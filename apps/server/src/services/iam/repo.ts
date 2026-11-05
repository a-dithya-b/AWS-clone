import type { PolicyDocument } from "@cloudlearn/iam-engine";
import { formatArn, generateIamId } from "@cloudlearn/shared";
import { all, type Db, get, run } from "../../core/db";

// Data access for IAM. Rows use snake_case; everything returned is camelCase.

export type PrincipalKind = "user" | "group" | "role";

export const iamArn = (accountId: string, kind: string, path: string, name: string) =>
  formatArn({ service: "iam", accountId, resource: `${kind}${path}${name}` });

export const awsManagedPolicyArn = (name: string) =>
  formatArn({ service: "iam", accountId: "aws", resource: `policy/${name}` });

// ---------------------------------------------------------------- users

export interface IamUser {
  id: string;
  accountId: string;
  name: string;
  path: string;
  arn: string;
  passwordHash: string | null;
  passwordResetRequired: boolean;
  passwordLastUsed: string | null;
  createdAt: string;
}

interface UserRow {
  id: string;
  account_id: string;
  name: string;
  path: string;
  arn: string;
  password_hash: string | null;
  password_reset_required: number;
  password_last_used: string | null;
  created_at: string;
}

const toUser = (r: UserRow): IamUser => ({
  id: r.id,
  accountId: r.account_id,
  name: r.name,
  path: r.path,
  arn: r.arn,
  passwordHash: r.password_hash,
  passwordResetRequired: r.password_reset_required === 1,
  passwordLastUsed: r.password_last_used,
  createdAt: r.created_at,
});

export function findUser(db: Db, accountId: string, name: string): IamUser | undefined {
  const r = get<UserRow>(db, "SELECT * FROM iam_users WHERE account_id = ? AND name = ?", accountId, name);
  return r && toUser(r);
}

export function findUserById(db: Db, id: string): IamUser | undefined {
  const r = get<UserRow>(db, "SELECT * FROM iam_users WHERE id = ?", id);
  return r && toUser(r);
}

export function listUsers(db: Db, accountId: string, pathPrefix = "/"): IamUser[] {
  return all<UserRow>(
    db,
    "SELECT * FROM iam_users WHERE account_id = ? AND path LIKE ? ORDER BY name",
    accountId,
    `${pathPrefix}%`,
  ).map(toUser);
}

export function insertUser(db: Db, accountId: string, name: string, path: string, now: Date): IamUser {
  const id = generateIamId("AIDA");
  run(
    db,
    "INSERT INTO iam_users (id, account_id, name, path, arn, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    accountId,
    name,
    path,
    iamArn(accountId, "user", path, name),
    now.toISOString(),
  );
  return findUserById(db, id) as IamUser;
}

export function setUserPassword(
  db: Db,
  userId: string,
  hash: string | null,
  resetRequired = false,
) {
  run(
    db,
    "UPDATE iam_users SET password_hash = ?, password_reset_required = ? WHERE id = ?",
    hash,
    resetRequired ? 1 : 0,
    userId,
  );
}

export function touchUserPassword(db: Db, userId: string, now: Date) {
  run(db, "UPDATE iam_users SET password_last_used = ? WHERE id = ?", now.toISOString(), userId);
}

export function deleteUserRow(db: Db, userId: string) {
  run(db, "DELETE FROM iam_users WHERE id = ?", userId);
}

// ---------------------------------------------------------------- groups

export interface IamGroup {
  id: string;
  accountId: string;
  name: string;
  path: string;
  arn: string;
  createdAt: string;
}

interface GroupRow {
  id: string;
  account_id: string;
  name: string;
  path: string;
  arn: string;
  created_at: string;
}

const toGroup = (r: GroupRow): IamGroup => ({
  id: r.id,
  accountId: r.account_id,
  name: r.name,
  path: r.path,
  arn: r.arn,
  createdAt: r.created_at,
});

