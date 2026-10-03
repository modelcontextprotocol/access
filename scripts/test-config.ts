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
import { ACCESS_POLICIES, getAccessPolicyTeams } from '../src/config/accessPolicies';
import { REPOSITORY_ACCESS, REPOSITORY_DEFAULTS } from '../src/config/repoAccess';
import {
  DISCORD_CHANNELS,
  DISCORD_CHANNEL_FLAG_REQUIRE_TAG,
  discordChannelCreatePayloadFromConfig,
  discordChannelPayloadFromConfig,
  discordChannelRequireTagError,
  discordChannelResourceName,
  discordChannelStateFromApi,
  discordChannelTypeName,
  getDiscordChannelConfigErrors,
  getDiscordChannelConfigWarnings,
  getDiscordChannelDrift,
  type DiscordChannelApiResponse,
  type DiscordChannelConfig,
  type DiscordNewChannelConfig,
} from '../src/config/channels';

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

// Test repository config
test('REPOSITORY_ACCESS has no duplicate repositories', () => {
  const names = REPOSITORY_ACCESS.map((r) => r.repository);
  return names.length > 0 && names.length === new Set(names).size;
});
test('All managed repositories (with settings) have an admin grant', () =>
  REPOSITORY_ACCESS.filter((r) => r.settings).every(
    (r) =>
      r.teams?.some((t) => t.permission === 'admin') ||
      r.users?.some((u) => u.permission === 'admin')
  ));
test('All managed repositories have a non-empty description', () =>
  REPOSITORY_ACCESS.filter((r) => r.settings).every((r) => !!r.settings!.description.trim()));
test('REPOSITORY_DEFAULTS archives instead of deleting on destroy', () =>
  REPOSITORY_DEFAULTS.archiveOnDestroy === true);

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

// Test Cloudflare Access policy config
test('SECURITY_TEAM role exists (GitHub-only, no parent team)', () => {
  const role = roleLookup.get(ROLE_IDS.SECURITY_TEAM);
  return (
    role !== undefined &&
    role.github?.team === 'security-team' &&
    role.github.parent === undefined &&
    role.discord === undefined &&
    role.google === undefined &&
    !role.provisionUser
  );
});
test('ACCESS_POLICIES is not empty with unique ids', () => {
  const ids = ACCESS_POLICIES.map((p) => p.id);
  return ids.length > 0 && ids.length === new Set(ids).size;
});
test('All access policy roles exist and have GitHub teams', () =>
  ACCESS_POLICIES.every((p) => p.roles.every((id) => !!roleLookup.get(id)?.github?.team)));
test('Access policy roles are unique within each policy', () =>
  ACCESS_POLICIES.every((p) => p.roles.length === new Set(p.roles).size));
test('security-room policy renders the expected include-rule teams in order', () => {
  const policy = ACCESS_POLICIES.find((p) => p.id === 'security-room-maintainers');
  if (!policy) return false;
  const teams = getAccessPolicyTeams(policy);
  const expected = ['core-maintainers', 'lead-maintainers', 'security-managers', 'security-team'];
  return teams.length === expected.length && teams.every((t, i) => t === expected[i]);
});
test('security-team team has members', () =>
  MEMBERS.some((m) => m.github && m.memberOf.includes(ROLE_IDS.SECURITY_TEAM)));
test('getAccessPolicyTeams throws for a role without a GitHub team', () => {
  try {
    getAccessPolicyTeams({
      id: 'bogus',
      description: '',
      cloudflarePolicyName: 'x',
      roles: [ROLE_IDS.ADMINISTRATORS],
    });
    return false;
  } catch {
    return true;
  }
});

