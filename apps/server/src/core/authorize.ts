import type { ContextValue, PolicySource } from "@cloudlearn/iam-engine";
import type { EvaluationSummary } from "@cloudlearn/shared";
import type { Session } from "./sessions";

export interface AuthorizationRequest {
  session: Session;
  /** IAM action, e.g. "sqs:SendMessage". */
  action: string;
  /** Target resource ARN, or "*". */
  resource: string;
  /** Owner of the resource when its ARN has no account (S3). */
  resourceAccount?: string;
  /** Resource-based policies that also apply (e.g. a bucket policy). */
  resourcePolicies?: PolicySource[];
  /** Extra, service-specific condition keys. */
  conditionKeys?: Record<string, ContextValue>;
  /**
   * Check only the caller's identity-based policies, even for another account's resource. Used by
   * AssumeRole, which checks the role's trust policy separately.
   */
  identityOnly?: boolean;
}

/** Decides whether a principal may perform an action. The IAM module provides the real one. */
export interface Authorizer {
  authorize(request: AuthorizationRequest): EvaluationSummary;
}

/**
 * The fallback authorizer, used by tests that don't need IAM. The root user can do anything in its
 * own account (true in AWS too), and any other principal is denied by default.
 */
export const rootOnlyAuthorizer: Authorizer = {
  authorize({ session }) {
    if (session.principal.type === "root") {
      return {
        decision: "Allow",
        reason: "The root user has full access to every resource in its own account.",
        matchedStatements: [],
      };
    }
    return {
      decision: "ImplicitDeny",
      reason: "No policy allows this action, so it is denied by default.",
      matchedStatements: [],
    };
  },
};
