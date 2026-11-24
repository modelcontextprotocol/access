// GitHub sign-in for Google Workspace, through Cloudflare Access for SaaS.
//
// Google Workspace hands the password step to a SAML SSO profile whose IdP is a
// Cloudflare Access SaaS application (src/cloudflare.ts). Access signs the user in
// with the existing GitHub login method and asserts a SAML NameID that Google matches
// to a Workspace account. The NameID comes from the table built here, keyed on the
// verified numeric `githubUserId` in users.ts, never on the mutable login or on the
// GitHub account's email.
//
// Cloudflare's stored identity for a GitHub sign-in has `id` = the numeric GitHub
// user ID (an integer), `idp` = { id: <login method ID>, type: "github" } and
// `groups` = the user's orgs with their teams. (The dashboard's login-method test
// shows only name, email and groups; `last-seen-identity` shows all fields.)
//
// Fail closed by construction:
//   - Only members listed in WORKSPACE_SSO_GITHUB_LOGINS are in the table. An empty
//     list means nobody can sign in; there is no wildcard.
//   - Anyone not in the table, signed in through another login method, or not in the
//     modelcontextprotocol org gets UNMAPPED_NAME_ID, an address in the reserved
//     `.invalid` TLD that can never be a Workspace account, so Google refuses it.

import { buildRoleLookup } from './roles';
import { MEMBERS } from './users';
import { hasGoogleWorkspaceAccount, type Member } from './utils';

export const WORKSPACE_DOMAIN = 'modelcontextprotocol.io';
export const WORKSPACE_SSO_GITHUB_ORG = 'modelcontextprotocol';

/** NameID asserted for anyone without a mapping. `.invalid` is reserved (RFC 2606). */
export const UNMAPPED_NAME_ID = 'unmapped@access.invalid';

/**
 * GitHub logins that may sign in to Workspace with GitHub. Each must be a member
 * with a verified `githubUserId` and a Workspace account (validate-config checks).
 *
 * Pilot: only sambhav. Before adding anyone, confirm their `githubUserId` with them
 * in a reviewed PR, and add their account to the Google OU the SSO profile is
 * assigned to. Removing a login here revokes GitHub sign-in on the next deploy.
 */
export const WORKSPACE_SSO_GITHUB_LOGINS: readonly string[] = ['sambhav'];

/** Characters allowed in a googleEmailPrefix (also keeps the JSONata literal inert). */
export const GOOGLE_EMAIL_PREFIX_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

export interface WorkspaceSsoMapping {
  githubLogin: string;
  githubUserId: number;
  email: string;
}

/**
 * Resolve the allowlist to `githubUserId -> Workspace email` rows.
 * Throws on any entry that cannot be mapped safely, so a bad config fails the
 * deploy instead of silently dropping (or worse, mis-mapping) someone.
 */
export function getWorkspaceSsoMappings(
  logins: readonly string[] = WORKSPACE_SSO_GITHUB_LOGINS,
  members: readonly Member[] = MEMBERS
): WorkspaceSsoMapping[] {
  const roleLookup = buildRoleLookup();
  const seenIds = new Set<number>();
  const seenEmails = new Set<string>();

  return logins.map((login) => {
    const matches = members.filter((m) => m.github?.toLowerCase() === login.toLowerCase());
    if (matches.length !== 1) {
      throw new Error(`Workspace SSO login "${login}" must match exactly one member in users.ts`);
    }
    const member = matches[0];
    const id = member.githubUserId;
    if (id === undefined || !Number.isSafeInteger(id) || id <= 0) {
      throw new Error(`Workspace SSO member "${login}" has no verified githubUserId`);
    }
    if (!hasGoogleWorkspaceAccount(member, roleLookup)) {
      throw new Error(`Workspace SSO member "${login}" has no Google Workspace account in config`);
    }
    if (!GOOGLE_EMAIL_PREFIX_PATTERN.test(member.googleEmailPrefix)) {
      throw new Error(`Workspace SSO member "${login}" has an invalid googleEmailPrefix`);
    }
    const email = `${member.googleEmailPrefix}@${WORKSPACE_DOMAIN}`;
    if (seenIds.has(id) || seenEmails.has(email)) {
      throw new Error(`Workspace SSO member "${login}" is listed more than once`);
    }
    seenIds.add(id);
    seenEmails.add(email);
    return { githubLogin: member.github!, githubUserId: id, email };
  });
}

/**
 * JSONata for the SAML app's `nameIdTransformJsonata`, evaluated by Cloudflare
 * against the user's Access identity (see the header for its shape).
 *
 * Keys and values are emitted with JSON.stringify and come from validated digits and
 * prefixes, so config cannot inject JSONata.
 */
export function buildNameIdTransform(
  mappings: readonly WorkspaceSsoMapping[],
  githubIdentityProviderId: string
): string {
  const table = Object.fromEntries(mappings.map((m) => [String(m.githubUserId), m.email]));
  return [
    '(',
    `  $emails := ${JSON.stringify(table)};`,
    `  $fromGitHub := idp.id = ${JSON.stringify(githubIdentityProviderId)};`,
    `  $inOrg := ${JSON.stringify(WORKSPACE_SSO_GITHUB_ORG)} in groups.name;`,
    `  $key := $type(id) = "number" or $type(id) = "string" ? $string(id);`,
    `  $email := $fromGitHub and $inOrg and $type($key) = "string" ? $lookup($emails, $key);`,
    `  $type($email) = "string" ? $email : ${JSON.stringify(UNMAPPED_NAME_ID)}`,
    ')',
  ].join('\n');
}
