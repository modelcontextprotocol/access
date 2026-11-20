import { MEMBERS } from '../../src/config/users';
import { buildRoleLookup } from '../../src/config/roles';
import { hasGoogleWorkspaceAccount } from '../../src/config/utils';

const roleLookup = buildRoleLookup();

const workspaceAccounts = new Map<string, { prefix: string; githubUserId?: number }>();
for (const member of MEMBERS) {
  if (member.github && hasGoogleWorkspaceAccount(member, roleLookup)) {
    workspaceAccounts.set(member.github.toLowerCase(), {
      prefix: member.googleEmailPrefix.toLowerCase(),
      githubUserId: member.githubUserId,
    });
  }
}

export function workspaceAccountFor(githubLogin: string) {
  return workspaceAccounts.get(githubLogin.toLowerCase());
}
