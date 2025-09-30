import type { GROUPS } from './groups';

function isValidGroupName(name: string): boolean {
  return /^[a-z][a-z0-9-]*[a-z]$/.test(name);
}

export type Platform = 'github' | 'google';

export function defineGroups<
  const T extends readonly {
    name: Lowercase<string>;
    description: string;
    memberOf?: readonly (T[number]['name'])[];
    isEmailGroup?: boolean;
    onlyOnPlatforms?: readonly Platform[];
  }[]
>(groups: T) {
  for (const group of groups) {
    if (!isValidGroupName(group.name)) {
      throw new Error(
        `Invalid group name: ${group.name}. Must be lowercase alphanumeric with dashes, starting with a letter.`
      );
    }
  }

  return groups;
}

export type GroupKey = (typeof GROUPS)[number]['name'];

export interface Group {
  name: GroupKey;
  description: string;
  memberOf?: readonly GroupKey[];
  isEmailGroup?: boolean;
  onlyOnPlatforms?: readonly Platform[];
}

export interface Member {
  github?: string;
  email?: string;
  memberOf: readonly GroupKey[];
}