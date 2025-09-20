import type { Member } from './utils';

export const MEMBERS: readonly Member[] = [
  {
    github: 'domdomegg',
    email: 'adam@modelcontextprotocol.io',
    memberOf: ['test-child'],
  },
] as const;