/**
 * Eligibility and team membership, computed from the same config Pulumi uses
 * to manage GitHub teams (src/config in this repo). The Worker is redeployed
 * whenever that config changes, so it always agrees with the GitHub teams.
 *
 * Reading the config rather than calling the GitHub teams API also covers
 * provisionUser roles that have no GitHub team (e.g. wg-ig-facilitators).
 */
import { MEMBERS } from '../../src/config/users';
import { ROLES, buildRoleLookup, type Role } from '../../src/config/roles';
import { githubTeamsFor, hasProvisionUserRole, type Member } from '../../src/config/utils';
import type { RoleId } from '../../src/config/roleIds';

const roleLookup: Map<RoleId, Role> = buildRoleLookup();

const membersByLogin = new Map<string, Member>();
for (const member of MEMBERS) {
  if (member.github) membersByLogin.set(member.github.toLowerCase(), member);
}

export function findMember(githubLogin: string): Member | undefined {
  return membersByLogin.get(githubLogin.toLowerCase());
}

/** Same rule Pulumi uses to decide who may have a Workspace account. */
export function isEligible(member: Member | undefined): boolean {
  if (!member || member.skipGoogleUserProvisioning) return false;
  return hasProvisionUserRole(member.memberOf, roleLookup);
}

/** GitHub team slugs the member belongs to, including parent teams. */
export function teamsFor(member: Member | undefined): string[] {
  return member ? githubTeamsFor(member.memberOf, roleLookup) : [];
}

/** Email prefixes that must never be handed to a person. */
export const RESERVED_PREFIXES: ReadonlySet<string> = (() => {
  const reserved = new Set([
    'abuse',
    'admin',
    'administrator',
    'all',
    'billing',
    'everyone',
    'help',
    'hostmaster',
    'info',
    'legal',
    'mailer-daemon',
    'no-reply',
    'noreply',
    'postmaster',
    'press',
    'privacy',
    'root',
    'security',
    'support',
    'team',
    'webmaster',
  ]);
  for (const role of ROLES) {
    reserved.add(role.id);
    if (role.github) reserved.add(role.github.team);
    if (role.google) reserved.add(role.google.group);
  }
  return reserved;
})();

/**
 * Prefixes already assigned to someone in users.ts. A member may claim their
 * own configured prefix; nobody else may.
 */
export function prefixOwner(prefix: string): Member | undefined {
  return MEMBERS.find((m) => m.googleEmailPrefix?.toLowerCase() === prefix);
}
