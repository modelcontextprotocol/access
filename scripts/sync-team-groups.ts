#!/usr/bin/env npx ts-node

/**
 * Mirrors every GitHub team in roles.ts as a Google group
 * (<team-slug>@modelcontextprotocol.io), with the Workspace accounts of the
 * team's members (including members of child teams).
 *
 * - Roles that already have a `google` group in roles.ts are left to Pulumi.
 * - Only groups this script created (marked in their description) are ever
 *   changed; an existing group or address with the same name is reported and
 *   skipped.
 * - Membership comes from users.ts via each account's GitHub user ID
 *   (externalIds, set by access.modelcontextprotocol.io or the backfill).
 * - Any lookup failure aborts the run before changes, so partial data never
 *   removes anyone.
 *
 * Dry run by default; pass --apply to write.
 *   GOOGLE_SA_KEY="$(cat sa-key.json)" GITHUB_TOKEN=... npx ts-node scripts/sync-team-groups.ts [--apply]
 */
import { ROLES, buildRoleLookup } from '../src/config/roles';
import { MEMBERS } from '../src/config/users';
import { githubTeamsFor } from '../src/config/utils';
import {
  DIRECTORY,
  GoogleApiError,
  github,
  githubIdOf,
  googleApi,
  listAllUsers,
} from './lib/google-admin';

const DOMAIN = 'modelcontextprotocol.io';
const MARKER = 'scripts/sync-team-groups.ts';
const SETTINGS = 'https://www.googleapis.com/groups/v1/groups';
const apply = process.argv.includes('--apply');

// Same restrictive settings Pulumi uses for non-email groups (src/google.ts):
// usable for sharing Drive and calendars, not an open mailing list.
const GROUP_SETTINGS = {
  allowExternalMembers: 'false',
  whoCanViewMembership: 'ALL_IN_DOMAIN_CAN_VIEW',
  whoCanModerateMembers: 'NONE',
  whoCanLeaveGroup: 'NONE_CAN_LEAVE',
  whoCanJoin: 'INVITED_CAN_JOIN',
  whoCanPostMessage: 'ALL_OWNERS_CAN_POST',
  whoCanContactOwner: 'ALL_OWNERS_CAN_CONTACT',
  whoCanViewGroup: 'ALL_OWNERS_CAN_VIEW',
};

interface Group {
  email: string;
  description?: string;
}

async function listMembers(groupEmail: string): Promise<string[]> {
  const emails: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: '200' });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await googleApi<{ members?: { email: string }[]; nextPageToken?: string }>(
      'GET',
      `${DIRECTORY}/groups/${groupEmail}/members?${params}`
    );
    emails.push(...(page?.members ?? []).map((m) => m.email.toLowerCase()));
    pageToken = page?.nextPageToken;
  } while (pageToken);
  return emails;
}

async function main() {
  console.log(apply ? 'Applying changes.' : 'Dry run (pass --apply to write).');
  const roleLookup = buildRoleLookup();
  const membersByLogin = new Map(
    MEMBERS.filter((m) => m.github).map((m) => [m.github!.toLowerCase(), m])
  );

  // Teams to mirror: every GitHub team whose role has no Pulumi-managed group.
  const teams = ROLES.filter((r) => r.github && !r.google).map((r) => r.github!.team);
  const desired = new Map<string, Set<string>>(teams.map((t) => [t, new Set()]));

  // Desired membership, from Workspace accounts linked to GitHub IDs.
  for (const user of await listAllUsers()) {
    const githubId = githubIdOf(user);
    if (!githubId || user.suspended) continue;
    const ghUser = await github<{ login: string }>(`/user/${githubId}`);
    if (!ghUser) continue; // GitHub account deleted; offboarding handles it
    const member = membersByLogin.get(ghUser.login.toLowerCase());
    if (!member) continue;
    for (const team of githubTeamsFor(member.memberOf, roleLookup)) {
      desired.get(team)?.add(user.primaryEmail.toLowerCase());
    }
  }

  const skipped: string[] = [];
  for (const [team, want] of desired) {
    const email = `${team}@${DOMAIN}`;
    let group = await googleApi<Group>('GET', `${DIRECTORY}/groups/${email}`);

    if (group && !group.description?.includes(MARKER)) {
      skipped.push(`${email}: existing group not managed by this script`);
      continue;
    }
    if (!group) {
      if (want.size === 0) continue; // don't create empty groups
      console.log(`${apply ? 'Create' : 'Would create'} ${email} (${want.size} members)`);
      if (!apply) continue;
      try {
        group = await googleApi<Group>('POST', `${DIRECTORY}/groups`, {
          email,
          name: team,
          description: `Mirrors GitHub team @modelcontextprotocol/${team}. Managed by github.com/modelcontextprotocol/access (${MARKER}).`,
        });
      } catch (err) {
        if (err instanceof GoogleApiError && err.status === 409) {
          skipped.push(`${email}: address already used by a user or alias`);
          continue;
        }
        throw err;
      }
      await googleApi('PATCH', `${SETTINGS}/${email}?alt=json`, GROUP_SETTINGS);
    }

    const have = new Set(await listMembers(email));
    const toAdd = [...want].filter((e) => !have.has(e));
    const toRemove = [...have].filter((e) => !want.has(e));
    for (const m of toAdd) {
      console.log(`  ${apply ? 'add' : 'would add'} ${m} -> ${team}`);
      if (apply)
        await googleApi('POST', `${DIRECTORY}/groups/${email}/members`, {
          email: m,
          role: 'MEMBER',
        });
    }
    for (const m of toRemove) {
      console.log(`  ${apply ? 'remove' : 'would remove'} ${m} <- ${team}`);
      if (apply) await googleApi('DELETE', `${DIRECTORY}/groups/${email}/members/${m}`);
    }
  }

  if (skipped.length) {
    console.log(`\nSkipped (${skipped.length}):`);
    skipped.forEach((s) => console.log(`  ${s}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
