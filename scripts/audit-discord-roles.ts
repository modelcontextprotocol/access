/**
 * Script to audit Discord roles against the repo configuration.
 *
 * For each user defined in the repo with a Discord ID, this script:
 * 1. Gets their actual Discord roles
 * 2. Compares against expected roles based on their memberOf
 * 3. Reports discrepancies
 *
 * Run with: npx ts-node scripts/audit-discord-roles.ts
 */

import { MEMBERS } from '../src/config/users';
import { ROLES, getRole } from '../src/config/roles';
import type { RoleId } from '../src/config/roleIds';

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';

interface DiscordRole {
  id: string;
  name: string;
}

interface DiscordMember {
  user: { id: string; username: string; global_name: string };
  roles: string[];
}

// Build role name -> id lookup from Discord
const discordRoleNameToId = new Map<string, string>();
const discordRoleIdToName = new Map<string, string>();

// Build expected role name -> RoleId lookup from config
const syncedRoleNameToRoleId = new Map<string, RoleId>();

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Discord API error: ${response.status} ${error}`);
  }
  return response.json();
}

async function getDiscordRoles(): Promise<DiscordRole[]> {
  return fetchJson(`https://discord.com/api/v10/guilds/${GUILD_ID}/roles`);
}

async function getDiscordMember(discordId: string): Promise<DiscordMember | null> {
  try {
    return await fetchJson(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${discordId}`);
  } catch (e) {
    return null;
  }
}

/**
 * Expand role IDs to include all Discord-implied roles
 * (GitHub parent traversal + discordImplies)
 */
function expandDiscordRoles(roleIds: readonly RoleId[]): Set<RoleId> {
  const expanded = new Set<RoleId>();
  const queue = [...roleIds];

  while (queue.length > 0) {
    const roleId = queue.shift()!;
    if (expanded.has(roleId)) continue;

    const role = getRole(roleId);
    if (!role) continue;

    expanded.add(roleId);

    // Add parent role (GitHub hierarchy)
    if (role.github?.parent) {
      queue.push(role.github.parent);
    }

    // Add discord-implied roles
    if (role.discordImplies) {
      queue.push(...role.discordImplies);
    }
  }

  return expanded;
}

async function main() {
  if (!BOT_TOKEN || !GUILD_ID) {
    console.error('Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID environment variables');
    process.exit(1);
  }

  console.log('Fetching Discord roles...');
  const discordRoles = await getDiscordRoles();

  // Build role lookups
  for (const role of discordRoles) {
    discordRoleNameToId.set(role.name, role.id);
    discordRoleIdToName.set(role.id, role.name);
  }

  // Build synced role name -> RoleId lookup
  for (const role of ROLES) {
    if (role.discord?.role) {
      syncedRoleNameToRoleId.set(role.discord.role, role.id);
    }
  }

  // Map manual role names to their synced equivalents
  const manualToSynced = new Map<string, string>();
  for (const role of discordRoles) {
    const syncedName = `${role.name} (synced)`;
    if (discordRoleNameToId.has(syncedName)) {
      manualToSynced.set(role.name, syncedName);
    }
  }

  console.log('\n=== Discord Roles Summary ===');
  console.log(`Total roles: ${discordRoles.length}`);
  console.log(`Synced roles: ${discordRoles.filter(r => r.name.endsWith('(synced)')).length}`);
  console.log(`Manual roles with synced equivalent: ${manualToSynced.size}`);

  console.log('\n=== Auditing Users ===\n');

  const issues: string[] = [];
  const membersWithDiscord = MEMBERS.filter(m => m.discord);

  for (const member of membersWithDiscord) {
    const discordMember = await getDiscordMember(member.discord!);
    if (!discordMember) {
      issues.push(`❌ ${member.github || member.email}: Discord ID ${member.discord} not found in guild`);
      continue;
    }

    const username = discordMember.user.global_name || discordMember.user.username;

    // Get actual role names
    const actualRoleNames = new Set(
      discordMember.roles.map(id => discordRoleIdToName.get(id) || id)
    );

    // Get expected synced role names based on memberOf
    const expandedRoleIds = expandDiscordRoles(member.memberOf);
    const expectedSyncedRoles = new Set<string>();
    const expectedManualRoles = new Set<string>();

    for (const roleId of expandedRoleIds) {
      const role = getRole(roleId);
      if (role?.discord?.role) {
        expectedSyncedRoles.add(role.discord.role);
        // Also expect the manual equivalent if it exists
        const manualName = role.discord.role.replace(' (synced)', '');
        if (discordRoleNameToId.has(manualName)) {
          expectedManualRoles.add(manualName);
        }
      }
    }

    // Check for missing synced roles
    const missingSyncedRoles: string[] = [];
    for (const expectedRole of expectedSyncedRoles) {
      if (!actualRoleNames.has(expectedRole)) {
        missingSyncedRoles.push(expectedRole);
      }
    }

    // Check for manual roles without synced equivalent
    const manualWithoutSynced: string[] = [];
    for (const roleName of actualRoleNames) {
      if (roleName.endsWith('(synced)')) continue;
      if (roleName === '@everyone') continue;

      const syncedEquivalent = `${roleName} (synced)`;
      if (discordRoleNameToId.has(syncedEquivalent)) {
        // This is a manual role that has a synced equivalent
        if (!actualRoleNames.has(syncedEquivalent)) {
          manualWithoutSynced.push(`${roleName} (has no ${syncedEquivalent})`);
        }
      }
    }

    if (missingSyncedRoles.length > 0 || manualWithoutSynced.length > 0) {
      console.log(`\n👤 ${username} (${member.github || member.email})`);
      console.log(`   Discord ID: ${member.discord}`);

      if (missingSyncedRoles.length > 0) {
        console.log(`   ❌ Missing synced roles:`);
        for (const role of missingSyncedRoles) {
          console.log(`      - ${role}`);
          issues.push(`${username}: Missing ${role}`);
        }
      }

      if (manualWithoutSynced.length > 0) {
        console.log(`   ⚠️  Manual roles without synced equivalent:`);
        for (const role of manualWithoutSynced) {
          console.log(`      - ${role}`);
          issues.push(`${username}: ${role}`);
        }
      }
    } else {
      console.log(`✅ ${username} (${member.github || member.email})`);
    }
  }

  console.log('\n\n=== Summary ===');
  if (issues.length === 0) {
    console.log('✅ All users have matching roles!');
  } else {
    console.log(`❌ Found ${issues.length} issues:\n`);
    for (const issue of issues) {
      console.log(`   - ${issue}`);
    }
  }
}

main().catch(console.error);
