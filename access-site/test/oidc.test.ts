import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { app } from '../src/index';
import type { Env } from '../src/env';
import { sha256 } from '../src/crypto';
import {
  CLIENT_SECRET,
  CookieJar,
  type FakeWorld,
  GOOGLE_REDIRECT,
  ISSUER,
  createEnv,
  installFetchMock,
  memberWithPrefix,
} from './helpers';

const VERIFIER = 'v'.repeat(43) + '-verifier-for-tests';

let env: Env;
let world: FakeWorld;

function worldFor(login: string, id = 4242): FakeWorld {
  return {
    githubUser: { id, login, name: 'Test Person' },
    githubLogins: new Map([[String(id), login]]),
    directory: new Map(),
    calls: [],
  };
}

async function call(path: string, jar: CookieJar, init: RequestInit = {}) {
  const res = await app.request(
    `${ISSUER}${path}`,
    { ...init, headers: { ...(init.headers as Record<string, string>), Cookie: jar.header() } },
    env
  );
  jar.store(res);
  return res;
}

/** Runs Google -> /authorize -> GitHub -> back to Google; returns the final redirect. */
async function signIn(jar: CookieJar, params: Record<string, string> = {}) {
  const query = new URLSearchParams({
    client_id: 'google-workspace',
    redirect_uri: GOOGLE_REDIRECT,
    response_type: 'code',
    scope: 'openid email profile',
    state: 'google-state',
    nonce: 'google-nonce',
    code_challenge: await sha256(VERIFIER),
    code_challenge_method: 'S256',
    ...params,
  });
  const authorize = await call(`/authorize?${query}`, jar);
  expect(authorize.status).toBe(302);
  expect(authorize.headers.get('Location')).toBe('/login');

  const toGitHub = await call('/login', jar);
  expect(toGitHub.status).toBe(302);
  const githubUrl = new URL(toGitHub.headers.get('Location')!);
  expect(githubUrl.origin).toBe('https://github.com');

  return call(`/login?code=gh-code&state=${githubUrl.searchParams.get('state')}`, jar);
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
  const member = memberWithPrefix();
  world = worldFor(member.github!);
  world.directory.set(`${member.googleEmailPrefix}@modelcontextprotocol.io`, {
    primaryEmail: `${member.googleEmailPrefix}@modelcontextprotocol.io`,
    orgUnitPath: '/Model Context Protocol',
    externalIds: [{ type: 'custom', customType: 'github', value: '4242' }],
  });
  installFetchMock(world);
});

afterEach(() => vi.unstubAllGlobals());

describe('discovery', () => {
  it('publishes metadata and a JWKS', async () => {
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
});

describe('authorization code flow', () => {
  it('signs in a linked, eligible user with the GitHub ID as subject', async () => {
    const jar = new CookieJar();
    const back = await signIn(jar);
    expect(back.status).toBe(302);
    const location = new URL(back.headers.get('Location')!);
    expect(`${location.origin}${location.pathname}`).toBe(GOOGLE_REDIRECT);
    expect(location.searchParams.get('state')).toBe('google-state');

    const res = await exchange(location.searchParams.get('code')!);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id_token: string; access_token: string };

    const jwks = (await (await app.request(`${ISSUER}/jwks`, {}, env)).json()) as { keys: never[] };
    const { payload } = await jwtVerify(body.id_token, createLocalJWKSet(jwks), {
      issuer: ISSUER,
      audience: 'google-workspace',
    });
    const member = memberWithPrefix();
    expect(payload.sub).toBe('4242');
    expect(payload.email).toBe(`${member.googleEmailPrefix}@modelcontextprotocol.io`);
    expect(payload.nonce).toBe('google-nonce');
    expect(payload.preferred_username).toBe(member.github);

    const info = await app.request(
      `${ISSUER}/userinfo`,
      { headers: { Authorization: `Bearer ${body.access_token}` } },
      env
    );
    expect(((await info.json()) as { sub: string }).sub).toBe('4242');
  });

  it('rejects code replay', async () => {
    const back = await signIn(new CookieJar());
    const code = new URL(back.headers.get('Location')!).searchParams.get('code')!;
    expect((await exchange(code)).status).toBe(200);
    const replay = await exchange(code);
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('rejects a wrong PKCE verifier and a wrong client secret', async () => {
    const back = await signIn(new CookieJar());
    const code = new URL(back.headers.get('Location')!).searchParams.get('code')!;
    expect((await exchange(code, { code_verifier: 'x'.repeat(43) })).status).toBe(400);

    const back2 = await signIn(new CookieJar());
    const code2 = new URL(back2.headers.get('Location')!).searchParams.get('code')!;
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

  it('sends users without an account to the account page instead of Google', async () => {
    world.directory.clear();
    const jar = new CookieJar();
    const back = await signIn(jar);
    expect(back.headers.get('Location')).toBe('/?signin=blocked');
    const home = await call('/?signin=blocked', jar);
    const text = await home.text();
    expect(text).toContain('You need an active');
    expect(text).toContain('Set up account');
  });

  it('refuses suspended accounts', async () => {
    const [user] = [...world.directory.values()];
    user!.suspended = true;
    const back = await signIn(new CookieJar());
    expect(back.headers.get('Location')).toBe('/?signin=blocked');
  });
});
