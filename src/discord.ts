import * as pulumi from '@pulumi/pulumi';
import { ROLES, type Role, buildRoleLookup } from './config/roles';
import { MEMBERS } from './config/users';
import type { RoleId } from './config/roleIds';

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

async function discordFetch<T>(
  token: string,
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${DISCORD_API_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = (await response.json()) as DiscordApiError;
    throw new Error(`Discord API error: ${error.message} (code: ${error.code})`);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
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
  async create(inputs: DiscordRoleInputs): Promise<pulumi.dynamic.CreateResult<DiscordRoleOutputs>> {
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
    } catch {
      throw new Error(`Failed to read role ${id}`);
    }
  },

  async update(
    id: string,
    _olds: DiscordRoleOutputs,
    news: DiscordRoleInputs
  ): Promise<pulumi.dynamic.UpdateResult<DiscordRoleOutputs>> {
    await discordFetch<DiscordRoleApiResponse>(
      news.token,
      `/guilds/${news.guildId}/roles/${id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: news.roleName,
        }),
      }
    );

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
}

async function syncMemberRoles(
  inputs: DiscordMemberRoleSyncInputs
): Promise<{ addedRoles: string[]; removedRoles: string[] }> {
  // Get the user's current roles
  const member = await discordFetch<DiscordGuildMemberApiResponse>(
    inputs.token,
    `/guilds/${inputs.guildId}/members/${inputs.userId}`
  );

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

  return { addedRoles, removedRoles };
}

const discordMemberRoleSyncProvider: pulumi.dynamic.ResourceProvider = {
  async create(
    inputs: DiscordMemberRoleSyncInputs
  ): Promise<pulumi.dynamic.CreateResult<DiscordMemberRoleSyncOutputs>> {
    const { addedRoles, removedRoles } = await syncMemberRoles(inputs);

    return {
      id: inputs.userId,
      outs: {
        ...inputs,
        addedRoles,
        removedRoles,
      },
    };
  },

  async read(
    id: string,
    props: DiscordMemberRoleSyncOutputs
  ): Promise<pulumi.dynamic.ReadResult<DiscordMemberRoleSyncOutputs>> {
    try {
      const member = await discordFetch<DiscordGuildMemberApiResponse>(
        props.token,
        `/guilds/${props.guildId}/members/${props.userId}`
      );

      const currentRoles = new Set(member.roles);
      const expectedRoles = new Set(props.expectedRoleIds);
      const managedRoles = new Set(props.managedRoleIds);

      // Check if roles are in sync (only considering managed roles)
      const outOfSync =
        Array.from(expectedRoles).some((r) => !currentRoles.has(r)) ||
        Array.from(currentRoles).some((r) => managedRoles.has(r) && !expectedRoles.has(r));

      if (outOfSync) {
        // Return current state but note it needs update
        return {
          id,
          props: {
            ...props,
            addedRoles: [],
            removedRoles: [],
          },
        };
      }

      return { id, props };
    } catch {
      throw new Error(`Failed to read member roles for ${id}`);
    }
  },

  async update(
    id: string,
    _olds: DiscordMemberRoleSyncOutputs,
    news: DiscordMemberRoleSyncInputs
  ): Promise<pulumi.dynamic.UpdateResult<DiscordMemberRoleSyncOutputs>> {
    const { addedRoles, removedRoles } = await syncMemberRoles(news);

    return {
      outs: {
        ...news,
        addedRoles,
        removedRoles,
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
        ...args,
      },
      opts
    );
  }
}

const roleLookup = buildRoleLookup();
// Discord roles keyed by Discord role name
const roles: Record<string, DiscordRole> = {};

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
  const allManagedRoleIds = ROLES.filter((r) => r.discord).map((r) => roles[r.discord!.role].roleId);

  // Sync roles for each member
  MEMBERS.forEach((member) => {
    if (!member.discord) return;

    // Get the Discord role IDs this member should have
    const expectedRoleIds = member.memberOf
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
}

export { roles as discordRoles };
