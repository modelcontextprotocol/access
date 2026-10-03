import * as pulumi from '@pulumi/pulumi';
import { ROLES, type Role, buildRoleLookup } from './config/roles';
import { MEMBERS } from './config/users';
import type { RoleId } from './config/roleIds';
import {
  DISCORD_CHANNELS,
  DISCORD_CHANNEL_TYPE_IDS,
  discordChannelCreatePayloadFromConfig,
  discordChannelPayloadFromConfig,
  discordChannelRequireTagError,
  discordChannelResourceName,
  discordChannelStateFromApi,
  discordChannelTypeName,
  getDiscordChannelDrift,
  type DiscordChannelApiResponse,
  type DiscordChannelConfig,
  type DiscordChannelState,
} from './config/channels';

const config = new pulumi.Config('discord');
// Discord integration is optional - only enabled if botToken and guildId are configured
const DISCORD_BOT_TOKEN = config.getSecret('botToken');
const DISCORD_GUILD_ID = config.get('guildId');
const DISCORD_ENABLED = DISCORD_BOT_TOKEN !== undefined && DISCORD_GUILD_ID !== undefined;

if (!DISCORD_ENABLED) {
  pulumi.log.info('Discord integration disabled: botToken or guildId not configured');
}

const DISCORD_API_BASE = 'https://discord.com/api/v10';

interface DiscordApiError {
  code: number;
  message: string;
}

interface DiscordRateLimitResponse {
  message: string;
  retry_after: number;
  global: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cloudflare 5xx and edge-level 429s return plain-text bodies ("upstream connect
// error...", "error code: 1015") that crash a naive response.json().
function tryParseJson<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

async function discordFetch<T>(
  token: string,
  endpoint: string,
  options: RequestInit = {},
  maxRetries = 10
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(`${DISCORD_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (response.status === 429) {
      const text = await response.text();
      const body = tryParseJson<DiscordRateLimitResponse>(text);
      const retryAfterSec = body?.retry_after ?? 1;
      // Linearly increasing jitter de-syncs the thundering herd when many
      // resources refresh in parallel and all receive the same retry_after.
      const jitterMs = Math.random() * 1000 * (attempt + 1);
      const retryAfterMs = Math.ceil(retryAfterSec * 1000) + jitterMs;
      lastError = new Error(
        `Discord API rate limited on ${endpoint} (retry_after=${retryAfterSec}s, global=${body?.global ?? false})`
      );
      if (attempt < maxRetries) {
        await sleep(retryAfterMs);
        continue;
      }
      throw lastError;
    }

    if (response.status >= 500 && response.status < 600) {
      const text = await response.text();
      lastError = new Error(`Discord API ${response.status} on ${endpoint}: ${text.slice(0, 200)}`);
      if (attempt < maxRetries) {
        await sleep(2 ** attempt * 500 + Math.random() * 1000);
        continue;
      }
      throw lastError;
    }

    if (!response.ok) {
      const text = await response.text();
      const error = tryParseJson<DiscordApiError>(text);
      throw new Error(
        error
          ? `Discord API error: ${error.message} (code: ${error.code})`
          : `Discord API ${response.status} on ${endpoint}: ${text.slice(0, 200)}`
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  throw (
    lastError ?? new Error(`Discord API request to ${endpoint} failed after ${maxRetries} retries`)
  );
}

// Discord API response types
interface DiscordRoleApiResponse {
  id: string;
  name: string;
  position: number;
  permissions: string;
  managed: boolean;
}

interface DiscordGuildMemberApiResponse {
  roles: string[];
}

// Discord Role Dynamic Provider
interface DiscordRoleInputs {
  guildId: string;
  roleName: string;
  token: string;
}

interface DiscordRoleOutputs extends DiscordRoleInputs {
  roleId: string;
}

const discordRoleProvider: pulumi.dynamic.ResourceProvider = {
  async create(
    inputs: DiscordRoleInputs
  ): Promise<pulumi.dynamic.CreateResult<DiscordRoleOutputs>> {
    const role = await discordFetch<DiscordRoleApiResponse>(
      inputs.token,
      `/guilds/${inputs.guildId}/roles`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: inputs.roleName,
          permissions: '0', // No special permissions - roles are for organization only
          mentionable: false,
          hoist: false,
        }),
      }
    );

    return {
      id: role.id,
      outs: {
        ...inputs,
        roleId: role.id,
      },
    };
  },

  async read(
    id: string,
    props: DiscordRoleOutputs
  ): Promise<pulumi.dynamic.ReadResult<DiscordRoleOutputs>> {
    try {
      const roles = await discordFetch<DiscordRoleApiResponse[]>(
        props.token,
        `/guilds/${props.guildId}/roles`
      );

      const role = roles.find((r) => r.id === id);
      if (!role) {
        // Role was deleted externally
        throw new Error(`Role ${id} not found`);
      }

      return {
        id,
        props: {
          ...props,
          roleName: role.name,
          roleId: role.id,
        },
      };
    } catch (error) {
      throw new Error(`Failed to read role ${id}: ${error}`);
    }
  },

  async update(
    id: string,
    _olds: DiscordRoleOutputs,
    news: DiscordRoleInputs
  ): Promise<pulumi.dynamic.UpdateResult<DiscordRoleOutputs>> {
    await discordFetch<DiscordRoleApiResponse>(news.token, `/guilds/${news.guildId}/roles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: news.roleName,
      }),
    });

    return {
      outs: {
        ...news,
        roleId: id,
      },
    };
  },

  async delete(id: string, props: DiscordRoleOutputs): Promise<void> {
    try {
      await discordFetch<void>(props.token, `/guilds/${props.guildId}/roles/${id}`, {
        method: 'DELETE',
      });
    } catch (error) {
      // Ignore errors if role is already deleted
      console.warn(`Failed to delete role ${id}: ${error}`);
    }
  },
};

