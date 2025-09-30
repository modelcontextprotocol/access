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
  {
    name: 'test-parent',
    description: 'All maintainers. Users should not be added directly to this group.',
  },
  {
    name: 'test-child',
    description: 'Registry maintainers',
    memberOf: ['test-parent'],
  },
  {
    name: 'test-email-group',
    description: 'Example email group that accepts external emails',
    isEmailGroup: true,
  },
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