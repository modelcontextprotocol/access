import { nowSeconds, sha256 } from './crypto';

export interface PendingAuthorization {
  client_id: string;
  redirect_uri: string;
  state: string | null;
  nonce: string | null;
  /** PKCE S256 challenge; null if the client did not send one (it still authenticates with its secret). */
  code_challenge: string | null;
}

export interface AuthorizationCode extends Omit<PendingAuthorization, 'state'> {
  claims: Record<string, unknown>;
}

export interface Session {
  github_id: string;
  github_login: string;
  github_name: string | null;
}

export interface Account {
  github_id: string;
  email: string;
  suspended: boolean;
}

// --- Sign-in flow (rows are single-use: read with DELETE ... RETURNING) ----

export async function savePending(
  db: D1Database,
  id: string,
  p: PendingAuthorization,
  ttlSeconds: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO pending_authorizations
         (id_hash, client_id, redirect_uri, state, nonce, code_challenge, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      await sha256(id),
      p.client_id,
      p.redirect_uri,
      p.state,
      p.nonce,
      p.code_challenge,
      nowSeconds() + ttlSeconds
    )
    .run();
}

export async function takePending(
  db: D1Database,
  id: string
): Promise<PendingAuthorization | null> {
  const row = await db
    .prepare(`DELETE FROM pending_authorizations WHERE id_hash = ? RETURNING *`)
    .bind(await sha256(id))
    .first<PendingAuthorization & { expires_at: number }>();
  if (!row || row.expires_at < nowSeconds()) return null;
  return row;
}

export async function saveCode(
  db: D1Database,
  code: string,
  c: AuthorizationCode,
  ttlSeconds: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO authorization_codes
         (code_hash, client_id, redirect_uri, nonce, code_challenge, claims, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      await sha256(code),
      c.client_id,
      c.redirect_uri,
      c.nonce,
      c.code_challenge,
      JSON.stringify(c.claims),
      nowSeconds() + ttlSeconds
    )
    .run();
}

export async function takeCode(db: D1Database, code: string): Promise<AuthorizationCode | null> {
  const row = await db
    .prepare(`DELETE FROM authorization_codes WHERE code_hash = ? RETURNING *`)
    .bind(await sha256(code))
    .first<Omit<AuthorizationCode, 'claims'> & { claims: string; expires_at: number }>();
  if (!row || row.expires_at < nowSeconds()) return null;
  return { ...row, claims: JSON.parse(row.claims) as Record<string, unknown> };
}

// --- Account page sessions -------------------------------------------------

export async function createSession(
  db: D1Database,
  id: string,
  s: Session,
  ttlSeconds: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sessions (id_hash, github_id, github_login, github_name, expires_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(await sha256(id), s.github_id, s.github_login, s.github_name, nowSeconds() + ttlSeconds)
    .run();
}

export async function getSession(db: D1Database, id: string | undefined): Promise<Session | null> {
  if (!id || id.length > 100) return null;
  return db
    .prepare(
      `SELECT github_id, github_login, github_name FROM sessions
       WHERE id_hash = ? AND expires_at >= ?`
    )
    .bind(await sha256(id), nowSeconds())
    .first<Session>();
}

export async function deleteSession(db: D1Database, id: string | undefined): Promise<void> {
  if (!id) return;
  await db
    .prepare(`DELETE FROM sessions WHERE id_hash = ?`)
    .bind(await sha256(id))
    .run();
}

// --- Account cache -----------------------------------------------------------

export async function getAccount(db: D1Database, githubId: string): Promise<Account | null> {
  const row = await db
    .prepare(`SELECT github_id, email, suspended FROM accounts WHERE github_id = ?`)
    .bind(githubId)
    .first<{ github_id: string; email: string; suspended: number }>();
  return row ? { ...row, suspended: row.suspended === 1 } : null;
}

export async function upsertAccount(db: D1Database, a: Account): Promise<void> {
  // An email can only belong to one GitHub ID; drop any stale row first.
  await db.batch([
    db
      .prepare(`DELETE FROM accounts WHERE email = ? AND github_id != ?`)
      .bind(a.email, a.github_id),
    db
      .prepare(
        `INSERT INTO accounts (github_id, email, suspended, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (github_id) DO UPDATE
           SET email = excluded.email, suspended = excluded.suspended, updated_at = excluded.updated_at`
      )
      .bind(a.github_id, a.email, a.suspended ? 1 : 0, nowSeconds()),
  ]);
}

/** Replaces the whole cache with a fresh read of the Directory. */
export async function replaceAccounts(db: D1Database, accounts: Account[]): Promise<void> {
  const now = nowSeconds();
  await db.batch([
    db.prepare(`DELETE FROM accounts`),
    ...accounts.map((a) =>
      db
        .prepare(
          `INSERT OR REPLACE INTO accounts (github_id, email, suspended, updated_at) VALUES (?, ?, ?, ?)`
        )
        .bind(a.github_id, a.email, a.suspended ? 1 : 0, now)
    ),
  ]);
}

// --- Locks and cleanup -------------------------------------------------------

/** Returns false if another creation for this GitHub user is in flight. */
export async function acquireCreationLock(db: D1Database, githubId: string): Promise<boolean> {
  const now = nowSeconds();
  await db.prepare(`DELETE FROM creation_locks WHERE expires_at < ?`).bind(now).run();
  const res = await db
    .prepare(`INSERT OR IGNORE INTO creation_locks (github_id, expires_at) VALUES (?, ?)`)
    .bind(githubId, now + 120)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function releaseCreationLock(db: D1Database, githubId: string): Promise<void> {
  await db.prepare(`DELETE FROM creation_locks WHERE github_id = ?`).bind(githubId).run();
}

export async function deleteExpired(db: D1Database): Promise<void> {
  const now = nowSeconds();
  await db.batch([
    db.prepare(`DELETE FROM pending_authorizations WHERE expires_at < ?`).bind(now),
    db.prepare(`DELETE FROM authorization_codes WHERE expires_at < ?`).bind(now),
    db.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(now),
    db.prepare(`DELETE FROM creation_locks WHERE expires_at < ?`).bind(now),
  ]);
}