class DiscordRole extends pulumi.dynamic.Resource {
  public readonly roleId!: pulumi.Output<string>;
  public readonly roleName!: pulumi.Output<string>;
  public readonly guildId!: pulumi.Output<string>;

  constructor(
    name: string,
    args: {
      guildId: pulumi.Input<string>;
      roleName: pulumi.Input<string>;
      token: pulumi.Input<string>;
    },
    opts?: pulumi.CustomResourceOptions
  ) {
    super(
      discordRoleProvider,
      name,
      {
        roleId: undefined,
        ...args,
      },
      opts
    );
  }
}

// Discord Member Role Sync Dynamic Provider
// This provider reconciles a user's roles to match exactly what's defined in config
// It adds missing roles AND removes extra roles (only for roles we manage)
interface DiscordMemberRoleSyncInputs {
  guildId: string;
  userId: string;
  /** Role IDs that this user SHOULD have (managed roles only) */
  expectedRoleIds: string[];
  /** All role IDs that we manage (to know which ones to potentially remove) */
  managedRoleIds: string[];
  token: string;
}

interface DiscordMemberRoleSyncOutputs extends DiscordMemberRoleSyncInputs {
  /** Roles that were added during last sync */
  addedRoles: string[];
  /** Roles that were removed during last sync */
  removedRoles: string[];
  /** True if the member was not found on the Discord server */
  memberNotFound: boolean;
}

async function syncMemberRoles(
  inputs: DiscordMemberRoleSyncInputs
): Promise<{ addedRoles: string[]; removedRoles: string[]; memberNotFound: boolean }> {
  // Get the user's current roles
  let member: DiscordGuildMemberApiResponse;
  try {
    member = await discordFetch<DiscordGuildMemberApiResponse>(
      inputs.token,
      `/guilds/${inputs.guildId}/members/${inputs.userId}`
    );
  } catch (error) {
    // If the member isn't on the server, skip gracefully
    if (error instanceof Error && error.message.includes('code: 10007')) {
      console.warn(
        `Discord member ${inputs.userId} not found on server - skipping role sync. ` +
          `They may have left the server or the Discord ID may be incorrect.`
      );
      return { addedRoles: [], removedRoles: [], memberNotFound: true };
    }
    throw error;
  }

  const currentRoles = new Set(member.roles);
  const expectedRoles = new Set(inputs.expectedRoleIds);
  const managedRoles = new Set(inputs.managedRoleIds);

  const addedRoles: string[] = [];
  const removedRoles: string[] = [];

  // Add missing roles
  for (const roleId of Array.from(expectedRoles)) {
    if (!currentRoles.has(roleId)) {
      await discordFetch<void>(
        inputs.token,
        `/guilds/${inputs.guildId}/members/${inputs.userId}/roles/${roleId}`,
        { method: 'PUT' }
      );
      addedRoles.push(roleId);
    }
  }

  // Remove roles that the user has but shouldn't (only managed roles)
  for (const roleId of Array.from(currentRoles)) {
    if (managedRoles.has(roleId) && !expectedRoles.has(roleId)) {
      await discordFetch<void>(
        inputs.token,
        `/guilds/${inputs.guildId}/members/${inputs.userId}/roles/${roleId}`,
        { method: 'DELETE' }
      );
      removedRoles.push(roleId);
    }
  }

  return { addedRoles, removedRoles, memberNotFound: false };
}

