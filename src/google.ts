import * as gworkspace from '@pulumi/googleworkspace';
import { GROUPS } from './config/groups';
import type { Group } from './config/utils';
import { MEMBERS } from './config/users';

const groups: Record<string, gworkspace.Group> = {};

GROUPS.forEach((group: Group) => {
  // Skip groups that don't include google in their platforms
  if (group.onlyOnPlatforms && !group.onlyOnPlatforms.includes('google')) return;

  groups[group.name] = new gworkspace.Group(group.name, {
    email: `${group.name}@modelcontextprotocol.io`,
    name: group.name,
    description: group.description + ' \n(Managed by github.com/modelcontextprotocol/access)',
  });

  new gworkspace.GroupSettings(group.name, {
    email: groups[group.name].email,

    // Maximise visibility of group. It's visible in GitHub anyway
    whoCanViewMembership: 'ALL_IN_DOMAIN_CAN_VIEW',

    // This specifies who can add/remove members. We want this to only be via this IaC.
    whoCanModerateMembers: 'NONE',
    whoCanLeaveGroup: 'NONE_CAN_LEAVE',
    whoCanJoin: 'INVITED_CAN_JOIN',

    // Email groups allow anyone (including externals) to post
    // Non-email groups are not intended as mailing lists, so use the most restrictive settings
    // whoCanViewGroup is badly named, but actually means 'Permissions to view group messages'. See https://developers.google.com/workspace/admin/groups-settings/v1/reference/groups
    ...(group.isEmailGroup ? {
      whoCanPostMessage: 'ANYONE_CAN_POST',
      whoCanContactOwner: 'ALL_OWNERS_CAN_CONTACT',
      whoCanViewGroup: 'ALL_MEMBERS_CAN_VIEW',
    } : {
      whoCanPostMessage: 'ALL_OWNERS_CAN_POST',
      whoCanContactOwner: 'ALL_OWNERS_CAN_CONTACT',
      whoCanViewGroup: 'ALL_OWNERS_CAN_VIEW',
    }),

  });

  group.memberOf?.forEach((parentGroupKey) => {
    new gworkspace.GroupMember(`${group.name}-in-${parentGroupKey}`, {
      groupId: groups[parentGroupKey].id,
      email: groups[group.name].email,
      role: 'MEMBER',
    });
  });
});

MEMBERS.forEach((member) => {
  if (!member.email) return;

  member.memberOf.forEach((teamKey) => {
    new gworkspace.GroupMember(`${member.email}-${teamKey}`, {
      groupId: groups[teamKey].id,
      email: member.email!,
      role: 'MEMBER',
    });
  });
});