export function findGroup(db: Db, accountId: string, name: string): IamGroup | undefined {
  const r = get<GroupRow>(db, "SELECT * FROM iam_groups WHERE account_id = ? AND name = ?", accountId, name);
  return r && toGroup(r);
}

export function listGroups(db: Db, accountId: string, pathPrefix = "/"): IamGroup[] {
  return all<GroupRow>(
    db,
    "SELECT * FROM iam_groups WHERE account_id = ? AND path LIKE ? ORDER BY name",
    accountId,
    `${pathPrefix}%`,
  ).map(toGroup);
}

export function insertGroup(db: Db, accountId: string, name: string, path: string, now: Date): IamGroup {
  const id = generateIamId("AGPA");
  run(
    db,
    "INSERT INTO iam_groups (id, account_id, name, path, arn, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    accountId,
    name,
    path,
    iamArn(accountId, "group", path, name),
    now.toISOString(),
  );
  return toGroup(get<GroupRow>(db, "SELECT * FROM iam_groups WHERE id = ?", id) as GroupRow);
}

export function deleteGroupRow(db: Db, groupId: string) {
  run(db, "DELETE FROM iam_groups WHERE id = ?", groupId);
}

export function groupsForUser(db: Db, userId: string): IamGroup[] {
  return all<GroupRow>(
    db,
    `SELECT g.* FROM iam_groups g JOIN iam_group_members m ON m.group_id = g.id
     WHERE m.user_id = ? ORDER BY g.name`,
    userId,
  ).map(toGroup);
}

export function usersInGroup(db: Db, groupId: string): IamUser[] {
  return all<UserRow>(
    db,
    `SELECT u.* FROM iam_users u JOIN iam_group_members m ON m.user_id = u.id
     WHERE m.group_id = ? ORDER BY u.name`,
    groupId,
  ).map(toUser);
}

export function addMember(db: Db, groupId: string, userId: string, now: Date) {
  run(
    db,
    "INSERT OR IGNORE INTO iam_group_members (group_id, user_id, added_at) VALUES (?, ?, ?)",
    groupId,
    userId,
    now.toISOString(),
  );
}

export function removeMember(db: Db, groupId: string, userId: string) {
  run(db, "DELETE FROM iam_group_members WHERE group_id = ? AND user_id = ?", groupId, userId);
}

// ---------------------------------------------------------------- roles

export interface IamRole {
  id: string;
  accountId: string;
  name: string;
  path: string;
  arn: string;
  description: string | null;
  trustPolicy: PolicyDocument;
  maxSessionDuration: number;
  lastUsedAt: string | null;
  createdAt: string;
}

interface RoleRow {
  id: string;
  account_id: string;
  name: string;
  path: string;
  arn: string;
  description: string | null;
  trust_policy: string;
  max_session_duration: number;
  last_used_at: string | null;
  created_at: string;
}

const toRole = (r: RoleRow): IamRole => ({
  id: r.id,
  accountId: r.account_id,
  name: r.name,
  path: r.path,
  arn: r.arn,
  description: r.description,
  trustPolicy: JSON.parse(r.trust_policy),
  maxSessionDuration: r.max_session_duration,
  lastUsedAt: r.last_used_at,
  createdAt: r.created_at,
});

export function findRole(db: Db, accountId: string, name: string): IamRole | undefined {
  const r = get<RoleRow>(db, "SELECT * FROM iam_roles WHERE account_id = ? AND name = ?", accountId, name);
  return r && toRole(r);
}

export function findRoleById(db: Db, id: string): IamRole | undefined {
  const r = get<RoleRow>(db, "SELECT * FROM iam_roles WHERE id = ?", id);
  return r && toRole(r);
}

export function listRoles(db: Db, accountId: string, pathPrefix = "/"): IamRole[] {
  return all<RoleRow>(
    db,
    "SELECT * FROM iam_roles WHERE account_id = ? AND path LIKE ? ORDER BY name",
    accountId,
    `${pathPrefix}%`,
  ).map(toRole);
}

