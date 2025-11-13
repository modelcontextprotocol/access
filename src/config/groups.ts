import { defineGroups } from './utils';

// NOTE: For GitHub teams, only the first memberOf will be used as the parent team.
// GitHub only supports one parent team per team.
//
// Email groups (isEmailGroup: true) accept emails from anyone (including external users)
// and notify group members for each email.
//
// Groups are created on all platforms (GitHub and Google) by default.
// To limit a group to specific platforms, set the onlyOnPlatforms array (e.g., onlyOnPlatforms: ['google']).
export const GROUPS = defineGroups([
  // MCP Organization Structure
  {
    name: 'steering-committee',
    description: 'MCP Steering Committee',
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'core',
    description: 'Core team',
    memberOf: ['steering-committee'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'core-maintainers',
    description: 'Core maintainers',
    memberOf: ['steering-committee'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'moderators',
    description: 'Community moderators',
    memberOf: ['steering-committee'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'docs-maintaners',
    description: 'MCP docs maintainers',
    memberOf: ['steering-committee'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'inspector-maintainers',
    description: 'MCP Inspector maintainers',
    memberOf: ['steering-committee'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'mcpb-maintainers',
    description: 'MCPB (Model Context Protocol Bundle) maintainers',
    memberOf: ['steering-committee'],
    onlyOnPlatforms: ['github'],
  },

  // SDK Maintainers
  {
    name: 'sdk-maintainers',
    description: 'Authors and maintainers of official MCP SDKs',
    memberOf: ['steering-committee'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'csharp-sdk',
    description: 'Official C# SDK maintainers',
    memberOf: ['sdk-maintainers'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'go-sdk',
    description: 'The Go SDK Team',
    memberOf: ['sdk-maintainers'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'java-sdk',
    description: 'Official Java SDK maintainers',
    memberOf: ['sdk-maintainers'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'kotlin-sdk',
    description: 'Official Kotlin SDK maintainers',
    memberOf: ['sdk-maintainers'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'php-sdk',
    description: 'Official PHP SDK maintainers',
    memberOf: ['sdk-maintainers'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'python-sdk',
    description: 'Official Python SDK maintainers',
    memberOf: ['sdk-maintainers'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'python-sdk-auth',
    description: 'Auth related owners',
    memberOf: ['python-sdk'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'ruby-sdk',
    description: 'Official Ruby SDK maintainers',
    memberOf: ['sdk-maintainers'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'rust-sdk',
    description: 'Official Rust SDK maintainers',
    memberOf: ['sdk-maintainers'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'swift-sdk',
    description: 'Official Swift SDK maintainers',
    memberOf: ['sdk-maintainers'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'typescript-sdk',
    description: 'Official TypeScript SDK',
    memberOf: ['sdk-maintainers'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'typescript-sdk-auth',
    description: 'Code owners for auth in Typescript SDK',
    memberOf: ['typescript-sdk'],
    onlyOnPlatforms: ['github'],
  },

  // Working Groups
  {
    name: 'working-groups',
    description: 'MCP Working Groups',
    memberOf: ['steering-committee'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'auth-wg',
    description: 'Authentication Working Group',
    memberOf: ['working-groups'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'registry-wg',
    description: 'Official registry builders and maintainers',
    memberOf: ['working-groups'],
  },
  {
    name: 'security-wg',
    description: 'Security Working Group',
    memberOf: ['working-groups'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'transport-wg',
    description: 'Transport Working Group',
    memberOf: ['working-groups'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'inspector-v2-wg',
    description: 'Inspector V2 Working Group',
    memberOf: ['working-groups'],
    onlyOnPlatforms: ['github'],
  },

  // Interest Groups
  {
    name: 'interest-groups',
    description: 'Interest Groups',
    memberOf: ['steering-committee'],
    onlyOnPlatforms: ['github'],
  },
  {
    name: 'ig-financial-services',
    description: 'Financial Services Interest Group',
    memberOf: ['interest-groups'],
    onlyOnPlatforms: ['github'],
  },

  // Email-only groups
  {
    name: 'antitrust',
    description: 'Antitrust compliance contacts',
    isEmailGroup: true,
    onlyOnPlatforms: ['google'],
  },
  {
    name: 'catch-all',
    description: 'Catch-all email group',
    isEmailGroup: true,
    onlyOnPlatforms: ['google'],
  },
] as const);