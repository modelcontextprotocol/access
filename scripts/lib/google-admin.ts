/**
 * Tiny Google Admin API client for one-off and scheduled scripts, using the
 * same service account as Pulumi. Reads the key from GOOGLE_SA_KEY (JSON) or
 * the file in GOOGLE_APPLICATION_CREDENTIALS (as set by
 * google-github-actions/auth). No extra dependencies.
 */
import { createSign } from 'crypto';
import { readFileSync } from 'fs';

const SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user',
  'https://www.googleapis.com/auth/admin.directory.group',
  'https://www.googleapis.com/auth/apps.groups.settings',
];

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function loadKey(): ServiceAccountKey {
  if (process.env.GOOGLE_SA_KEY) return JSON.parse(process.env.GOOGLE_SA_KEY);
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) return JSON.parse(readFileSync(path, 'utf8'));
  throw new Error('Set GOOGLE_SA_KEY or GOOGLE_APPLICATION_CREDENTIALS');
}

const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url');

let token: { value: string; exp: number } | undefined;

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (token && token.exp > now + 60) return token.value;
  const key = loadKey();
  const tokenUri = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPES.join(' '),
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    })
  )}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(key.private_key);
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(signature)}`,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, exp: now + body.expires_in };
  return token.value;
}

export class GoogleApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Calls a Google API. Returns null on 404; throws GoogleApiError otherwise. */
export async function googleApi<T>(method: string, url: string, body?: unknown): Promise<T | null> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new GoogleApiError(res.status, `${method} ${url}: ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? ({} as T) : ((await res.json()) as T);
}

export const DIRECTORY = 'https://admin.googleapis.com/admin/directory/v1';
export const GITHUB_EXTERNAL_ID_TYPE = 'github';

export interface DirectoryUser {
  primaryEmail: string;
  suspended?: boolean;
  isAdmin?: boolean;
  orgUnitPath?: string;
  externalIds?: { type: string; customType?: string; value: string }[];
}

export function githubIdOf(user: DirectoryUser): string | undefined {
  return user.externalIds?.find(
    (e) => e.type === 'custom' && e.customType === GITHUB_EXTERNAL_ID_TYPE
  )?.value;
}

export async function listAllUsers(): Promise<DirectoryUser[]> {
  const users: DirectoryUser[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ customer: 'my_customer', maxResults: '500' });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await googleApi<{ users?: DirectoryUser[]; nextPageToken?: string }>(
      'GET',
      `${DIRECTORY}/users?${params}`
    );
    users.push(...(page?.users ?? []));
    pageToken = page?.nextPageToken;
  } while (pageToken);
  return users;
}

/** GitHub user ID for a login, or current login for an ID. Uses GITHUB_TOKEN if set. */
export async function github<T>(path: string): Promise<T | null> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'modelcontextprotocol-access-scripts',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status}`);
  return (await res.json()) as T;
}
