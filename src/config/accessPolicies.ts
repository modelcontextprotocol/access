// Cloudflare Zero Trust Access policies.
// Each entry describes who may sign in to a Cloudflare Access-protected site, expressed
// as roles from roles.ts. src/cloudflare.ts renders every role's GitHub team into a
// `github-organization` include rule on the policy, so the roster is managed in
// users.ts like every other GitHub team.
//
// Cloudflare matches DIRECT GitHub team membership only: a member of `python-sdk`
// does not satisfy a rule for its parent team `sdk-maintainers`. Roles listed here
// must therefore be teams people are added to directly (see the `security-room` role).

import { ROLE_IDS, type RoleId } from './roleIds';
import { buildRoleLookup } from './roles';

/** GitHub organization that Cloudflare Access include rules are matched against. */
export const GITHUB_ORG = 'modelcontextprotocol';

export interface AccessPolicy {
  /** Stable identifier, used as the Pulumi resource name */
  id: string;
  /** What the policy protects */
  description: string;
  /** Name of the reusable Access policy in Cloudflare (Zero Trust > Access > Policies) */
  cloudflarePolicyName: string;
  /**
   * ID of the reusable policy that already exists in Cloudflare. When set, and the
   * `cloudflare:importExistingPolicies` stack config is true, Pulumi adopts this
   * policy instead of creating a new one. See the README section
   * "Cloudflare Access (security-room)".
   */
  cloudflarePolicyId?: string;
  /** Roles whose GitHub team may sign in. Order is preserved in the include rules. */
  roles: readonly RoleId[];
}

export const ACCESS_POLICIES: readonly AccessPolicy[] = [
  {
    id: 'security-room-maintainers',
    description: 'Who can sign in to securityroom.modelcontextprotocol.io',
    cloudflarePolicyName: 'Maintainers',
    cloudflarePolicyId: '11a6814e-bb85-4ea2-aa12-6b081b09aa56',
    roles: [
      ROLE_IDS.CORE_MAINTAINERS,
      ROLE_IDS.LEAD_MAINTAINERS,
      ROLE_IDS.SECURITY_MANAGERS,
      // Per-SDK security leads are added to this team directly in users.ts
      ROLE_IDS.SECURITY_ROOM,
    ],
  },
];

/**
 * Resolve a policy's roles to the GitHub team slugs Cloudflare matches against,
 * in declaration order. Throws if a role is unknown or has no GitHub team, so
 * a bad reference fails validation rather than silently dropping a rule.
 */
export function getAccessPolicyTeams(policy: AccessPolicy): string[] {
  const roleLookup = buildRoleLookup();
  return policy.roles.map((roleId) => {
    const role = roleLookup.get(roleId);
    if (!role) {
      throw new Error(`Access policy "${policy.id}" references unknown role "${roleId}"`);
    }
    if (!role.github) {
      throw new Error(
        `Access policy "${policy.id}" references role "${roleId}" which has no GitHub team`
      );
    }
    return role.github.team;
  });
}
