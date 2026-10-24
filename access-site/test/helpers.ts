/**
 * Test harness: a D1 stand-in over node:sqlite (real SQL, including
 * DELETE ... RETURNING), generated keys, and a fetch mock for GitHub and the
 * Google Directory. Picks real members from src/config so tests follow the
 * live eligibility rules.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { exportPKCS8, generateKeyPair } from 'jose';
import { vi } from 'vitest';
import type { Env } from '../src/env';
import type { DirectoryUser } from '../src/google';
import { resetGoogleTokenCache } from '../src/google';
import { MEMBERS } from '../../src/config/users';
import { buildRoleLookup } from '../../src/config/roles';
import { hasProvisionUserRole } from '../../src/config/utils';

// --- D1 stand-in ---------------------------------------------------------------

class Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: unknown[] = []
  ) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params);
  }
  private args() {
    return this.params.map((p) => (typeof p === 'boolean' ? Number(p) : p)) as never[];
  }
  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.args()) as T | undefined) ?? null;
  }
  async all<T>() {
    return {
      results: this.db.prepare(this.sql).all(...this.args()) as T[],
      success: true,
      meta: {},
    };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.args());
    return { success: true, results: [], meta: { changes: Number(r.changes) } };
  }
}

export function createD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  return {
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (stmts: Statement[]) => {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

// --- Env -------------------------------------------------------------------------

export const ISSUER = 'https://access.modelcontextprotocol.io';
export const GOOGLE_REDIRECT = 'https://www.google.com/a/oidc/callback-test';
export const CLIENT_SECRET = 'test-client-secret';

export async function createEnv(overrides: Partial<Env> = {}): Promise<Env> {
  const signing = await generateKeyPair('RS256', { extractable: true });
  const sa = await generateKeyPair('RS256', { extractable: true });
  return {
    DB: createD1(),
    ISSUER,
    WORKSPACE_DOMAIN: 'modelcontextprotocol.io',
    WORKSPACE_OU_PATH: '/Model Context Protocol',
    GITHUB_CLIENT_ID: 'gh-client',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    OIDC_CLIENT_ID: 'google-workspace',
    OIDC_REDIRECT_URIS: GOOGLE_REDIRECT,
    OIDC_CLIENT_SECRET: CLIENT_SECRET,
    OIDC_SIGNING_KEY: await exportPKCS8(signing.privateKey),
    OFFBOARDING_MODE: 'report',
    OFFBOARDING_MAX_PER_RUN: '3',
    GOOGLE_SA_KEY: JSON.stringify({
      client_email: 'access-site@example.iam.gserviceaccount.com',
      private_key: await exportPKCS8(sa.privateKey),
      token_uri: 'https://oauth2.googleapis.com/token',
    }),
    ...overrides,
  };
}

// --- Config-driven test identities ---------------------------------------------

const roleLookup = buildRoleLookup();

/** An eligible member with a googleEmailPrefix in users.ts (link flow). */
export function memberWithPrefix() {
  const m = MEMBERS.find(
    (m) =>
      m.github &&
      m.googleEmailPrefix &&
      !m.skipGoogleUserProvisioning &&
      hasProvisionUserRole(m.memberOf, roleLookup)
  );
  if (!m) throw new Error('no eligible member with a prefix in config');
  return m;
}

/** An eligible member without a googleEmailPrefix (create flow). */
export function memberWithoutPrefix() {
  const m = MEMBERS.find(
    (m) =>
      m.github &&
      !m.googleEmailPrefix &&
      !m.skipGoogleUserProvisioning &&
      hasProvisionUserRole(m.memberOf, roleLookup)
  );
  if (!m) throw new Error('no eligible member without a prefix in config');
  return m;
}

/** A configured member who is not eligible. */
export function ineligibleMember() {
  const m = MEMBERS.find((m) => m.github && !hasProvisionUserRole(m.memberOf, roleLookup));
  if (!m) throw new Error('no ineligible member in config');
  return m;
}

// --- Fetch mock ----------------------------------------------------------------------

export interface FakeWorld {
  /** The GitHub user returned by the OAuth flow. */
  githubUser: { id: number; login: string; name: string | null };
  /** GitHub ID -> login for /user/{id}; missing means 404. */
  githubLogins: Map<string, string>;
  /** Directory users by primary email. */
  directory: Map<string, DirectoryUser>;
  calls: { method: string; url: string; body?: unknown }[];
}

export function installFetchMock(world: FakeWorld) {
  resetGoogleTokenCache();
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    );
    const method = init?.method ?? 'GET';
    let body: unknown;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    world.calls.push({ method, url: url.toString(), body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    if (url.href === 'https://github.com/login/oauth/access_token')
      return json({ access_token: 'gh-user-token', token_type: 'bearer', scope: '' });
    if (url.href === 'https://api.github.com/user')
      return json({ ...world.githubUser, email: null });
    if (url.href === 'https://api.github.com/user/emails')
      return json([
        { email: 'person@example.com', primary: true, verified: true, visibility: 'private' },
      ]);
    const userById = url.pathname.match(/^\/user\/(\d+)$/);
    if (url.hostname === 'api.github.com' && userById) {
      const login = world.githubLogins.get(userById[1]!);
      return login ? json({ id: Number(userById[1]), login }) : json({ message: 'Not Found' }, 404);
    }

    if (url.href === 'https://oauth2.googleapis.com/token')
      return json({ access_token: 'google-token', expires_in: 3600 });
    if (url.hostname === 'admin.googleapis.com') {
      const path = url.pathname.replace('/admin/directory/v1', '');
      if (path === '/users' && method === 'GET') {
        const query = url.searchParams.get('query') ?? '';
        const ext = query.match(/^externalId:(\d+)$/);
        const users = [...world.directory.values()].filter((u) =>
          ext
            ? u.externalIds?.some((e) => e.value === ext[1])
            : u.orgUnitPath === '/Model Context Protocol'
        );
        return json({ users });
      }
      if (path === '/users' && method === 'POST') {
        const u = body as DirectoryUser;
        if (world.directory.has(u.primaryEmail)) return json({ error: 'exists' }, 409);
        world.directory.set(u.primaryEmail, { ...u, suspended: false });
        return json(u);
      }
      const one = path.match(/^\/users\/(.+)$/);
      if (one) {
        const email = decodeURIComponent(one[1]!);
        const u = world.directory.get(email);
        if (!u) return json({ error: 'not found' }, 404);
        if (method === 'PATCH') {
          Object.assign(u, body as object);
          return json(u);
        }
        return json(u);
      }
    }
    if (url.hostname === 'discord.com') return new Response(null, { status: 204 });
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

// --- Cookie jar for multi-step flows -------------------------------------------------

export class CookieJar {
  private cookies = new Map<string, string>();
  store(res: Response) {
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const [name, ...value] = pair!.split('=');
      const v = value.join('=');
      if (/Max-Age=0/i.test(header) || v === '') this.cookies.delete(name!);
      else this.cookies.set(name!, v);
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  get(name: string) {
    return this.cookies.get(name);
  }
}