export function insertRole(
  db: Db,
  input: {
    accountId: string;
    name: string;
    path: string;
    description: string | null;
    trustPolicy: PolicyDocument;
    maxSessionDuration: number;
    now: Date;
  },
): IamRole {
  const id = generateIamId("AROA");
  run(
    db,
    `INSERT INTO iam_roles (id, account_id, name, path, arn, description, trust_policy,
       max_session_duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.accountId,
    input.name,
    input.path,
    iamArn(input.accountId, "role", input.path, input.name),
    input.description,
    JSON.stringify(input.trustPolicy),
    input.maxSessionDuration,
    input.now.toISOString(),
  );
  return findRoleById(db, id) as IamRole;
}

export function updateRole(
  db: Db,
  roleId: string,
  fields: { description?: string | null; maxSessionDuration?: number; trustPolicy?: PolicyDocument },
) {
  if (fields.description !== undefined)
    run(db, "UPDATE iam_roles SET description = ? WHERE id = ?", fields.description, roleId);
  if (fields.maxSessionDuration !== undefined)
    run(db, "UPDATE iam_roles SET max_session_duration = ? WHERE id = ?", fields.maxSessionDuration, roleId);
  if (fields.trustPolicy !== undefined)
    run(db, "UPDATE iam_roles SET trust_policy = ? WHERE id = ?", JSON.stringify(fields.trustPolicy), roleId);
}

export function touchRole(db: Db, roleId: string, now: Date) {
  run(db, "UPDATE iam_roles SET last_used_at = ? WHERE id = ?", now.toISOString(), roleId);
}

export function deleteRoleRow(db: Db, roleId: string) {
  run(db, "DELETE FROM iam_roles WHERE id = ?", roleId);
}

// ---------------------------------------------------------------- managed policies

export interface ManagedPolicy {
  id: string;
  /** null for AWS-managed policies. */
  accountId: string | null;
  name: string;
  path: string;
  arn: string;
  description: string | null;
  defaultVersionId: string;
  nextVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface PolicyRow {
  id: string;
  account_id: string | null;
  name: string;
  path: string;
  arn: string;
  description: string | null;
  default_version_id: string;
  next_version: number;
  created_at: string;
  updated_at: string;
}

const toPolicy = (r: PolicyRow): ManagedPolicy => ({
  id: r.id,
  accountId: r.account_id,
  name: r.name,
  path: r.path,
  arn: r.arn,
  description: r.description,
  defaultVersionId: r.default_version_id,
  nextVersion: r.next_version,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Finds a policy by ARN that `accountId` can see: AWS-managed, or its own. */
export function findPolicy(db: Db, accountId: string, arn: string): ManagedPolicy | undefined {
  const r = get<PolicyRow>(
    db,
    "SELECT * FROM iam_policies WHERE arn = ? AND (account_id IS NULL OR account_id = ?)",
    arn,
    accountId,
  );
  return r && toPolicy(r);
}

export function findPolicyById(db: Db, id: string): ManagedPolicy | undefined {
  const r = get<PolicyRow>(db, "SELECT * FROM iam_policies WHERE id = ?", id);
  return r && toPolicy(r);
}

export function listPolicies(
  db: Db,
  accountId: string,
  scope: "All" | "AWS" | "Local",
): ManagedPolicy[] {
  const where =
    scope === "AWS"
      ? "account_id IS NULL"
      : scope === "Local"
        ? "account_id = ?"
        : "(account_id IS NULL OR account_id = ?)";
  const params = scope === "AWS" ? [] : [accountId];
  return all<PolicyRow>(db, `SELECT * FROM iam_policies WHERE ${where} ORDER BY name`, ...params).map(
    toPolicy,
  );
}

export function insertPolicy(
  db: Db,
  input: {
    id?: string;
    accountId: string | null;
    name: string;
    path: string;
    arn: string;
    description: string | null;
    document: PolicyDocument;
    now: Date;
  },
): ManagedPolicy {
  const id = input.id ?? generateIamId("ANPA");
  const now = input.now.toISOString();
  run(
    db,
    `INSERT INTO iam_policies (id, account_id, name, path, arn, description, default_version_id,
       next_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'v1', 2, ?, ?)`,
    id,
    input.accountId,
    input.name,
    input.path,
    input.arn,
    input.description,
    now,
    now,
  );
  run(
    db,
    "INSERT INTO iam_policy_versions (policy_id, version_id, document, created_at) VALUES (?, 'v1', ?, ?)",
    id,
    JSON.stringify(input.document),
    now,
  );
  return findPolicyById(db, id) as ManagedPolicy;
}

export interface PolicyVersion {
  versionId: string;
  document: PolicyDocument;
  createdAt: string;
  isDefault: boolean;
}

export function listPolicyVersions(db: Db, policy: ManagedPolicy): PolicyVersion[] {
  return all<{ version_id: string; document: string; created_at: string }>(
    db,
    "SELECT * FROM iam_policy_versions WHERE policy_id = ? ORDER BY CAST(SUBSTR(version_id, 2) AS INTEGER) DESC",
    policy.id,
  ).map((r) => ({
    versionId: r.version_id,
    document: JSON.parse(r.document),
    createdAt: r.created_at,
    isDefault: r.version_id === policy.defaultVersionId,
  }));
}

export function getPolicyVersion(db: Db, policy: ManagedPolicy, versionId: string): PolicyVersion | undefined {
  return listPolicyVersions(db, policy).find((v) => v.versionId === versionId);
}

export function defaultDocument(db: Db, policy: ManagedPolicy): PolicyDocument {
  return (getPolicyVersion(db, policy, policy.defaultVersionId) as PolicyVersion).document;
}

export function addPolicyVersion(
  db: Db,
  policy: ManagedPolicy,
  document: PolicyDocument,
  setAsDefault: boolean,
  now: Date,
): string {
  const versionId = `v${policy.nextVersion}`;
  run(
    db,
    "INSERT INTO iam_policy_versions (policy_id, version_id, document, created_at) VALUES (?, ?, ?, ?)",
    policy.id,
    versionId,
    JSON.stringify(document),
    now.toISOString(),
  );
  run(
    db,
    `UPDATE iam_policies SET next_version = next_version + 1, updated_at = ?
       ${setAsDefault ? ", default_version_id = ?" : ""} WHERE id = ?`,
    now.toISOString(),
    ...(setAsDefault ? [versionId] : []),
    policy.id,
  );
  return versionId;
}

export function setDefaultVersion(db: Db, policyId: string, versionId: string, now: Date) {
  run(
    db,
    "UPDATE iam_policies SET default_version_id = ?, updated_at = ? WHERE id = ?",
    versionId,
    now.toISOString(),
    policyId,
  );
}

export function deletePolicyVersion(db: Db, policyId: string, versionId: string) {
  run(db, "DELETE FROM iam_policy_versions WHERE policy_id = ? AND version_id = ?", policyId, versionId);
}

/** Replaces the default version's document in place. Only used to refresh AWS-managed seeds. */
export function overwriteDefaultDocument(db: Db, policy: ManagedPolicy, document: PolicyDocument) {
  run(
    db,
    "UPDATE iam_policy_versions SET document = ? WHERE policy_id = ? AND version_id = ?",
    JSON.stringify(document),
    policy.id,
    policy.defaultVersionId,
  );
}

export function deletePolicyRow(db: Db, policyId: string) {
  run(db, "DELETE FROM iam_policies WHERE id = ?", policyId);
}

// ---------------------------------------------------------------- attachments

export function attachedPolicies(db: Db, kind: PrincipalKind, principalId: string): ManagedPolicy[] {
  return all<PolicyRow>(
    db,
    `SELECT p.* FROM iam_policies p JOIN iam_policy_attachments a ON a.policy_id = p.id
     WHERE a.principal_type = ? AND a.principal_id = ? ORDER BY p.name`,
    kind,
    principalId,
  ).map(toPolicy);
}

export function attach(db: Db, accountId: string, policyId: string, kind: PrincipalKind, principalId: string, now: Date) {
  run(
    db,
    `INSERT OR IGNORE INTO iam_policy_attachments (policy_id, account_id, principal_type, principal_id, attached_at)
     VALUES (?, ?, ?, ?, ?)`,
    policyId,
    accountId,
    kind,
    principalId,
    now.toISOString(),
  );
}

export function detach(db: Db, policyId: string, kind: PrincipalKind, principalId: string) {
  run(
    db,
    "DELETE FROM iam_policy_attachments WHERE policy_id = ? AND principal_type = ? AND principal_id = ?",
    policyId,
    kind,
    principalId,
  );
}

export function attachmentCount(db: Db, policyId: string, accountId: string): number {
  return (
    get<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM iam_policy_attachments WHERE policy_id = ? AND account_id = ?",
      policyId,
      accountId,
    )?.n ?? 0
  );
}

export interface PolicyEntities {
  users: IamUser[];
  groups: IamGroup[];
  roles: IamRole[];
}

export function entitiesForPolicy(db: Db, policyId: string, accountId: string): PolicyEntities {
  const ids = (kind: PrincipalKind) =>
    all<{ principal_id: string }>(
      db,
      "SELECT principal_id FROM iam_policy_attachments WHERE policy_id = ? AND account_id = ? AND principal_type = ?",
      policyId,
      accountId,
      kind,
    ).map((r) => r.principal_id);
  return {
    users: ids("user").map((id) => findUserById(db, id)).filter((u): u is IamUser => !!u),
    groups: ids("group")
      .map((id) => get<GroupRow>(db, "SELECT * FROM iam_groups WHERE id = ?", id))
      .filter((g): g is GroupRow => !!g)
      .map(toGroup),
    roles: ids("role").map((id) => findRoleById(db, id)).filter((r): r is IamRole => !!r),
  };
}

// ---------------------------------------------------------------- inline policies

export interface InlinePolicy {
  name: string;
  document: PolicyDocument;
  createdAt: string;
}

export function inlinePolicies(db: Db, kind: PrincipalKind, principalId: string): InlinePolicy[] {
  return all<{ name: string; document: string; created_at: string }>(
    db,
    "SELECT name, document, created_at FROM iam_inline_policies WHERE principal_type = ? AND principal_id = ? ORDER BY name",
    kind,
    principalId,
  ).map((r) => ({ name: r.name, document: JSON.parse(r.document), createdAt: r.created_at }));
}

export function putInline(
  db: Db,
  accountId: string,
  kind: PrincipalKind,
  principalId: string,
  name: string,
  document: PolicyDocument,
  now: Date,
) {
  run(
    db,
    `INSERT INTO iam_inline_policies (account_id, principal_type, principal_id, name, document, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (principal_type, principal_id, name) DO UPDATE SET document = excluded.document`,
    accountId,
    kind,
    principalId,
    name,
    JSON.stringify(document),
    now.toISOString(),
  );
}

export function deleteInline(db: Db, kind: PrincipalKind, principalId: string, name: string) {
  run(
    db,
    "DELETE FROM iam_inline_policies WHERE principal_type = ? AND principal_id = ? AND name = ?",
    kind,
    principalId,
    name,
  );
}

export function deleteAllForPrincipal(db: Db, kind: PrincipalKind, principalId: string) {
  run(db, "DELETE FROM iam_inline_policies WHERE principal_type = ? AND principal_id = ?", kind, principalId);
  run(db, "DELETE FROM iam_policy_attachments WHERE principal_type = ? AND principal_id = ?", kind, principalId);
}

// ---------------------------------------------------------------- account summary

export function countFor(db: Db, table: string, accountId: string): number {
  return get<{ n: number }>(db, `SELECT COUNT(*) AS n FROM ${table} WHERE account_id = ?`, accountId)?.n ?? 0;
}
