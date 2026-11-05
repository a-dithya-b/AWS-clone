import { buildContext, normalizePolicy } from "./normalize";
import { describeStatement, statementApplies, toMatched } from "./statement";
import type { EvalRequest, MatchedStatement, PolicySource, TrustEvaluation } from "./types";

/** Evaluates a role's trust policy for sts:AssumeRole by the request's principal. */
export function evaluateTrustPolicy(args: {
  trustPolicy: PolicySource;
  request: EvalRequest;
}): TrustEvaluation {
  const { trustPolicy, request } = args;
  const context = buildContext(request.context);
  const normalized = normalizePolicy(trustPolicy.document);
  const denies: MatchedStatement[] = [];
  const allows: MatchedStatement[] = [];
  let principalNamedExplicitly = false;

  for (const st of normalized.statements) {
    const result = statementApplies(st, "trust", request, context, normalized.useVariables);
    if (!result.applies) continue;
    if (st.effect === "Deny") denies.push(toMatched(trustPolicy, st));
    else {
      allows.push(toMatched(trustPolicy, st));
      if (result.explicitPrincipal) principalNamedExplicitly = true;
    }
  }

  const policiesEvaluated = [
    {
      id: trustPolicy.id,
      name: trustPolicy.name,
      type: trustPolicy.type,
      ...(trustPolicy.attachedVia ? { attachedVia: trustPolicy.attachedVia } : {}),
    },
  ];
  const who = request.principalArn;

  const [firstDeny] = denies;
  if (firstDeny) {
    return {
      decision: "ExplicitDeny",
      reason: `The role's trust policy explicitly denies ${who} (${describeStatement(firstDeny)}). An explicit Deny always wins.`,
      matchedStatements: denies,
      policiesEvaluated,
      principalNamedExplicitly: false,
    };
  }
  const [firstAllow] = allows;
  if (firstAllow) {
    const extra = principalNamedExplicitly
      ? "It names this identity directly, so no extra identity permission is needed."
      : "It trusts the whole account, so the identity also needs sts:AssumeRole permission from its own policies.";
    return {
      decision: "Allow",
      reason: `The role's trust policy allows ${who} to assume it (${describeStatement(firstAllow)}). ${extra}`,
      matchedStatements: allows,
      policiesEvaluated,
      principalNamedExplicitly,
    };
  }
  return {
    decision: "ImplicitDeny",
    reason: `The role's trust policy doesn't allow ${who} to assume it.`,
    matchedStatements: [],
    policiesEvaluated,
    principalNamedExplicitly: false,
  };
}
