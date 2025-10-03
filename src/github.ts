import * as github from '@pulumi/github';
import { GROUPS } from './config/groups';
import { REPOSITORY_ACCESS } from './config/repoAccess';
import type { Group } from './config/utils';
import { MEMBERS } from './config/users';

const teams: Record<string, github.Team> = {};

GROUPS.forEach((group: Group) => {
  // Skip groups that don't include github in their platforms
  if (group.onlyOnPlatforms && !group.onlyOnPlatforms.includes('github')) return;

  teams[group.name] = new github.Team(group.name, {
    name: group.name,
    description: group.description + ' \n(Managed by github.com/modelcontextprotocol/access)',
    privacy: 'closed',
    parentTeamId: group.memberOf?.[0] ? teams[group.memberOf[0]].id : undefined,
  });
});

MEMBERS.forEach((member) => {
  if (!member.github) return;

  member.memberOf.forEach((teamKey) => {
    new github.TeamMembership(`${member.github}-${teamKey}`, {
      teamId: teams[teamKey].id,
      username: member.github!,
      role: 'member',
    });
  });
});

REPOSITORY_ACCESS.forEach((repo) => {
  new github.RepositoryCollaborators(`repo-${repo.repository}`, {
    repository: repo.repository,
    teams: repo.teams.map((t) => ({
      teamId: teams[t.team].id,
      permission: t.permission,
    })),
  });
});
