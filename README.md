# MCP Access Management

Infrastructure as Code for managing access to MCP community resources using Pulumi.

- Define groups in [`src/config/roles.ts`](src/config/roles.ts)
- Add users to groups in [`src/config/users.ts`](src/config/users.ts)
- Changes are applied via GitHub Actions when merged to the main branch

## What This Manages

- **GitHub Teams**: Automatically syncs team memberships in the MCP GitHub organization
- **Google Workspace Groups**: Automatically syncs group memberships for @modelcontextprotocol.io email accounts
  - **Email Groups**: Groups with `isEmailGroup: true` accept emails from anyone (including external users) and notify all members. External posts are moderated for security.
- **Google Workspace User Accounts**: Provisions @modelcontextprotocol.io accounts for members of roles with `provisionUser: true` (directly, or via a role nested under one through `github.parent` — e.g. SDK teams under `sdk-maintainers`, working groups under `working-groups`)
- **npm & PyPI Package Publishing Access** (declared, not applied): Expected registry access is declared in [`src/config/packageAccess.ts`](src/config/packageAccess.ts) and drift against the live npm registry is detected by CI — but changes are applied manually by a maintainer. See [npm & PyPI Package Publishing Access](#npm--pypi-package-publishing-access) below for why and how.

### Opting in to a Google Workspace account (maintainers)

If you're a maintainer — explicitly or implicitly (SDK maintainers, working group members, etc.) — and want an `@modelcontextprotocol.io` account, open a PR adding the following fields to your entry in [`src/config/users.ts`](src/config/users.ts):

```ts
{
  github: 'your-github-username',
  // ...
  firstName: 'Your',
  lastName: 'Name',
  googleEmailPrefix: 'yourname', // -> yourname@modelcontextprotocol.io
  memberOf: [ROLE_IDS.MAINTAINERS /* , ... */],
},
```

Once merged, Pulumi provisions the account. An admin will share your initial password (retrievable via `pulumi stack output --show-secrets newGWSUserPasswords`).

## npm & PyPI Package Publishing Access

Publishing access to the `modelcontextprotocol` npm organization and to the MCP PyPI projects is **config-as-code with human-applied changes** — deliberately outside the Pulumi resource graph:

- **npm** has an official management API ([api-docs.npmjs.com](https://api-docs.npmjs.com/)), but since August 2026 every governance mutation (org/team membership, maintainer add/remove, trusted-publisher config, token management) requires an **interactive 2FA challenge** — tokens, even with "bypass 2FA", get `403`. Reads still work headless with a granular access token, so drift is detected automatically and remediated manually.
- **PyPI** has **no management API at all**: collaborators, trusted publishers, and organizations are web-UI only, and maintainer invites must be accepted by email. The PyPI section of the config is declared state for audit purposes plus the manual procedures below.

What lives where:

- [`src/config/packageAccess.ts`](src/config/packageAccess.ts) — expected npm org membership (derived from members' `npm` field in `users.ts`), per-package maintainers and trusted publishers for the key packages, a default policy for the rest of the org's packages, and declared PyPI project rosters.
- [`scripts/check-package-drift.ts`](scripts/check-package-drift.ts) — read-only npm drift check: `NPM_TOKEN=<token> npm run check-package-drift`. Prints a drift report and a remediation plan of `npm` CLI commands; exits nonzero on drift, and skips gracefully when `NPM_TOKEN` is unset.
- [`.github/workflows/package-drift.yml`](.github/workflows/package-drift.yml) — runs the check weekly and on demand, using the optional `NPM_READ_TOKEN` secret (a read-only npm granular access token with organization read access; note write-capable npm tokens expire after at most 90 days, so keep this one read-only).

### Applying npm changes (runbook)

1. Edit `src/config/packageAccess.ts` / `users.ts` to the desired state and merge the PR.
2. Run the drift check locally with a read-only token: `NPM_TOKEN=<token> npm run check-package-drift`.
3. Review the printed remediation plan — especially any removal commands.
4. As an npm org owner, execute the plan in **one interactive session**: log in with `npm login`, trigger a 2FA prompt (e.g. run the first command), and choose **"Don't ask again for 5 minutes"** on the npmjs.com challenge. npm's own bulk guidance is to script the commands with a `sleep 2` between calls — roughly 80 operations fit in one approval window.
5. Re-run the drift check to confirm it exits clean.

### PyPI procedures (manual, web UI only)

- **Add a maintainer**: Manage project → Collaborators → invite by PyPI username with the Maintainer (upload only) or Owner role. The invitee must accept the invitation email before the role takes effect. Afterwards, record the account in `packageAccess.ts` and on the member's `pypi` field.
- **Trusted publisher**: Manage project → Publishing → add the GitHub repository + workflow (multiple publishers per project are allowed). Prefer trusted publishing over project-scoped API tokens.
- **Recommended follow-up**: apply for a free [PyPI community organization](https://docs.pypi.org/organization-accounts/) so projects are org-owned and access is managed via teams rather than per-project role edits.
- **Naming constraint**: the PyPI project name `modelcontextprotocol` is registered by an unrelated third party, so MCP's Python packages live under `mcp*` names. Any future consolidation under that name would require a [PEP 541](https://peps.python.org/pep-0541/) name-transfer request or simply keeping the `mcp*` naming.

## Deployment

### Production Deployment (Automated)

**Note:** Production deployment is automatically handled by GitHub Actions. All merges to the `main` branch trigger an automatic deployment via [the configured GitHub Actions workflow](.github/workflows/deploy.yml).

### Manual Deployment

Pre-requisites:

- [Pulumi CLI installed](https://www.pulumi.com/docs/iac/download-install/)
- [Google Cloud SDK installed](https://cloud.google.com/sdk/docs/install)
- Access to GCP project and GCS bucket
- Required credentials and secrets

1. Authenticate with GCP: `gcloud auth application-default login`
2. Get the passphrase file `passphrase.prod.txt` from the maintainers
3. Preview changes: `make preview`
4. Deploy changes: `make up`

## Key Management

### Required GitHub Secrets (for CI/CD)

The following secrets must be configured in GitHub Actions for automated deployments:

- **`GCP_PROD_SERVICE_ACCOUNT_KEY`**: GCP service account key
  - Used to authenticate with Google Cloud Storage for Pulumi state (`gs://mcp-access-prod-pulumi-state`)
  - Should be a JSON key file for a service account with Storage Admin permissions
  - See "Setting Up GCS Backend" below for setup instructions

- **`PULUMI_PROD_PASSPHRASE`**: Passphrase for encrypting Pulumi state
  - Used to decrypt encrypted values in Pulumi stack configuration
  - Keep this secure - if lost, you cannot decrypt your Pulumi state

## Initial Setup

If setting up this infrastructure for the first time:

### 1. Set Up Service Account

```bash
# Create project and enable APIs
gcloud projects create mcp-access-prod
gcloud config set project mcp-access-prod
gcloud services enable storage.googleapis.com
gcloud services enable admin.googleapis.com
gcloud services enable groupssettings.googleapis.com

# Create service account
gcloud iam service-accounts create pulumi-svc \
  --display-name="MCP Access Management Service Account" \
  --description="Service account for Pulumi state and Google Workspace management"

# Grant storage admin permissions (for Pulumi state)
gcloud projects add-iam-policy-binding mcp-access-prod \
  --member="serviceAccount:pulumi-svc@mcp-access-prod.iam.gserviceaccount.com" \
  --role="roles/storage.admin"

# Create key
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=pulumi-svc@mcp-access-prod.iam.gserviceaccount.com

# Create GCS bucket for Pulumi state
gsutil mb gs://mcp-access-prod-pulumi-state
```

Then:

1. In Google Workspace Admin Console, go to **Account** → **Admin roles**
2. Select **Groups Admin** role (or create a custom role with these privileges):
   - Read, create, update, and delete groups
   - Read and update group members
3. Click **Assign service accounts**
4. Add your service account email: `pulumi-svc@mcp-access-prod.iam.gserviceaccount.com`

### 2. Initialize Pulumi Stack

```bash
# Login to Pulumi backend (GCS)
pulumi login gs://mcp-access-prod-pulumi-state

# Create production stack
export PULUMI_CONFIG_PASSPHRASE_FILE=passphrase.prod.txt
pulumi stack init prod

# Configure application secrets in Pulumi
pulumi config set --secret googleworkspace:credentials "$(cat sa-key.json)"
pulumi config set --secret github:token "ghp_your_github_token_here"
```

### 3. Configure GitHub Actions Secrets

Add the CI/CD secrets to GitHub Actions (repository settings → Secrets and variables → Actions):

- `GCP_PROD_SERVICE_ACCOUNT_KEY`: Content of `sa-key.json`
- `PULUMI_PROD_PASSPHRASE`: The passphrase you set above
