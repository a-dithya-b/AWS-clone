import { type PolicyDocument, type PolicyKind, validatePolicy } from "@cloudlearn/iam-engine";
import { z } from "zod";
import { buildCatalog } from "../../core/catalog";
import { AwsError } from "../../core/errors";
import type { CoreDeps } from "../../core/service";
import type { IamGroup, IamRole, IamUser, ManagedPolicy } from "./repo";

// ---------------------------------------------------------------- input rules (from the IAM API reference)

const NAME_CHARS = /^[\w+=,.@-]+$/;
const nameRule = (label: string, max: number) =>
  z
    .string()
    .min(1, `${label} must not be empty.`)
    .max(max, `${label} must be ${max} characters or fewer.`)
    .regex(NAME_CHARS, `${label} can only contain letters, numbers and the characters +=,.@-_`);

export const UserName = nameRule("UserName", 64);
export const GroupName = nameRule("GroupName", 128);
export const RoleName = nameRule("RoleName", 64);
export const PolicyName = nameRule("PolicyName", 128);

export const Path = z
  .string()
  .max(512)
  .regex(/^\/([\x21-\x7E]*\/)?$/, "Path must begin and end with a forward slash (/).")
  .default("/");

export const PolicyArn = z.string().min(20).max(2048).startsWith("arn:aws:iam::", "PolicyArn must be an IAM policy ARN.");

/** A policy document, given as a JSON string (like the AWS API) or as an object. */
export const DocumentInput = z.union([z.string().min(1).max(131072), z.record(z.string(), z.unknown())]);

export const Pagination = {
  Marker: z.string().regex(/^\d+$/, "Marker is not valid.").optional(),
  MaxItems: z.number().int().min(1).max(1000).default(100),
};

export function paginate<T>(items: T[], marker: string | undefined, maxItems: number) {
  const start = marker ? Number(marker) : 0;
  const page = items.slice(start, start + maxItems);
  const next = start + maxItems;
  return next < items.length
    ? { items: page, IsTruncated: true as const, Marker: String(next) }
    : { items: page, IsTruncated: false as const };
}

// ---------------------------------------------------------------- errors (AWS codes and wording)

export const noSuchEntity = (message: string) => new AwsError("NoSuchEntity", message, 404);
export const alreadyExists = (message: string) => new AwsError("EntityAlreadyExists", message, 409);
export const deleteConflict = (message: string) => new AwsError("DeleteConflict", message, 409);
export const limitExceeded = (message: string) => new AwsError("LimitExceeded", message, 409);
export const invalidInput = (message: string) => new AwsError("InvalidInput", message, 400);

/** Max managed policies attached to one user, group or role (the AWS default quota). */
export const MAX_ATTACHED_POLICIES = 10;
export const MAX_POLICY_VERSIONS = 5;
export const MAX_GROUPS_PER_USER = 10;

/**
 * Validates a policy and returns the parsed document, or throws MalformedPolicyDocument with
 * the first error, as IAM does.
 */
export function parseDocument(deps: CoreDeps, input: unknown, kind: PolicyKind): PolicyDocument {
  const result = validatePolicy(input, { kind, catalog: buildCatalog(deps.services) });
  const firstError = result.issues.find((i) => i.severity === "error");
  if (!result.valid || !result.document) {
    throw new AwsError(
      "MalformedPolicyDocument",
      firstError ? firstError.message : "Syntax errors in policy.",
      400,
    );
  }
  return result.document;
}

// ---------------------------------------------------------------- response shapes (as the IAM API returns them)

export const formatUser = (u: IamUser) => ({
  Path: u.path,
  UserName: u.name,
  UserId: u.id,
  Arn: u.arn,
  CreateDate: u.createdAt,
  ...(u.passwordLastUsed ? { PasswordLastUsed: u.passwordLastUsed } : {}),
});

export const formatGroup = (g: IamGroup) => ({
  Path: g.path,
  GroupName: g.name,
  GroupId: g.id,
  Arn: g.arn,
  CreateDate: g.createdAt,
});

export const formatRole = (r: IamRole) => ({
  Path: r.path,
  RoleName: r.name,
  RoleId: r.id,
  Arn: r.arn,
  CreateDate: r.createdAt,
  AssumeRolePolicyDocument: r.trustPolicy,
  Description: r.description ?? "",
  MaxSessionDuration: r.maxSessionDuration,
  ...(r.lastUsedAt ? { RoleLastUsed: { LastUsedDate: r.lastUsedAt, Region: "us-east-1" } } : {}),
});

export const formatPolicy = (p: ManagedPolicy, attachmentCount: number) => ({
  PolicyName: p.name,
  PolicyId: p.id,
  Arn: p.arn,
  Path: p.path,
  DefaultVersionId: p.defaultVersionId,
  AttachmentCount: attachmentCount,
  IsAttachable: true,
  Description: p.description ?? "",
  CreateDate: p.createdAt,
  UpdateDate: p.updatedAt,
  /** CloudLearn addition: who manages the policy. */
  Scope: p.accountId === null ? ("AWS" as const) : ("Local" as const),
});
