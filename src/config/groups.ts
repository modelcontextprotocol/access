import { defineGroups } from './utils';

// NOTE: For GitHub teams, only the first memberOf will be used as the parent team.
// GitHub only supports one parent team per team.
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
] as const);