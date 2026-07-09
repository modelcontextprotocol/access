// GitHub organization-level role assignments.
// These grant a base permission across ALL repositories in the org via GitHub's
// pre-defined organization roles, independent of per-repo collaborators in repoAccess.ts.
// See https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/using-organization-roles

export type OrgRoleName =
  | 'all_repo_read'
  | 'all_repo_triage'
  | 'all_repo_write'
  | 'all_repo_maintain'
  | 'all_repo_admin'
  | 'security_manager';

export interface OrgRoleAssignment {
  /** GitHub team slug */
  team: string;
  /** Pre-defined GitHub organization role name */
  role: OrgRoleName;
}

export const ORG_ROLE_ASSIGNMENTS: OrgRoleAssignment[] = [
  { team: 'lead-maintainers', role: 'all_repo_admin' },
  { team: 'core-maintainers', role: 'all_repo_admin' },
  // Security managers can view and manage security alerts and draft security
  // advisories (GHSAs) across all repositories in the org.
  { team: 'security-managers', role: 'security_manager' },
];
