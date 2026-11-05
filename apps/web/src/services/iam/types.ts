import type { PolicyDocument } from "@cloudlearn/iam-engine";
import type { EvaluationSummary } from "@cloudlearn/shared";

// Response shapes of the IAM API (mirrors apps/server/src/services/iam).

export interface IamUser {
  Path: string;
  UserName: string;
  UserId: string;
  Arn: string;
  CreateDate: string;
  PasswordLastUsed?: string;
}

export interface IamUserListItem extends IamUser {
  ConsoleAccess: boolean;
  GroupCount: number;
}

export interface IamGroup {
  Path: string;
  GroupName: string;
  GroupId: string;
  Arn: string;
  CreateDate: string;
}

export interface IamGroupListItem extends IamGroup {
  UserCount: number;
  PolicyCount: number;
}

export interface IamRole {
  Path: string;
  RoleName: string;
  RoleId: string;
  Arn: string;
  CreateDate: string;
  AssumeRolePolicyDocument: PolicyDocument;
  Description: string;
  MaxSessionDuration: number;
  RoleLastUsed?: { LastUsedDate: string; Region: string };
}

export interface IamPolicy {
  PolicyName: string;
  PolicyId: string;
  Arn: string;
  Path: string;
  DefaultVersionId: string;
  AttachmentCount: number;
  IsAttachable: boolean;
  Description: string;
  CreateDate: string;
  UpdateDate: string;
  Scope: "AWS" | "Local";
}

export interface PolicyVersion {
  VersionId: string;
  Document: PolicyDocument;
  IsDefaultVersion: boolean;
  CreateDate: string;
}

export interface AttachedPolicy {
  PolicyName: string;
  PolicyArn: string;
}

export interface Page {
  IsTruncated: boolean;
  Marker?: string;
}

export type ListUsersOutput = Page & { Users: IamUserListItem[] };
export type ListGroupsOutput = Page & { Groups: IamGroupListItem[] };
export type ListGroupsForUserOutput = Page & { Groups: IamGroup[] };
export type ListRolesOutput = Page & { Roles: IamRole[] };
export type ListPoliciesOutput = Page & { Policies: IamPolicy[] };
export type ListAttachedPoliciesOutput = Page & { AttachedPolicies: AttachedPolicy[] };
export type ListInlinePoliciesOutput = Page & { PolicyNames: string[] };
export type GetGroupOutput = Page & { Group: IamGroup; Users: IamUser[] };

export interface LoginProfile {
  UserName: string;
  CreateDate: string;
  PasswordResetRequired: boolean;
}

export interface ListEntitiesForPolicyOutput {
  PolicyUsers: { UserName: string; UserId: string }[];
  PolicyGroups: { GroupName: string; GroupId: string }[];
  PolicyRoles: { RoleName: string; RoleId: string }[];
}

export interface AccountSummary {
  SummaryMap: Record<string, number>;
}

export interface SimulationResult {
  EvalActionName: string;
  EvalResourceName: string;
  EvalDecision: "allowed" | "explicitDeny" | "implicitDeny";
  MatchedStatements: { SourcePolicyId: string; SourcePolicyType: string }[];
  Evaluation: EvaluationSummary;
}

export interface SimulationOutput {
  EvaluationResults: SimulationResult[];
}

export type PrincipalKind = "user" | "group" | "role";

export const kindLabel: Record<PrincipalKind, "User" | "Group" | "Role"> = {
  user: "User",
  group: "Group",
  role: "Role",
};

export const isAwsManaged = (arn: string) => arn.startsWith("arn:aws:iam::aws:policy/");
