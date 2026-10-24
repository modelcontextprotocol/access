/**
 * Nightly job: clean up expired rows, rebuild the account cache from the
 * Directory, and suspend accounts whose GitHub user is no longer eligible.
 *
 * Offboarding fails safe: an account is only suspended when its GitHub user
 * was looked up successfully and is not eligible under the current config.
 * Lookup errors skip the account, and a run that would suspend more than
 * OFFBOARDING_MAX_PER_RUN accounts suspends none.
 */
import type { Env } from './env';
import { type Account, deleteExpired, replaceAccounts } from './db';
import { findMember, isEligible } from './eligibility';
import { githubLoginForId } from './github';
import { githubIdOf, listUsersInOu, suspendUser } from './google';

export interface NightlyReport {
  linked: number;
  unlinked: string[];
  toSuspend: { email: string; reason: string }[];
  suspended: string[];
  skipped: { email: string; reason: string }[];
  aborted: boolean;
}

export async function runNightly(env: Env): Promise<NightlyReport> {
  await deleteExpired(env.DB);

  const users = (await listUsersInOu(env)).filter((u) => !u.isAdmin);
  const accounts: Account[] = [];
  const report: NightlyReport = {
    linked: 0,
    unlinked: [],
    toSuspend: [],
    suspended: [],
    skipped: [],
    aborted: false,
  };

  for (const user of users) {
    const githubId = githubIdOf(user);
    if (!githubId) {
      if (!user.suspended) report.unlinked.push(user.primaryEmail);
      continue;
    }
    accounts.push({ github_id: githubId, email: user.primaryEmail, suspended: !!user.suspended });
    if (user.suspended) continue;

    const lookup = await githubLoginForId(githubId, env.GITHUB_API_TOKEN);
    if (lookup.status === 'error') {
      report.skipped.push({
        email: user.primaryEmail,
        reason: `GitHub lookup failed: ${lookup.detail}`,
      });
    } else if (lookup.status === 'not_found') {
      report.toSuspend.push({
        email: user.primaryEmail,
        reason: 'GitHub account no longer exists',
      });
    } else if (!isEligible(findMember(lookup.login))) {
      report.toSuspend.push({
        email: user.primaryEmail,
        reason: `@${lookup.login} is no longer in an eligible team`,
      });
    }
  }
  report.linked = accounts.length;
  await replaceAccounts(env.DB, accounts);

  const max = Number.parseInt(env.OFFBOARDING_MAX_PER_RUN, 10) || 0;
  const enforce = env.OFFBOARDING_MODE === 'enforce';
  if (enforce && report.toSuspend.length > max) {
    report.aborted = true;
  } else if (enforce) {
    for (const { email, reason } of report.toSuspend) {
      await suspendUser(env, email);
      console.log(JSON.stringify({ event: 'account.suspend', email, reason }));
      report.suspended.push(email);
    }
    if (report.suspended.length > 0) {
      const suspendedSet = new Set(report.suspended);
      await replaceAccounts(
        env.DB,
        accounts.map((a) => (suspendedSet.has(a.email) ? { ...a, suspended: true } : a))
      );
    }
  }

  // The full report, including what report mode would have suspended, goes to Workers logs.
  console.log(
    JSON.stringify({ event: 'nightly', mode: enforce ? 'enforce' : 'report', max, ...report })
  );
  return report;
}
