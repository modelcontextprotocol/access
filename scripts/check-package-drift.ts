#!/usr/bin/env npx ts-node

/**
 * Compares live npm registry state against the expected state declared in
 * src/config/packageAccess.ts and prints a drift report plus a remediation
 * plan of npm CLI commands for a maintainer to run in a single interactive
 * 2FA-authenticated session (see "npm & PyPI Package Publishing Access" in
 * the README).
 *
 * Read-only: this script never mutates anything. All npm write operations
 * require an interactive 2FA challenge (since August 2026), which is why the
 * remediation is a human-executed plan instead of automation. PyPI has no
 * management API at all and is not checked here.
 *
 * Run with: NPM_TOKEN=<read-only granular access token> npx ts-node scripts/check-package-drift.ts
 *
 * - Without NPM_TOKEN: prints a skip notice and exits 0 (so CI without the
 *   secret is a graceful no-op, mirroring the optional Discord credentials).
 * - With NPM_TOKEN: exits 1 when drift is found, 0 when clean.
 */

import {
  NPM_ORG,
  NPM_PACKAGES,
  NPM_DEFAULT_POLICY,
  getNpmPackageAccess,
  getExpectedNpmOrgMembers,
} from '../src/config/packageAccess';

const REGISTRY = 'https://registry.npmjs.org';
const REQUEST_DELAY_MS = 150;

const token = process.env.NPM_TOKEN;

interface Drift {
  description: string;
  /** Remediation lines; lines starting with '#' are guidance, not commands */
  commands: readonly string[];
}

const drifts: Drift[] = [];
const warnings: string[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registryGet(path: string): Promise<{ status: number; body: unknown }> {
  const url = `${REGISTRY}${path}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2000 * attempt);
    try {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} from ${url}`);
        continue;
      }
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // Non-JSON body (e.g. empty 404) — leave as null
      }
      return { status: response.status, body };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

function diffSets(
  expected: readonly string[],
  actual: readonly string[]
): { missing: string[]; unexpected: string[] } {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    missing: expected.filter((e) => !actualSet.has(e)).sort(),
    unexpected: actual.filter((a) => !expectedSet.has(a)).sort(),
  };
}

async function checkOrgMembership(): Promise<void> {
  const { status, body } = await registryGet(`/-/org/${NPM_ORG}/user`);
  if (status !== 200 || typeof body !== 'object' || body === null) {
    warnings.push(
      `Could not read org roster (GET /-/org/${NPM_ORG}/user returned ${status}). ` +
        `The token likely lacks organization read access — org membership was NOT checked.`
    );
    return;
  }

  const roster = body as Record<string, string>;
  const actual = Object.keys(roster);
  if (actual.length === 0) {
    warnings.push(
      `Org roster came back empty — unauthenticated requests see an empty roster, ` +
        `so the token likely lacks organization access. Org membership was NOT checked.`
    );
    return;
  }

  const { missing, unexpected } = diffSets(getExpectedNpmOrgMembers(), actual);
  for (const user of missing) {
    drifts.push({
      description: `Org member missing: "${user}" is expected in the "${NPM_ORG}" org but is not a member`,
      commands: [`npm org set ${NPM_ORG} ${user} developer`],
    });
  }
  for (const user of unexpected) {
    drifts.push({
      description:
        `Unexpected org member: "${user}" (role: ${roster[user]}) is in the "${NPM_ORG}" org ` +
        `but not declared in packageAccess.ts/users.ts`,
      commands: [
        `# Either add npm: '${user}' to the right member in src/config/users.ts (or UNMAPPED_NPM_USERS), or remove them:`,
        `npm org rm ${NPM_ORG} ${user}`,
      ],
    });
  }
}

async function listOrgPackages(): Promise<string[]> {
  const { status, body } = await registryGet(`/-/org/${NPM_ORG}/package`);
  if (status === 200 && typeof body === 'object' && body !== null) {
    return Object.keys(body as Record<string, string>).sort();
  }
  warnings.push(
    `Could not enumerate org packages (GET /-/org/${NPM_ORG}/package returned ${status}); ` +
      `falling back to the ${NPM_PACKAGES.length} explicitly declared packages.`
  );
  return NPM_PACKAGES.map((p) => p.package);
}

/** Extract candidate trusted-publisher configs from a /trust response, defensively. */
function extractTrustConfigs(body: unknown): Array<Record<string, unknown>> {
  if (body === null || typeof body !== 'object') return [];
  if (Array.isArray(body)) return body.filter((c) => typeof c === 'object' && c !== null);
  const obj = body as Record<string, unknown>;
  for (const key of ['objects', 'configurations', 'trustedPublishers', 'trust']) {
    if (Array.isArray(obj[key])) {
      return (obj[key] as unknown[]).filter(
        (c): c is Record<string, unknown> => typeof c === 'object' && c !== null
      );
    }
  }
  return [obj];
}

