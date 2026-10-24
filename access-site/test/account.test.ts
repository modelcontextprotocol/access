import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/index';
import type { Env } from '../src/env';
import {
  CookieJar,
  type FakeWorld,
  ISSUER,
  createEnv,
  ineligibleMember,
  installFetchMock,
  memberWithPrefix,
  memberWithoutPrefix,
} from './helpers';

let env: Env;

async function signedIn(login: string, id: number, world: FakeWorld) {
  env = await createEnv();
  world.githubUser = { id, login, name: 'Ada Lovelace' };
  installFetchMock(world);
  const jar = new CookieJar();
  const go = async (path: string, init: RequestInit = {}) => {
    const res = await app.request(
      `${ISSUER}${path}`,
      { ...init, headers: { ...(init.headers as Record<string, string>), Cookie: jar.header() } },
      env
    );
    jar.store(res);
    return res;
  };
  const toGitHub = await go('/login');
  const state = new URL(toGitHub.headers.get('Location')!).searchParams.get('state');
  const back = await go(`/login?code=c&state=${state}`);
  expect(back.headers.get('Location')).toBe('/');
  return go;
}

function emptyWorld(): FakeWorld {
  return {
    githubUser: { id: 0, login: '', name: null },
    githubLogins: new Map(),
    directory: new Map(),
    calls: [],
  };
}

function post(form: Record<string, string>, origin = ISSUER): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: origin },
    body: new URLSearchParams(form).toString(),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('account page', () => {
  it('shows a sign-in button when signed out', async () => {
    env = await createEnv();
    const res = await app.request(`${ISSUER}/`, {}, env);
    expect(await res.text()).toContain('Sign in with GitHub');
  });

  it('creates an account with a chosen address for an eligible member', async () => {
    const world = emptyWorld();
    const member = memberWithoutPrefix();
    const go = await signedIn(member.github!, 777, world);

    const page = await (await go('/')).text();
    expect(page).toContain('Create account');

    const res = await go(
      '/account',
      post({ firstName: 'Ada', lastName: 'Lovelace', prefix: 'ada.test' })
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('ada.test@modelcontextprotocol.io');

    const created = world.directory.get('ada.test@modelcontextprotocol.io')!;
    expect(created.orgUnitPath).toBe('/Model Context Protocol');
    expect(created.externalIds).toEqual([{ type: 'custom', customType: 'github', value: '777' }]);

    const log = await env.DB.prepare(`SELECT action, subject FROM audit_log`).first<{
      action: string;
      subject: string;
    }>();
    expect(log).toEqual({ action: 'account.create', subject: 'ada.test@modelcontextprotocol.io' });

    // Second visit shows the account instead of the form.
    expect(await (await go('/')).text()).toContain('Open Gmail');
  });

  it('links the address configured in users.ts instead of creating a new one', async () => {
    const world = emptyWorld();
    const member = memberWithPrefix();
    const email = `${member.googleEmailPrefix}@modelcontextprotocol.io`;
    world.directory.set(email, { primaryEmail: email, orgUnitPath: '/Model Context Protocol' });
    const go = await signedIn(member.github!, 888, world);

    const res = await go(
      '/account',
      post({ firstName: 'Ada', lastName: 'Lovelace', prefix: 'ignored' })
    );
    expect(res.status).toBe(200);
    expect(world.directory.get(email)!.externalIds).toEqual([
      { type: 'custom', customType: 'github', value: '888' },
    ]);
    expect(world.directory.has('ignored@modelcontextprotocol.io')).toBe(false);
  });

  it('refuses an address that is taken or reserved', async () => {
    const world = emptyWorld();
    world.directory.set('taken@modelcontextprotocol.io', {
      primaryEmail: 'taken@modelcontextprotocol.io',
    });
    const go = await signedIn(memberWithoutPrefix().github!, 999, world);

    const taken = await go('/account', post({ firstName: 'Ada', lastName: 'L', prefix: 'taken' }));
    expect(taken.status).toBe(400);
    expect(await taken.text()).toContain('already taken');

    const reserved = await go(
      '/account',
      post({ firstName: 'Ada', lastName: 'L', prefix: 'postmaster' })
    );
    expect(reserved.status).toBe(400);
    expect(await reserved.text()).toContain('reserved');
  });

  it('rejects cross-site form posts', async () => {
    const world = emptyWorld();
    const go = await signedIn(memberWithoutPrefix().github!, 555, world);
    const res = await go(
      '/account',
      post({ firstName: 'Ada', lastName: 'L', prefix: 'ada.x' }, 'https://evil.example')
    );
    expect(res.status).toBe(403);
    expect(world.directory.size).toBe(0);
  });

  it('tells ineligible users why, without a form', async () => {
    const world = emptyWorld();
    const go = await signedIn(ineligibleMember().github!, 123, world);
    const text = await (await go('/')).text();
    expect(text).toContain('is not in a team');
    expect(text).not.toContain('<form method="post" action="/account">');
    const res = await go('/account', post({ firstName: 'Ada', lastName: 'L', prefix: 'sneaky' }));
    expect(res.status).toBe(400);
    expect(world.directory.size).toBe(0);
  });
});
