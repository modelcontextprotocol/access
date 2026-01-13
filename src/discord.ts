import * as pulumi from '@pulumi/pulumi';
import { ROLES, type Role, buildRoleLookup } from './config/roles';
import { MEMBERS } from './config/users';
import type { RoleId } from './config/roleIds';

const config = new pulumi.Config('discord');
const DISCORD_BOT_TOKEN = config.requireSecret('botToken');
const DISCORD_GUILD_ID = config.require('guildId');

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

// Discord Role Membership Dynamic Provider
interface DiscordRoleMembershipInputs {
  guildId: string;
  userId: string;
  roleId: string;
  token: string;
}

const discordRoleMembershipProvider: pulumi.dynamic.ResourceProvider = {
  async create(
    inputs: DiscordRoleMembershipInputs
  ): Promise<pulumi.dynamic.CreateResult<DiscordRoleMembershipInputs>> {
    await discordFetch<void>(
      inputs.token,
      `/guilds/${inputs.guildId}/members/${inputs.userId}/roles/${inputs.roleId}`,
      { method: 'PUT' }
    );

    return {
      id: `${inputs.userId}-${inputs.roleId}`,
      outs: inputs,
    };
  },

  async read(
    id: string,
    props: DiscordRoleMembershipInputs
  ): Promise<pulumi.dynamic.ReadResult<DiscordRoleMembershipInputs>> {
    try {
      const member = await discordFetch<DiscordGuildMemberApiResponse>(
        props.token,
        `/guilds/${props.guildId}/members/${props.userId}`
      );

      if (!member.roles.includes(props.roleId)) {
        throw new Error(`User ${props.userId} does not have role ${props.roleId}`);
      }

      return { id, props };
    } catch {
      throw new Error(`Failed to read membership ${id}`);
    }
  },

  async delete(id: string, props: DiscordRoleMembershipInputs): Promise<void> {
    try {
      await discordFetch<void>(
        props.token,
        `/guilds/${props.guildId}/members/${props.userId}/roles/${props.roleId}`,
        { method: 'DELETE' }
      );
    } catch (error) {
      // Ignore errors if membership is already removed
      console.warn(`Failed to remove role membership ${id}: ${error}`);
    }
  },
};

class DiscordRoleMembership extends pulumi.dynamic.Resource {
  constructor(
    name: string,
    args: {
      guildId: pulumi.Input<string>;
      userId: pulumi.Input<string>;
      roleId: pulumi.Input<string>;
      token: pulumi.Input<string>;
    },
    opts?: pulumi.CustomResourceOptions
  ) {
    super(discordRoleMembershipProvider, name, args, opts);
  }
}

const roleLookup = buildRoleLookup();
// Discord roles keyed by Discord role name
const roles: Record<string, DiscordRole> = {};

// Create Discord roles for roles that have Discord config
ROLES.forEach((role: Role) => {
  if (!role.discord) return;

  roles[role.discord.role] = new DiscordRole(`discord-role-${role.id}`, {
    guildId: DISCORD_GUILD_ID,
    roleName: role.discord.role,
    token: DISCORD_BOT_TOKEN,
  });
});

// Assign roles to members
MEMBERS.forEach((member) => {
  if (!member.discord) return;

  member.memberOf.forEach((roleId: RoleId) => {
    const role = roleLookup.get(roleId);
    if (!role?.discord) return; // Role doesn't have Discord config

    const discordRole = roles[role.discord.role];
    new DiscordRoleMembership(
      `discord-membership-${member.discord}-${role.id}`,
      {
        guildId: DISCORD_GUILD_ID,
        userId: member.discord!,
        roleId: discordRole.roleId,
        token: DISCORD_BOT_TOKEN,
      },
      { dependsOn: [discordRole] }
    );
  });
});

export { roles as discordRoles };