// Test Discord channel config (channels.ts) and its pure Discord API mapping
const SNOWFLAKE = '123456789012345678';
const OTHER_SNOWFLAKE = '987654321098765432';
const FORUM_CONFIG: DiscordNewChannelConfig = {
  name: 'sdk-help',
  type: 'forum',
  parentId: OTHER_SNOWFLAKE,
  topic: 'One thread per question',
  rateLimitPerUser: 5,
  defaultAutoArchiveDuration: 10080,
  defaultThreadRateLimitPerUser: 10,
  requireTag: true,
  availableTags: [
    { name: 'typescript', emojiName: '🟦' },
    { name: 'answered', moderated: true },
  ],
  defaultReactionEmoji: { emojiName: '👍' },
  defaultSortOrder: 'creation_date',
  defaultForumLayout: 'gallery',
};
// What Discord returns for FORUM_CONFIG once applied (tags carry Discord-assigned IDs,
// and an unrelated flag bit is set to check that it survives updates)
const FORUM_API: DiscordChannelApiResponse = {
  id: SNOWFLAKE,
  type: 15,
  guild_id: OTHER_SNOWFLAKE,
  name: 'sdk-help',
  parent_id: OTHER_SNOWFLAKE,
  topic: 'One thread per question',
  nsfw: false,
  position: 3,
  rate_limit_per_user: 5,
  default_auto_archive_duration: 10080,
  default_thread_rate_limit_per_user: 10,
  flags: DISCORD_CHANNEL_FLAG_REQUIRE_TAG | (1 << 15),
  available_tags: [
    {
      id: '111111111111111111',
      name: 'answered',
      moderated: true,
      emoji_id: null,
      emoji_name: null,
    },
    {
      id: '222222222222222222',
      name: 'typescript',
      moderated: false,
      emoji_id: null,
      emoji_name: '🟦',
    },
  ],
  default_reaction_emoji: { emoji_id: null, emoji_name: '👍' },
  default_sort_order: 1,
  default_forum_layout: 2,
};
const TEXT_API: DiscordChannelApiResponse = {
  id: SNOWFLAKE,
  type: 0,
  guild_id: OTHER_SNOWFLAKE,
  name: 'general',
  parent_id: null,
  topic: null,
  rate_limit_per_user: 0,
};
const hasErrorMatching = (channels: DiscordChannelConfig[], pattern: RegExp) =>
  getDiscordChannelConfigErrors(channels).some((e) => pattern.test(e));
const hasWarningMatching = (channels: DiscordChannelConfig[], pattern: RegExp) =>
  getDiscordChannelConfigWarnings(channels).some((w) => pattern.test(w));
const isClean = (channels: DiscordChannelConfig[]) =>
  getDiscordChannelConfigErrors(channels).length === 0 &&
  getDiscordChannelConfigWarnings(channels).length === 0;

test('DISCORD_CHANNELS passes validation', () =>
  getDiscordChannelConfigErrors(DISCORD_CHANNELS).length === 0);
test('DISCORD_CHANNELS resource names are unique', () => {
  const names = DISCORD_CHANNELS.map(discordChannelResourceName);
  return names.length === new Set(names).size;
});
test('Channel validation accepts adopted text, new forum and adopted media entries', () =>
  isClean([
    { id: SNOWFLAKE, name: 'general', type: 'text', rateLimitPerUser: 5 },
    FORUM_CONFIG,
    { id: OTHER_SNOWFLAKE, name: 'showcase', type: 'media', requireTag: false },
  ]));
test('Channel name is optional when adopting by id and required when creating', () =>
  isClean([{ id: SNOWFLAKE, type: 'text', rateLimitPerUser: 5 }]) &&
  discordChannelResourceName({ id: SNOWFLAKE, type: 'text' }) === `discord-channel-${SNOWFLAKE}` &&
  hasErrorMatching(
    [{ type: 'text' } as unknown as DiscordChannelConfig],
    /"<unnamed>" has no name; a channel created without an id needs one/
  ));
