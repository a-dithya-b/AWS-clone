import type { EvaluationSummary } from "@cloudlearn/shared";
import type { Session } from "./sessions";

export interface AuthorizationRequest {
  session: Session;
  /** IAM action, e.g. "sqs:SendMessage". */
  action: string;
  /** Target resource ARN, or "*". */
  resource: string;
}

/** Decides whether a principal may perform an action. The IAM module provides the real one. */
export interface Authorizer {
  authorize(request: AuthorizationRequest): EvaluationSummary;
}

/**
 * The Phase 1 authorizer. The root user can do anything in its own account (true in AWS too), and
 * any other principal is denied by default. The IAM module replaces this with policy evaluation.
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
