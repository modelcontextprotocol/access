/**
 * Discord role permissions that may be granted through roles.ts.
 *
 * Deliberately an allowlist of low-risk, non-moderation permissions: anything that
 * could administer the server (ADMINISTRATOR, MANAGE_*, KICK/BAN, MENTION_EVERYONE...)
 * stays a by-hand decision in Discord. Extend this list in a reviewed PR when needed.
 *
 * Bit values: https://discord.com/developers/docs/topics/permissions#permissions-bitwise-permission-flags
 */
export const DISCORD_ROLE_PERMISSION_BITS = {
  ADD_REACTIONS: 1n << 6n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
} as const;

export type DiscordRolePermission = keyof typeof DISCORD_ROLE_PERMISSION_BITS;

export function isDiscordRolePermission(value: string): value is DiscordRolePermission {
  return Object.prototype.hasOwnProperty.call(DISCORD_ROLE_PERMISSION_BITS, value);
}

/** Bitfield for a list of permission names, as the decimal string the Discord API uses. */
export function discordPermissionBitfield(permissions: readonly DiscordRolePermission[]): string {
  return permissions
    .reduce((bits, name) => bits | DISCORD_ROLE_PERMISSION_BITS[name], 0n)
    .toString();
}

/**
 * The permissions to write to a role so that Pulumi owns only the bits it declared.
 *
 * - Bits Pulumi did not manage before and does not manage now are left exactly as they
 *   are live (permissions set by hand in Discord survive).
 * - Bits declared now are set.
 * - Bits Pulumi declared previously but no longer declares are cleared.
 *
 * All values are Discord's decimal-string bitfields.
 */
export function mergeDiscordRolePermissions(
  live: string,
  previouslyManaged: string | undefined,
  managed: string | undefined
): string {
  const previous = BigInt(previouslyManaged ?? '0');
  const next = BigInt(managed ?? '0');
  return ((BigInt(live) & ~previous) | next).toString();
}

/**
 * Permissions that may be allowed or denied per channel through `permissionOverwrites`
 * in channels.ts. Separate from the role allowlist above: these are only ever applied
 * to one channel, never granted server-wide on a role. Limited to the posting
 * permissions needed to make a text channel thread-only; extend in a reviewed PR.
 */
export const DISCORD_CHANNEL_PERMISSION_BITS = {
  SEND_MESSAGES: 1n << 11n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
} as const;

export type DiscordChannelPermission = keyof typeof DISCORD_CHANNEL_PERMISSION_BITS;

export function isDiscordChannelPermission(value: string): value is DiscordChannelPermission {
  return Object.prototype.hasOwnProperty.call(DISCORD_CHANNEL_PERMISSION_BITS, value);
}

/** Bitfield for a list of channel permission names, as a decimal string. */
export function discordChannelPermissionBitfield(
  permissions: readonly DiscordChannelPermission[]
): string {
  return permissions
    .reduce((bits, name) => bits | DISCORD_CHANNEL_PERMISSION_BITS[name], 0n)
    .toString();
}

/** The allow/deny bitfields (decimal strings) of one channel permission overwrite */
export interface DiscordPermissionOverwriteBits {
  allow: string;
  deny: string;
}

/**
 * The allow/deny values to write to a channel permission overwrite so that Pulumi owns
 * only the bits it declared, following the same rules as mergeDiscordRolePermissions:
 * bits never managed are left as they are live, bits declared now are set, and bits
 * declared previously but no longer are cleared. A bit declared on one side is also
 * cleared from the other, since a permission cannot be both allowed and denied.
 */
export function mergeDiscordPermissionOverwrite(
  live: DiscordPermissionOverwriteBits,
  previouslyManaged: DiscordPermissionOverwriteBits | undefined,
  managed: DiscordPermissionOverwriteBits | undefined
): DiscordPermissionOverwriteBits {
  const previousAllow = BigInt(previouslyManaged?.allow ?? '0');
  const previousDeny = BigInt(previouslyManaged?.deny ?? '0');
  const nextAllow = BigInt(managed?.allow ?? '0');
  const nextDeny = BigInt(managed?.deny ?? '0');
  return {
    allow: ((BigInt(live.allow) & ~previousAllow & ~nextDeny) | nextAllow).toString(),
    deny: ((BigInt(live.deny) & ~previousDeny & ~nextAllow) | nextDeny).toString(),
  };
}

/** Errors for permission names that are duplicated or not on the allowlist. */
export function getDiscordRolePermissionErrors(
  roleName: string,
  permissions: readonly string[]
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const permission of permissions) {
    if (!isDiscordRolePermission(permission)) {
      errors.push(
        `Discord role "${roleName}": permission "${permission}" is not allowed ` +
          `(allowed: ${Object.keys(DISCORD_ROLE_PERMISSION_BITS).join(', ')})`
      );
    }
    if (seen.has(permission)) {
      errors.push(`Discord role "${roleName}": permission "${permission}" is listed twice`);
    }
    seen.add(permission);
  }
  return errors;
}
