import { z } from "zod";
import { transaction } from "../../../core/db";
import { defineAction } from "../../../core/service";
import {
  alreadyExists,
  deleteConflict,
  formatGroup,
  formatUser,
  GroupName,
  limitExceeded,
  MAX_GROUPS_PER_USER,
  noSuchEntity,
  Pagination,
  Path,
  paginate,
  UserName,
} from "../common";
import { groupArn, requireGroup, requireUser } from "../lookup";
import {
  addMember,
  attachedPolicies,
  deleteGroupRow,
  findGroup,
  groupsForUser,
  inlinePolicies,
  insertGroup,
  listGroups,
  removeMember,
  usersInGroup,
} from "../repo";

export const groupActions = [
  defineAction({
    name: "CreateGroup",
    iamAction: "iam:CreateGroup",
    accessLevel: "Write",
    input: z.object({ GroupName, Path }),
    resource: (i, ctx) => groupArn(ctx, i.GroupName, i.Path),
    handler: (i, { session, deps }) => {
      if (findGroup(deps.db, session.accountId, i.GroupName)) {
        throw alreadyExists(`Group with name ${i.GroupName} already exists.`);
      }
      return {
        Group: formatGroup(
          insertGroup(deps.db, session.accountId, i.GroupName, i.Path, deps.clock.now()),
        ),
      };
    },
  }),

  defineAction({
    name: "GetGroup",
    iamAction: "iam:GetGroup",
    accessLevel: "Read",
    input: z.object({ GroupName, ...Pagination }),
    resource: (i, ctx) => groupArn(ctx, i.GroupName),
    handler: (i, ctx) => {
      const group = requireGroup(ctx, i.GroupName);
      const { items, ...page } = paginate(
        usersInGroup(ctx.deps.db, group.id).map(formatUser),
        i.Marker,
        i.MaxItems,
      );
      return { Group: formatGroup(group), Users: items, ...page };
    },
  }),

  defineAction({
    name: "ListGroups",
    iamAction: "iam:ListGroups",
    accessLevel: "List",
    input: z.object({ PathPrefix: z.string().startsWith("/").default("/"), ...Pagination }),
    handler: (i, { session, deps }) => {
      const groups = listGroups(deps.db, session.accountId, i.PathPrefix).map((g) => ({
        ...formatGroup(g),
        // CloudLearn additions for the console's group table:
        UserCount: usersInGroup(deps.db, g.id).length,
        PolicyCount:
          attachedPolicies(deps.db, "group", g.id).length +
          inlinePolicies(deps.db, "group", g.id).length,
      }));
      const { items, ...page } = paginate(groups, i.Marker, i.MaxItems);
      return { Groups: items, ...page };
    },
  }),

  defineAction({
    name: "DeleteGroup",
    iamAction: "iam:DeleteGroup",
    accessLevel: "Write",
    input: z.object({ GroupName }),
    resource: (i, ctx) => groupArn(ctx, i.GroupName),
    handler: (i, ctx) => {
      const { db } = ctx.deps;
      const group = requireGroup(ctx, i.GroupName);
      if (usersInGroup(db, group.id).length)
        throw deleteConflict("Cannot delete entity, must remove users from group first.");
      if (attachedPolicies(db, "group", group.id).length)
        throw deleteConflict("Cannot delete entity, must detach all policies first.");
      if (inlinePolicies(db, "group", group.id).length)
        throw deleteConflict("Cannot delete entity, must delete policies first.");
      transaction(db, () => deleteGroupRow(db, group.id));
      return {};
    },
  }),

  defineAction({
    name: "AddUserToGroup",
    iamAction: "iam:AddUserToGroup",
    accessLevel: "Write",
    input: z.object({ GroupName, UserName }),
    resource: (i, ctx) => groupArn(ctx, i.GroupName),
    handler: (i, ctx) => {
      const group = requireGroup(ctx, i.GroupName);
      const user = requireUser(ctx, i.UserName);
      const current = groupsForUser(ctx.deps.db, user.id);
      if (!current.some((g) => g.id === group.id) && current.length >= MAX_GROUPS_PER_USER) {
        throw limitExceeded(`Cannot exceed quota for GroupsPerUser: ${MAX_GROUPS_PER_USER}`);
      }
      addMember(ctx.deps.db, group.id, user.id, ctx.deps.clock.now());
      return {};
    },
  }),

  defineAction({
    name: "RemoveUserFromGroup",
    iamAction: "iam:RemoveUserFromGroup",
    accessLevel: "Write",
    input: z.object({ GroupName, UserName }),
    resource: (i, ctx) => groupArn(ctx, i.GroupName),
    handler: (i, ctx) => {
      const group = requireGroup(ctx, i.GroupName);
      const user = requireUser(ctx, i.UserName);
      if (!groupsForUser(ctx.deps.db, user.id).some((g) => g.id === group.id)) {
        throw noSuchEntity(`User ${user.name} is not in group ${group.name}.`);
      }
      removeMember(ctx.deps.db, group.id, user.id);
      return {};
    },
  }),
];
