# access.modelcontextprotocol.io

Sign in to MCP Google Workspace with GitHub.

A small Cloudflare Worker (Hono, jose, D1) that is the OpenID Connect provider for Google Workspace's custom OIDC SSO profile. Maintainers sign in to Google with their GitHub account; there are no Google passwords.

Accounts stay infrastructure as code. Who has an account, and which address, is `users.ts`: a GitHub user can sign in as `<googleEmailPrefix>@modelcontextprotocol.io` only if their entry has a `googleEmailPrefix`, isn't opted out, and is in a role with `provisionUser`, the same rule Pulumi uses to create the account. The Worker bundles `src/config` and is redeployed on every config change, so removing someone from `users.ts` stops their sign-in on the next deploy.

The Worker holds no Google credentials and creates nothing in Google.

## How sign-in works

```mermaid
sequenceDiagram
  actor M as Maintainer
  participant G as Google
  participant W as access.modelcontextprotocol.io
  participant GH as GitHub
  M->>G: Open Gmail
  G->>W: /authorize (OIDC)
  W->>GH: GitHub App sign-in
  GH-->>W: user ID, login
  W->>W: login -> address in users.ts
  W-->>G: code
  G->>W: /token
  W-->>G: ID token: sub=<GitHub ID>, email=<prefix>@modelcontextprotocol.io
  G-->>M: Signed in
```

GitHub users with no account in `users.ts` get a page explaining how to request one.

## Security

- **Accounts come from `users.ts`**, which only core maintainers can approve (CODEOWNERS). Anyone who can merge a `googleEmailPrefix` change can map a GitHub account to that Workspace address, so treat those changes like credential changes.
- **GitHub logins are pinned to GitHub user IDs** on first sign-in (`github_identities` in D1). GitHub frees a login when its owner renames, so if someone else registers that name, sign-in is refused until `users.ts` is updated and the pin is cleared (see Operations).
- **Codes and requests are single-use and short-lived**: pending requests last 10 minutes and authorization codes 2 minutes, stored hashed and consumed with `DELETE ... RETURNING`. PKCE is enforced when Google sends it, and a verifier without a challenge is rejected (RFC 9700). Redirect URIs must match exactly; client credentials are form-decoded (RFC 6749 2.3.1) and compared in constant time.
- **Rate limited**: `/authorize` and `/login` allow 30 requests per minute per IP, so anonymous traffic can't exhaust D1 writes.
- **Minimal GitHub access**: the GitHub App has no repository or organization permissions, and its user token is revoked right after the user is read.
- **No Google credentials** in the Worker; it cannot create, change or read Google accounts.
- **CI**: actions are pinned to commit SHAs, Git credentials aren't persisted, and deploy secrets are only exposed to the deploy step, never to `npm ci`.
- **Break-glass**: super admins are exempt from the SSO profile. The GitHub org requires 2FA, which covers Google skipping its own 2-step verification for SSO users.

Sign-ins and refusals are logged as JSON lines in Workers Logs.

## Setup

Cloudflare provisioning is done by CI: on every merge to `main`, [`scripts/deploy.sh`](scripts/deploy.sh) finds or creates the `access-site` D1 database, applies migrations, and deploys the Worker with its secrets. Until the secrets below exist, the deploy job is skipped with a notice, so merging early is safe. Non-secret settings live in `wrangler.toml` and change by PR.

One-time steps:

1. **Cloudflare API token** (MCP Domain Account): create a token scoped to Workers Scripts edit, D1 edit, and Workers Routes and DNS edit on the `modelcontextprotocol.io` zone. Store it as `CLOUDFLARE_ACCESS_SITE_TOKEN` in the `production` environment.
2. **OIDC keys**, generated locally and stored straight into GitHub secrets without being printed (needs `openssl` and `gh`):
   ```sh
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
     | gh secret set ACCESS_SITE_OIDC_SIGNING_KEY --env production -R modelcontextprotocol/access
   openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' > oidc-client-secret.txt
   gh secret set ACCESS_SITE_OIDC_CLIENT_SECRET --env production -R modelcontextprotocol/access < oidc-client-secret.txt
   ```
   Keep `oidc-client-secret.txt` until step 4 (Google needs the same value), then delete it.
3. **GitHub App** (org owner): org-owned, callback URL `https://access.modelcontextprotocol.io/login`, permission Account → Email addresses: read-only (the sign-in library reads it; it is not used), no repository or organization permissions. Put its client ID in `GITHUB_CLIENT_ID` in `wrangler.toml` (PR) and its client secret in `ACCESS_SITE_GITHUB_CLIENT_SECRET` (production environment).
4. **Google SSO profile** (super admin), once the Worker is live: Security → Authentication → SSO with third-party IdP → add a custom **OIDC** profile with issuer `https://access.modelcontextprotocol.io`, client ID `google-workspace`, the client secret from step 2, and change password URL `https://github.com/settings/security` (passwords now live on GitHub). Put the redirect URI Google shows into `OIDC_REDIRECT_URIS` in `wrangler.toml` (PR). Assign the profile to a pilot sub-OU first, then to **Model Context Protocol**. Super admins always keep Google sign-in, which is the break-glass path.

## Operations

- **Rotate the signing key**: copy the current key object (`keys[0]`) from `https://access.modelcontextprotocol.io/jwks` into the `ACCESS_SITE_OIDC_PREVIOUS_JWK` secret, replace `ACCESS_SITE_OIDC_SIGNING_KEY` as in setup step 2, and re-run the workflow. A day later set `ACCESS_SITE_OIDC_PREVIOUS_JWK` to `{}` and re-run.
- **Logs**: sign-ins and refusals are JSON lines in Workers Logs (dashboard, or `npx wrangler tail`). `signin.denied` with `reason: identity_mismatch` means a pinned login came from a different GitHub account.
- **Clear an identity pin** (after confirming the person, e.g. they recreated their GitHub account): `npx wrangler d1 execute access-site --remote --command "DELETE FROM github_identities WHERE login = '<login>'"`.

## Development

```sh
npm ci
npm test         # vitest, Node 22+ (uses node:sqlite in place of D1)
npm run typecheck
npm run dev      # wrangler dev
```

## Google behaviour

- The redirect URI is specific to each SSO profile and only shown once the profile exists, so it is set by PR after setup step 4.
- Google doesn't document whether it sends PKCE; both cases are supported.