const discordMemberRoleSyncProvider: pulumi.dynamic.ResourceProvider = {
  async create(
    inputs: DiscordMemberRoleSyncInputs
  ): Promise<pulumi.dynamic.CreateResult<DiscordMemberRoleSyncOutputs>> {
    const { addedRoles, removedRoles, memberNotFound } = await syncMemberRoles(inputs);

    return {
      id: inputs.userId,
      outs: {
        ...inputs,
        addedRoles,
        removedRoles,
        memberNotFound,
      },
    };
  },

  async read(
    id: string,
    props: DiscordMemberRoleSyncOutputs
  ): Promise<pulumi.dynamic.ReadResult<DiscordMemberRoleSyncOutputs>> {
    let member: DiscordGuildMemberApiResponse;
    try {
      member = await discordFetch<DiscordGuildMemberApiResponse>(
        props.token,
        `/guilds/${props.guildId}/members/${props.userId}`
      );
    } catch (error) {
      // If the member isn't on the server, return state indicating they're not found
      if (error instanceof Error && error.message.includes('code: 10007')) {
        return {
          id,
          props: {
            ...props,
            addedRoles: [],
            removedRoles: [],
            memberNotFound: true,
          },
        };
      }
      throw new Error(`Failed to read member roles for ${id}: ${error}`);
    }

    const currentRoles = new Set(member.roles);
    const expectedRoles = new Set(props.expectedRoleIds);
    const managedRoles = new Set(props.managedRoleIds);

    // Check if roles are in sync (only considering managed roles)
    const outOfSync =
      Array.from(expectedRoles).some((r) => !currentRoles.has(r)) ||
      Array.from(currentRoles).some((r) => managedRoles.has(r) && !expectedRoles.has(r));

    if (outOfSync) {
      // Self-heal: apply the expected roles now. Without this, refresh would
      // only observe drift, and since inputs are unchanged Pulumi would never
      // trigger update() — leaving members who joined after create() stuck.
      const { addedRoles, removedRoles, memberNotFound } = await syncMemberRoles(props);
      return {
        id,
        props: {
          ...props,
          addedRoles,
          removedRoles,
          memberNotFound,
        },
      };
    }

    return { id, props: { ...props, memberNotFound: false } };
  },

  async update(
    id: string,
    _olds: DiscordMemberRoleSyncOutputs,
    news: DiscordMemberRoleSyncInputs
  ): Promise<pulumi.dynamic.UpdateResult<DiscordMemberRoleSyncOutputs>> {
    const { addedRoles, removedRoles, memberNotFound } = await syncMemberRoles(news);

    return {
      outs: {
        ...news,
        addedRoles,
        removedRoles,
        memberNotFound,
      },
    };
  },

  async delete(id: string, props: DiscordMemberRoleSyncOutputs): Promise<void> {
    // When a user is removed from config, remove all their managed roles
    for (const roleId of props.expectedRoleIds) {
      try {
        await discordFetch<void>(
          props.token,
          `/guilds/${props.guildId}/members/${props.userId}/roles/${roleId}`,
          { method: 'DELETE' }
        );
      } catch (error) {
        console.warn(`Failed to remove role ${roleId} from user ${id}: ${error}`);
      }
    }
  },
};

class DiscordMemberRoleSync extends pulumi.dynamic.Resource {
  public readonly addedRoles!: pulumi.Output<string[]>;
  public readonly removedRoles!: pulumi.Output<string[]>;
  public readonly memberNotFound!: pulumi.Output<boolean>;

