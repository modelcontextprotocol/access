import * as gworkspace from '@pulumi/googleworkspace';
import { GROUPS } from './config/groups';
import type { Group } from './config/utils';
import { MEMBERS } from './config/users';

const groups: Record<string, gworkspace.Group> = {};

GROUPS.forEach((group: Group) => {
  groups[group.name] = new gworkspace.Group(group.name, {
    email: `${group.name}@modelcontextprotocol.io`,
    name: group.name,
    description: group.description + ' \n(Managed by github.com/modelcontextprotocol/access)',
  });

  new gworkspace.GroupSettings(group.name, {
    email: groups[group.name].email,
    whoCanContactOwner: 'ALL_OWNERS_CAN_CONTACT',
    whoCanJoin: 'INVITED_CAN_JOIN',
    whoCanLeaveGroup: 'NONE_CAN_LEAVE',
    whoCanModerateMembers: 'OWNERS_ONLY',
    whoCanPostMessage: 'ALL_OWNERS_CAN_POST',
    whoCanViewGroup: 'ALL_MEMBERS_CAN_VIEW',
    whoCanViewMembership: 'ALL_IN_DOMAIN_CAN_VIEW',
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
