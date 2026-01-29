import type { RoleId } from './roleIds';
import type { Role } from './roles';

/**
 * A member of the MCP organization.
 * Members are assigned to roles via memberOf, and the role definitions
 * determine which platforms (GitHub, Discord, Google) they get access to.
 */
export interface Member {
  /** GitHub username */
  github?: string;
  /** Email address (for Google Workspace) */
  email?: string;
  /** Discord user ID (snowflake) */
  discord?: string;
  /** Roles this member belongs to */
  memberOf: readonly RoleId[];
}

/**
 * Sort roles by GitHub parent dependency (topological sort).
 * Ensures parent teams are created before child teams.
 *
 * This is necessary because when creating GitHub teams, we need the parent
 * team's ID. If we process roles in arbitrary order, a child team might be
 * processed before its parent, resulting in undefined parentTeamId.
 */
export function sortRolesByGitHubDependency(
  roles: readonly Role[],
  roleLookup: Map<RoleId, Role>
): Role[] {
  const result: Role[] = [];
  const visited = new Set<RoleId>();

  function visit(role: Role): void {
    if (visited.has(role.id)) return;

    // Only process roles with GitHub config
    if (!role.github) {
      visited.add(role.id);
      return;
    }

    // Visit parent first if it exists and has GitHub config
    if (role.github.parent) {
      const parentRole = roleLookup.get(role.github.parent);
      if (parentRole) {
        visit(parentRole);
      }
    }

    visited.add(role.id);
    result.push(role);
  }

  for (const role of roles) {
    visit(role);
  }

  return result;
}

// Re-export for convenience
export { ROLE_IDS, type RoleId } from './roleIds';
export {
  ROLES,
  type Role,
  type GitHubConfig,
  type DiscordConfig,
  type GoogleConfig,
} from './roles';
