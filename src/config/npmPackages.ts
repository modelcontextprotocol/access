/**
 * npm package access configuration.
 *
 * Maps npm packages to the npm teams (defined via `npm` config on roles in
 * roles.ts) that should have access to them. Teams are referenced by their
 * npm team name (e.g., 'inspector' -> modelcontextprotocol:inspector).
 *
 * Note: the 'developers' team is npm's built-in default team (all org members
 * belong to it automatically) and is intentionally not managed here.
 */

export type NpmPermission = 'read-only' | 'read-write';

export interface NpmTeamAccess {
  /** npm team name (must match an `npm.team` in roles.ts) */
  team: string;
  permission: NpmPermission;
}

export interface NpmPackageAccess {
  /** Full package name, including the @modelcontextprotocol scope */
  package: string;
  teams: readonly NpmTeamAccess[];
}

export const NPM_PACKAGE_ACCESS: readonly NpmPackageAccess[] = [
  {
    package: '@modelcontextprotocol/inspector',
    teams: [{ team: 'inspector', permission: 'read-write' }],
  },
  {
    package: '@modelcontextprotocol/inspector-client',
    teams: [{ team: 'inspector', permission: 'read-write' }],
  },
  {
    package: '@modelcontextprotocol/inspector-server',
    teams: [{ team: 'inspector', permission: 'read-write' }],
  },
  {
    package: '@modelcontextprotocol/inspector-cli',
    teams: [{ team: 'inspector', permission: 'read-write' }],
  },
];