test('Channel validation rejects malformed snowflakes', () =>
  hasErrorMatching(
    [{ id: '12345', name: 'a', type: 'text' }],
    /has id "12345" which is not a Discord snowflake/
  ) &&
  hasErrorMatching([{ name: 'a', type: 'text', parentId: 'abc' }], /parentId "abc"/) &&
  hasErrorMatching(
    [{ name: 'a', type: 'forum', defaultReactionEmoji: { emojiId: '1' } }],
    /defaultReactionEmoji has emojiId "1"/
  ) &&
  hasErrorMatching(
    [{ name: 'a', type: 'forum', availableTags: [{ name: 't', emojiId: 'x' }] }],
    /tag "t" has emojiId "x"/
  ));
test('Channel validation rejects duplicate ids and duplicate names without id', () =>
  hasErrorMatching(
    [
      { id: SNOWFLAKE, name: 'a', type: 'text' },
      { id: SNOWFLAKE, name: 'b', type: 'text' },
    ],
    /duplicate id/
  ) &&
  hasErrorMatching(
    [
      { name: 'a', type: 'text' },
      { name: 'a', type: 'forum' },
    ],
    /duplicate name without an id/
  ) &&
  // Same name is fine when one entry is adopted by id (different resource names)
  getDiscordChannelConfigErrors([
    { id: SNOWFLAKE, name: 'a', type: 'text' },
    { name: 'a', type: 'forum' },
  ]).length === 0);
test('Channel validation accepts any 1-100 character name, unicode and emoji included', () =>
  isClean([
    { name: 'sdk│help', type: 'text' },
    { name: '🐛-bugs', type: 'forum', availableTags: [{ name: 'open' }] },
    { name: 'ヘルプ', type: 'text' },
    // 100 emoji are 100 characters to Discord even though they are 200 UTF-16 code units
    { name: '🟦'.repeat(100), type: 'text' },
  ]));
test('Channel validation rejects empty and over-long names', () =>
  hasErrorMatching([{ name: '', type: 'text' }], /invalid name ""; Discord allows 1-100/) &&
  hasErrorMatching([{ name: '   ', type: 'text' }], /invalid name "   "/) &&
  hasErrorMatching([{ name: 'a'.repeat(101), type: 'text' }], /invalid name "a{101}"/) &&
  !hasErrorMatching([{ name: 'a'.repeat(100), type: 'text' }], /invalid name/));
test('Channel validation warns, without an error, on names Discord would normalize', () =>
  hasWarningMatching(
    [{ name: 'SDK Help', type: 'text' }],
    /"SDK Help" with uppercase letters or spaces/
  ) &&
  !hasErrorMatching([{ name: 'SDK Help', type: 'text' }], /name/) &&
  hasWarningMatching([{ id: SNOWFLAKE, name: 'General', type: 'text' }], /"General"/) &&
  hasWarningMatching([{ name: 'sdk help', type: 'text' }], /"sdk help"/) &&
  getDiscordChannelConfigWarnings([{ name: 'sdk-help_2', type: 'text' }]).length === 0);
test('Channel validation enforces topic length per channel type', () =>
  hasErrorMatching(
    [{ name: 'a', type: 'text', topic: 'x'.repeat(1025) }],
    /topic of 1025 characters; Discord allows at most 1024 on a text channel/
  ) &&
  isClean([{ name: 'a', type: 'text', topic: 'x'.repeat(1024) }]) &&
  isClean([{ name: 'a', type: 'forum', topic: 'x'.repeat(4096) }]) &&
  hasErrorMatching(
    [{ name: 'a', type: 'media', topic: 'x'.repeat(4097) }],
    /topic of 4097 characters; Discord allows at most 4096 on a media channel/
  ));
