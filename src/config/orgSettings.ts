// GitHub organization-level settings.
// Captured explicitly so changes go through review. Values mirror current state
// except defaultRepositoryPermission, which is set to 'none' so private repos
// (disclosures, community-moderators, GHSA forks) are not implicitly readable
// by every org member. Explicit access flows from orgRoles.ts and repoAccess.ts.

// billingEmail is required by the provider but intentionally omitted here so it
// is not committed to a public repo. It is read from Pulumi config in github.ts:
//   pulumi config set --secret githubBillingEmail <email>
export const ORG_SETTINGS = {
  name: 'Model Context Protocol',
  description:
    'An open protocol that enables seamless integration between LLM applications and external data sources and tools.',
  defaultRepositoryPermission: 'none',
  hasOrganizationProjects: true,
  hasRepositoryProjects: true,
  membersCanCreateRepositories: false,
  membersCanCreatePublicRepositories: false,
  membersCanCreatePrivateRepositories: false,
  membersCanCreatePages: false,
  membersCanCreatePublicPages: false,
  membersCanCreatePrivatePages: false,
  membersCanForkPrivateRepositories: false,
  webCommitSignoffRequired: false,
  // Provider defaults the following to `false` if omitted, which would silently
  // disable org-wide security features that are currently on.
  advancedSecurityEnabledForNewRepositories: true,
  dependabotAlertsEnabledForNewRepositories: true,
  dependabotSecurityUpdatesEnabledForNewRepositories: true,
  dependencyGraphEnabledForNewRepositories: true,
  secretScanningEnabledForNewRepositories: true,
  secretScanningPushProtectionEnabledForNewRepositories: true,
} as const;
