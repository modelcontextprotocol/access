/**
 * Minimal Google Admin SDK Directory client.
 *
 * Authenticates as the service account itself (no domain-wide delegation).
 * The service account holds a custom admin role with user create, read and
 * update privileges scoped to the MCP organizational unit, so this Worker
 * cannot touch admins or users in other OUs.
 */
import { SignJWT, importPKCS8 } from 'jose';
import type { Env } from './env';
import { nowSeconds, randomToken } from './crypto';

const DIRECTORY = 'https://admin.googleapis.com/admin/directory/v1';
const SCOPE = 'https://www.googleapis.com/auth/admin.directory.user';
export const GITHUB_EXTERNAL_ID_TYPE = 'github';

export interface ExternalId {
  type: string;
  customType?: string;
  value: string;
}

export interface DirectoryUser {
  primaryEmail: string;
  suspended?: boolean;
  isAdmin?: boolean;
  orgUnitPath?: string;
  externalIds?: ExternalId[];
  name?: { givenName?: string; familyName?: string; fullName?: string };
}

let cachedToken: { key: string; token: string; exp: number } | undefined;

async function accessToken(env: Env): Promise<string> {
  if (cachedToken?.key === env.GOOGLE_SA_KEY && cachedToken.exp > nowSeconds() + 60) {
    return cachedToken.token;
  }
  const sa = JSON.parse(env.GOOGLE_SA_KEY) as {
    client_email: string;
    private_key: string;
    token_uri?: string;
  };
  const tokenUri = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setAudience(tokenUri)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(await importPKCS8(sa.private_key, 'RS256'));
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    key: env.GOOGLE_SA_KEY,
    token: body.access_token,
    exp: nowSeconds() + body.expires_in,
  };
  return body.access_token;
}

async function directory(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<Response> {
  return fetch(`${DIRECTORY}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${await accessToken(env)}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function expectOk(res: Response, what: string): Promise<void> {
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${what} failed: ${res.status} ${detail.slice(0, 300)}`);
  }
}

function githubExternalId(githubId: string): ExternalId {
  return { type: 'custom', customType: GITHUB_EXTERNAL_ID_TYPE, value: githubId };
}

export function githubIdOf(user: DirectoryUser): string | undefined {
  return user.externalIds?.find(
    (e) => e.type === 'custom' && e.customType === GITHUB_EXTERNAL_ID_TYPE
  )?.value;
}

export async function getUser(env: Env, email: string): Promise<DirectoryUser | null> {
  const res = await directory(env, `/users/${encodeURIComponent(email)}`);
  if (res.status === 404) return null;
  await expectOk(res, 'users.get');
  return (await res.json()) as DirectoryUser;
}

/** Finds the Workspace user linked to a GitHub user ID, if any. */
export async function findUserByGithubId(
  env: Env,
  githubId: string
): Promise<DirectoryUser | null> {
  const params = new URLSearchParams({
    customer: 'my_customer',
    query: `externalId:${githubId}`,
    maxResults: '10',
  });
  const res = await directory(env, `/users?${params}`);
  await expectOk(res, 'users.list');
  const body = (await res.json()) as { users?: DirectoryUser[] };
  // The search matches any external ID type, so keep only our "github" one.
  return body.users?.find((u) => githubIdOf(u) === githubId) ?? null;
}

export async function listUsersInOu(env: Env): Promise<DirectoryUser[]> {
  const users: DirectoryUser[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      customer: 'my_customer',
      query: `orgUnitPath='${env.WORKSPACE_OU_PATH}'`,
      maxResults: '500',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await directory(env, `/users?${params}`);
    await expectOk(res, 'users.list');
    const body = (await res.json()) as { users?: DirectoryUser[]; nextPageToken?: string };
    users.push(...(body.users ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return users;
}

export type CreateResult = { status: 'created' } | { status: 'conflict' };

export async function createUser(
  env: Env,
  input: { email: string; firstName: string; lastName: string; githubId: string }
): Promise<CreateResult> {
  const res = await directory(env, '/users', {
    method: 'POST',
    body: {
      primaryEmail: input.email,
      name: { givenName: input.firstName, familyName: input.lastName },
      // Sign-in is always SSO; this password is never shown to anyone.
      password: randomToken(32),
      changePasswordAtNextLogin: false,
      orgUnitPath: env.WORKSPACE_OU_PATH,
      externalIds: [githubExternalId(input.githubId)],
    },
  });
  // 409: the address is already a user, alias or group.
  if (res.status === 409) return { status: 'conflict' };
  await expectOk(res, 'users.insert');
  return { status: 'created' };
}

/** Records the GitHub ID on an existing user, keeping its other external IDs. */
export async function linkGithubId(env: Env, user: DirectoryUser, githubId: string): Promise<void> {
  const others = (user.externalIds ?? []).filter(
    (e) => !(e.type === 'custom' && e.customType === GITHUB_EXTERNAL_ID_TYPE)
  );
  const res = await directory(env, `/users/${encodeURIComponent(user.primaryEmail)}`, {
    method: 'PATCH',
    body: { externalIds: [...others, githubExternalId(githubId)] },
  });
  await expectOk(res, 'users.patch (link)');
}

export async function suspendUser(env: Env, email: string): Promise<void> {
  const res = await directory(env, `/users/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    body: { suspended: true },
  });
  await expectOk(res, 'users.patch (suspend)');
}

/** Test hook. */
export function resetGoogleTokenCache(): void {
  cachedToken = undefined;
}
