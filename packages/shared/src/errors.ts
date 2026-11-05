export type Decision = "Allow" | "ExplicitDeny" | "ImplicitDeny";

/** What the evaluator found. CloudLearn adds this to AccessDenied errors to teach *why*. */
export interface EvaluationSummary {
  decision: Decision;
  reason: string;
  matchedStatements: unknown[];
}

/** The JSON body of every API error. `code` and `message` follow AWS; the rest is CloudLearn's. */
export interface ApiErrorBody {
  code: string;
  message: string;
  evaluation?: EvaluationSummary;
}

/** Builds the same AccessDenied wording AWS uses. */
export function accessDeniedMessage(args: {
  principalArn: string;
  action: string;
  resource: string;
  decision: Exclude<Decision, "Allow">;
}): string {
  const base = `User: ${args.principalArn} is not authorized to perform: ${args.action} on resource: ${args.resource}`;
  return args.decision === "ExplicitDeny"
    ? `${base} with an explicit deny in an identity-based policy`
    : `${base} because no identity-based policy allows the ${args.action} action`;
}
