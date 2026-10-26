import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { sha256 } from '../src/crypto';
import { workspaceEmailFor } from '../src/eligibility';
import { MEMBERS } from '../../src/config/users';
import {
  CLIENT_SECRET,
  CookieJar,
  GOOGLE_REDIRECT,
  ISSUER,
  createEnv,
  ineligibleMember,
  memberWithAccount,
  memberWithoutAccount,
  mockGitHub,
} from './helpers';

const VERIFIER = 'v'.repeat(43) + '-verifier-for-tests';
const DOMAIN = 'modelcontextprotocol.io';

let env: Env;
let lastJar: CookieJar;
let lastGitHub: ReturnType<typeof mockGitHub>;

async function call(path: string, jar: CookieJar) {
  const res = await app.request(`${ISSUER}${path}`, { headers: { Cookie: jar.header() } }, env);
  jar.store(res);
  return res;
}

/** Runs Google -> /authorize -> GitHub -> back; returns the final response. */
async function signIn(
  github: { id: number; login: string },
  params: Record<string, string | undefined> = {}
) {
  lastGitHub = mockGitHub({ ...github, name: 'Test Person' });
  const jar = new CookieJar();
  lastJar = jar;
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
  const authorize = await call(`/authorize?${query}`, jar);
  expect(authorize.status).toBe(302);
  expect(authorize.headers.get('Location')).toBe('/login');

  const toGitHub = await call('/login', jar);
  expect(toGitHub.status).toBe(302);
  const githubUrl = new URL(toGitHub.headers.get('Location')!);
  expect(githubUrl.origin).toBe('https://github.com');

  return call(`/login?code=gh-code&state=${githubUrl.searchParams.get('state')}`, jar);
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
  it('maps a configured member to their address, case-insensitively', () => {
    const m = memberWithAccount();
    expect(workspaceEmailFor(m.github!.toUpperCase(), DOMAIN)).toBe(
      `${m.googleEmailPrefix!.toLowerCase()}@${DOMAIN}`
    );
  });
  it('returns null without a prefix, without an eligible role, or when unknown', () => {
    expect(workspaceEmailFor(memberWithoutAccount().github!, DOMAIN)).toBeNull();
    expect(workspaceEmailFor(ineligibleMember().github!, DOMAIN)).toBeNull();
    expect(workspaceEmailFor('definitely-not-a-configured-user', DOMAIN)).toBeNull();
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
});

describe('sign-in', () => {
  it('signs in a configured member with the GitHub ID as subject', async () => {
    const member = memberWithAccount();
    const back = await signIn({ id: 4242, login: member.github! });
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
    expect(payload.email).toBe(`${member.googleEmailPrefix!.toLowerCase()}@${DOMAIN}`);
    expect(payload.nonce).toBe('google-nonce');
    expect(payload.preferred_username).toBe(member.github);

    const info = await app.request(
      `${ISSUER}/userinfo`,
      { headers: { Authorization: `Bearer ${body.access_token}` } },
      env
    );
    expect(((await info.json()) as { sub: string }).sub).toBe('4242');
  });

  it('works when the client sends no PKCE challenge', async () => {
    const back = await signIn(
      { id: 1, login: memberWithAccount().github! },
      { code_challenge: undefined, code_challenge_method: undefined }
    );
    expect((await exchange(codeFrom(back), { code_verifier: '' })).status).toBe(200);
  });

  it('refuses GitHub users without an account in users.ts', async () => {
    for (const login of [
      memberWithoutAccount().github!,
      ineligibleMember().github!,
      'definitely-not-a-configured-user',
    ]) {
      const res = await signIn({ id: 7, login });
      expect(res.status, login).toBe(403);
      expect(await res.text()).toContain('googleEmailPrefix');
    }
  });

  it('rejects code replay', async () => {
    const code = codeFrom(await signIn({ id: 2, login: memberWithAccount().github! }));
    expect((await exchange(code)).status).toBe(200);
    const replay = await exchange(code);
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('rejects a wrong PKCE verifier and a wrong client secret', async () => {
    const login = memberWithAccount().github!;
    const code = codeFrom(await signIn({ id: 3, login }));
    expect((await exchange(code, { code_verifier: 'x'.repeat(43) })).status).toBe(400);

    const code2 = codeFrom(await signIn({ id: 3, login }));
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
  it('refuses a login that is pinned to a different GitHub account', async () => {
    const login = memberWithAccount().github!;
    expect((await signIn({ id: 100, login })).status).toBe(302);
    // Same login, different GitHub user ID: a freed and re-registered name.
    const res = await signIn({ id: 200, login });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('previously used by a different GitHub account');
    // The original owner still signs in.
    expect((await signIn({ id: 100, login: login.toUpperCase() })).status).toBe(302);
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
    const code = codeFrom(await signIn({ id: 5, login: memberWithAccount().github! }));
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
    const back = await signIn(
      { id: 6, login: memberWithAccount().github! },
      { code_challenge: undefined, code_challenge_method: undefined }
    );
    const res = await exchange(codeFrom(back));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('stamps auth_time at GitHub sign-in, revokes the GitHub token and clears the state cookie', async () => {
    const before = Math.floor(Date.now() / 1000);
    const back = await signIn({ id: 8, login: memberWithAccount().github! });
    expect(lastGitHub).toHaveBeenCalledWith(
      'https://api.github.com/applications/gh-client/token',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(lastJar.header()).not.toMatch(/(^|; )state=/);

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
  it('has no two members with the same GitHub login or email prefix, ignoring case', () => {
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
    const withAccount = MEMBERS.filter((m) => m.github && workspaceEmailFor(m.github, DOMAIN));
    const [pilot, other] = withAccount;
    env = await createEnv({ PILOT_GITHUB_LOGINS: ` ${pilot!.github!.toUpperCase()} ` });

    expect((await signIn({ id: 11, login: pilot!.github! })).status).toBe(302);

    const res = await signIn({ id: 12, login: other!.github! });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("isn't enabled");
  });

  it('maps every pilot login in wrangler.toml to a Workspace account', () => {
    const toml = readFileSync(join(import.meta.dirname, '../wrangler.toml'), 'utf8');
    const match = toml.match(/^PILOT_GITHUB_LOGINS\s*=\s*"([^"]*)"/m);
    const logins = (match?.[1] ?? '')
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
    for (const login of logins) {
      expect(workspaceEmailFor(login, DOMAIN), login).not.toBeNull();
    }
  });
});
