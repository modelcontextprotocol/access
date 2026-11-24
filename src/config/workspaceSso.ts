// GitHub sign-in for Google Workspace via a Cloudflare Access SAML app (src/cloudflare.ts).
// See README "GitHub sign-in for Google Workspace".
import { GITHUB_ORG } from './accessPolicies';
import { MEMBERS } from './users';
import { resolveGoogleMemberEmail, type Member } from './utils';

/** NameID for anyone not mapped; `.invalid` (RFC 2606) is never a Workspace account. */
export const UNMAPPED_NAME_ID = 'unmapped@access.invalid';

/** `githubUserId -> Workspace email` for members with `workspaceSso`; throws on bad config. */
export function getWorkspaceSsoTable(members: readonly Member[] = MEMBERS): Record<string, string> {
  const table: Record<string, string> = {};
  for (const m of members.filter((m) => m.workspaceSso)) {
    const id = m.githubUserId ?? 0;
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      String(id) in table ||
      !/^[a-z0-9][a-z0-9._-]*$/.test(m.googleEmailPrefix ?? '')
    ) {
      throw new Error(
        `Workspace SSO: "${m.github}" needs a unique githubUserId and googleEmailPrefix`
      );
    }
    table[String(id)] = resolveGoogleMemberEmail(m)!;
  }
  return table;
}

/**
 * JSONata NameID transform, evaluated against the Access identity: `id` (numeric
 * GitHub user ID), `idp.id` (login method), `groups[].name` (GitHub orgs). Fails
 * closed to UNMAPPED_NAME_ID. Literals are JSON-encoded, so config can't inject JSONata.
 */
export function buildNameIdTransform(table: Record<string, string>, githubIdpId: string): string {
  return `(
  $allowed := idp.id = ${JSON.stringify(githubIdpId)} and ${JSON.stringify(GITHUB_ORG)} in groups.name and $type(id) in ["number", "string"];
  $email := $allowed ? $lookup(${JSON.stringify(table)}, $string(id));
  $type($email) = "string" ? $email : ${JSON.stringify(UNMAPPED_NAME_ID)}
)`;
}
