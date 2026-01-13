#!/usr/bin/env npx ts-node

/**
 * Tests the configuration structure without needing Pulumi credentials.
 * Run with: npx ts-node scripts/test-config.ts
 */

import { ROLES, buildRoleLookup, getRolesForPlatform } from '../src/config/roles';
import { ROLE_IDS, isValidRoleId } from '../src/config/roleIds';
import { MEMBERS } from '../src/config/users';

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
  Object.values(ROLE_IDS).every(id => isValidRoleId(id))
);

// Test ROLES
test('ROLES array is not empty', () => ROLES.length > 0);
test('All roles have id and description', () =>
  ROLES.every(r => r.id && r.description)
);
test('All role IDs are unique', () => {
  const ids = ROLES.map(r => r.id);
  return ids.length === new Set(ids).size;
});

// Test platform configs
const githubRoles = getRolesForPlatform('github');
const discordRoles = getRolesForPlatform('discord');
const googleRoles = getRolesForPlatform('google');

test('Has GitHub roles', () => githubRoles.length > 0);
test('Has Discord roles', () => discordRoles.length > 0);
test('Has Google roles', () => googleRoles.length > 0);

test('GitHub roles have team names', () =>
  githubRoles.every(r => r.github?.team)
);
test('Discord roles have role names', () =>
  discordRoles.every(r => r.discord?.role)
);
test('Google roles have group names', () =>
  googleRoles.every(r => r.google?.group)
);

// Test parent relationships
const roleLookup = buildRoleLookup();
test('All GitHub parent references are valid', () =>
  githubRoles.every(r => {
    if (!r.github?.parent) return true;
    const parent = roleLookup.get(r.github.parent);
    return parent && parent.github;
  })
);

// Test members
test('MEMBERS array is not empty', () => MEMBERS.length > 0);
test('All members have at least one identifier', () =>
  MEMBERS.every(m => m.github || m.email || m.discord)
);
test('All member role references are valid', () =>
  MEMBERS.every(m => m.memberOf.every(id => roleLookup.has(id)))
);

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

// Summary
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
