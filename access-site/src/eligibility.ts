/**
 * Who may sign in, and as which Workspace address, read from the same config
 * Pulumi uses to provision accounts (src/config in this repo). users.ts stays
 * the source of truth; the Worker bundles it and is redeployed on every change.
 */
import { MEMBERS } from '../../src/config/users';
import { buildRoleLookup, type Role } from '../../src/config/roles';
import { hasProvisionUserRole, type Member } from '../../src/config/utils';
import type { RoleId } from '../../src/config/roleIds';

const roleLookup: Map<RoleId, Role> = buildRoleLookup();

const membersByLogin = new Map<string, Member>();
for (const member of MEMBERS) {
  if (member.github) membersByLogin.set(member.github.toLowerCase(), member);
}

export function findMember(githubLogin: string): Member | undefined {
  return membersByLogin.get(githubLogin.toLowerCase());
}

/**
 * The Workspace address this GitHub user signs in as, or null if they have
 * none: not in users.ts, no googleEmailPrefix, opted out, or no longer in a
 * role that grants an account (same rule Pulumi uses to provision).
 */
export function workspaceEmailFor(githubLogin: string, domain: string): string | null {
  const member = findMember(githubLogin);
  if (!member?.googleEmailPrefix || member.skipGoogleUserProvisioning) return null;
  if (!hasProvisionUserRole(member.memberOf, roleLookup)) return null;
  return `${member.googleEmailPrefix.toLowerCase()}@${domain}`;
}
