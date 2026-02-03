/**
 * Role ID constants for type-safe role references.
 * Using constants prevents typos and enables autocomplete.
 */
export const ROLE_IDS = {
  // ===================
  // Organization Structure
  // ===================
  STEERING_COMMITTEE: 'steering-committee',
  CORE_MAINTAINERS: 'core-maintainers',
  LEAD_MAINTAINERS: 'lead-maintainers',
  MODERATORS: 'moderators',
  ADMINISTRATORS: 'administrators', // Discord only
  COMMUNITY_MANAGERS: 'community-managers', // Discord only

  // ===================
  // Maintainer Groups
  // ===================
  MAINTAINERS: 'maintainers',
  DOCS_MAINTAINERS: 'docs-maintainers',
  INSPECTOR_MAINTAINERS: 'inspector-maintainers',
  MCPB_MAINTAINERS: 'mcpb-maintainers',
  REFERENCE_SERVERS_MAINTAINERS: 'reference-servers-maintainers',
  REGISTRY_MAINTAINERS: 'registry-maintainers',
  USE_MCP_MAINTAINERS: 'use-mcp-maintainers',

  // ===================
  // SDK Maintainers
  // ===================
  SDK_MAINTAINERS: 'sdk-maintainers',
  CSHARP_SDK: 'csharp-sdk',
  GO_SDK: 'go-sdk',
  JAVA_SDK: 'java-sdk',
  KOTLIN_SDK: 'kotlin-sdk',
  MCP_APPS_SDK: 'mcp-apps-sdk',
  PHP_SDK: 'php-sdk',
  PYTHON_SDK: 'python-sdk',
  PYTHON_SDK_AUTH: 'python-sdk-auth', // GitHub only (CODEOWNERS)
  RUBY_SDK: 'ruby-sdk',
  RUST_SDK: 'rust-sdk',
  SWIFT_SDK: 'swift-sdk',
  TYPESCRIPT_SDK: 'typescript-sdk',
  TYPESCRIPT_SDK_AUTH: 'typescript-sdk-auth', // GitHub only (CODEOWNERS)

  // ===================
  // Working Groups
  // ===================
  WORKING_GROUPS: 'working-groups',
  AUTH_MAINTAINERS: 'auth-maintainers',
  SECURITY_WG: 'security-wg',
  SERVER_IDENTITY_WG: 'server-identity-wg',
  TRANSPORT_WG: 'transport-wg',
  MCP_APPS_WG: 'mcp-apps-wg',

  // ===================
  // Interest Groups
  // ===================
  INTEREST_GROUPS: 'interest-groups',
  AGENTS_IG: 'agents-ig',
  AUTH_IG: 'auth-ig',
  CLIENT_IMPLEMENTOR_IG: 'client-implementor-ig',
  FINANCIAL_SERVICES_IG: 'financial-services-ig',
  GATEWAYS_IG: 'gateways-ig',

  // ===================
  // WG/IG Facilitators (Discord only)
  // ===================
  WG_IG_FACILITATORS: 'wg-ig-facilitators',

  // ===================
  // Email Groups (Google only)
  // ===================
  ANTITRUST: 'antitrust',
  CATCH_ALL: 'catch-all',
} as const;

export type RoleId = (typeof ROLE_IDS)[keyof typeof ROLE_IDS];

/**
 * Helper to check if a string is a valid RoleId at runtime.
 */
export function isValidRoleId(id: string): id is RoleId {
  return Object.values(ROLE_IDS).includes(id as RoleId);
}