async function checkPackage(packageName: string): Promise<void> {
  const expected = getNpmPackageAccess(packageName);
  const isExplicit = NPM_PACKAGES.some((p) => p.package === packageName);

  // 1) Maintainers, from the public package document
  const { status, body } = await registryGet(`/${packageName.replace('/', '%2F')}`);
  if (status !== 200 || typeof body !== 'object' || body === null) {
    warnings.push(`Could not read package document for ${packageName} (HTTP ${status}).`);
    return;
  }
  const packument = body as {
    maintainers?: Array<{ name?: string }>;
    'dist-tags'?: Record<string, string>;
    versions?: Record<string, { _npmUser?: { trustedPublisher?: unknown } }>;
  };

  const actualMaintainers = (packument.maintainers ?? [])
    .map((m) => m.name)
    .filter((name): name is string => typeof name === 'string');
  const { missing, unexpected } = diffSets(expected.maintainers, actualMaintainers);
  for (const user of missing) {
    drifts.push({
      description: `Maintainer missing on ${packageName}: "${user}"`,
      commands: [`npm owner add ${user} ${packageName}`],
    });
  }
  for (const user of unexpected) {
    drifts.push({
      description:
        `Unexpected maintainer on ${packageName}: "${user}" ` +
        `(not in its ${isExplicit ? 'declared maintainers' : 'default-policy maintainers'})`,
      commands: [
        `# Either declare "${user}" for this package in src/config/packageAccess.ts, or remove them:`,
        `npm owner rm ${user} ${packageName}`,
      ],
    });
  }

  // 2) Trusted publishing of the latest release (default policy)
  const latestVersion = packument['dist-tags']?.latest;
  const latest = latestVersion ? packument.versions?.[latestVersion] : undefined;
  if (NPM_DEFAULT_POLICY.requireTrustedPublishing && latest && !latest._npmUser?.trustedPublisher) {
    drifts.push({
      description:
        `${packageName}@${latestVersion} was not published via trusted publishing ` +
        `(policy: all org packages publish via OIDC)`,
      commands: [
        `# Configure a trusted publisher for ${packageName} (web UI: package Settings -> Trusted publishing,`,
        `# or \`npm trust\` on npm >= 11.15.0), then stop using publish tokens for it.`,
      ],
    });
  }

  // 3) Declared trusted-publisher configuration (explicit packages only)
  if (expected.trustedPublisher) {
    const want = expected.trustedPublisher;
    const trust = await registryGet(`/-/package/${packageName.replace('/', '%2F')}/trust`);
    if (trust.status === 401 || trust.status === 403) {
      warnings.push(
        `Cannot read trusted-publisher config for ${packageName} (HTTP ${trust.status}); ` +
          `token lacks permission — declared publisher (${want.repository} ${want.workflow}) was NOT verified.`
      );
    } else if (trust.status === 404 || extractTrustConfigs(trust.body).length === 0) {
      drifts.push({
        description: `No trusted publisher configured on ${packageName} (expected ${want.repository} via ${want.workflow})`,
        commands: [
          `# Configure trusted publishing for ${packageName}: GitHub Actions, repository ${want.repository},`,
          `# workflow ${want.workflow} (web UI: package Settings -> Trusted publishing, or \`npm trust\`).`,
        ],
      });
    } else if (trust.status === 200) {
      const configs = extractTrustConfigs(trust.body);
      const matches = configs.some((c) => {
        const text = JSON.stringify(c);
        const repoOk =
          text.includes(want.repository) ||
          (text.includes(want.repository.split('/')[0]) &&
            text.includes(want.repository.split('/')[1]));
        const workflowFile = want.workflow.split('/').pop() ?? want.workflow;
        return repoOk && text.includes(workflowFile);
      });
      if (!matches) {
        drifts.push({
          description:
            `Trusted publisher mismatch on ${packageName}: expected ${want.repository} via ${want.workflow}, ` +
            `live config differs: ${JSON.stringify(configs)}`,
          commands: [
            `# Update trusted publishing for ${packageName} to repository ${want.repository},`,
            `# workflow ${want.workflow} (web UI: package Settings -> Trusted publishing, or \`npm trust\`).`,
          ],
        });
      }
    }
  }
}

async function main(): Promise<void> {
  if (!token) {
    console.log('NPM_TOKEN is not set — skipping npm package access drift check.');
    console.log(
      'Provide a read-only granular access token with organization read access to enable it.'
    );
    process.exit(0);
  }

  console.log(`Checking npm package access drift for org "${NPM_ORG}"...\n`);

  await checkOrgMembership();

  const packages = await listOrgPackages();
  console.log(`Checking ${packages.length} packages...`);
  const declared = new Set(NPM_PACKAGES.map((p) => p.package));
  const notInOrg = [...declared].filter((p) => !packages.includes(p));
  for (const pkg of notInOrg) {
    warnings.push(`Declared package ${pkg} was not found in the org package list.`);
  }
  for (const pkg of packages) {
    await checkPackage(pkg);
    await sleep(REQUEST_DELAY_MS);
  }

  // Report
  if (warnings.length > 0) {
    console.log('\n--- Warnings (not drift) ---');
    for (const warning of warnings) console.log(`  ! ${warning}`);
  }

  if (drifts.length === 0) {
    console.log('\nNo drift detected. Live npm state matches src/config/packageAccess.ts.');
    process.exit(0);
  }

  console.log(`\n--- Drift report (${drifts.length} finding${drifts.length === 1 ? '' : 's'}) ---`);
  for (const drift of drifts) console.log(`  ✗ ${drift.description}`);

  console.log('\n--- Remediation plan ---');
  console.log('# Review, then run in ONE interactive npm session (logged in as an org owner).');
  console.log('# Approve a 2FA challenge on npmjs.com and choose "Don\'t ask again for 5 minutes"');
  console.log('# to batch these; add `sleep 2` between commands in longer batches.');
  console.log('# See "npm & PyPI Package Publishing Access" in the README.\n');
  for (const drift of drifts) {
    for (const command of drift.commands) console.log(command);
  }

  process.exit(1);
}

main().catch((e) => {
  console.error(`Drift check failed: ${e}`);
  process.exit(1);
});