test('requireTag needs tags: error on a new channel or empty tags, warning on an adopted one', () =>
  hasErrorMatching(
    [{ name: 'a', type: 'forum', requireTag: true }],
    /sets requireTag but declares no availableTags; a new channel has no tags/
  ) &&
  hasErrorMatching(
    [{ name: 'a', type: 'forum', requireTag: true, availableTags: [] }],
    /sets requireTag but availableTags is empty/
  ) &&
  hasErrorMatching(
    [{ id: SNOWFLAKE, type: 'media', requireTag: true, availableTags: [] }],
    /sets requireTag but availableTags is empty/
  ) &&
  !hasErrorMatching([{ id: SNOWFLAKE, type: 'forum', requireTag: true }], /requireTag/) &&
  hasWarningMatching(
    [{ id: SNOWFLAKE, type: 'forum', requireTag: true }],
    /sets requireTag without availableTags, so it relies on the tags already on the channel/
  ) &&
  isClean([{ id: SNOWFLAKE, type: 'forum', requireTag: false }]) &&
  isClean([{ name: 'a', type: 'forum', requireTag: true, availableTags: [{ name: 't' }] }]));
test('Channel validation rejects more than 20 tags and duplicate tag names', () =>
  hasErrorMatching(
    [
      {
        name: 'a',
        type: 'forum',
        availableTags: Array.from({ length: 21 }, (_, i) => ({ name: `tag-${i}` })),
      },
    ],
    /declares 21 tags/
  ) &&
  hasErrorMatching(
    [{ name: 'a', type: 'forum', availableTags: [{ name: 'x' }, { name: 'x' }] }],
    /tag "x" is declared twice/
  ));
test('Channel validation rejects forum/media settings on text channels', () =>
  (['requireTag', 'availableTags', 'defaultReactionEmoji', 'defaultSortOrder'] as const).every(
    (field) =>
      hasErrorMatching(
        [{ name: 'a', type: 'text', [field]: FORUM_CONFIG[field] } as DiscordChannelConfig],
        new RegExp(`sets ${field} but is a text channel`)
      )
  ));
test('Channel validation rejects defaultForumLayout on non-forum channels', () =>
  hasErrorMatching([{ name: 'a', type: 'media', defaultForumLayout: 'list' }], /media channel/) &&
  hasErrorMatching([{ name: 'a', type: 'text', defaultForumLayout: 'list' }], /text channel/) &&
  getDiscordChannelConfigErrors([{ name: 'a', type: 'forum', defaultForumLayout: 'list' }])
    .length === 0);
test('Channel validation rejects disallowed durations and slowmode values', () =>
  hasErrorMatching(
    [{ name: 'a', type: 'text', defaultAutoArchiveDuration: 120 as 60 }],
    /defaultAutoArchiveDuration 120/
  ) &&
  hasErrorMatching(
    [{ name: 'a', type: 'text', rateLimitPerUser: 21601 }],
    /rateLimitPerUser 21601/
  ) &&
  hasErrorMatching(
    [{ name: 'a', type: 'text', defaultThreadRateLimitPerUser: -1 }],
    /defaultThreadRateLimitPerUser -1/
  ));
test('Channel validation requires exactly one of emojiId/emojiName on defaultReactionEmoji', () =>
  hasErrorMatching(
    [{ name: 'a', type: 'forum', defaultReactionEmoji: {} }],
    /neither emojiId nor emojiName/
  ) &&
  hasErrorMatching(
    [{ name: 'a', type: 'forum', defaultReactionEmoji: { emojiId: SNOWFLAKE, emojiName: 'x' } }],
    /both emojiId and emojiName/
  ));

test('discordChannelTypeName maps text/forum/media and nothing else', () =>
  discordChannelTypeName(0) === 'text' &&
  discordChannelTypeName(15) === 'forum' &&
  discordChannelTypeName(16) === 'media' &&
  discordChannelTypeName(2) === undefined);
