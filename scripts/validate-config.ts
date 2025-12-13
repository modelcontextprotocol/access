#!/usr/bin/env npx ts-node

/**
 * Validates that all team references in repoAccess.ts exist in groups.ts
 * Run with: npx ts-node scripts/validate-config.ts
 */

import { GROUPS } from '../src/config/groups';
import { REPOSITORY_ACCESS } from '../src/config/repoAccess';
import { MEMBERS } from '../src/config/users';
import type { Group, Member } from '../src/config/utils';

// Get all GitHub team names (groups not limited to google-only platforms)
const githubTeamNames = new Set<string>();
// Get all group names (for member validation - members can be in any group)
const allGroupNames = new Set<string>();

for (const g of GROUPS) {
  const group = g as Group;
  allGroupNames.add(group.name);

  const platforms = group.onlyOnPlatforms;
  if (!platforms || platforms.includes('github')) {
    githubTeamNames.add(group.name);
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
        `ERROR: Repository "${repo.repository}" references team "${teamRef.team}" which does not exist in groups.ts`
      );
      hasErrors = true;
    }
  }
}

// Validate team references in MEMBERS (memberOf)
// Members can be in any group (GitHub or Google-only)
console.log('Validating team references in users.ts...');
for (const m of MEMBERS) {
  const member = m as Member;
  for (const teamKey of member.memberOf) {
    if (!allGroupNames.has(teamKey)) {
      console.error(
        `ERROR: Member "${member.github || member.email}" references team "${teamKey}" which does not exist in groups.ts`
      );
      hasErrors = true;
    }
  }
}

// Validate parent team references (memberOf in groups)
console.log('Validating parent team references in groups.ts...');
for (const g of GROUPS) {
  const group = g as Group;
  if (!group.memberOf) continue;

  for (const parentTeam of group.memberOf) {
    if (!allGroupNames.has(parentTeam)) {
      console.error(
        `ERROR: Group "${group.name}" has parent "${parentTeam}" which does not exist in groups.ts`
      );
      hasErrors = true;
    }
  }
}

if (hasErrors) {
  console.error('\nValidation failed! Please fix the errors above.');
  process.exit(1);
} else {
  console.log('\nAll team references are valid.');
  process.exit(0);
}
