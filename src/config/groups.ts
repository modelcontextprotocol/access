import { defineGroups } from './utils';

// NOTE: For GitHub teams, only the first memberOf will be used as the parent team.
// GitHub only supports one parent team per team.
//
// Email groups (isEmailGroup: true) accept emails from anyone (including external users)
// and notify group members for each email.
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
  },
] as const);