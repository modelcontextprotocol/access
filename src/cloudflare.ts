import * as pulumi from '@pulumi/pulumi';
import * as cloudflare from '@pulumi/cloudflare';
import { ACCESS_POLICIES, GITHUB_ORG, getAccessPolicyTeams } from './config/accessPolicies';
import { buildNameIdTransform, getWorkspaceSsoTable } from './config/workspaceSso';

const config = new pulumi.Config('cloudflare');
// Cloudflare integration is optional - only enabled if roleManagementToken is configured,
// so previews stay green before the CLOUDFLARE_ROLE_MANAGEMENT_TOKEN secret exists.
// The token is scoped to Access policy role management only (Account > Access: Apps and
// Policies > Edit); it is not a general-purpose Cloudflare API token.
const CLOUDFLARE_ROLE_MANAGEMENT_TOKEN = config.getSecret('roleManagementToken');
const CLOUDFLARE_ENABLED = CLOUDFLARE_ROLE_MANAGEMENT_TOKEN !== undefined;

if (!CLOUDFLARE_ENABLED) {
  pulumi.log.info('Cloudflare integration disabled: roleManagementToken not configured');
}

// Access policies keyed by policy id (accessPolicies.ts)
const accessPolicies: Record<string, cloudflare.ZeroTrustAccessPolicy> = {};

if (CLOUDFLARE_ENABLED) {
  const accountId = config.require('accountId');
  const githubIdentityProviderId = config.require('githubIdentityProviderId');
  // Pulumi's `import` option requires the program's inputs to match the live
  // resource, so adopting an existing policy is a two-step process:
  //   1. importExistingPolicies=true: adopt the policy as-is (rule fields ignored)
  //   2. importExistingPolicies=false (or unset): manage the rules from config
  // See README "Cloudflare Access (security-room)".
  const importExisting = config.getBoolean('importExistingPolicies') ?? false;

  const provider = new cloudflare.Provider('cloudflare', {
    // Provider argument name; the value is the role-management token above.
    apiToken: CLOUDFLARE_ROLE_MANAGEMENT_TOKEN,
  });

  ACCESS_POLICIES.forEach((policy) => {
    const teams = getAccessPolicyTeams(policy);
    const importId =
      importExisting && policy.cloudflarePolicyId
        ? `${accountId}/${policy.cloudflarePolicyId}`
        : undefined;

    accessPolicies[policy.id] = new cloudflare.ZeroTrustAccessPolicy(
      `access-policy-${policy.id}`,
      {
        accountId,
        name: policy.cloudflarePolicyName,
        decision: 'allow',
        includes: teams.map((team) => ({
          githubOrganization: {
            identityProviderId: githubIdentityProviderId,
            name: GITHUB_ORG,
            team,
          },
        })),
      },
      {
        provider,
        import: importId,
        // connectionRules and sessionDuration are set by the Cloudflare API with
        // defaults we do not model. During import, also keep the live rule lists so
        // the adoption succeeds; the next deploy without the flag applies the config.
        ignoreChanges: importId
          ? ['connectionRules', 'sessionDuration', 'includes', 'excludes', 'requires']
          : ['connectionRules', 'sessionDuration'],
      }
    );
  });

  // GitHub sign-in for Google Workspace: Access is the SAML IdP for Google's SSO
  // profile. Org members only, GitHub only; the NameID transform picks the account.
  const workspaceSsoPolicy = new cloudflare.ZeroTrustAccessPolicy(
    'access-policy-workspace-sso',
    {
      accountId,
      name: 'Google Workspace sign-in',
      decision: 'allow',
      includes: [
        { githubOrganization: { identityProviderId: githubIdentityProviderId, name: GITHUB_ORG } },
      ],
    },
    { provider, ignoreChanges: ['connectionRules', 'sessionDuration'] }
  );
  new cloudflare.ZeroTrustAccessApplication(
    'access-app-workspace-sso',
    {
      accountId,
      name: 'Google Workspace',
      type: 'saas',
      allowedIdps: [githubIdentityProviderId],
      autoRedirectToIdentity: true,
      appLauncherVisible: false,
      sessionDuration: '1h',
      policies: [{ id: workspaceSsoPolicy.id, precedence: 1 }],
      saasApp: {
        authType: 'saml',
        spEntityId: config.get('googleSamlEntityId') ?? 'google.com/a/modelcontextprotocol.io',
        consumerServiceUrl:
          config.get('googleSamlAcsUrl') ?? 'https://www.google.com/a/modelcontextprotocol.io/acs',
        nameIdFormat: 'email',
        nameIdTransformJsonata: buildNameIdTransform(
          getWorkspaceSsoTable(),
          githubIdentityProviderId
        ),
      },
    },
    { provider }
  );
}

export const cloudflareAccessPolicyIds = Object.fromEntries(
  Object.entries(accessPolicies).map(([id, policy]) => [id, policy.id])
);
export { accessPolicies as cloudflareAccessPolicies };
