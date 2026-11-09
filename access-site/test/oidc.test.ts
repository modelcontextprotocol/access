import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { sha256 } from '../src/crypto';
import { workspaceAccountFor } from '../src/eligibility';
import { buildRoleLookup } from '../../src/config/roles';
import { hasGoogleWorkspaceAccount, type Member } from '../../src/config/utils';
import {
  CLIENT_SECRET,
  CookieJar,
  GOOGLE_REDIRECT,
  ISSUER,
  createEnv,
  mockGitHub,
} from './helpers';

const { pilot, existing } = vi.hoisted(() => ({
  pilot: { id: 4242, login: 'test-pilot' },
  existing: { id: 4243, login: 'test-existing' },
}));

vi.mock('../../src/config/users', async () => {
  const { ROLE_IDS } = await import('../../src/config/roleIds');
  const name = { firstName: 'Test', lastName: 'Person' };
  const provisioning = { ...name, memberOf: [ROLE_IDS.CORE_MAINTAINERS] };
  return {
    MEMBERS: [
      { ...provisioning, github: pilot.login, githubUserId: pilot.id, googleEmailPrefix: 'Pilot' },
      {
        ...name,
        github: existing.login,
        githubUserId: existing.id,
        googleEmailPrefix: 'existing',
        memberOf: [],
        existingGWSUser: true,
      },
      { ...provisioning, github: 'unverified', googleEmailPrefix: 'unverified' },
      { ...provisioning, github: 'missing-prefix' },
      { ...provisioning, github: 'missing-name', googleEmailPrefix: 'incomplete', firstName: '' },
      { ...name, github: 'missing-role', googleEmailPrefix: 'missing-role', memberOf: [] },
      { ...provisioning, github: 'opted-out', skipGoogleUserProvisioning: true },
    ] satisfies Member[],
  };
});

const VERIFIER = 'v'.repeat(43) + '-verifier-for-tests';
const DOMAIN = 'modelcontextprotocol.io';

let env: Env;
let lastJar: CookieJar;
let lastGitHub: ReturnType<typeof mockGitHub>;

async function call(path: string, jar: CookieJar, init: RequestInit = {}) {
  const res = await app.request(
    `${ISSUER}${path}`,
    { ...init, headers: { Cookie: jar.header() } },
    env
  );
  jar.store(res);
  return res;
}

async function startSignIn(params: Record<string, string | undefined> = {}, method = 'GET') {
  const jar = new CookieJar();
  const query = new URLSearchParams(
    Object.entries({
      client_id: 'google-workspace',
      redirect_uri: GOOGLE_REDIRECT,
      response_type: 'code',
      scope: 'openid email profile',
      state: 'google-state',
      nonce: 'google-nonce',
      code_challenge: await sha256(VERIFIER),
      code_challenge_method: 'S256',
      ...params,
    }).filter((e): e is [string, string] => e[1] !== undefined)
  );
  const authorize =
    method === 'POST'
      ? await call('/authorize', jar, { method, body: query })
      : await call(`/authorize?${query}`, jar);
  expect(authorize.status).toBe(method === 'POST' ? 303 : 302);
  expect(authorize.headers.get('Location')).toBe('/login');
  expect(authorize.headers.getSetCookie()).toEqual([
    expect.stringMatching(/^__Host-mcp_pending=.+; Path=\/; .*HttpOnly; Secure; SameSite=Lax$/i),
  ]);
  expect(authorize.headers.get('Cross-Origin-Opener-Policy')).toBeNull();

  const toGitHub = await call('/login', jar);
  expect(toGitHub.status).toBe(302);
  const githubUrl = new URL(toGitHub.headers.get('Location')!);
  expect(githubUrl.origin).toBe('https://github.com');
  expect(githubUrl.searchParams.get('redirect_uri')).toBe(`${ISSUER}/login`);
  return { jar, githubUrl, state: githubUrl.searchParams.get('state')! };
}

/** Runs Google -> /authorize -> GitHub -> back; returns the final response. */
async function signIn(github = pilot, params: Record<string, string | undefined> = {}) {
  lastGitHub = mockGitHub({ ...github, name: 'Test Person' });
  const { jar, state } = await startSignIn(params);
  lastJar = jar;
  return call(`/login?code=gh-code&state=${state}`, jar);
}

function codeFrom(res: Response): string {
  return new URL(res.headers.get('Location')!).searchParams.get('code')!;
}