test('Text channel payload never contains forum/media fields', () => {
  const payload = discordChannelPayloadFromConfig({
    id: SNOWFLAKE,
    name: 'general',
    type: 'text',
    topic: 'Hello',
    rateLimitPerUser: 5,
    defaultAutoArchiveDuration: 4320,
  });
  const forumKeys = [
    'flags',
    'available_tags',
    'default_reaction_emoji',
    'default_sort_order',
    'default_forum_layout',
  ];
  return (
    payload.name === 'general' &&
    payload.topic === 'Hello' &&
    payload.rate_limit_per_user === 5 &&
    payload.default_auto_archive_duration === 4320 &&
    forumKeys.every((key) => !(key in payload))
  );
});
test('Payload omits settings the config does not declare', () => {
  const payload = discordChannelPayloadFromConfig({ name: 'general', type: 'text' });
  return Object.keys(payload).length === 1 && payload.name === 'general';
});
test('Payload leaves out name when an adopted channel does not declare one', () => {
  const payload = discordChannelPayloadFromConfig({ id: SNOWFLAKE, type: 'text', topic: 'Hi' });
  return Object.keys(payload).join(',') === 'topic';
});
test('position is sent on create only, never in the modify payload', () => {
  const config: DiscordNewChannelConfig = { name: 'a', type: 'text', position: 4, nsfw: true };
  const modify = discordChannelPayloadFromConfig(config);
  const create = discordChannelCreatePayloadFromConfig(config);
  return !('position' in modify) && modify.nsfw === true && create.position === 4;
});
test('Forum payload maps tags, emoji, sort order, layout and REQUIRE_TAG', () => {
  const payload = discordChannelPayloadFromConfig(FORUM_CONFIG);
  const tags = payload.available_tags as { id?: string; name: string; moderated: boolean }[];
  return (
    payload.flags === DISCORD_CHANNEL_FLAG_REQUIRE_TAG &&
    payload.default_sort_order === 1 &&
    payload.default_forum_layout === 2 &&
    JSON.stringify(payload.default_reaction_emoji) ===
      JSON.stringify({ emoji_id: null, emoji_name: '👍' }) &&
    tags.length === 2 &&
    tags.every((t) => t.id === undefined) &&
    tags[1].name === 'answered' &&
    tags[1].moderated === true
  );
});
test('Forum payload preserves tag IDs and other flag bits from the live state', () => {
  const state = discordChannelStateFromApi(FORUM_API);
  const payload = discordChannelPayloadFromConfig(
    {
      ...FORUM_CONFIG,
      requireTag: false,
      availableTags: [{ name: 'typescript' }, { name: 'new' }],
    },
    state
  );
  const tags = payload.available_tags as { id?: string; name: string }[];
  return (
    payload.flags === 1 << 15 && tags[0].id === '222222222222222222' && tags[1].id === undefined
  );
});
test('Media payload never contains default_forum_layout', () => {
  const payload = discordChannelPayloadFromConfig({
    name: 'showcase',
    type: 'media',
    requireTag: true,
    defaultSortOrder: 'latest_activity',
    // Invalid for media (validation rejects it); the mapping must still not send it
    defaultForumLayout: 'list',
  });
  return (
    payload.flags === DISCORD_CHANNEL_FLAG_REQUIRE_TAG &&
    payload.default_sort_order === 0 &&
    !('default_forum_layout' in payload)
  );
});
test('Create payload adds the Discord type and leaves out flags', () => {
  const payload = discordChannelCreatePayloadFromConfig(FORUM_CONFIG);
  return (
    payload.type === 15 &&
    !('flags' in payload) &&
    discordChannelCreatePayloadFromConfig({ name: 'a', type: 'text' }).type === 0 &&
    discordChannelCreatePayloadFromConfig({ name: 'a', type: 'media' }).type === 16
  );
});
test('discordChannelStateFromApi maps a forum channel back into config vocabulary', () => {
  const state = discordChannelStateFromApi(FORUM_API);
  return (
    state.type === 'forum' &&
    state.requireTag === true &&
    state.flags === (DISCORD_CHANNEL_FLAG_REQUIRE_TAG | (1 << 15)) &&
    state.availableTags.length === 2 &&
    state.availableTags[0].id === '111111111111111111' &&
    state.availableTags[0].moderated === true &&
    state.defaultReactionEmoji?.emojiName === '👍' &&
    state.defaultSortOrder === 'creation_date' &&
    state.defaultForumLayout === 'gallery' &&
    state.position === 3
  );
});
test('discordChannelStateFromApi normalizes a bare text channel', () => {
  const state = discordChannelStateFromApi(TEXT_API);
  return (
    state.type === 'text' &&
    state.topic === '' &&
    state.parentId === null &&
    state.nsfw === false &&
    state.requireTag === false &&
    state.availableTags.length === 0 &&
    state.defaultReactionEmoji === null &&
    state.defaultSortOrder === null &&
    state.defaultForumLayout === null
  );
});
test('No drift when the live channel matches the declared forum config', () =>
  getDiscordChannelDrift(FORUM_CONFIG, discordChannelStateFromApi(FORUM_API)).length === 0);
