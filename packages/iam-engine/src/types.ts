// Types for IAM policy documents and their evaluation. Mirrors the AWS policy grammar:
// https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_grammar.html

export type Effect = "Allow" | "Deny";
export type Decision = "Allow" | "ExplicitDeny" | "ImplicitDeny";

export type PrincipalBlock =
  | "*"
  | { AWS?: string | string[]; Service?: string | string[]; Federated?: string | string[] };

/** Operator → condition key → value(s), e.g. { "StringEquals": { "aws:username": "alice" } } */
export type ConditionBlock = Record<string, Record<string, unknown>>;

export interface Statement {
  Sid?: string;
  Effect: Effect;
  Principal?: PrincipalBlock;
  NotPrincipal?: PrincipalBlock;
  Action?: string | string[];
  NotAction?: string | string[];
  Resource?: string | string[];
  NotResource?: string | string[];
  Condition?: ConditionBlock;
}

export interface PolicyDocument {
  Version?: string;
  Id?: string;
  Statement: Statement | Statement[];
}

/**
 * identity: attached to a user, group or role (Principal not allowed, Resource required).
 * resource: attached to a resource such as a bucket or queue (Principal required).
 * trust: a role's AssumeRole policy (Principal required, Resource not allowed).
 */
export type PolicyKind = "identity" | "resource" | "trust";

export interface PolicyIssue {
  severity: "error" | "warning";
  /** AWS-style message, e.g. "Policy document should not specify a principal." */
  message: string;
  /** Where in the document, e.g. "Statement[0].Action[1]". Empty for the whole document. */
  path: string;
}

export interface ValidationResult {
  /** True when there are no "error" issues. Warnings don't make a policy invalid. */
  valid: boolean;
  issues: PolicyIssue[];
  /** The parsed document, when the input was valid JSON with the right shape. */
  document?: PolicyDocument;
}

export interface ValidateOptions {
  kind: PolicyKind;
  /**
   * Actions CloudLearn simulates, e.g. ["sqs:SendMessage", ...]. When given, the validator warns
   * about actions that match nothing in a simulated service, and about services CloudLearn
   * doesn't simulate.
   */
  catalog?: ActionCatalogEntry[];
}

export type PolicySourceType =
  | "aws-managed"
  | "customer-managed"
  | "inline"
  | "resource-based"
  | "trust";

/** One policy that takes part in an evaluation, with where it came from. */
export interface PolicySource {
  /** The policy ARN for managed policies; a readable ID for inline ones. */
  id: string;
  name: string;
  type: PolicySourceType;
  /** How it applies to the principal, e.g. "user/alice" or "group/developers". */
  attachedVia?: string;
  document: PolicyDocument;
}

export type ContextValue = string | string[] | boolean | number;

export interface EvalRequest {
  /** e.g. arn:aws:iam::123456789012:user/alice or arn:aws:sts::123456789012:assumed-role/R/s */
  principalArn: string;
  /** Account that owns the principal. */
  principalAccount: string;
  /** e.g. "sqs:SendMessage" */
  action: string;
  /** Target resource ARN, or "*". */
  resource: string;
  /**
   * Condition keys and policy-variable values, e.g. { "aws:username": "alice" }.
   * Key lookup is case-insensitive, like AWS.
   */
  context?: Record<string, ContextValue>;
}

export interface MatchedStatement {
  policyId: string;
  policyName: string;
  policyType: PolicySourceType;
  attachedVia?: string;
  statementIndex: number;
  sid?: string;
  effect: Effect;
  statement: Statement;
}

export interface EvaluatedPolicy {
  id: string;
  name: string;
  type: PolicySourceType;
  attachedVia?: string;
}

export interface Evaluation {
  decision: Decision;
  /** One or two plain-English sentences explaining the decision, for learners. */
  reason: string;
  /**
   * The statements that decided the outcome: every matching Deny for ExplicitDeny, every matching
   * Allow for Allow, empty for ImplicitDeny.
   */
  matchedStatements: MatchedStatement[];
  /** Every policy that was considered. */
  policiesEvaluated: EvaluatedPolicy[];
}

export interface TrustEvaluation extends Evaluation {
  /**
   * True when the Allow names the caller's exact ARN (not "*" or the account root). In AWS, a
   * same-account caller named this way doesn't also need sts:AssumeRole in its identity policies.
   */
  principalNamedExplicitly: boolean;
}

export type AccessLevel = "List" | "Read" | "Write" | "Permissions management" | "Tagging";

export interface ActionCatalogEntry {
  /** e.g. "sqs:SendMessage" */
  action: string;
  /** e.g. "sqs" */
  service: string;
  /** e.g. "Simple Queue Service" */
  serviceName: string;
  accessLevel: AccessLevel;
}

export interface ServiceSummary {
  service: string;
  serviceName: string;
  effect: Effect;
  /** "Full access" when every catalog action of the service is matched. */
  access: "Full access" | "Limited";
  levels: { level: AccessLevel; actions: string[]; total: number }[];
  /** Resource patterns from the matching statements ("All resources" is "*"). */
  resources: string[];
  /** True when any contributing statement has a Condition. */
  hasConditions: boolean;
}

export interface PolicySummary {
  entries: ServiceSummary[];
  /** Services named in the policy that CloudLearn doesn't simulate. */
  unsupportedServices: string[];
}
