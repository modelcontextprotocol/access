#!/usr/bin/env npx ts-node

/**
 * Validates that all references in the config are valid.
 * Run with: npx ts-node scripts/validate-config.ts
 */

import { ROLES, buildRoleLookup } from '../src/config/roles';
import { REPOSITORY_ACCESS } from '../src/config/repoAccess';
import { MEMBERS } from '../src/config/users';
import type { RoleId } from '../src/config/roleIds';

const roleLookup = buildRoleLookup();

// Get all GitHub team names (roles that have GitHub config)
const githubTeamNames = new Set<string>();
// Get all role IDs (for member validation)
const allRoleIds = new Set<RoleId>();

for (const role of ROLES) {
  allRoleIds.add(role.id);

  if (role.github) {
    githubTeamNames.add(role.github.team);
  }
}

let hasErrors = false;

// Validate team references in REPOSITORY_ACCESS
console.log('Validating team references in repoAccess.ts...');
for (const repo of REPOSITORY_ACCESS) {
  if (!repo.teams) continue;

  for (const teamRef of repo.teams) {
    if (!githubTeamNames.has(teamRef.team)) {
      console.error(
        `ERROR: Repository "${repo.repository}" references team "${teamRef.team}" which does not exist in roles.ts`
      );
      hasErrors = true;
    }
  }
}

// Validate role references in MEMBERS (memberOf)
console.log('Validating role references in users.ts...');
for (const member of MEMBERS) {
  for (const roleId of member.memberOf) {
    if (!allRoleIds.has(roleId)) {
      console.error(
        `ERROR: Member "${member.github || member.email}" references role "${roleId}" which does not exist in roles.ts`
      );
      hasErrors = true;
    }
  }
}

// Validate member ordering in users.ts
console.log('Validating member ordering in users.ts...');
{
  // Split members into github members and email-only members
  const githubMembers: (typeof MEMBERS)[number][] = [];
  const emailOnlyMembers: (typeof MEMBERS)[number][] = [];

  for (const member of MEMBERS) {
    if (member.github) {
      githubMembers.push(member);
    } else if (member.email) {
      emailOnlyMembers.push(member);
    }
  }

  // Check that github members come before email-only members
  let foundEmailOnly = false;
  for (const member of MEMBERS) {
    if (!member.github && member.email) {
      foundEmailOnly = true;
    } else if (member.github && foundEmailOnly) {
      console.error(
        `ERROR: Member "${member.github}" appears after email-only members. GitHub members should come before email-only members.`
      );
      hasErrors = true;
      break;
    }
  }

  // Check that github members are sorted alphabetically (case-insensitive)
  for (let i = 1; i < githubMembers.length; i++) {
    const prev = githubMembers[i - 1].github!.toLowerCase();
    const curr = githubMembers[i].github!.toLowerCase();
    if (prev > curr) {
      console.error(
        `ERROR: Members are not sorted alphabetically. "${githubMembers[i - 1].github}" should come after "${githubMembers[i].github}".`
      );
      hasErrors = true;
      break;
    }
  }
}

// Validate parent role references in roles.ts
console.log('Validating parent role references in roles.ts...');
for (const role of ROLES) {
  if (!role.github?.parent) continue;

  const parentRole = roleLookup.get(role.github.parent);
  if (!parentRole) {
    console.error(
      `ERROR: Role "${role.id}" has parent "${role.github.parent}" which does not exist in roles.ts`
    );
    hasErrors = true;
  } else if (!parentRole.github) {
    console.error(
      `ERROR: Role "${role.id}" has parent "${role.github.parent}" which does not have GitHub config`
    );
    hasErrors = true;
  }
}

if (hasErrors) {
  console.error('\nValidation failed! Please fix the errors above.');
  process.exit(1);
} else {
  console.log('\nAll references are valid.');
  process.exit(0);
}