  constructor(
    name: string,
    args: {
      guildId: pulumi.Input<string>;
      userId: pulumi.Input<string>;
      expectedRoleIds: pulumi.Input<pulumi.Input<string>[]>;
      managedRoleIds: pulumi.Input<pulumi.Input<string>[]>;
      token: pulumi.Input<string>;
    },
    opts?: pulumi.CustomResourceOptions
  ) {
    super(
      discordMemberRoleSyncProvider,
      name,
      {
        addedRoles: undefined,
        removedRoles: undefined,
        memberNotFound: undefined,
        ...args,
      },
      opts
    );
  }
}

// Discord Channel Dynamic Provider
// Manages the settings of a channel declared in config/channels.ts: either an existing
// channel adopted by its ID, or a new channel created by this provider (the only way to
// get a thread-only forum/media channel, since Discord cannot convert a text channel).
//
// Only the settings the config declares are managed; the rest of the channel is left
// alone. read() is side-effect free and returns the live settings as `state`, and
// diff() compares that state with the declared config, so drift introduced by hand in
// Discord is corrected by the next deploy (`make up` runs `pulumi up --refresh`).
//
// NEVER deletes a channel: removing an entry from channels.ts only drops the resource
// from Pulumi state, because deleting a channel destroys its message history.
interface DiscordChannelInputs {
  guildId: string;
  channel: DiscordChannelConfig;
  token: string;
}

interface DiscordChannelOutputs extends DiscordChannelInputs {
  channelId: string;
  /** Managed settings as last read from Discord */
  state: DiscordChannelState;
}

/** Discord error code for "Unknown Channel" */
const DISCORD_UNKNOWN_CHANNEL_CODE = 10003;

// Sent on every channel create/modify so the guild's audit log shows where the change
// came from. Discord URL-decodes this header, hence the encoding. Passed per call rather
// than inside discordFetch so the role/member providers' serialized code is unchanged.
const DISCORD_CHANNEL_AUDIT_LOG_HEADERS = {
  'X-Audit-Log-Reason': encodeURIComponent('modelcontextprotocol/access deploy'),
};

function describeDiscordChannelType(typeId: number): string {
  const name = discordChannelTypeName(typeId);
  return name ? `type ${typeId} (${name})` : `type ${typeId}`;
}

/** "Discord channel <id> ("<name>")", or just the id when the entry declares no name */
function discordChannelLabel(id: string, config: DiscordChannelConfig): string {
  return config.name !== undefined
    ? `Discord channel ${id} ("${config.name}")`
    : `Discord channel ${id}`;
}

/**
 * Check that a live channel is the one the config means: same guild, same type.
 * Discord can only convert text <-> announcement channels, so a type mismatch cannot
 * be fixed with a PATCH and the deploy must fail with an actionable message.
 */
function assertDiscordChannelMatches(
  guildId: string,
  config: DiscordChannelConfig,
  live: DiscordChannelApiResponse
): void {
  const label = discordChannelLabel(live.id, config);
  if (live.guild_id !== guildId) {
    throw new Error(
      `${label} belongs to guild ${live.guild_id ?? 'unknown'}, not the configured guild ${guildId}`
    );
  }
  if (discordChannelTypeName(live.type) !== config.type) {
    throw new Error(
      `${label} is ${describeDiscordChannelType(live.type)} but channels.ts declares type ` +
        `'${config.type}' (${DISCORD_CHANNEL_TYPE_IDS[config.type]}). Discord cannot convert ` +
        `between these types: to make an existing channel thread-only, declare a new forum/media ` +
        `channel (without id) and retire the old one by hand.`
    );
  }
}

/**
 * Apply the declared settings to a live channel if they differ, and return the
 * resulting state. Tag IDs and unmanaged flag bits come from `live`.
 */
async function reconcileDiscordChannel(
  token: string,
  guildId: string,
  config: DiscordChannelConfig,
  live: DiscordChannelApiResponse
): Promise<DiscordChannelState> {
  assertDiscordChannelMatches(guildId, config, live);

  const current = discordChannelStateFromApi(live);
  const drift = getDiscordChannelDrift(config, current);
  if (drift.length === 0) return current;

  // Turning on REQUIRE_TAG with no tags to pick from would make Discord reject every post
  const requireTagError = discordChannelRequireTagError(config, current);
  if (requireTagError !== undefined) {
    throw new Error(`${discordChannelLabel(live.id, config)}: ${requireTagError}`);
  }

  const updated = await discordFetch<DiscordChannelApiResponse>(token, `/channels/${live.id}`, {
    method: 'PATCH',
    headers: DISCORD_CHANNEL_AUDIT_LOG_HEADERS,
    body: JSON.stringify(discordChannelPayloadFromConfig(config, current)),
  });
  return discordChannelStateFromApi(updated);
}

