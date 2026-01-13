import type { RoleId } from './roleIds';

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

// Re-export for convenience
export { ROLE_IDS, type RoleId } from './roleIds';
export { ROLES, type Role, type GitHubConfig, type DiscordConfig, type GoogleConfig } from './roles';
