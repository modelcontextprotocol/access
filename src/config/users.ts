import type { Member } from './utils';

export const MEMBERS: readonly Member[] = [
  {
    github: 'domdomegg',
    email: 'adam@modelcontextprotocol.io',
    memberOf: ['test-child'],
  },
  {
    email: 'adamj@anthropic.com',
    memberOf: ['catch-all'],
  },
  {
    email: 'davidsp@anthropic.com',
    memberOf: ['antitrust'],
  },
  {
    email: 'mattsamuels@anthropic.com',
    memberOf: ['antitrust'],
  },
  {
    email: 'davideramian@anthropic.com',
    memberOf: ['antitrust'],
  },
] as const;