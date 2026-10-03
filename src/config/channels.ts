// Discord channels managed by Pulumi (the DiscordChannel resource in src/discord.ts).
//
// Thread-only channels: Discord has no "require threads" switch on a text channel.
// Thread-only behaviour exists only as the GUILD_FORUM (15) and GUILD_MEDIA (16)
// channel types, where every post opens a thread. The API converts text <->
// announcement channels only, so an existing text channel can NEVER become a forum.
// To make an existing channel thread-only, declare a NEW forum/media channel here
// (without `id`) and retire the old channel by hand once people have moved over.
//
// Each entry works in one of two modes:
//   - `id` set: the existing channel with that snowflake is adopted and the settings
//     declared here are enforced on it in place. Settings you omit are left exactly as
//     they are on Discord. The declared `type` must match the live channel type; a
//     mismatch fails the deploy instead of silently managing the wrong thing.
//   - `id` unset: a new channel of `type` is created in the guild on the next deploy.
//
// Removing an entry NEVER deletes the channel on Discord (that would destroy its
// history); the resource is only dropped from Pulumi state. Changing `id` or `type`
// replaces the resource the same way: the new channel is adopted/created and the old
// one is left in place. Delete channels by hand, if at all.
//
// The `id ?? name` of an entry is also its Pulumi resource name
// (`discord-channel-<id ?? name>`), so renaming a channel created without `id` creates
// a second channel. Adopt it by its `id` first if you want to rename it in place.

export type DiscordChannelType = 'text' | 'forum' | 'media';

/** Allowed values (minutes) for defaultAutoArchiveDuration. */
export const DISCORD_AUTO_ARCHIVE_DURATIONS = [60, 1440, 4320, 10080] as const;
export type DiscordAutoArchiveDuration = (typeof DISCORD_AUTO_ARCHIVE_DURATIONS)[number];

export type DiscordSortOrder = 'latest_activity' | 'creation_date';
export type DiscordForumLayout = 'not_set' | 'list' | 'gallery';

/** A custom (`emojiId`) or unicode (`emojiName`) emoji; set exactly one. */
export interface DiscordEmojiConfig {
  /** Custom emoji ID (snowflake) */
  emojiId?: string;
  /** Unicode emoji character, e.g. '🐛' */
  emojiName?: string;
}

/** A tag that threads in a forum/media channel can be filed under. */
export interface DiscordForumTagConfig extends DiscordEmojiConfig {
  /** Tag name (1-20 characters), unique within the channel. Used to match the tag across deploys. */
  name: string;
  /** If true, only members with MANAGE_THREADS can apply or remove the tag */
  moderated?: boolean;
}

export interface DiscordChannelConfig {
  /**
   * Snowflake of an existing channel to adopt. When set, the settings below are
   * applied to that channel in place; when unset, a new channel is created.
   */
  id?: string;
  /** Channel name: lowercase letters, digits, '-' and '_' (Discord normalizes anything else) */
  name: string;
  /** 'text' is a normal channel; 'forum' and 'media' are thread-only */
  type: DiscordChannelType;
  /** Category (parent channel) snowflake */
  parentId?: string;
  /** Channel topic; for forum/media channels this is the post guidelines text */
  topic?: string;
  nsfw?: boolean;
  /** Sort position within the category */
  position?: number;
  /** Slowmode in seconds (0-21600) */
  rateLimitPerUser?: number;
  /** Default auto-archive time for new threads, in minutes */
  defaultAutoArchiveDuration?: DiscordAutoArchiveDuration;
  /** Slowmode (seconds) applied to newly created threads */
  defaultThreadRateLimitPerUser?: number;

  // --- forum/media only ---
  /** Require every new thread to carry at least one tag */
  requireTag?: boolean;
  /** Tags threads can be filed under (max 20). `[]` removes all tags; omit to leave them alone. */
  availableTags?: readonly DiscordForumTagConfig[];
  /** Emoji shown as the default reaction on new threads */
  defaultReactionEmoji?: DiscordEmojiConfig;
  defaultSortOrder?: DiscordSortOrder;

