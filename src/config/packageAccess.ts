// npm & PyPI package publishing access configuration
//
// This file declares the *expected* state of package-registry access so it can
// be reviewed and audited in one place. Unlike GitHub/Google/Discord, none of
// it is applied by Pulumi:
//
// - npm: since August 2026 every mutating org/team/package-access/trust
//   operation requires an interactive 2FA challenge (tokens — even with
//   "bypass 2FA" — get 403), so unattended reconciliation is impossible.
//   Read endpoints still work with a granular access token, so drift is
//   *detected* by scripts/check-package-drift.ts (run weekly by
//   .github/workflows/package-drift.yml) and *applied* by a human following
//   the runbook in the README ("npm & PyPI Package Publishing Access").
// - PyPI: there is no management API at all (collaborators, trusted
//   publishers and organizations are web-UI only), so the PyPI section below
//   is declared state for audit plus a manual runbook — nothing is automated.
//
// This module must stay import-safe for scripts/validate-config.ts and
// scripts/test-config.ts: pure data and helpers, no network, no Pulumi.

import { MEMBERS } from './users';

/** The npm organization (scope) that owns @modelcontextprotocol/* packages. */
export const NPM_ORG = 'modelcontextprotocol';

/**
 * A package's npm trusted publishing configuration (OIDC from GitHub Actions).
 * npm allows exactly one trusted publisher per package.
 */
export interface NpmTrustedPublisher {
  /** GitHub repository allowed to publish, as "owner/repo" */
  repository: string;
  /** Workflow file path within the repository, e.g. ".github/workflows/main.yml" */
  workflow: string;
}

/** Expected access for a single npm package. */
export interface NpmPackageAccess {
  /** Full package name, e.g. "@modelcontextprotocol/sdk" */
  package: string;
  /**
   * npm usernames expected to have publish rights (the registry
   * "maintainers" list). Every entry must be the `npm` field of a member in
   * users.ts or listed in UNMAPPED_NPM_USERS (enforced by validate-config).
   */
  maintainers: readonly string[];
  /** Expected trusted publishing configuration, if declared */
  trustedPublisher?: NpmTrustedPublisher;
}

/**
 * npm usernames that currently hold access but have not been verifiably
 * mapped to a member in users.ts yet. Keep this list shrinking: when a
 * mapping is confirmed, set `npm` on the member and remove the entry here.
 */
export const UNMAPPED_NPM_USERS: readonly string[] = [
  // Registry email ashwin@anthropic.com; no matching entry in users.ts.
  'ashwin-ant',
];

/**
 * The baseline maintainer set for org packages: the npm accounts of the core
 * publishing group (see users.ts: jspahrsummers, pcarleton, felixweinberger,
 * dsp-ant, ochafik, plus the unmapped ashwin-ant).
 */
export const NPM_BASE_MAINTAINERS: readonly string[] = [
  'ashwin-ant',
  'fweinberger',
  'jspahrsummers',
  'ochafik-ant',
  'pcarleton',
  'thedsp',
];

/**
 * Packages with explicitly declared access. Packages in the org that are not
 * listed here fall under NPM_DEFAULT_POLICY.
 */
export const NPM_PACKAGES: readonly NpmPackageAccess[] = [
  {
    package: '@modelcontextprotocol/sdk',
    maintainers: NPM_BASE_MAINTAINERS,
    trustedPublisher: {
      repository: 'modelcontextprotocol/typescript-sdk',
      workflow: '.github/workflows/main.yml',
    },
  },
  {
    package: '@modelcontextprotocol/inspector',
    maintainers: [...NPM_BASE_MAINTAINERS, 'cliffhall'],
    trustedPublisher: {
      repository: 'modelcontextprotocol/inspector',
      workflow: '.github/workflows/main.yml',
    },
  },
  {
    package: '@modelcontextprotocol/server-everything',
    maintainers: [...NPM_BASE_MAINTAINERS, 'cliffhall'],
    trustedPublisher: {
      repository: 'modelcontextprotocol/servers',
      workflow: '.github/workflows/release.yml',
    },
  },
];

/**
 * Policy applied to every org package without an explicit NPM_PACKAGES entry
 * (the org has ~54 packages; the drift checker enumerates them live).
 */
export const NPM_DEFAULT_POLICY = {
  /** Expected maintainers for packages without an explicit entry */
  maintainers: NPM_BASE_MAINTAINERS,
  /**
   * All org packages should publish via trusted publishing (OIDC), not
   * tokens. The drift checker reports packages whose latest release was not
   * trusted-published; the exact repository/workflow is only pinned for
   * packages with an explicit NPM_PACKAGES entry.
   */
  requireTrustedPublishing: true,
} as const;

/** Expected access for the given package: its explicit entry or the default policy. */
export function getNpmPackageAccess(packageName: string): NpmPackageAccess {
  return (
    NPM_PACKAGES.find((p) => p.package === packageName) ?? {
      package: packageName,
      maintainers: NPM_DEFAULT_POLICY.maintainers,
    }
  );
}

/**
 * Expected npm org membership: every npm username declared on a member in
 * users.ts, plus the not-yet-mapped accounts. Sorted, de-duplicated.
 */
export function getExpectedNpmOrgMembers(): string[] {
  const usernames = new Set<string>(UNMAPPED_NPM_USERS);
  for (const member of MEMBERS) {
    if (member.npm) usernames.add(member.npm);
  }
  return [...usernames].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// PyPI (declared state only — no API exists, nothing is automated)
// ---------------------------------------------------------------------------

/** Expected access for a single PyPI project. */
export interface PyPiProjectAccess {
  /** Project name on pypi.org */
  project: string;
  /**
   * PyPI accounts with a role on the project. PyPI does not publicly expose
   * whether an account is Owner or Maintainer, so this is a single list.
   * Every entry must be the `pypi` field of a member in users.ts or listed
   * in UNMAPPED_PYPI_USERS (enforced by validate-config).
   */
  accounts: readonly string[];
  /** Source repository expected to publish via trusted publishing */
  repository?: string;
  /** Caveats about this entry (e.g. unverified rosters) */
  notes?: string;
}

/** PyPI usernames with access that are not yet mapped to a member in users.ts. */
export const UNMAPPED_PYPI_USERS: readonly string[] = [];

export const PYPI_PROJECTS: readonly PyPiProjectAccess[] = [
  {
    project: 'mcp',
    accounts: ['Kludex', 'dsp', 'jspahrsummers', 'maxisbey'],
    repository: 'modelcontextprotocol/python-sdk',
  },
  {
    project: 'mcp-server-git',
    accounts: [],
    repository: 'modelcontextprotocol/servers',
    notes:
      'Account roster not yet audited — PyPI exposes rosters only in the ' +
      'web UI, and this page could not be verified. A project owner should ' +
      'fill this in from pypi.org/manage/project/mcp-server-git/collaboration/.',
  },
  {
    project: 'mcp-server-fetch',
    accounts: [],
    repository: 'modelcontextprotocol/servers',
    notes:
      'Account roster not yet audited — see mcp-server-git note; source: ' +
      'pypi.org/manage/project/mcp-server-fetch/collaboration/.',
  },
  {
    project: 'mcp-server-time',
    accounts: [],
    repository: 'modelcontextprotocol/servers',
    notes:
      'Account roster not yet audited — see mcp-server-git note; source: ' +
      'pypi.org/manage/project/mcp-server-time/collaboration/.',
  },
];
