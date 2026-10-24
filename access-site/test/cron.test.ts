import { afterEach, describe, expect, it, vi } from 'vitest';
import { runNightly } from '../src/cron';
import { getAccount } from '../src/db';
import {
  createEnv,
  type FakeWorld,
  ineligibleMember,
  installFetchMock,
  memberWithPrefix,
} from './helpers';

const OU = '/Model Context Protocol';

function world(): FakeWorld {
  const eligible = memberWithPrefix().github!;
  const ineligible = ineligibleMember().github!;
  return {
    githubUser: { id: 0, login: '', name: null },
    githubLogins: new Map([
      ['1', eligible],
      ['2', ineligible],
      ['3', ineligible],
    ]),
    directory: new Map(
      [
        { primaryEmail: 'keep@modelcontextprotocol.io', id: '1' },
        { primaryEmail: 'leaver@modelcontextprotocol.io', id: '2' },
        { primaryEmail: 'gone@modelcontextprotocol.io', id: '404' },
        { primaryEmail: 'admin@modelcontextprotocol.io', id: '3', isAdmin: true },
        { primaryEmail: 'unlinked@modelcontextprotocol.io' },
      ].map(({ id, ...u }) => [
        u.primaryEmail,
        {
          ...u,
          orgUnitPath: OU,
          externalIds: id ? [{ type: 'custom', customType: 'github', value: id }] : undefined,
        },
      ])
    ),
    calls: [],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('nightly job', () => {
  it('reports in report mode without suspending, and rebuilds the cache', async () => {
    const env = await createEnv();
    const w = world();
    installFetchMock(w);
    const report = await runNightly(env);
    expect(report.toSuspend.map((s) => s.email).sort()).toEqual([
      'gone@modelcontextprotocol.io',
      'leaver@modelcontextprotocol.io',
    ]);
    expect(report.suspended).toEqual([]);
    expect(report.unlinked).toEqual(['unlinked@modelcontextprotocol.io']);
    expect(w.directory.get('leaver@modelcontextprotocol.io')!.suspended).toBeFalsy();
    expect(await getAccount(env.DB, '1')).toMatchObject({ email: 'keep@modelcontextprotocol.io' });
    expect(await getAccount(env.DB, '3')).toBeNull(); // admins are never managed
  });

  it('suspends in enforce mode', async () => {
    const env = await createEnv({ OFFBOARDING_MODE: 'enforce' });
    const w = world();
    installFetchMock(w);
    const report = await runNightly(env);
    expect(report.suspended.sort()).toEqual([
      'gone@modelcontextprotocol.io',
      'leaver@modelcontextprotocol.io',
    ]);
    expect(w.directory.get('leaver@modelcontextprotocol.io')!.suspended).toBe(true);
    expect(w.directory.get('keep@modelcontextprotocol.io')!.suspended).toBeFalsy();
    expect((await getAccount(env.DB, '2'))!.suspended).toBe(true);
  });

  it('aborts when too many accounts would be suspended', async () => {
    const env = await createEnv({ OFFBOARDING_MODE: 'enforce', OFFBOARDING_MAX_PER_RUN: '1' });
    const w = world();
    installFetchMock(w);
    const report = await runNightly(env);
    expect(report.aborted).toBe(true);
    expect(report.suspended).toEqual([]);
    expect(w.directory.get('leaver@modelcontextprotocol.io')!.suspended).toBeFalsy();
  });

  it('skips, rather than suspends, when the GitHub lookup fails', async () => {
    const env = await createEnv({ OFFBOARDING_MODE: 'enforce' });
    const w = world();
    const mock = installFetchMock(w);
    const original = mock.getMockImplementation()!;
    mock.mockImplementation(async (input, init) => {
      if (String(input).startsWith('https://api.github.com/user/2'))
        return new Response('boom', { status: 502 });
      return original(input, init);
    });
    const report = await runNightly(env);
    expect(report.skipped.map((s) => s.email)).toEqual(['leaver@modelcontextprotocol.io']);
    expect(w.directory.get('leaver@modelcontextprotocol.io')!.suspended).toBeFalsy();
  });
});