  // --- forum only ---
  defaultForumLayout?: DiscordForumLayout;
}

/**
 * Channels managed by Pulumi. Empty until maintainers add entries, so deploys are a
 * no-op. Examples:
 *
 *   // Adopt an existing text channel by ID and pin its slowmode and thread defaults
 *   {
 *     id: '1234567890123456789',
 *     name: 'general',
 *     type: 'text',
 *     rateLimitPerUser: 5,
 *     defaultAutoArchiveDuration: 4320,
 *   },
 *
 *   // Create a new thread-only forum channel (an existing text channel cannot be
 *   // converted; create the forum, then retire the old channel by hand)
 *   {
 *     name: 'sdk-help',
 *     type: 'forum',
 *     parentId: '1234567890123456789',
 *     topic: 'One thread per question. Pick the SDK tag that matches.',
 *     requireTag: true,
 *     availableTags: [
 *       { name: 'typescript', emojiName: '🟦' },
 *       { name: 'python', emojiName: '🐍' },
 *       { name: 'answered', moderated: true },
 *     ],
 *     defaultReactionEmoji: { emojiName: '👍' },
 *     defaultSortOrder: 'latest_activity',
 *     defaultForumLayout: 'list',
 *     defaultAutoArchiveDuration: 10080,
 *   },
 *
 *   // Adopt an existing media (thread-only, image/video first) channel by ID
 *   {
 *     id: '1234567890123456789',
 *     name: 'showcase',
 *     type: 'media',
 *     requireTag: false,
 *     defaultSortOrder: 'creation_date',
 *   },
 */
export const DISCORD_CHANNELS: readonly DiscordChannelConfig[] = [];

/** Pulumi resource name for a channel entry (stable across deploys). */
export function discordChannelResourceName(channel: DiscordChannelConfig): string {
  return `discord-channel-${channel.id ?? channel.name}`;
}

/** Forum and media channels are thread-only: every post is a thread. */
export function isThreadOnlyChannelType(type: DiscordChannelType): boolean {
  return type === 'forum' || type === 'media';
}

// ---------------------------------------------------------------------------
// Validation (used by scripts/validate-config.ts and scripts/test-config.ts)
// ---------------------------------------------------------------------------

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const CHANNEL_NAME_PATTERN = /^[a-z0-9_-]{1,100}$/;
/** Discord's maximum slowmode, in seconds (6 hours) */
const MAX_RATE_LIMIT_PER_USER = 21600;
const MAX_AVAILABLE_TAGS = 20;
const MAX_TAG_NAME_LENGTH = 20;

export function isDiscordSnowflake(value: string): boolean {
  return SNOWFLAKE_PATTERN.test(value);
}

function emojiConfigErrors(
  label: string,
  emoji: DiscordEmojiConfig,
  requireOne: boolean
): string[] {
  const errors: string[] = [];
  const hasId = emoji.emojiId !== undefined;
  const hasName = emoji.emojiName !== undefined;
  if (hasId && hasName) {
    errors.push(`${label} sets both emojiId and emojiName; set exactly one`);
  }
  if (requireOne && !hasId && !hasName) {
    errors.push(`${label} sets neither emojiId nor emojiName; set exactly one`);
  }
  if (hasId && !isDiscordSnowflake(emoji.emojiId!)) {
    errors.push(`${label} has emojiId "${emoji.emojiId}" which is not a Discord snowflake`);
  }
  if (hasName && emoji.emojiName!.trim() === '') {
    errors.push(`${label} has an empty emojiName`);
  }
  return errors;
}

/**
 * Validate the channel entries. Returns one human-readable message per problem
 * (empty when everything is fine) so the validate script can print them and the
 * tests can assert on them. Catches what would otherwise only fail inside the
 * deploy: malformed snowflakes, duplicate resource names, settings Discord rejects
 * for the channel type, and limits Discord enforces (tags, slowmode, durations).
 */
