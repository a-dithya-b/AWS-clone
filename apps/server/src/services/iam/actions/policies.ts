import { z } from "zod";
import { transaction } from "../../../core/db";
import { AwsError } from "../../../core/errors";
import { defineAction } from "../../../core/service";
import {
  alreadyExists,
  DocumentInput,
  deleteConflict,
  formatPolicy,
  invalidInput,
  limitExceeded,
  MAX_POLICY_VERSIONS,
  noSuchEntity,
  Pagination,
  PolicyArn,
  PolicyName,
  Path,
  paginate,
  parseDocument,
} from "../common";
import { requirePolicy } from "../lookup";
import {
  addPolicyVersion,
  attachmentCount,
  deletePolicyRow,
  deletePolicyVersion,
  entitiesForPolicy,
  getPolicyVersion,
  iamArn,
  insertPolicy,
  listPolicies,
  listPolicyVersions,
  type ManagedPolicy,
  setDefaultVersion,
} from "../repo";

const VersionId = z.string().regex(/^v[1-9][0-9]*$/, "VersionId must look like v1, v2, …");

function requireCustomerManaged(policy: ManagedPolicy) {
  if (policy.accountId === null) {
    throw invalidInput(
      `${policy.arn} is an AWS managed policy. You can attach it, but you can't change or delete it.`,
    );
  }
}

const formatVersion = (v: { versionId: string; document: unknown; createdAt: string; isDefault: boolean }) => ({
  VersionId: v.versionId,
  Document: v.document,
  IsDefaultVersion: v.isDefault,
  CreateDate: v.createdAt,
});

