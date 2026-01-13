import { ROLE_IDS, type RoleId } from './roleIds';

/**
 * GitHub team configuration
 */
export interface GitHubConfig {
  /** Team name (usually matches role ID) */
  team: string;
  /** Parent team role ID */
  parent?: RoleId;
}

/**
 * Discord role configuration
 */
export interface DiscordConfig {
  /** Display name in Discord (can have spaces) */
  role: string;
}

/**
 * Google Workspace group configuration
 */
export interface GoogleConfig {
  /** Group name (used as prefix for @modelcontextprotocol.io email) */
  group: string;
  /** If true, accepts emails from anyone including external users */
  isEmailGroup?: boolean;
}

/**
 * Role definition with platform-specific configurations.
 * A role only exists on platforms where it has a config key.
 */
export interface Role {
  id: RoleId;
  description: string;
  github?: GitHubConfig;
  discord?: DiscordConfig;
  google?: GoogleConfig;
}

/**
 * All roles in the MCP organization.
 * Each role specifies which platforms it exists on via presence of config keys.
 */
export const ROLES: readonly Role[] = [
  // ===================
  // Organization Structure
  // ===================
  {
    id: ROLE_IDS.STEERING_COMMITTEE,
    description: 'MCP Steering Committee',
    github: { team: 'steering-committee' },
    // No discord - this is a GitHub-only organizational container
  },
  {
    id: ROLE_IDS.ADMINISTRATORS,
    description: 'Discord server administrators',
    discord: { role: 'administrators' },
    // Discord only - no GitHub equivalent
  },
  {
    id: ROLE_IDS.LEAD_MAINTAINERS,
    description: 'Lead maintainers with elevated responsibilities',
    discord: { role: 'lead maintainers' },
    // Discord only for now - could add GitHub if needed
  },
  {
    id: ROLE_IDS.CORE_MAINTAINERS,
    description: 'Core maintainers',
    github: { team: 'core-maintainers', parent: ROLE_IDS.STEERING_COMMITTEE },
    discord: { role: 'core maintainers' },
  },
  {
    id: ROLE_IDS.MODERATORS,
    description: 'Community moderators',
    github: { team: 'moderators', parent: ROLE_IDS.STEERING_COMMITTEE },
    discord: { role: 'community moderators' },
  },

  // ===================
  // Maintainer Groups
  // ===================
  {
    id: ROLE_IDS.MAINTAINERS,
    description: 'General maintainers',
    discord: { role: 'maintainers' },
    // Discord only - general maintainer role
  },
  {
    id: ROLE_IDS.DOCS_MAINTAINERS,
    description: 'MCP docs maintainers',
    github: { team: 'docs-maintainers', parent: ROLE_IDS.STEERING_COMMITTEE },
    // No discord role for docs maintainers
  },
  {
    id: ROLE_IDS.INSPECTOR_MAINTAINERS,
    description: 'MCP Inspector maintainers',
    github: { team: 'inspector-maintainers', parent: ROLE_IDS.STEERING_COMMITTEE },
    discord: { role: 'inspector maintainers' },
  },
  {
    id: ROLE_IDS.MCPB_MAINTAINERS,
    description: 'MCPB (Model Context Protocol Bundle) maintainers',
    github: { team: 'mcpb-maintainers', parent: ROLE_IDS.STEERING_COMMITTEE },
    // No discord role
  },
  {
    id: ROLE_IDS.REFERENCE_SERVERS_MAINTAINERS,
    description: 'Reference servers maintainers',
    discord: { role: 'reference servers maintainers' },
    // Discord only for now
  },
  {
    id: ROLE_IDS.REGISTRY_MAINTAINERS,
    description: 'Registry builders and maintainers',
    github: { team: 'registry-wg', parent: ROLE_IDS.WORKING_GROUPS },
    discord: { role: 'registry maintainers' },
    google: { group: 'registry-wg' },
  },
  {
    id: ROLE_IDS.USE_MCP_MAINTAINERS,
    description: 'use-mcp maintainers',
    discord: { role: 'use-mcp maintainers' },
    // Discord only
  },

  // ===================
  // SDK Maintainers
  // ===================
  {
    id: ROLE_IDS.SDK_MAINTAINERS,
    description: 'Authors and maintainers of official MCP SDKs',
    github: { team: 'sdk-maintainers', parent: ROLE_IDS.STEERING_COMMITTEE },
    discord: { role: 'sdk maintainers' },
  },
  {
    id: ROLE_IDS.CSHARP_SDK,
    description: 'Official C# SDK maintainers',
    github: { team: 'csharp-sdk', parent: ROLE_IDS.SDK_MAINTAINERS },
    discord: { role: 'c# sdk maintainers' },
  },
  {
    id: ROLE_IDS.GO_SDK,
    description: 'Official Go SDK maintainers',
    github: { team: 'go-sdk', parent: ROLE_IDS.SDK_MAINTAINERS },
    discord: { role: 'go sdk maintainers' },
  },
  {
    id: ROLE_IDS.JAVA_SDK,
    description: 'Official Java SDK maintainers',
    github: { team: 'java-sdk', parent: ROLE_IDS.SDK_MAINTAINERS },
    discord: { role: 'java sdk maintainers' },
  },
  {
    id: ROLE_IDS.KOTLIN_SDK,
    description: 'Official Kotlin SDK maintainers',
    github: { team: 'kotlin-sdk', parent: ROLE_IDS.SDK_MAINTAINERS },
    discord: { role: 'kotlin sdk maintainers' },
  },
  {
    id: ROLE_IDS.PHP_SDK,
    description: 'Official PHP SDK maintainers',
    github: { team: 'php-sdk', parent: ROLE_IDS.SDK_MAINTAINERS },
    discord: { role: 'php sdk maintainers' },
  },
  {
    id: ROLE_IDS.PYTHON_SDK,
    description: 'Official Python SDK maintainers',
    github: { team: 'python-sdk', parent: ROLE_IDS.SDK_MAINTAINERS },
    discord: { role: 'python sdk maintainers' },
  },
  {
    id: ROLE_IDS.PYTHON_SDK_AUTH,
    description: 'Python SDK auth code owners',
    github: { team: 'python-sdk-auth', parent: ROLE_IDS.PYTHON_SDK },
    // GitHub only - for CODEOWNERS
  },
  {
    id: ROLE_IDS.RUBY_SDK,
    description: 'Official Ruby SDK maintainers',
    github: { team: 'ruby-sdk', parent: ROLE_IDS.SDK_MAINTAINERS },
    discord: { role: 'ruby sdk maintainers' },
  },
  {
    id: ROLE_IDS.RUST_SDK,
    description: 'Official Rust SDK maintainers',
    github: { team: 'rust-sdk', parent: ROLE_IDS.SDK_MAINTAINERS },
    discord: { role: 'rust sdk maintainers' },
  },
  {
    id: ROLE_IDS.SWIFT_SDK,
    description: 'Official Swift SDK maintainers',
    github: { team: 'swift-sdk', parent: ROLE_IDS.SDK_MAINTAINERS },
    discord: { role: 'swift sdk maintainers' },
  },
  {
    id: ROLE_IDS.TYPESCRIPT_SDK,
    description: 'Official TypeScript SDK maintainers',
    github: { team: 'typescript-sdk', parent: ROLE_IDS.SDK_MAINTAINERS },
    discord: { role: 'typescript sdk maintainers' },
  },
  {
    id: ROLE_IDS.TYPESCRIPT_SDK_AUTH,
    description: 'TypeScript SDK auth code owners',
    github: { team: 'typescript-sdk-auth', parent: ROLE_IDS.TYPESCRIPT_SDK },
    // GitHub only - for CODEOWNERS
  },

  // ===================
  // Working Groups
  // ===================
  {
    id: ROLE_IDS.WORKING_GROUPS,
    description: 'MCP Working Groups',
    github: { team: 'working-groups', parent: ROLE_IDS.STEERING_COMMITTEE },
    // No discord - organizational container
  },
  {
    id: ROLE_IDS.AUTH_WG,
    description: 'Authentication Working Group',
    github: { team: 'auth-wg', parent: ROLE_IDS.WORKING_GROUPS },
    // See AUTH_IG for Discord role
  },
  {
    id: ROLE_IDS.SECURITY_WG,
    description: 'Security Working Group',
    github: { team: 'security-wg', parent: ROLE_IDS.WORKING_GROUPS },
    // See interest group for Discord role
  },
  {
    id: ROLE_IDS.SERVER_IDENTITY_WG,
    description: 'Server Identity Working Group',
    discord: { role: 'server identity working group' },
    // Discord only for now
  },
  {
    id: ROLE_IDS.TRANSPORT_WG,
    description: 'Transport Working Group',
    github: { team: 'transport-wg', parent: ROLE_IDS.WORKING_GROUPS },
    discord: { role: 'transports working group' },
  },

  // ===================
  // Interest Groups
  // ===================
  {
    id: ROLE_IDS.INTEREST_GROUPS,
    description: 'Interest Groups',
    github: { team: 'interest-groups', parent: ROLE_IDS.STEERING_COMMITTEE },
    // No discord - organizational container
  },
  {
    id: ROLE_IDS.AGENTS_IG,
    description: 'Agents Interest Group',
    discord: { role: 'agents interest group' },
    // Discord only
  },
  {
    id: ROLE_IDS.AUTH_IG,
    description: 'Auth Interest Group',
    discord: { role: 'auth interest group' },
    // Discord only - separate from AUTH_WG which is GitHub
  },
  {
    id: ROLE_IDS.CLIENT_IMPLEMENTOR_IG,
    description: 'Client Implementor Interest Group',
    discord: { role: 'client implementor interest group' },
    // Discord only
  },
  {
    id: ROLE_IDS.FINANCIAL_SERVICES_IG,
    description: 'Financial Services Interest Group',
    github: { team: 'ig-financial-services', parent: ROLE_IDS.INTEREST_GROUPS },
    discord: { role: 'financial services interest group' },
  },

  // ===================
  // Email Groups (Google only)
  // ===================
  {
    id: ROLE_IDS.ANTITRUST,
    description: 'Antitrust compliance contacts',
    google: { group: 'antitrust', isEmailGroup: true },
    // Google only
  },
  {
    id: ROLE_IDS.CATCH_ALL,
    description: 'Catch-all email group',
    google: { group: 'catch-all', isEmailGroup: true },
    // Google only
  },
] as const;

/**
 * Get a role by ID
 */
export function getRole(id: RoleId): Role | undefined {
  return ROLES.find((r) => r.id === id);
}

/**
 * Get all roles that exist on a specific platform
 */
export function getRolesForPlatform(platform: 'github' | 'discord' | 'google'): Role[] {
  return ROLES.filter((r) => r[platform] !== undefined);
}

/**
 * Build a lookup map of roles by ID
 */
export function buildRoleLookup(): Map<RoleId, Role> {
  return new Map(ROLES.map((r) => [r.id, r]));
}