export function getDiscordChannelConfigErrors(channels: readonly DiscordChannelConfig[]): string[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const seenNamesWithoutId = new Set<string>();

  for (const channel of channels) {
    const label = `Discord channel "${channel.id ?? channel.name}"`;
    const threadOnly = isThreadOnlyChannelType(channel.type);

    if (!CHANNEL_NAME_PATTERN.test(channel.name)) {
      errors.push(
        `${label} has an invalid name "${channel.name}"; use 1-100 lowercase letters, digits, '-' and '_'`
      );
    }

    if (channel.id !== undefined) {
      if (!isDiscordSnowflake(channel.id)) {
        errors.push(`${label} has id "${channel.id}" which is not a Discord snowflake`);
      }
      if (seenIds.has(channel.id)) {
        errors.push(`${label} is declared twice (duplicate id)`);
      }
      seenIds.add(channel.id);
    } else {
      // Two entries without id and the same name would declare the same Pulumi resource twice
      if (seenNamesWithoutId.has(channel.name)) {
        errors.push(`${label} is declared twice (duplicate name without an id)`);
      }
      seenNamesWithoutId.add(channel.name);
    }

    if (channel.parentId !== undefined && !isDiscordSnowflake(channel.parentId)) {
      errors.push(`${label} has parentId "${channel.parentId}" which is not a Discord snowflake`);
    }

    if (
      channel.position !== undefined &&
      (!Number.isInteger(channel.position) || channel.position < 0)
    ) {
      errors.push(`${label} has position ${channel.position}; it must be a non-negative integer`);
    }

    for (const [field, value] of [
      ['rateLimitPerUser', channel.rateLimitPerUser],
      ['defaultThreadRateLimitPerUser', channel.defaultThreadRateLimitPerUser],
    ] as const) {
      if (
        value !== undefined &&
        (!Number.isInteger(value) || value < 0 || value > MAX_RATE_LIMIT_PER_USER)
      ) {
        errors.push(
          `${label} has ${field} ${value}; it must be an integer between 0 and ${MAX_RATE_LIMIT_PER_USER} seconds`
        );
      }
    }

    if (
      channel.defaultAutoArchiveDuration !== undefined &&
      !(DISCORD_AUTO_ARCHIVE_DURATIONS as readonly number[]).includes(
        channel.defaultAutoArchiveDuration
      )
    ) {
      errors.push(
        `${label} has defaultAutoArchiveDuration ${channel.defaultAutoArchiveDuration}; ` +
          `Discord allows ${DISCORD_AUTO_ARCHIVE_DURATIONS.join(', ')}`
      );
    }

    if (!threadOnly) {
      for (const field of [
        'requireTag',
        'availableTags',
        'defaultReactionEmoji',
        'defaultSortOrder',
      ] as const) {
        if (channel[field] !== undefined) {
          errors.push(
            `${label} sets ${field} but is a text channel; that setting exists only on forum and media channels`
          );
        }
      }
    }

    if (channel.type !== 'forum' && channel.defaultForumLayout !== undefined) {
      errors.push(
        `${label} sets defaultForumLayout but is a ${channel.type} channel; that setting exists only on forum channels`
      );
    }

    if (channel.availableTags !== undefined) {
      if (channel.availableTags.length > MAX_AVAILABLE_TAGS) {
        errors.push(
          `${label} declares ${channel.availableTags.length} tags; Discord allows at most ${MAX_AVAILABLE_TAGS}`
        );
      }
      const seenTagNames = new Set<string>();
      for (const tag of channel.availableTags) {
        const tagLabel = `${label} tag "${tag.name}"`;
        if (tag.name.trim() === '' || tag.name.length > MAX_TAG_NAME_LENGTH) {
          errors.push(`${tagLabel} must have a name of 1-${MAX_TAG_NAME_LENGTH} characters`);
        }
        if (seenTagNames.has(tag.name)) {
          errors.push(`${tagLabel} is declared twice; tag names must be unique within a channel`);
        }
        seenTagNames.add(tag.name);
        errors.push(...emojiConfigErrors(tagLabel, tag, false));
      }
    }

    if (channel.defaultReactionEmoji !== undefined) {
      errors.push(
        ...emojiConfigErrors(`${label} defaultReactionEmoji`, channel.defaultReactionEmoji, true)
      );
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Mapping between this config and the Discord API, kept free of I/O so that
// scripts/test-config.ts can exercise it. src/discord.ts does the HTTP calls.
// ---------------------------------------------------------------------------

/** Discord channel type IDs: GUILD_TEXT, GUILD_FORUM, GUILD_MEDIA */
export const DISCORD_CHANNEL_TYPE_IDS: Record<DiscordChannelType, number> = {
  text: 0,
  forum: 15,
  media: 16,
};
const DISCORD_SORT_ORDER_IDS: Record<DiscordSortOrder, number> = {
  latest_activity: 0,
  creation_date: 1,
};
const DISCORD_FORUM_LAYOUT_IDS: Record<DiscordForumLayout, number> = {
  not_set: 0,
  list: 1,
  gallery: 2,
};
/** Channel flag bit: new threads in a forum/media channel must carry a tag */
export const DISCORD_CHANNEL_FLAG_REQUIRE_TAG = 1 << 4;

function keyForValue<K extends string>(
  ids: Record<K, number>,
  value: number | null | undefined
): K | null {
  if (value === null || value === undefined) return null;
  const match = (Object.keys(ids) as K[]).find((key) => ids[key] === value);
  return match ?? null;
}

/** Name of a Discord channel type ID, or undefined for types this config does not model */
export function discordChannelTypeName(typeId: number): DiscordChannelType | undefined {
  return keyForValue(DISCORD_CHANNEL_TYPE_IDS, typeId) ?? undefined;
}

/** The subset of Discord's channel object that this module reads */
export interface DiscordChannelApiResponse {
  id: string;
  type: number;
  guild_id?: string;
  name: string;
  position?: number;
  parent_id?: string | null;
  topic?: string | null;
  nsfw?: boolean;
  rate_limit_per_user?: number;
  default_auto_archive_duration?: number | null;
  default_thread_rate_limit_per_user?: number | null;
  flags?: number;
  available_tags?: DiscordForumTagApi[];
  default_reaction_emoji?: DiscordEmojiApi | null;
  default_sort_order?: number | null;
  default_forum_layout?: number | null;
}

export interface DiscordForumTagApi {
  /** Assigned by Discord; omitted when creating a tag */
  id?: string;
  name: string;
  moderated: boolean;
  emoji_id: string | null;
  emoji_name: string | null;
}

export interface DiscordEmojiApi {
  emoji_id: string | null;
  emoji_name: string | null;
}

export interface DiscordEmojiState {
  emojiId: string | null;
  emojiName: string | null;
}

export interface DiscordForumTagState extends DiscordEmojiState {
  /** Discord's tag ID, carried into updates so a tag keeps its identity (and the threads filed under it) */
  id: string;
  name: string;
  moderated: boolean;
}

/**
 * The managed settings of a channel as read from Discord, in config vocabulary.
 * Stored as the resource's `state` output; the resource's diff compares it against
 * the declared config to detect drift after a refresh.
 */
export interface DiscordChannelState {
  type: DiscordChannelType | null;
  name: string;
  parentId: string | null;
  topic: string;
  nsfw: boolean;
  position: number | null;
  rateLimitPerUser: number;
  defaultAutoArchiveDuration: number | null;
  defaultThreadRateLimitPerUser: number;
  /** Raw channel flags; bits other than REQUIRE_TAG are preserved verbatim on updates */
  flags: number;
  requireTag: boolean;
  availableTags: DiscordForumTagState[];
  defaultReactionEmoji: DiscordEmojiState | null;
  defaultSortOrder: DiscordSortOrder | null;
  defaultForumLayout: DiscordForumLayout | null;
}

function emojiStateFromApi(emoji: DiscordEmojiApi | null | undefined): DiscordEmojiState | null {
  if (!emoji || (emoji.emoji_id === null && emoji.emoji_name === null)) return null;
  return { emojiId: emoji.emoji_id ?? null, emojiName: emoji.emoji_name ?? null };
}

function emojiApiFromConfig(emoji: DiscordEmojiConfig): DiscordEmojiApi {
  return { emoji_id: emoji.emojiId ?? null, emoji_name: emoji.emojiName ?? null };
}

/** Map a Discord channel object to the managed state. */
export function discordChannelStateFromApi(
  channel: DiscordChannelApiResponse
): DiscordChannelState {
  const flags = channel.flags ?? 0;
  return {
    type: discordChannelTypeName(channel.type) ?? null,
    name: channel.name,
    parentId: channel.parent_id ?? null,
    topic: channel.topic ?? '',
    nsfw: channel.nsfw ?? false,
    position: channel.position ?? null,
    rateLimitPerUser: channel.rate_limit_per_user ?? 0,
    defaultAutoArchiveDuration: channel.default_auto_archive_duration ?? null,
    defaultThreadRateLimitPerUser: channel.default_thread_rate_limit_per_user ?? 0,
    flags,
    requireTag: (flags & DISCORD_CHANNEL_FLAG_REQUIRE_TAG) !== 0,
    availableTags: (channel.available_tags ?? [])
      .filter((tag): tag is DiscordForumTagApi & { id: string } => tag.id !== undefined)
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        moderated: tag.moderated ?? false,
        emojiId: tag.emoji_id ?? null,
        emojiName: tag.emoji_name ?? null,
      })),
    defaultReactionEmoji: emojiStateFromApi(channel.default_reaction_emoji),
    defaultSortOrder: keyForValue(DISCORD_SORT_ORDER_IDS, channel.default_sort_order),
    defaultForumLayout: keyForValue(DISCORD_FORUM_LAYOUT_IDS, channel.default_forum_layout),
  };
}

