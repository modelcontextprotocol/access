import * as crypto from 'crypto';
import * as pulumi from '@pulumi/pulumi';
import * as gworkspace from '@pulumi/googleworkspace';
import * as random from '@pulumi/random';
import { ROLES, type Role, buildRoleLookup } from './config/roles';
import { MEMBERS } from './config/users';
import type { RoleId } from './config/roleIds';

const roleLookup = buildRoleLookup();
// Groups keyed by Google group name
const groups: Record<string, gworkspace.Group> = {};

// Create Google groups for roles that have Google config
ROLES.forEach((role: Role) => {
  if (!role.google) return;

  groups[role.google.group] = new gworkspace.Group(role.google.group, {
    email: `${role.google.group}@modelcontextprotocol.io`,
    name: role.google.group,
    description: role.description + ' \n(Managed by github.com/modelcontextprotocol/access)',
  });

  new gworkspace.GroupSettings(role.google.group, {
    email: groups[role.google.group].email,

    // Maximise visibility of group. It's visible in GitHub anyway
    whoCanViewMembership: 'ALL_IN_DOMAIN_CAN_VIEW',

    // This specifies who can add/remove members. We want this to only be via this IaC.
    whoCanModerateMembers: 'NONE',
    whoCanLeaveGroup: 'NONE_CAN_LEAVE',
    whoCanJoin: 'INVITED_CAN_JOIN',

    // Email groups allow anyone (including externals) to post
    // Non-email groups are not intended as mailing lists, so use the most restrictive settings
    // whoCanViewGroup is badly named, but actually means 'Permissions to view group messages'. See https://developers.google.com/workspace/admin/groups-settings/v1/reference/groups
    ...(role.google.isEmailGroup
      ? {
          whoCanPostMessage: 'ANYONE_CAN_POST',
          whoCanContactOwner: 'ALL_OWNERS_CAN_CONTACT',
          whoCanViewGroup: 'ALL_MEMBERS_CAN_VIEW',
        }
      : {
          whoCanPostMessage: 'ALL_OWNERS_CAN_POST',
          whoCanContactOwner: 'ALL_OWNERS_CAN_CONTACT',
          whoCanViewGroup: 'ALL_OWNERS_CAN_VIEW',
        }),
  });
});

// Create the organizational unit for MCP users
const mcpOrgUnit = new gworkspace.OrgUnit('mcp-org-unit', {
  name: 'Model Context Protocol',
  parentOrgUnitPath: '/',
  description: 'Organizational unit for MCP team members (Managed by github.com/modelcontextprotocol/access)',
});

// Provision Google Workspace user accounts for members in roles with provisionUser
const provisionedUsersByEmail: Record<string, gworkspace.User> = {};
const newUserPasswords: Record<string, pulumi.Output<string>> = {};

MEMBERS.forEach((member) => {
  if (
    !member.firstName ||
    !member.lastName ||
    !member.googleEmailPrefix ||
    member.skipGoogleUserProvisioning
  )
    return;

  const needsUser = member.memberOf.some((roleId: RoleId) => {
    const role = roleLookup.get(roleId);
    return role?.google?.provisionUser === true;
  });
  if (!needsUser) return;

  const primaryEmail = `${member.googleEmailPrefix}@modelcontextprotocol.io`;

  if (member.existingGWSUser) {
    // Import existing user into Pulumi state without recreating
    const user = new gworkspace.User(
      `gws-user-${member.googleEmailPrefix}`,
      {
        primaryEmail,
        name: { familyName: member.lastName!, givenName: member.firstName! },
        orgUnitPath: mcpOrgUnit.orgUnitPath,
      },
      { import: primaryEmail, dependsOn: [mcpOrgUnit] }
    );
    provisionedUsersByEmail[primaryEmail] = user;
  } else {
    // Create new user with random password
    const password = new random.RandomPassword(`gws-pwd-${member.googleEmailPrefix}`, {
      length: 24,
      special: true,
    });
    const hashedPassword = password.result.apply((plaintext: string) =>
      crypto.createHash('sha1').update(plaintext).digest('hex')
    );

    const user = new gworkspace.User(
      `gws-user-${member.googleEmailPrefix}`,
      {
        primaryEmail,
        name: { familyName: member.lastName!, givenName: member.firstName! },
        password: hashedPassword,
        hashFunction: 'SHA-1',
        changePasswordAtNextLogin: true,
        orgUnitPath: mcpOrgUnit.orgUnitPath,
      },
      { dependsOn: [mcpOrgUnit] }
    );
    provisionedUsersByEmail[primaryEmail] = user;

    // Track password for export so an admin can retrieve it
    newUserPasswords[primaryEmail] = password.result;
  }
});

// Create group memberships for users
MEMBERS.forEach((member) => {
  // Prefer the provisioned GWS email over the personal email for group memberships
  const gwsEmail = member.googleEmailPrefix
    ? `${member.googleEmailPrefix}@modelcontextprotocol.io`
    : undefined;
  const memberEmail = gwsEmail || member.email;
  if (!memberEmail) return;
  const provisionedUser = gwsEmail ? provisionedUsersByEmail[gwsEmail] : undefined;

  member.memberOf.forEach((roleId: RoleId) => {
    const role = roleLookup.get(roleId);
    if (!role?.google) return; // Role doesn't have Google config

    new gworkspace.GroupMember(
      `${memberEmail}-${role.google.group}`,
      {
        groupId: groups[role.google.group].id,
        email: memberEmail,
        role: 'MEMBER',
      },
      provisionedUser ? { dependsOn: [provisionedUser] } : undefined
    );
  });
});

export { groups as googleGroups };
// Export initial passwords as secrets so an admin can retrieve them with:
//   pulumi stack output --show-secrets newGWSUserPasswords
export const newGWSUserPasswords = pulumi.secret(newUserPasswords);
