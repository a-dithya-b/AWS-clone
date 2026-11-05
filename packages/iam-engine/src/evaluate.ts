import { buildContext, normalizePolicy } from "./normalize";
import { describeStatement, statementApplies, toMatched } from "./statement";
import type { EvalRequest, Evaluation, MatchedStatement, PolicySource } from "./types";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Evaluates a request against identity-based (and optional resource-based) policies, using AWS's
 * same-account logic: any matching explicit Deny wins; otherwise any matching Allow (from either
 * an identity or a resource policy) allows; otherwise the request is implicitly denied.
 */
export function evaluate(args: {
  identityPolicies: PolicySource[];
  resourcePolicies?: PolicySource[];
  request: EvalRequest;
}): Evaluation {
  const { identityPolicies, resourcePolicies = [], request } = args;
  const context = buildContext(request.context);
  const denies: MatchedStatement[] = [];
  const allows: MatchedStatement[] = [];

  const groups: [PolicySource[], "identity" | "resource"][] = [
    [identityPolicies, "identity"],
    [resourcePolicies, "resource"],
  ];
  for (const [policies, kind] of groups) {
    for (const policy of policies) {
      const normalized = normalizePolicy(policy.document);
      for (const st of normalized.statements) {
        if (!statementApplies(st, kind, request, context, normalized.useVariables).applies)
          continue;
        (st.effect === "Deny" ? denies : allows).push(toMatched(policy, st));
      }
    }
  }

  const policiesEvaluated = [...identityPolicies, ...resourcePolicies].map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    ...(p.attachedVia ? { attachedVia: p.attachedVia } : {}),
  }));

  const [firstDeny] = denies;
  if (firstDeny) {
    const more =
      denies.length > 1
        ? ` ${plural(denies.length - 1, "other Deny statement also matches", "other Deny statements also match")}.`
        : "";
    return {
      decision: "ExplicitDeny",
      reason: `Denied explicitly by ${describeStatement(firstDeny)}. An explicit Deny always wins, even over an Allow.${more}`,
      matchedStatements: denies,
      policiesEvaluated,
    };
  }

  const [firstAllow] = allows;
  if (firstAllow) {
    const more =
      allows.length > 1
        ? ` ${plural(allows.length - 1, "other statement also allows", "other statements also allow")} it.`
        : "";
    return {
      decision: "Allow",
      reason: `Allowed by ${describeStatement(firstAllow)}.${more}`,
      matchedStatements: allows,
      policiesEvaluated,
    };
  }

  const total = policiesEvaluated.length;
  const reason =
    total === 0
      ? "No policies are attached to this identity, so every action is denied by default."
      : `None of the ${plural(total, "policy", "policies")} that apply to this identity allow ${request.action} on ${request.resource}. Everything is denied unless a policy allows it.`;
  return { decision: "ImplicitDeny", reason, matchedStatements: [], policiesEvaluated };
}
