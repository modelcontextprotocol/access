/**
 * Short-lived sign-in state in D1. Rows are single-use (read with
 * DELETE ... RETURNING), stored under a SHA-256 hash of their ID, and expire
 * within minutes. Nothing about accounts is stored here.
 */
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

/** Removes expired rows. */
async function deleteExpired(db: D1Database): Promise<void> {
  const now = nowSeconds();
  await db.batch([
    db.prepare(`DELETE FROM pending_authorizations WHERE expires_at < ?`).bind(now),
    db.prepare(`DELETE FROM authorization_codes WHERE expires_at < ?`).bind(now),
  ]);
}

/** Share of new sign-ins that also clean up expired rows (keeps D1 writes low). */
const CLEANUP_RATE = 0.05;

export async function savePending(
  db: D1Database,
  id: string,
  p: PendingAuthorization,
  ttlSeconds: number
): Promise<void> {
  if (Math.random() < CLEANUP_RATE) await deleteExpired(db);
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

/**
 * Pins each GitHub login to the first GitHub user ID seen signing in with it
 * (trust on first use). GitHub frees a login when its owner renames, so a
 * different ID for a pinned login means someone else registered that name.
 * Returns false on a mismatch. Clear the row only after confirming the
 * person (e.g. they deleted and recreated their GitHub account).
 */
export async function pinGithubIdentity(
  db: D1Database,
  login: string,
  githubId: string
): Promise<boolean> {
  const key = login.toLowerCase();
  await db
    .prepare(
      `INSERT OR IGNORE INTO github_identities (login, github_id, first_seen) VALUES (?, ?, ?)`
    )
    .bind(key, githubId, nowSeconds())
    .run();
  const row = await db
    .prepare(`SELECT github_id FROM github_identities WHERE login = ?`)
    .bind(key)
    .first<{ github_id: string }>();
  return row?.github_id === githubId;
}