test('Drift names only the declared settings that differ', () => {
  const state = discordChannelStateFromApi(FORUM_API);
  const drift = getDiscordChannelDrift(
    { ...FORUM_CONFIG, topic: 'Changed', requireTag: false, defaultForumLayout: 'list' },
    state
  );
  return drift.join(',') === 'topic,requireTag,defaultForumLayout';
});
test('Omitted settings never count as drift', () =>
  getDiscordChannelDrift(
    { id: SNOWFLAKE, name: 'sdk-help', type: 'forum' },
    discordChannelStateFromApi(FORUM_API)
  ).length === 0 &&
  getDiscordChannelDrift(
    { id: SNOWFLAKE, name: 'general', type: 'text' },
    discordChannelStateFromApi(TEXT_API)
  ).length === 0);
test('Name counts as drift only when declared', () => {
  const state = discordChannelStateFromApi(TEXT_API);
  return (
    getDiscordChannelDrift({ id: SNOWFLAKE, type: 'text', rateLimitPerUser: 0 }, state).length ===
      0 &&
    getDiscordChannelDrift({ id: SNOWFLAKE, name: 'genral', type: 'text' }, state).join(',') ===
      'name'
  );
});
test('position never counts as drift', () =>
  getDiscordChannelDrift({ ...FORUM_CONFIG, position: 99 }, discordChannelStateFromApi(FORUM_API))
    .length === 0);
test('discordChannelRequireTagError fires only when REQUIRE_TAG would have no tags', () => {
  const withTags = discordChannelStateFromApi(FORUM_API);
  const noTags = discordChannelStateFromApi({ ...FORUM_API, available_tags: [] });
  return (
    discordChannelRequireTagError({ id: SNOWFLAKE, type: 'forum', requireTag: true }, withTags) ===
      undefined &&
    /no tags on Discord and channels.ts declares none/.test(
      discordChannelRequireTagError({ id: SNOWFLAKE, type: 'forum', requireTag: true }, noTags) ??
        ''
    ) &&
    /availableTags is empty/.test(
      discordChannelRequireTagError(
        { id: SNOWFLAKE, type: 'forum', requireTag: true, availableTags: [] },
        withTags
      ) ?? ''
    ) &&
    discordChannelRequireTagError({ ...FORUM_CONFIG }, noTags) === undefined &&
    discordChannelRequireTagError({ id: SNOWFLAKE, type: 'forum', requireTag: false }, noTags) ===
      undefined &&
    discordChannelRequireTagError({ id: SNOWFLAKE, type: 'text' }, noTags) === undefined
  );
});
test('Drift reports a type mismatch between config and live channel', () =>
  getDiscordChannelDrift(
    { id: SNOWFLAKE, name: 'general', type: 'forum' },
    discordChannelStateFromApi(TEXT_API)
  ).join(',') === 'type');
test('Tag drift ignores Discord tag IDs and ordering but catches changed tags', () => {
  const state = discordChannelStateFromApi(FORUM_API);
  const reordered = { ...FORUM_CONFIG, availableTags: [...FORUM_CONFIG.availableTags!].reverse() };
  const renamed = { ...FORUM_CONFIG, availableTags: [{ name: 'typescript', emojiName: '🟦' }] };
  return (
    getDiscordChannelDrift(reordered, state).length === 0 &&
    getDiscordChannelDrift(renamed, state).join(',') === 'availableTags'
  );
});

// Summary
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
