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
