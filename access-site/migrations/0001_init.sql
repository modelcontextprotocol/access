-- Sign-in requests from Google, held while the user is at GitHub.
CREATE TABLE pending_authorizations (
  id_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  state TEXT,
  nonce TEXT,
  code_challenge TEXT,
  expires_at INTEGER NOT NULL
);

-- Single-use authorization codes (stored hashed; consumed with DELETE ... RETURNING).
CREATE TABLE authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  nonce TEXT,
  code_challenge TEXT,
  claims TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Sessions for the account page (session IDs stored hashed).
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  github_id TEXT NOT NULL,
  github_login TEXT NOT NULL,
  github_name TEXT,
  expires_at INTEGER NOT NULL
);

-- Cache of GitHub user ID -> Workspace account. Google (externalIds) is the
-- source of truth; the nightly job rebuilds this table from the Directory.
CREATE TABLE accounts (
  github_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  suspended INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- One account creation in flight per GitHub user.
CREATE TABLE creation_locks (
  github_id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  subject TEXT,
  detail TEXT
);

CREATE INDEX audit_log_at ON audit_log (at);