/** Deep equality for the JSON-like values Pulumi hands to the provider (key order ignored) */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, i) => jsonEqual(value, b[i]));
  }
  const recordA = a as Record<string, unknown>;
  const recordB = b as Record<string, unknown>;
  // undefined properties are dropped during serialization, so treat them as absent
  const keysA = Object.keys(recordA).filter((k) => recordA[k] !== undefined);
  const keysB = Object.keys(recordB).filter((k) => recordB[k] !== undefined);
  return keysA.length === keysB.length && keysA.every((k) => jsonEqual(recordA[k], recordB[k]));
}

const discordChannelProvider: pulumi.dynamic.ResourceProvider = {
  async diff(
    _id: string,
    olds: DiscordChannelOutputs,
    news: DiscordChannelInputs
  ): Promise<pulumi.dynamic.DiffResult> {
    const replaces: string[] = [];
    if (olds.guildId !== news.guildId) replaces.push('guildId');
    // A different channel, or a type Discord cannot convert to: adopt/create the new
    // one and drop the old one from state (delete() never touches Discord).
    if (olds.channel?.id !== news.channel.id || olds.channel?.type !== news.channel.type) {
      replaces.push('channel');
    }

    const inputsChanged =
      olds.guildId !== news.guildId ||
      olds.token !== news.token ||
      !jsonEqual(olds.channel, news.channel);
    // `state` is the live state from the last create/update/refresh
    const drifted =
      olds.state === undefined || getDiscordChannelDrift(news.channel, olds.state).length > 0;

    return {
      changes: inputsChanged || drifted,
      replaces: replaces.length > 0 ? replaces : undefined,
    };
  },

  async create(
    inputs: DiscordChannelInputs
  ): Promise<pulumi.dynamic.CreateResult<DiscordChannelOutputs>> {
    const { guildId, channel, token } = inputs;

    let live: DiscordChannelApiResponse;
    if (channel.id !== undefined) {
      // Adopt the existing channel and bring its declared settings in line
      live = await discordFetch<DiscordChannelApiResponse>(token, `/channels/${channel.id}`);
    } else {
      // Create Guild Channel does not take `flags`; reconcile below applies requireTag
      live = await discordFetch<DiscordChannelApiResponse>(token, `/guilds/${guildId}/channels`, {
        method: 'POST',
        headers: DISCORD_CHANNEL_AUDIT_LOG_HEADERS,
        body: JSON.stringify(discordChannelCreatePayloadFromConfig(channel)),
      });
    }

    const state = await reconcileDiscordChannel(token, guildId, channel, live);

    return {
      id: live.id,
      outs: {
        ...inputs,
        channelId: live.id,
        state,
      },
    };
  },

  async read(
    id: string,
    props: DiscordChannelOutputs
  ): Promise<pulumi.dynamic.ReadResult<DiscordChannelOutputs>> {
    let live: DiscordChannelApiResponse;
    try {
      live = await discordFetch<DiscordChannelApiResponse>(props.token, `/channels/${id}`);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes(`code: ${DISCORD_UNKNOWN_CHANNEL_CODE}`)
      ) {
        // Deleted outside Pulumi: a blank id drops the resource from state on refresh.
        // The next deploy recreates a channel declared without id, and fails with a
        // clear error for one declared by id.
        console.warn(`${discordChannelLabel(id, props.channel)} no longer exists`);
        return { id: '' };
      }
      throw new Error(`Failed to read channel ${id}: ${error}`);
    }

    // Side-effect free: report the live settings and let diff() turn drift into an update
    return {
      id,
      props: {
        ...props,
        channelId: live.id,
        state: discordChannelStateFromApi(live),
      },
    };
  },

  async update(
    id: string,
    _olds: DiscordChannelOutputs,
    news: DiscordChannelInputs
  ): Promise<pulumi.dynamic.UpdateResult<DiscordChannelOutputs>> {
    // Re-read before patching so tag IDs and unmanaged flag bits are current even
    // when the last refresh is stale
    const live = await discordFetch<DiscordChannelApiResponse>(news.token, `/channels/${id}`);
    const state = await reconcileDiscordChannel(news.token, news.guildId, news.channel, live);

    return {
      outs: {
        ...news,
        channelId: id,
        state,
      },
    };
  },

  async delete(id: string, props: DiscordChannelOutputs): Promise<void> {
    // Never delete a Discord channel: that would destroy its message history.
    // Removing an entry from channels.ts only stops managing the channel.
    console.warn(
      `${discordChannelLabel(id, props.channel)} was removed from config; it is left in place ` +
        `on Discord and only dropped from Pulumi state. Delete it by hand if intended.`
    );
  },
};