async function exchange(code: string, extra: Record<string, string> = {}) {
  return app.request(
    `${ISSUER}/token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`google-workspace:${CLIENT_SECRET}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: GOOGLE_REDIRECT,
        code_verifier: VERIFIER,
        ...extra,
      }),
    },
    env
  );
}

beforeEach(async () => {
  env = await createEnv();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('users.ts mapping', () => {
  it('maps both provisioned and existing Workspace accounts, ignoring login case', () => {
    expect(workspaceAccountFor(pilot.login.toUpperCase())).toEqual({
      prefix: 'pilot',
      githubUserId: pilot.id,
    });
    expect(workspaceAccountFor(existing.login)).toEqual({
      prefix: 'existing',
      githubUserId: existing.id,
    });
  });

  it('does not map unprovisioned, opted-out or unknown members', () => {
    for (const login of [
      'missing-prefix',
      'missing-name',
      'missing-role',
      'opted-out',
      'unknown',
    ]) {
      expect(workspaceAccountFor(login), login).toBeUndefined();
    }
  });
});

describe('discovery', () => {
  it('publishes metadata and a public-only JWKS', async () => {
    const meta = (await (
      await app.request(`${ISSUER}/.well-known/openid-configuration`, {}, env)
    ).json()) as Record<string, unknown>;
    expect(meta.issuer).toBe(ISSUER);
    expect(meta.token_endpoint).toBe(`${ISSUER}/token`);
    const jwks = (await (await app.request(`${ISSUER}/jwks`, {}, env)).json()) as {
      keys: { kid: string; d?: string }[];
    };
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]!.kid).toBeTruthy();
    expect(jwks.keys[0]!.d).toBeUndefined();
  });

  it('publishes the previous key during rotation, and ignores "{}"', async () => {
    const current = (await (await app.request(`${ISSUER}/jwks`, {}, env)).json()) as {
      keys: Record<string, string>[];
    };
    const previous = { ...current.keys[0]!, kid: 'previous-kid' };
    const rotating = await createEnv({ OIDC_PREVIOUS_JWK: JSON.stringify(previous) });
    const both = (await (await app.request(`${ISSUER}/jwks`, {}, rotating)).json()) as {
      keys: { kid: string }[];
    };
    expect(both.keys.map((k) => k.kid)).toContain('previous-kid');
    expect(both.keys).toHaveLength(2);

    const retired = await createEnv({ OIDC_PREVIOUS_JWK: '{}' });
    const one = (await (await app.request(`${ISSUER}/jwks`, {}, retired)).json()) as {
      keys: unknown[];
    };
    expect(one.keys).toHaveLength(1);
  });

  it('publishes the next key before cutover and keeps both keys across the switch', async () => {
    const jwks = async (binding: Env) => {
      const response = await app.request(`${ISSUER}/jwks`, {}, binding);
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
      return ((await response.json()) as { keys: { kid: string }[] }).keys;
    };
    const next = await createEnv();
    const [currentKey] = await jwks(env);
    const [nextKey] = await jwks(next);
    const nextJwk = JSON.stringify(nextKey);
    expect(await jwks({ ...env, OIDC_NEXT_JWK: nextJwk })).toEqual([currentKey, nextKey]);
    expect(
      await jwks({
        ...next,
        OIDC_PREVIOUS_JWK: JSON.stringify(currentKey),
        OIDC_NEXT_JWK: nextJwk,
      })
    ).toEqual([nextKey, currentKey]);
  });
});

