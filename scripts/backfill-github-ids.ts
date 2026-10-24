#!/usr/bin/env npx ts-node

/**
 * One-time backfill: stamps each existing Workspace account with its owner's
 * numeric GitHub user ID (externalIds, customType "github"), so they can sign
 * in through access.modelcontextprotocol.io before Google SSO is switched on.
 *
 * Mapping source: users.ts entries with both `github` and `googleEmailPrefix`.
 * Dry run by default; pass --apply to write. Safe to re-run.
 *
 *   GOOGLE_SA_KEY="$(cat sa-key.json)" GITHUB_TOKEN=... npx ts-node scripts/backfill-github-ids.ts
 *   ... --apply
 */
import { MEMBERS } from '../src/config/users';
import {
  DIRECTORY,
  GITHUB_EXTERNAL_ID_TYPE,
  type DirectoryUser,
  github,
  githubIdOf,
  googleApi,
  listAllUsers,
} from './lib/google-admin';

const DOMAIN = 'modelcontextprotocol.io';
const apply = process.argv.includes('--apply');

async function main() {
  console.log(apply ? 'Applying changes.' : 'Dry run (pass --apply to write).');
  const report = { linked: [] as string[], already: [] as string[], problems: [] as string[] };
  const configuredEmails = new Set<string>();

  for (const member of MEMBERS) {
    if (!member.github || !member.googleEmailPrefix) continue;
    const email = `${member.googleEmailPrefix.toLowerCase()}@${DOMAIN}`;
    configuredEmails.add(email);

    const ghUser = await github<{ id: number; login: string }>(`/users/${member.github}`);
    if (!ghUser) {
      report.problems.push(`${email}: GitHub user @${member.github} not found`);
      continue;
    }
    const githubId = String(ghUser.id);

    const user = await googleApi<DirectoryUser>('GET', `${DIRECTORY}/users/${email}`);
    if (!user) {
      report.problems.push(`${email}: no Workspace account (configured for @${member.github})`);
      continue;
    }
    const current = githubIdOf(user);
    if (current === githubId) {
      report.already.push(email);
      continue;
    }
    if (current) {
      report.problems.push(`${email}: linked to GitHub ID ${current}, config says ${githubId}`);
      continue;
    }

    if (apply) {
      const others = (user.externalIds ?? []).filter(
        (e) => !(e.type === 'custom' && e.customType === GITHUB_EXTERNAL_ID_TYPE)
      );
      await googleApi('PATCH', `${DIRECTORY}/users/${email}`, {
        externalIds: [
          ...others,
          { type: 'custom', customType: GITHUB_EXTERNAL_ID_TYPE, value: githubId },
        ],
      });
    }
    report.linked.push(`${email} -> @${member.github} (${githubId})`);
  }

  const unmapped = (await listAllUsers())
    .filter(
      (u) => !u.isAdmin && !u.suspended && !githubIdOf(u) && !configuredEmails.has(u.primaryEmail)
    )
    .map((u) => u.primaryEmail);

  console.log(`\n${apply ? 'Linked' : 'Would link'} (${report.linked.length}):`);
  report.linked.forEach((l) => console.log(`  ${l}`));
  console.log(`\nAlready linked: ${report.already.length}`);
  console.log(`\nProblems (${report.problems.length}):`);
  report.problems.forEach((p) => console.log(`  ${p}`));
  console.log(`\nActive accounts with no GitHub mapping in users.ts (${unmapped.length}):`);
  unmapped.forEach((u) => console.log(`  ${u}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