/**
 * Build the body for PATCH /channels/{id} (Modify Channel) from the declared config.
 * Only declared settings are sent, and only those valid for the channel type: forum/media
 * settings never reach a text channel and defaultForumLayout only reaches a forum.
 * `current` is the live state: REQUIRE_TAG is merged into its other flag bits and
 * existing tags keep their Discord ID when their name is still declared, so an update
 * does not delete and recreate them.
 */
export function discordChannelPayloadFromConfig(
  config: DiscordChannelConfig,
  current?: DiscordChannelState
): Record<string, unknown> {
  const payload: Record<string, unknown> = { name: config.name };

  if (config.parentId !== undefined) payload.parent_id = config.parentId;
  if (config.topic !== undefined) payload.topic = config.topic;
  if (config.nsfw !== undefined) payload.nsfw = config.nsfw;
  if (config.position !== undefined) payload.position = config.position;
  if (config.rateLimitPerUser !== undefined) payload.rate_limit_per_user = config.rateLimitPerUser;
  if (config.defaultAutoArchiveDuration !== undefined) {
    payload.default_auto_archive_duration = config.defaultAutoArchiveDuration;
  }
  if (config.defaultThreadRateLimitPerUser !== undefined) {
    payload.default_thread_rate_limit_per_user = config.defaultThreadRateLimitPerUser;
  }

  if (!isThreadOnlyChannelType(config.type)) return payload;

  if (config.requireTag !== undefined) {
    const otherFlags = (current?.flags ?? 0) & ~DISCORD_CHANNEL_FLAG_REQUIRE_TAG;
    payload.flags = config.requireTag ? otherFlags | DISCORD_CHANNEL_FLAG_REQUIRE_TAG : otherFlags;
  }
  if (config.availableTags !== undefined) {
    payload.available_tags = config.availableTags.map((tag): DiscordForumTagApi => {
      const existing = current?.availableTags.find((t) => t.name === tag.name);
      return {
        ...(existing ? { id: existing.id } : {}),
        name: tag.name,
        moderated: tag.moderated ?? false,
        ...emojiApiFromConfig(tag),
      };
    });
  }
  if (config.defaultReactionEmoji !== undefined) {
    payload.default_reaction_emoji = emojiApiFromConfig(config.defaultReactionEmoji);
  }
  if (config.defaultSortOrder !== undefined) {
    payload.default_sort_order = DISCORD_SORT_ORDER_IDS[config.defaultSortOrder];
  }
  if (config.type === 'forum' && config.defaultForumLayout !== undefined) {
    payload.default_forum_layout = DISCORD_FORUM_LAYOUT_IDS[config.defaultForumLayout];
  }

  return payload;
}