export const policyActions = [
  defineAction({
    name: "CreatePolicy",
    iamAction: "iam:CreatePolicy",
    accessLevel: "Permissions management",
    input: z.object({
      PolicyName,
      PolicyDocument: DocumentInput,
      Path,
      Description: z.string().max(1000).optional(),
    }),
    resource: (i, ctx) => iamArn(ctx.session.accountId, "policy", i.Path, i.PolicyName),
    handler: (i, { session, deps }) => {
      const arn = iamArn(session.accountId, "policy", i.Path, i.PolicyName);
      const existing = listPolicies(deps.db, session.accountId, "Local").some(
        (p) => p.name.toLowerCase() === i.PolicyName.toLowerCase(),
      );
      if (existing) {
        throw alreadyExists(`A policy called ${i.PolicyName} already exists. Duplicate names are not allowed.`);
      }
      const document = parseDocument(deps, i.PolicyDocument, "identity");
      const policy = insertPolicy(deps.db, {
        accountId: session.accountId,
        name: i.PolicyName,
        path: i.Path,
        arn,
        description: i.Description ?? null,
        document,
        now: deps.clock.now(),
      });
      return { Policy: formatPolicy(policy, 0) };
    },
  }),

  defineAction({
    name: "GetPolicy",
    iamAction: "iam:GetPolicy",
    accessLevel: "Read",
    input: z.object({ PolicyArn }),
    resource: (i) => i.PolicyArn,
    handler: (i, ctx) => {
      const policy = requirePolicy(ctx, i.PolicyArn);
      return { Policy: formatPolicy(policy, attachmentCount(ctx.deps.db, policy.id, ctx.session.accountId)) };
    },
  }),

  defineAction({
    name: "ListPolicies",
    iamAction: "iam:ListPolicies",
    accessLevel: "List",
    input: z.object({
      Scope: z.enum(["All", "AWS", "Local"]).default("All"),
      OnlyAttached: z.boolean().default(false),
      PathPrefix: z.string().startsWith("/").default("/"),
      ...Pagination,
    }),
    handler: (i, { session, deps }) => {
      const policies = listPolicies(deps.db, session.accountId, i.Scope)
        .filter((p) => p.path.startsWith(i.PathPrefix))
        .map((p) => formatPolicy(p, attachmentCount(deps.db, p.id, session.accountId)))
        .filter((p) => !i.OnlyAttached || p.AttachmentCount > 0);
      const { items, ...page } = paginate(policies, i.Marker, i.MaxItems);
      return { Policies: items, ...page };
    },
  }),

  defineAction({
    name: "DeletePolicy",
    iamAction: "iam:DeletePolicy",
    accessLevel: "Permissions management",
    input: z.object({ PolicyArn }),
    resource: (i) => i.PolicyArn,
    handler: (i, ctx) => {
      const { db } = ctx.deps;
      const policy = requirePolicy(ctx, i.PolicyArn);
      requireCustomerManaged(policy);
      if (attachmentCount(db, policy.id, ctx.session.accountId) > 0) {
        throw deleteConflict("Cannot delete a policy attached to entities.");
      }
      if (listPolicyVersions(db, policy).length > 1) {
        throw deleteConflict(
          "This policy has more than one version. Before you delete a policy, you must delete the policy's versions. The default version is deleted with the policy.",
        );
      }
      transaction(db, () => deletePolicyRow(db, policy.id));
      return {};
    },
  }),

  defineAction({
    name: "ListEntitiesForPolicy",
    iamAction: "iam:ListEntitiesForPolicy",
    accessLevel: "List",
    input: z.object({ PolicyArn }),
    resource: (i) => i.PolicyArn,
    handler: (i, ctx) => {
      const policy = requirePolicy(ctx, i.PolicyArn);
      const e = entitiesForPolicy(ctx.deps.db, policy.id, ctx.session.accountId);
      return {
        PolicyUsers: e.users.map((u) => ({ UserName: u.name, UserId: u.id })),
        PolicyGroups: e.groups.map((g) => ({ GroupName: g.name, GroupId: g.id })),
        PolicyRoles: e.roles.map((r) => ({ RoleName: r.name, RoleId: r.id })),
        IsTruncated: false,
      };
    },
  }),

  // ---------------------------------------------------------------- versions

  defineAction({
    name: "CreatePolicyVersion",
    iamAction: "iam:CreatePolicyVersion",
    accessLevel: "Permissions management",
    input: z.object({ PolicyArn, PolicyDocument: DocumentInput, SetAsDefault: z.boolean().default(false) }),
    resource: (i) => i.PolicyArn,
    handler: (i, ctx) => {
      const { db, clock } = ctx.deps;
      const policy = requirePolicy(ctx, i.PolicyArn);
      requireCustomerManaged(policy);
      if (listPolicyVersions(db, policy).length >= MAX_POLICY_VERSIONS) {
        throw limitExceeded(
          `A managed policy can have up to ${MAX_POLICY_VERSIONS} versions. Before you create a new version, you must delete an existing version.`,
        );
      }
      const document = parseDocument(ctx.deps, i.PolicyDocument, "identity");
      const versionId = addPolicyVersion(db, policy, document, i.SetAsDefault, clock.now());
      return {
        PolicyVersion: {
          VersionId: versionId,
          IsDefaultVersion: i.SetAsDefault,
          CreateDate: clock.now().toISOString(),
        },
      };
    },
  }),

  defineAction({
    name: "GetPolicyVersion",
    iamAction: "iam:GetPolicyVersion",
    accessLevel: "Read",
    input: z.object({ PolicyArn, VersionId }),
    resource: (i) => i.PolicyArn,
    handler: (i, ctx) => {
      const policy = requirePolicy(ctx, i.PolicyArn);
      const version = getPolicyVersion(ctx.deps.db, policy, i.VersionId);
      if (!version) throw noSuchEntity(`Policy ${i.PolicyArn} version ${i.VersionId} does not exist or is not attachable.`);
      return { PolicyVersion: formatVersion(version) };
    },
  }),

  defineAction({
    name: "ListPolicyVersions",
    iamAction: "iam:ListPolicyVersions",
    accessLevel: "List",
    input: z.object({ PolicyArn }),
    resource: (i) => i.PolicyArn,
    handler: (i, ctx) => {
      const policy = requirePolicy(ctx, i.PolicyArn);
      return { Versions: listPolicyVersions(ctx.deps.db, policy).map(formatVersion), IsTruncated: false };
    },
  }),

  defineAction({
    name: "SetDefaultPolicyVersion",
    iamAction: "iam:SetDefaultPolicyVersion",
    accessLevel: "Permissions management",
    input: z.object({ PolicyArn, VersionId }),
    resource: (i) => i.PolicyArn,
    handler: (i, ctx) => {
      const policy = requirePolicy(ctx, i.PolicyArn);
      requireCustomerManaged(policy);
      if (!getPolicyVersion(ctx.deps.db, policy, i.VersionId)) {
        throw noSuchEntity(`Policy ${i.PolicyArn} version ${i.VersionId} does not exist or is not attachable.`);
      }
      setDefaultVersion(ctx.deps.db, policy.id, i.VersionId, ctx.deps.clock.now());
      return {};
    },
  }),

  defineAction({
    name: "DeletePolicyVersion",
    iamAction: "iam:DeletePolicyVersion",
    accessLevel: "Permissions management",
    input: z.object({ PolicyArn, VersionId }),
    resource: (i) => i.PolicyArn,
    handler: (i, ctx) => {
      const policy = requirePolicy(ctx, i.PolicyArn);
      requireCustomerManaged(policy);
      if (!getPolicyVersion(ctx.deps.db, policy, i.VersionId)) {
        throw noSuchEntity(`Policy ${i.PolicyArn} version ${i.VersionId} does not exist or is not attachable.`);
      }
      if (policy.defaultVersionId === i.VersionId) {
        throw new AwsError("DeleteConflict", "Cannot delete the default version of a policy.", 409);
      }
      deletePolicyVersion(ctx.deps.db, policy.id, i.VersionId);
      return {};
    },
  }),
];