describe('sign-in', () => {
  it('signs in a configured member with the GitHub ID as subject', async () => {
    const back = await signIn();
    expect(back.status).toBe(302);
    const location = new URL(back.headers.get('Location')!);
    expect(`${location.origin}${location.pathname}`).toBe(GOOGLE_REDIRECT);
    expect(location.searchParams.get('state')).toBe('google-state');

    const res = await exchange(codeFrom(back));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id_token: string; access_token: string };

    const jwks = (await (await app.request(`${ISSUER}/jwks`, {}, env)).json()) as { keys: never[] };
    const { payload } = await jwtVerify(body.id_token, createLocalJWKSet(jwks), {
      issuer: ISSUER,
      audience: 'google-workspace',
    });
    expect(payload.sub).toBe('4242');
    expect(payload.email).toBe(`pilot@${DOMAIN}`);
    expect(payload.nonce).toBe('google-nonce');
    expect(payload.preferred_username).toBe(pilot.login);

    const info = await app.request(
      `${ISSUER}/userinfo`,
      { headers: { Authorization: `Bearer ${body.access_token}` } },
      env
    );
    expect(((await info.json()) as { sub: string }).sub).toBe('4242');
  });

  it('works when the client sends no PKCE challenge', async () => {
    const back = await signIn(pilot, {
      code_challenge: undefined,
      code_challenge_method: undefined,
    });
    expect((await exchange(codeFrom(back), { code_verifier: '' })).status).toBe(200);
  });

  it('refuses GitHub users without an account in users.ts', async () => {
    for (const login of [
      'missing-prefix',
      'missing-name',
      'missing-role',
      'opted-out',
      'unknown',
    ]) {
      const res = await signIn({ id: 7, login });
      expect(res.status, login).toBe(403);
      expect(await res.text()).toContain('Infrastructure WG');
    }
  });

  it('rejects code replay', async () => {
    const code = codeFrom(await signIn());
    expect((await exchange(code)).status).toBe(200);
    const replay = await exchange(code);
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('rejects a wrong PKCE verifier and a wrong client secret', async () => {
    const code = codeFrom(await signIn());
    expect((await exchange(code, { code_verifier: 'x'.repeat(43) })).status).toBe(400);

    const code2 = codeFrom(await signIn());
    const res = await app.request(
      `${ISSUER}/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: code2,
          redirect_uri: GOOGLE_REDIRECT,
          code_verifier: VERIFIER,
          client_id: 'google-workspace',
          client_secret: 'wrong',
        }),
      },
      env
    );
    expect(res.status).toBe(401);
  });

  it('never redirects to an unregistered redirect_uri', async () => {
    const res = await app.request(
      `${ISSUER}/authorize?client_id=google-workspace&redirect_uri=${encodeURIComponent('https://evil.example/cb')}&response_type=code&scope=openid`,
      {},
      env
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('does not start a GitHub sign-in unless Google is waiting', async () => {
    const res = await app.request(`${ISSUER}/login`, {}, env);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
  });
});

describe('security hardening', () => {
  it('rejects a recycled login on its first sign-in', async () => {
    const res = await signIn({ id: 999, login: pilot.login });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('does not match the verified ID');
    expect((await signIn({ ...pilot, login: pilot.login.toUpperCase() })).status).toBe(302);
  });

  it('refuses an existing account without a reviewed GitHub ID', async () => {
    const res = await signIn({ id: 7, login: 'unverified' });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('no verified GitHub ID');
  });

  it('signs in an existing Workspace account without a provisioning role', async () => {
    const res = await signIn(existing);
    expect(res.status).toBe(302);
    expect((await exchange(codeFrom(res))).status).toBe(200);
  });

  it('returns GitHub cancellation to Google with its original state and consumes the request', async () => {
    const github = mockGitHub({ ...pilot, name: null });
    const { jar, state } = await startSignIn();
    const res = await call(`/login?error=access_denied&state=${state}`, jar);
    expect(res.status).toBe(302);
    const redirect = new URL(res.headers.get('Location')!);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(GOOGLE_REDIRECT);
    expect(Object.fromEntries(redirect.searchParams)).toEqual({
      error: 'access_denied',
      state: 'google-state',
    });
    expect(jar.header()).toBe('');
    expect(github).not.toHaveBeenCalled();
  });

  it('rejects state from a different browser even if a legacy state cookie matches', async () => {
    const github = mockGitHub({ ...pilot, name: null });
    const first = await startSignIn();
    const second = await startSignIn();
    expect(first.state).not.toBe(second.state);
    const injected = await app.request(
      `${ISSUER}/login?code=gh-code&state=${second.state}`,
      { headers: { Cookie: `state=${second.state}; ${first.jar.header()}` } },
      env
    );
    expect(injected.status).toBe(400);
    expect(github).not.toHaveBeenCalled();
    expect((await call(`/login?code=gh-code&state=${first.state}`, first.jar)).status).toBe(302);

    const exchange = github.mock.calls.find(
      ([url]) => url === 'https://github.com/login/oauth/access_token'
    );
    const form = exchange?.[1]?.body as URLSearchParams;
    expect(await sha256(form.get('code_verifier')!)).toBe(
      first.githubUrl.searchParams.get('code_challenge')
    );
    expect(first.githubUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(form.get('redirect_uri')).toBe(`${ISSUER}/login`);
  });

  it('supports form POST /authorize and returns 502 on a malformed GitHub identity', async () => {
    mockGitHub({ id: 0, login: pilot.login, name: null });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { jar, state } = await startSignIn({}, 'POST');
    expect((await call(`/login?code=gh-code&state=${state}`, jar)).status).toBe(502);
  });

  it('rate-limits /authorize per IP when the limiter is bound', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    env = await createEnv({ RATE_LIMITER: { limit } as unknown as RateLimit });
    const res = await app.request(
      `${ISSUER}/authorize?client_id=google-workspace&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT)}&response_type=code&scope=openid`,
      { headers: { 'CF-Connecting-IP': '203.0.113.7' } },
      env
    );
    expect(res.status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' });
  });

  it('decodes form-encoded Basic client credentials (RFC 6749 2.3.1)', async () => {
    env = await createEnv({ OIDC_CLIENT_SECRET: 'a b:c+d' });
    const code = codeFrom(await signIn());
    const encoded = `google-workspace:${encodeURIComponent('a b:c+d').replace(/%20/g, '+')}`;
    const res = await app.request(
      `${ISSUER}/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${btoa(encoded)}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: GOOGLE_REDIRECT,
          code_verifier: VERIFIER,
        }),
      },
      env
    );
    expect(res.status).toBe(200);
  });

  it('rejects a code_verifier when no challenge was sent (PKCE downgrade)', async () => {
    const back = await signIn(pilot, {
      code_challenge: undefined,
      code_challenge_method: undefined,
    });
    const res = await exchange(codeFrom(back));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('stamps auth_time at GitHub sign-in, revokes the GitHub token and clears the pending cookie', async () => {
    const before = Math.floor(Date.now() / 1000);
    const back = await signIn();
    expect(lastGitHub).toHaveBeenCalledWith(
      'https://api.github.com/applications/gh-client/token',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(lastJar.header()).toBe('');

    const body = (await (await exchange(codeFrom(back))).json()) as { id_token: string };
    const jwks = (await (await app.request(`${ISSUER}/jwks`, {}, env)).json()) as { keys: never[] };
    const { payload } = await jwtVerify(body.id_token, createLocalJWKSet(jwks), {
      issuer: ISSUER,
      audience: 'google-workspace',
    });
    expect(payload.auth_time).toBeGreaterThanOrEqual(before);
    expect(payload.auth_time).toBeLessThanOrEqual(payload.iat!);
  });
});

describe('users.ts invariants the sign-in mapping relies on', () => {
  it('has no two members with the same GitHub login or email prefix, ignoring case', async () => {
    const { MEMBERS } =
      await vi.importActual<typeof import('../../src/config/users')>('../../src/config/users');
    const logins = MEMBERS.flatMap((m) => (m.github ? [m.github.toLowerCase()] : []));
    expect(new Set(logins).size).toBe(logins.length);
    const prefixes = MEMBERS.flatMap((m) =>
      m.googleEmailPrefix ? [m.googleEmailPrefix.toLowerCase()] : []
    );
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe('rollout pilot', () => {
  it('only lets the pilot logins sign in when PILOT_GITHUB_LOGINS is set', async () => {
    env = await createEnv({ PILOT_GITHUB_LOGINS: ` ${pilot.login.toUpperCase()} ` });
    expect((await signIn()).status).toBe(302);

    const res = await signIn(existing);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("isn't enabled");
  });

  it('maps every live pilot login to a Workspace account with a verified GitHub ID', async () => {
    const { MEMBERS } =
      await vi.importActual<typeof import('../../src/config/users')>('../../src/config/users');
    const roleLookup = buildRoleLookup();
    const toml = readFileSync(join(import.meta.dirname, '../wrangler.toml'), 'utf8');
    const match = toml.match(/^PILOT_GITHUB_LOGINS\s*=\s*"([^"]*)"/m);
    const logins = (match?.[1] ?? '')
      .split(',')
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);
    for (const login of logins) {
      const member = MEMBERS.find((m) => m.github?.toLowerCase() === login);
      expect(member && hasGoogleWorkspaceAccount(member, roleLookup), login).toBe(true);
      expect(member?.githubUserId, login).toBeGreaterThan(0);
      expect(Number.isSafeInteger(member?.githubUserId), login).toBe(true);
    }
  });
});