class DiscordChannel extends pulumi.dynamic.Resource {
  public readonly channelId!: pulumi.Output<string>;
  public readonly state!: pulumi.Output<DiscordChannelState>;

  constructor(
    name: string,
    args: {
      guildId: pulumi.Input<string>;
      channel: pulumi.Input<DiscordChannelConfig>;
      token: pulumi.Input<string>;
    },
    opts?: pulumi.CustomResourceOptions
  ) {
    super(
      discordChannelProvider,
      name,
      {
        channelId: undefined,
        state: undefined,
        ...args,
      },
      opts
    );
  }
}

const roleLookup = buildRoleLookup();
// Discord roles keyed by Discord role name
const roles: Record<string, DiscordRole> = {};
// Discord channels keyed by `id ?? name` of their channels.ts entry
const channels: Record<string, DiscordChannel> = {};

/**
 * Expand a set of role IDs to include all implied Discord roles.
 * This traverses:
 * 1. GitHub parent relationships (e.g., GO_SDK -> SDK_MAINTAINERS)
 * 2. discordImplies relationships (e.g., SDK_MAINTAINERS -> MAINTAINERS)
 */
function expandDiscordRoles(roleIds: readonly RoleId[]): Set<RoleId> {
  const expanded = new Set<RoleId>();
  const toProcess = [...roleIds];

  while (toProcess.length > 0) {
    const roleId = toProcess.pop()!;
    if (expanded.has(roleId)) continue;
    expanded.add(roleId);

    const role = roleLookup.get(roleId);
    if (!role) continue;

    // Follow GitHub parent relationship
    if (role.github?.parent) {
      toProcess.push(role.github.parent);
    }

    // Follow discordImplies relationships
    if (role.discordImplies) {
      toProcess.push(...role.discordImplies);
    }
  }

  return expanded;
}

// Only create Discord resources if Discord is enabled
if (DISCORD_ENABLED) {
  // These are guaranteed to be defined when DISCORD_ENABLED is true
  const guildId = DISCORD_GUILD_ID!;
  const botToken = DISCORD_BOT_TOKEN!;

  // Create Discord roles for roles that have Discord config
  ROLES.forEach((role: Role) => {
    if (!role.discord) return;

    roles[role.discord.role] = new DiscordRole(`discord-role-${role.id}`, {
      guildId,
      roleName: role.discord.role,
      token: botToken,
    });
  });

  // Collect all managed role IDs (roles that have Discord config)
  const allManagedRoleIds = ROLES.filter((r) => r.discord).map(
    (r) => roles[r.discord!.role].roleId
  );

  // Sync roles for each member
  MEMBERS.forEach((member) => {
    if (!member.discord) return;

    // Expand roles to include parents and implied roles
    const expandedRoleIds = expandDiscordRoles(member.memberOf);

    // Get the Discord role IDs this member should have
    const expectedRoleIds = Array.from(expandedRoleIds)
      .map((roleId: RoleId) => {
        const role = roleLookup.get(roleId);
        if (!role?.discord) return null;
        return roles[role.discord.role].roleId;
      })
      .filter((id): id is pulumi.Output<string> => id !== null);

    // Create a sync resource for this member
    new DiscordMemberRoleSync(
      `discord-member-sync-${member.discord}`,
      {
        guildId,
        userId: member.discord!,
        expectedRoleIds,
        managedRoleIds: allManagedRoleIds,
        token: botToken,
      },
      { dependsOn: Object.values(roles) }
    );
  });

  // Manage the channels declared in channels.ts (adopted by id, or created)
  DISCORD_CHANNELS.forEach((channel) => {
    channels[channel.id ?? channel.name] = new DiscordChannel(discordChannelResourceName(channel), {
      guildId,
      channel,
      token: botToken,
    });
  });
}

export { roles as discordRoles, channels as discordChannels };
