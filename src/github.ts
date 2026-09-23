import * as pulumi from '@pulumi/pulumi';
import * as github from '@pulumi/github';
import { ROLES, type Role, buildRoleLookup } from './config/roles';
import { REPOSITORY_ACCESS } from './config/repoAccess';
import { ORG_ROLE_ASSIGNMENTS } from './config/orgRoles';
import { ORG_SETTINGS } from './config/orgSettings';
import { MEMBERS } from './config/users';
import { sortRolesByGitHubDependency } from './config/utils';
import type { RoleId } from './config/roleIds';

const config = new pulumi.Config();

// The provider's Create for this resource is a PATCH on the existing org, so
// no import is needed; first apply writes the values below directly.
new github.OrganizationSettings(
  'org-settings',
  {
    ...ORG_SETTINGS,
    billingEmail: config.requireSecret('githubBillingEmail'),
  },
  { additionalSecretOutputs: ['billingEmail'] }
);

const roleLookup = buildRoleLookup();
// Teams keyed by GitHub team name (matches repoAccess.ts references)
const teams: Record<string, github.Team> = {};

// Sort roles so parent teams are created before child teams
const sortedRoles = sortRolesByGitHubDependency(ROLES, roleLookup);

// Create GitHub teams for roles that have GitHub config
sortedRoles.forEach((role: Role) => {
  if (!role.github) return;

  // Resolve parent team ID if specified
  // Parent is guaranteed to exist in `teams` due to topological sort
  let parentTeamId: github.Team['id'] | undefined;
  if (role.github.parent) {
    const parentRole = roleLookup.get(role.github.parent);
    if (parentRole?.github) {
      parentTeamId = teams[parentRole.github.team]?.id;
    }
  }

  teams[role.github.team] = new github.Team(role.github.team, {
    name: role.github.team,
    description: role.description + ' \n(Managed by github.com/modelcontextprotocol/access)',
    privacy: 'closed',
    parentTeamId,
  });
});

// Create team memberships
MEMBERS.forEach((member) => {
  if (!member.github) return;

  member.memberOf.forEach((roleId: RoleId) => {
    const role = roleLookup.get(roleId);
    if (!role?.github) return; // Role doesn't have GitHub config

    new github.TeamMembership(`${member.github}-${role.github.team}`, {
      teamId: teams[role.github.team].id,
      username: member.github!,
      role: 'member',
    });
  });
});

// Assign organization-level roles to teams (grants access across all repos)
const orgRoles = github.getOrganizationRolesOutput();
ORG_ROLE_ASSIGNMENTS.forEach((assignment) => {
  const team = teams[assignment.team];
  if (!team) {
    throw new Error(
      `orgRoles.ts references team '${assignment.team}' which is not managed in roles.ts`
    );
  }
  const roleId = orgRoles.roles.apply((roles) => {
    const match = roles.find((r) => r.name === assignment.role);
    if (!match) throw new Error(`Organization role '${assignment.role}' not found`);
    return match.roleId;
  });
  new github.OrganizationRoleTeam(`orgrole-${assignment.team}-${assignment.role}`, {
    teamSlug: team.slug,
    roleId,
  });
});

// Teams that hold organization-level roles (ORG_ROLE_ASSIGNMENTS above). GitHub's
// list-repository-teams API now also returns teams whose access comes from an org
// role, so a refresh reads them as direct collaborators on every repository and the
// provider then fails trying to delete the non-existent direct association (404).
// The pinned @pulumi/github 6.12.1 provider predates the upstream fix that skips
// non-direct teams (https://github.com/integrations/terraform-provider-github/pull/3571),
// so we tell the provider to ignore these teams on every repository that does not
// grant them directly in repoAccess.ts. Remove this workaround once we upgrade to a
// @pulumi/github release that includes that fix.
const orgRoleTeamNames = [...new Set(ORG_ROLE_ASSIGNMENTS.map((a) => a.team))];

// Configure repository access
REPOSITORY_ACCESS.forEach((repo) => {
  const grantedTeams = new Set(repo.teams?.map((t) => t.team));
  new github.RepositoryCollaborators(`repo-${repo.repository}`, {
    repository: repo.repository,
    // Ignore org-role teams, except where repoAccess.ts grants them directly on
    // this repository (e.g. lead-maintainers on maintainer-docs) — those grants
    // must stay managed by Pulumi.
    ignoreTeams: orgRoleTeamNames
      .filter((team) => !grantedTeams.has(team))
      .map((team) => ({ teamId: teams[team].slug })),
    teams: repo.teams?.map((t) => ({
      teamId: teams[t.team]?.id,
      permission: t.permission,
    })),
    users: repo.users?.map((u) => ({
      username: u.username,
      permission: u.permission,
    })),
  });
});

export { teams as githubTeams };
