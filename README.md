# MCP Access Management

Infrastructure as Code for managing access to MCP community resources using Pulumi.

- Define groups in [`src/config/groups.ts`](src/config/groups.ts)
- Add users to groups in [`src/config/users.ts`](src/config/users.ts)
- Changes are applied via GitHub Actions when merged to the main branch

## What This Manages

- **GitHub Teams**: Automatically syncs team memberships in the MCP GitHub organization
- **Google Workspace Groups**: Automatically syncs group memberships for @modelcontextprotocol.io email accounts

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
