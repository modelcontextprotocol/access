#!/usr/bin/env npx ts-node

/**
 * Tests the configuration structure without needing Pulumi credentials.
 * Run with: npx ts-node scripts/test-config.ts
 */

import { ROLES, buildRoleLookup, getRolesForPlatform } from '../src/config/roles';
import { ROLE_IDS, isValidRoleId } from '../src/config/roleIds';
import { MEMBERS } from '../src/config/users';
import { hasProvisionUserRole } from '../src/config/utils';
import {
  NPM_ORG,
  NPM_PACKAGES,
  PYPI_PROJECTS,
  getExpectedNpmOrgMembers,
  getNpmPackageAccess,
  NPM_DEFAULT_POLICY,
} from '../src/config/packageAccess';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => boolean) {
  try {
    if (fn()) {
      console.log(`✓ ${name}`);
      passed++;
    } else {
      console.log(`✗ ${name}`);
      failed++;
    }
  } catch (e) {
    console.log(`✗ ${name}: ${e}`);
    failed++;
  }
}

console.log('Testing role configuration...\n');

// Test ROLE_IDS
test('ROLE_IDS has entries', () => Object.keys(ROLE_IDS).length > 0);
test('All ROLE_IDS values are valid', () =>
  Object.values(ROLE_IDS).every((id) => isValidRoleId(id)));

// Test ROLES
test('ROLES array is not empty', () => ROLES.length > 0);
test('All roles have id and description', () => ROLES.every((r) => r.id && r.description));
test('All role IDs are unique', () => {
  const ids = ROLES.map((r) => r.id);
  return ids.length === new Set(ids).size;
});

// Test platform configs
const githubRoles = getRolesForPlatform('github');
const discordRoles = getRolesForPlatform('discord');
const googleRoles = getRolesForPlatform('google');

test('Has GitHub roles', () => githubRoles.length > 0);
test('Has Discord roles', () => discordRoles.length > 0);
test('Has Google roles', () => googleRoles.length > 0);

test('GitHub roles have team names', () => githubRoles.every((r) => r.github?.team));
test('Discord roles have role names', () => discordRoles.every((r) => r.discord?.role));
test('Google roles have group names', () => googleRoles.every((r) => r.google?.group));

// Test parent relationships
const roleLookup = buildRoleLookup();
test('All GitHub parent references are valid', () =>
  githubRoles.every((r) => {
    if (!r.github?.parent) return true;
    const parent = roleLookup.get(r.github.parent);
    return parent && parent.github;
  }));

// Test members
test('MEMBERS array is not empty', () => MEMBERS.length > 0);
test('All members have at least one identifier', () =>
  MEMBERS.every((m) => m.github || m.email || m.discord));
test('All member role references are valid', () =>
  MEMBERS.every((m) => m.memberOf.every((id) => roleLookup.has(id))));

// Test specific roles exist
test('CORE_MAINTAINERS role exists', () => !!roleLookup.get(ROLE_IDS.CORE_MAINTAINERS));
test('ADMINISTRATORS role exists (Discord-only)', () => {
  const role = roleLookup.get(ROLE_IDS.ADMINISTRATORS);
  return role !== undefined && role.discord !== undefined && role.github === undefined;
});
test('TYPESCRIPT_SDK_AUTH role exists (GitHub-only)', () => {
  const role = roleLookup.get(ROLE_IDS.TYPESCRIPT_SDK_AUTH);
  return role !== undefined && role.github !== undefined && role.discord === undefined;
});

// Test Google Workspace user provisioning
test('Roles with provisionUser exist', () => {
  const provisionRoles = ROLES.filter((r) => r.provisionUser);
  return provisionRoles.length > 0;
});

test('Members with googleEmailPrefix have firstName and lastName', () =>
  MEMBERS.every((m) => {
    if (!m.googleEmailPrefix) return true;
    return !!m.firstName && !!m.lastName;
  }));

test('googleEmailPrefix values are unique', () => {
  const prefixes = MEMBERS.filter((m) => m.googleEmailPrefix).map((m) => m.googleEmailPrefix);
  return prefixes.length === new Set(prefixes).size;
});

test('skipGoogleUserProvisioning is only used in provisionUser roles and without fields', () => {
  return MEMBERS.every((member) => {
    const inProvisionRole = hasProvisionUserRole(member.memberOf, roleLookup);
    if (!inProvisionRole) return !member.skipGoogleUserProvisioning;

    const hasProvisioningFields = !!(
      member.firstName &&
      member.lastName &&
      member.googleEmailPrefix
    );
    return !(hasProvisioningFields && member.skipGoogleUserProvisioning);
  });
});

test('Some members in provisionUser roles have Google user fields', () => {
  const membersInProvisionRoles = MEMBERS.filter((m) =>
    hasProvisionUserRole(m.memberOf, roleLookup)
  );
  const provisioned = membersInProvisionRoles.filter(
    (m) => m.firstName && m.lastName && m.googleEmailPrefix
  );
  return membersInProvisionRoles.length > 0 && provisioned.length > 0;
});

// Test package registry access config
test('NPM_ORG is modelcontextprotocol', () => NPM_ORG === 'modelcontextprotocol');
test('NPM_PACKAGES is not empty and all packages are org-scoped', () =>
  NPM_PACKAGES.length > 0 && NPM_PACKAGES.every((p) => p.package.startsWith(`@${NPM_ORG}/`)));
test('All NPM_PACKAGES have at least one maintainer', () =>
  NPM_PACKAGES.every((p) => p.maintainers.length > 0));
test('npm usernames on members are unique', () => {
  const usernames = MEMBERS.filter((m) => m.npm).map((m) => m.npm);
  return usernames.length === new Set(usernames).size;
});
test('pypi usernames on members are unique', () => {
  const usernames = MEMBERS.filter((m) => m.pypi).map((m) => m.pypi);
  return usernames.length === new Set(usernames).size;
});
test('Expected npm org membership is non-empty, sorted, and unique', () => {
  const orgMembers = getExpectedNpmOrgMembers();
  const sorted = [...orgMembers].sort((a, b) => a.localeCompare(b));
  return (
    orgMembers.length > 0 &&
    orgMembers.length === new Set(orgMembers).size &&
    orgMembers.every((username, i) => username === sorted[i])
  );
});
test('getNpmPackageAccess falls back to the default policy', () => {
  const access = getNpmPackageAccess(`@${NPM_ORG}/some-undeclared-package`);
  return access.maintainers === NPM_DEFAULT_POLICY.maintainers && !access.trustedPublisher;
});
test('getNpmPackageAccess returns explicit entries', () => {
  const access = getNpmPackageAccess(`@${NPM_ORG}/sdk`);
  return !!access.trustedPublisher;
});
test('PYPI_PROJECTS includes the mcp project with accounts', () => {
  const mcp = PYPI_PROJECTS.find((p) => p.project === 'mcp');
  return !!mcp && mcp.accounts.length > 0;
});
test('PyPI project names are unique', () => {
  const names = PYPI_PROJECTS.map((p) => p.project);
  return names.length === new Set(names).size;
});

// Summary
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