/**
 * Build the body for POST /guilds/{guild}/channels (Create Guild Channel). Same as the
 * modify payload plus `type`, minus `flags`, which that endpoint does not accept;
 * create() applies requireTag with a follow-up PATCH.
 */
export function discordChannelCreatePayloadFromConfig(
  config: DiscordChannelConfig
): Record<string, unknown> {
  const { flags: _flags, ...payload } = discordChannelPayloadFromConfig(config);
  return { type: DISCORD_CHANNEL_TYPE_IDS[config.type], ...payload };
}

function sortTagsByName<T extends { name: string }>(tags: readonly T[]): T[] {
  return [...tags].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Names of the declared settings whose live value differs from the config. Settings the
 * config omits are not managed and never count as drift. Empty means in sync.
 */
export function getDiscordChannelDrift(
  config: DiscordChannelConfig,
  state: DiscordChannelState
): string[] {
  const drift: string[] = [];
  const check = (field: string, declared: unknown, live: unknown) => {
    if (declared !== undefined && JSON.stringify(declared) !== JSON.stringify(live)) {
      drift.push(field);
    }
  };

  check('type', config.type, state.type);
  check('name', config.name, state.name);
  check('parentId', config.parentId, state.parentId);
  check('topic', config.topic, state.topic);
  check('nsfw', config.nsfw, state.nsfw);
  check('position', config.position, state.position);
  check('rateLimitPerUser', config.rateLimitPerUser, state.rateLimitPerUser);
  check(
    'defaultAutoArchiveDuration',
    config.defaultAutoArchiveDuration,
    state.defaultAutoArchiveDuration
  );
  check(
    'defaultThreadRateLimitPerUser',
    config.defaultThreadRateLimitPerUser,
    state.defaultThreadRateLimitPerUser
  );

  if (!isThreadOnlyChannelType(config.type)) return drift;

  check('requireTag', config.requireTag, state.requireTag);
  if (config.availableTags !== undefined) {
    // Compare by name, ignoring Discord's tag IDs and ordering
    const declaredTags = sortTagsByName(config.availableTags).map((tag) => ({
      name: tag.name,
      moderated: tag.moderated ?? false,
      emojiId: tag.emojiId ?? null,
      emojiName: tag.emojiName ?? null,
    }));
    const liveTags = sortTagsByName(state.availableTags).map((tag) => ({
      name: tag.name,
      moderated: tag.moderated,
      emojiId: tag.emojiId,
      emojiName: tag.emojiName,
    }));
    check('availableTags', declaredTags, liveTags);
  }
  if (config.defaultReactionEmoji !== undefined) {
    check(
      'defaultReactionEmoji',
      {
        emojiId: config.defaultReactionEmoji.emojiId ?? null,
        emojiName: config.defaultReactionEmoji.emojiName ?? null,
      },
      state.defaultReactionEmoji
    );
  }
  check('defaultSortOrder', config.defaultSortOrder, state.defaultSortOrder);
  if (config.type === 'forum') {
    check('defaultForumLayout', config.defaultForumLayout, state.defaultForumLayout);
  }

  return drift;
}
