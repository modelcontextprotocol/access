import * as gworkspace from '@pulumi/googleworkspace';
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

// Create group memberships for users
MEMBERS.forEach((member) => {
  if (!member.email) return;

  member.memberOf.forEach((roleId: RoleId) => {
    const role = roleLookup.get(roleId);
    if (!role?.google) return; // Role doesn't have Google config

    new gworkspace.GroupMember(`${member.email}-${role.google.group}`, {
      groupId: groups[role.google.group].id,
      email: member.email!,
      role: 'MEMBER',
    });
  });
});

export { groups as googleGroups };
