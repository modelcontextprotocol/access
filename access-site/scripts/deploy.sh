#!/usr/bin/env bash
# Provisions and deploys access.modelcontextprotocol.io. Run by CI
# (.github/workflows/access-site.yml); safe to re-run.
#
#   1. Finds the "access-site" D1 database, creating it on first run
#   2. Applies D1 migrations
#   3. Deploys the Worker, uploading secrets from the environment
#
# Required env: CLOUDFLARE_API_TOKEN, OIDC_SIGNING_KEY, OIDC_CLIENT_SECRET, GITHUB_CLIENT_SECRET
# Optional env: OIDC_ROTATION_JWKS (JWK Set of public keys during rotation; "{}" clears it)
# Non-secret settings (account, GitHub App client ID, Google redirect URI) are in wrangler.toml.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${CLOUDFLARE_API_TOKEN:?missing}" "${OIDC_SIGNING_KEY:?missing}" "${OIDC_CLIENT_SECRET:?missing}"
: "${GITHUB_CLIENT_SECRET:?missing}"

DB_NAME=access-site
db_id() { npx wrangler d1 list --json | jq -r --arg n "$DB_NAME" '.[] | select(.name == $n) | .uuid'; }

DB_ID="$(db_id)"
if [ -z "$DB_ID" ]; then
  echo "Creating D1 database $DB_NAME"
  npx wrangler d1 create "$DB_NAME" >/dev/null
  DB_ID="$(db_id)"
fi
[ -n "$DB_ID" ] || { echo "Could not find or create D1 database $DB_NAME" >&2; exit 1; }
sed -i "s/REPLACE_WITH_D1_DATABASE_ID/${DB_ID}/" wrangler.toml

for placeholder in REPLACE_WITH_GITHUB_APP_CLIENT_ID REPLACE_WITH_GOOGLE_SSO_REDIRECT_URI; do
  if grep -q "$placeholder" wrangler.toml; then
    echo "::warning::$placeholder is still a placeholder in wrangler.toml; sign-in will not work until it is set."
  fi
done

npx wrangler d1 migrations apply "$DB_NAME" --remote

secrets="$(mktemp)"
trap 'rm -f "$secrets"' EXIT
chmod 600 "$secrets"
jq -n \
  --arg signing "$OIDC_SIGNING_KEY" \
  --arg client "$OIDC_CLIENT_SECRET" \
  --arg github "$GITHUB_CLIENT_SECRET" \
  --arg rotation "${OIDC_ROTATION_JWKS:-"{}"}" \
  '{OIDC_SIGNING_KEY: $signing, OIDC_CLIENT_SECRET: $client, GITHUB_CLIENT_SECRET: $github,
    OIDC_ROTATION_JWKS: $rotation}' >"$secrets"

npx wrangler deploy --secrets-file "$secrets"
