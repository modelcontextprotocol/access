// GitHub sign-in for Google Workspace, through Cloudflare Access for SaaS.
//
// Google Workspace hands the password step to a SAML SSO profile whose IdP is a
// Cloudflare Access SaaS application (src/cloudflare.ts). Access signs the user in
// with the existing GitHub login method and asserts a SAML NameID that Google matches
// to a Workspace account. The NameID comes from the table built here.
//
// Key: Cloudflare's identity for GitHub carries no GitHub user ID, only `name`,
// `email` (the account's primary verified email) and `groups` (orgs and teams). So
// the table is keyed on the member's `githubEmail` in users.ts, and the transform
// also requires `modelcontextprotocol` in `groups`. GitHub lets only one account
// verify an address, so claiming someone's mapping needs their mailbox as well as
// org membership.
//
// Fail closed by construction:
//   - Only members listed in WORKSPACE_SSO_GITHUB_LOGINS are in the table. An empty
//     list means nobody can sign in; there is no wildcard.
//   - Anyone not in the table, outside the org, or whose email changed gets
//     UNMAPPED_NAME_ID, an address in the reserved `.invalid` TLD that can never be a
//     Workspace account, so Google refuses the assertion.

import { buildRoleLookup } from './roles';
import { MEMBERS } from './users';
import { hasGoogleWorkspaceAccount, type Member } from './utils';

export const WORKSPACE_DOMAIN = 'modelcontextprotocol.io';
export const WORKSPACE_SSO_GITHUB_ORG = 'modelcontextprotocol';

/** NameID asserted for anyone without a mapping. `.invalid` is reserved (RFC 2606). */
export const UNMAPPED_NAME_ID = 'unmapped@access.invalid';

/**
 * GitHub logins that may sign in to Workspace with GitHub. Each must be a member
 * with a confirmed `githubEmail` and a Workspace account (validate-config checks).
 *
 * Pilot: only sambhav. Before adding anyone, confirm their GitHub primary email with
 * them in a reviewed PR, and add their account to the Google OU the SSO profile is
 * assigned to. Removing a login here revokes GitHub sign-in on the next deploy.
 */
export const WORKSPACE_SSO_GITHUB_LOGINS: readonly string[] = ['sambhav'];

/** Characters allowed in a googleEmailPrefix (also keeps the JSONata literal inert). */
export const GOOGLE_EMAIL_PREFIX_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;

/** Conservative check for a single, plain email address. */
const EMAIL_PATTERN = /^[^\s@"\\]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

export interface WorkspaceSsoMapping {
  githubLogin: string;
  /** Lowercased GitHub primary email (the lookup key). */
  githubEmail: string;
  /** Workspace address asserted as the NameID. */
  email: string;
}

/**
 * Resolve the allowlist to `githubEmail -> Workspace email` rows.
 * Throws on any entry that cannot be mapped safely, so a bad config fails the
 * deploy instead of silently dropping (or worse, mis-mapping) someone.
 */
export function getWorkspaceSsoMappings(
  logins: readonly string[] = WORKSPACE_SSO_GITHUB_LOGINS,
  members: readonly Member[] = MEMBERS
): WorkspaceSsoMapping[] {
  const roleLookup = buildRoleLookup();
  const seenKeys = new Set<string>();
  const seenEmails = new Set<string>();

  return logins.map((login) => {
    const matches = members.filter((m) => m.github?.toLowerCase() === login.toLowerCase());
    if (matches.length !== 1) {
      throw new Error(`Workspace SSO login "${login}" must match exactly one member in users.ts`);
    }
    const member = matches[0];
    const githubEmail = member.githubEmail?.trim().toLowerCase();
    if (!githubEmail || !EMAIL_PATTERN.test(githubEmail)) {
      throw new Error(`Workspace SSO member "${login}" has no valid githubEmail`);
    }
    if (githubEmail.endsWith(`@${WORKSPACE_DOMAIN}`)) {
      throw new Error(
        `Workspace SSO member "${login}" githubEmail must not be a Workspace address`
      );
    }
    if (!hasGoogleWorkspaceAccount(member, roleLookup)) {
      throw new Error(`Workspace SSO member "${login}" has no Google Workspace account in config`);
    }
    if (!GOOGLE_EMAIL_PREFIX_PATTERN.test(member.googleEmailPrefix)) {
      throw new Error(`Workspace SSO member "${login}" has an invalid googleEmailPrefix`);
    }
    const email = `${member.googleEmailPrefix}@${WORKSPACE_DOMAIN}`;
    if (seenKeys.has(githubEmail) || seenEmails.has(email)) {
      throw new Error(`Workspace SSO member "${login}" is listed more than once`);
    }
    seenKeys.add(githubEmail);
    seenEmails.add(email);
    return { githubLogin: member.github!, githubEmail, email };
  });
}

/**
 * JSONata for the SAML app's `nameIdTransformJsonata`, evaluated by Cloudflare
 * against the user's Access identity (`email`, `groups[].name`, ...).
 *
 * Keys and values are emitted with JSON.stringify and come from validated config,
 * so config cannot inject JSONata.
 */
export function buildNameIdTransform(mappings: readonly WorkspaceSsoMapping[]): string {
  const table = Object.fromEntries(mappings.map((m) => [m.githubEmail, m.email]));
  return [
    '(',
    `  $emails := ${JSON.stringify(table)};`,
    `  $inOrg := ${JSON.stringify(WORKSPACE_SSO_GITHUB_ORG)} in groups.name;`,
    `  $key := $type(email) = "string" ? $lowercase($trim(email));`,
    `  $email := $inOrg and $type($key) = "string" ? $lookup($emails, $key);`,
    `  $type($email) = "string" ? $email : ${JSON.stringify(UNMAPPED_NAME_ID)}`,
    ')',
  ].join('\n');
}
