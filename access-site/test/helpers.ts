/**
 * Test harness: a D1 stand-in over node:sqlite (real SQL, including
 * DELETE ... RETURNING), generated keys, and a fetch mock for GitHub. Picks
 * real members from src/config so tests follow the live rules.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { exportPKCS8, generateKeyPair } from 'jose';
import { vi } from 'vitest';
import type { Env } from '../src/env';
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
    return this.params as never[];
  }
  async first<T>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...this.args()) as T | undefined) ?? null;
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.args());
    return { success: true, results: [], meta: { changes: Number(r.changes) } };
  }
}

export function createD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(import.meta.dirname, '../migrations/0001_init.sql'), 'utf8'));
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
  return {
    DB: createD1(),
    ISSUER,
    WORKSPACE_DOMAIN: 'modelcontextprotocol.io',
    GITHUB_CLIENT_ID: 'gh-client',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    OIDC_CLIENT_ID: 'google-workspace',
    OIDC_REDIRECT_URIS: GOOGLE_REDIRECT,
    OIDC_CLIENT_SECRET: CLIENT_SECRET,
    OIDC_SIGNING_KEY: await exportPKCS8(signing.privateKey),
    ...overrides,
  };
}

// --- Config-driven test identities ---------------------------------------------

const roleLookup = buildRoleLookup();

/** A member who has a Workspace account in users.ts. */
export function memberWithAccount() {
  const m = MEMBERS.find(
    (m) =>
      m.github &&
      m.googleEmailPrefix &&
      !m.skipGoogleUserProvisioning &&
      hasProvisionUserRole(m.memberOf, roleLookup)
  );
  if (!m) throw new Error('no member with a Workspace account in config');
  return m;
}

/** An eligible member with no googleEmailPrefix (no account yet). */
export function memberWithoutAccount() {
  const m = MEMBERS.find(
    (m) =>
      m.github &&
      !m.googleEmailPrefix &&
      !m.skipGoogleUserProvisioning &&
      hasProvisionUserRole(m.memberOf, roleLookup)
  );
  if (!m) throw new Error('no eligible member without an account in config');
  return m;
}

/** A configured member with a prefix but no role that grants an account, if any; else any ineligible member. */
export function ineligibleMember() {
  const m = MEMBERS.find((m) => m.github && !hasProvisionUserRole(m.memberOf, roleLookup));
  if (!m) throw new Error('no ineligible member in config');
  return m;
}

// --- GitHub fetch mock --------------------------------------------------------------

export function mockGitHub(user: { id: number; login: string; name: string | null }) {
  const json = (data: unknown) =>
    new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://github.com/login/oauth/access_token') {
      return json({ access_token: 'gh-user-token', token_type: 'bearer', scope: '' });
    }
    if (url === 'https://api.github.com/user') return json({ ...user, email: null });
    if (url === 'https://api.github.com/user/emails') {
      return json([{ email: 'person@example.com', primary: true, verified: true }]);
    }
    if (url === 'https://api.github.com/applications/gh-client/token') {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
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
}
