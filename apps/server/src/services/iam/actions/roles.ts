import { z } from "zod";
import { transaction } from "../../../core/db";
import { defineAction } from "../../../core/service";
import { deleteSessionsForPrincipal } from "../../../core/sessions";
import {
  alreadyExists,
  deleteConflict,
  DocumentInput,
  formatRole,
  Pagination,
  Path,
  paginate,
  parseDocument,
  RoleName,
} from "../common";
import { requireRole, roleArn } from "../lookup";
import {
  attachedPolicies,
  deleteRoleRow,
  findRole,
  inlinePolicies,
  insertRole,
  listRoles,
  updateRole,
} from "../repo";

const MaxSessionDuration = z
  .number()
  .int()
  .min(3600, "MaxSessionDuration must be at least 3600 seconds (1 hour).")
  .max(43200, "MaxSessionDuration must be at most 43200 seconds (12 hours).");

const Description = z.string().max(1000);

export const roleActions = [
  defineAction({
    name: "CreateRole",
    iamAction: "iam:CreateRole",
    accessLevel: "Write",
    input: z.object({
      RoleName,
      Path,
      AssumeRolePolicyDocument: DocumentInput,
      Description: Description.optional(),
      MaxSessionDuration: MaxSessionDuration.default(3600),
    }),
    resource: (i, ctx) => roleArn(ctx, i.RoleName, i.Path),
    handler: (i, { session, deps }) => {
      if (findRole(deps.db, session.accountId, i.RoleName)) {
        throw alreadyExists(`Role with name ${i.RoleName} already exists.`);
      }
      const trustPolicy = parseDocument(deps, i.AssumeRolePolicyDocument, "trust");
      const role = insertRole(deps.db, {
        accountId: session.accountId,
        name: i.RoleName,
        path: i.Path,
        description: i.Description ?? null,
        trustPolicy,
        maxSessionDuration: i.MaxSessionDuration,
        now: deps.clock.now(),
      });
      return { Role: formatRole(role) };
    },
  }),

  defineAction({
    name: "GetRole",
    iamAction: "iam:GetRole",
    accessLevel: "Read",
    input: z.object({ RoleName }),
    resource: (i, ctx) => roleArn(ctx, i.RoleName),
    handler: (i, ctx) => ({ Role: formatRole(requireRole(ctx, i.RoleName)) }),
  }),

  defineAction({
    name: "ListRoles",
    iamAction: "iam:ListRoles",
    accessLevel: "List",
    input: z.object({ PathPrefix: z.string().startsWith("/").default("/"), ...Pagination }),
    handler: (i, { session, deps }) => {
      const { items, ...page } = paginate(
        listRoles(deps.db, session.accountId, i.PathPrefix).map(formatRole),
        i.Marker,
        i.MaxItems,
      );
      return { Roles: items, ...page };
    },
  }),

  defineAction({
    name: "UpdateRole",
    iamAction: "iam:UpdateRole",
    accessLevel: "Write",
    input: z.object({ RoleName, Description: Description.optional(), MaxSessionDuration: MaxSessionDuration.optional() }),
    resource: (i, ctx) => roleArn(ctx, i.RoleName),
    handler: (i, ctx) => {
      const role = requireRole(ctx, i.RoleName);
      updateRole(ctx.deps.db, role.id, {
        description: i.Description,
        maxSessionDuration: i.MaxSessionDuration,
      });
      return {};
    },
  }),

  defineAction({
    name: "UpdateAssumeRolePolicy",
    iamAction: "iam:UpdateAssumeRolePolicy",
    accessLevel: "Permissions management",
    input: z.object({ RoleName, PolicyDocument: DocumentInput }),
    resource: (i, ctx) => roleArn(ctx, i.RoleName),
    handler: (i, ctx) => {
      const role = requireRole(ctx, i.RoleName);
      updateRole(ctx.deps.db, role.id, { trustPolicy: parseDocument(ctx.deps, i.PolicyDocument, "trust") });
      return {};
    },
  }),

  defineAction({
    name: "DeleteRole",
    iamAction: "iam:DeleteRole",
    accessLevel: "Write",
    input: z.object({ RoleName }),
    resource: (i, ctx) => roleArn(ctx, i.RoleName),
    handler: (i, ctx) => {
      const { db } = ctx.deps;
      const role = requireRole(ctx, i.RoleName);
      if (attachedPolicies(db, "role", role.id).length)
        throw deleteConflict("Cannot delete entity, must detach all policies first.");
      if (inlinePolicies(db, "role", role.id).length)
        throw deleteConflict("Cannot delete entity, must delete policies first.");
      transaction(db, () => {
        deleteRoleRow(db, role.id);
        // Anyone currently using the role loses it, as with revoked role sessions in AWS.
        deleteSessionsForPrincipal(db, role.id);
      });
      return {};
    },
  }),
];
