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

-- First GitHub user ID seen signing in with each login (trust on first use).
-- A different ID for the same login means the login was freed by a rename
-- and registered by someone else, so sign-in is refused.
CREATE TABLE github_identities (
  login TEXT PRIMARY KEY,
  github_id TEXT NOT NULL,
  first_seen INTEGER NOT NULL
);
