import * as github from '@pulumi/github';
import { ROLES, type Role, buildRoleLookup } from './config/roles';
import { REPOSITORY_ACCESS } from './config/repoAccess';
import { MEMBERS } from './config/users';
import { sortRolesByGitHubDependency } from './config/utils';
import type { RoleId } from './config/roleIds';

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

// Configure repository access
REPOSITORY_ACCESS.forEach((repo) => {
  new github.RepositoryCollaborators(`repo-${repo.repository}`, {
    repository: repo.repository,
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
