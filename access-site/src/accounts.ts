/**
 * Account logic: who may have an account, finding a user's account, and
 * creating or linking one. HTTP-free so it can be tested directly.
 */
import type { Env } from './env';
import {
  type Account,
  acquireCreationLock,
  audit,
  getAccount,
  releaseCreationLock,
  upsertAccount,
} from './db';
import { findMember, isEligible, prefixOwner } from './eligibility';
import { createUser, findUserByGithubId, getUser, githubIdOf, linkGithubId } from './google';
import { notify } from './notify';
import { validateName, validatePrefix } from './validation';

export interface GitHubIdentity {
  id: string;
  login: string;
  name: string | null;
}

/** The user's Workspace account: D1 cache first, then the Directory. */
export async function resolveAccount(env: Env, githubId: string): Promise<Account | null> {
  const cached = await getAccount(env.DB, githubId);
  if (cached) return cached;
  const user = await findUserByGithubId(env, githubId);
  if (!user) return null;
  const account = { github_id: githubId, email: user.primaryEmail, suspended: !!user.suspended };
  await upsertAccount(env.DB, account);
  return account;
}

export type AccountRequest =
  | { kind: 'link'; email: string }
  | { kind: 'create'; suggestedPrefix: string | null };

/**
 * What the account page should offer someone with no linked account:
 * members with a googleEmailPrefix in users.ts already have (or were promised)
 * that address, so they link it; everyone else picks a new address.
 */
export function accountRequestFor(env: Env, identity: GitHubIdentity): AccountRequest | null {
  const member = findMember(identity.login);
  if (!isEligible(member)) return null;
  if (member?.googleEmailPrefix) {
    return {
      kind: 'link',
      email: `${member.googleEmailPrefix.toLowerCase()}@${env.WORKSPACE_DOMAIN}`,
    };
  }
  return { kind: 'create', suggestedPrefix: null };
}

export type EnsureResult =
  | { ok: true; email: string; created: boolean }
  | { ok: false; error: string };

export async function ensureAccount(
  env: Env,
  identity: GitHubIdentity,
  form: { firstName?: unknown; lastName?: unknown; prefix?: unknown }
): Promise<EnsureResult> {
  const request = accountRequestFor(env, identity);
  if (!request)
    return { ok: false, error: 'You are not in a team that can have a Workspace account.' };

  const existing = await resolveAccount(env, identity.id);
  if (existing) return { ok: true, email: existing.email, created: false };

  const firstName = validateName(form.firstName, 'First name');
  if (!firstName.ok) return firstName;
  const lastName = validateName(form.lastName, 'Last name');
  if (!lastName.ok) return lastName;

  let email: string;
  if (request.kind === 'link') {
    email = request.email;
  } else {
    const prefix = validatePrefix(form.prefix);
    if (!prefix.ok) return prefix;
    const owner = prefixOwner(prefix.value);
    if (owner && owner.github?.toLowerCase() !== identity.login.toLowerCase()) {
      return { ok: false, error: `${prefix.value}@${env.WORKSPACE_DOMAIN} is already taken.` };
    }
    email = `${prefix.value}@${env.WORKSPACE_DOMAIN}`;
  }

  if (!(await acquireCreationLock(env.DB, identity.id))) {
    return { ok: false, error: 'Your account is already being set up. Refresh in a minute.' };
  }
  try {
    const current = await getUser(env, email);
    if (current) {
      // The address exists. Link it only if users.ts says it is this person's
      // and it is not already linked to another GitHub account.
      const linkedTo = githubIdOf(current);
      if (request.kind !== 'link' || (linkedTo && linkedTo !== identity.id)) {
        return { ok: false, error: `${email} is already taken.` };
      }
      if (!linkedTo) await linkGithubId(env, current, identity.id);
      await upsertAccount(env.DB, {
        github_id: identity.id,
        email,
        suspended: !!current.suspended,
      });
      await audit(env.DB, identity.login, 'account.link', email, { github_id: identity.id });
      return { ok: true, email, created: false };
    }

    const result = await createUser(env, {
      email,
      firstName: firstName.value,
      lastName: lastName.value,
      githubId: identity.id,
    });
    if (result.status === 'conflict') return { ok: false, error: `${email} is already taken.` };
    await upsertAccount(env.DB, { github_id: identity.id, email, suspended: false });
    await audit(env.DB, identity.login, 'account.create', email, { github_id: identity.id });
    await notify(env, `New Workspace account ${email} for @${identity.login}`);
    return { ok: true, email, created: true };
  } finally {
    await releaseCreationLock(env.DB, identity.id);
  }
}
