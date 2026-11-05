import { evaluateConditions } from "./conditions";
import { matchesPattern } from "./match";
import type { LookupContext, NormalizedStatement } from "./normalize";
import { matchPrincipal, type PrincipalMatch } from "./principal";
import type { ContextValue, EvalRequest, MatchedStatement, PolicySource } from "./types";
import { matchesPolicyString } from "./variables";

export type StatementKind = "identity" | "resource" | "trust";

export function actionMatches(st: NormalizedStatement, action: string): boolean {
  if (st.action) return st.action.some((p) => matchesPattern(p, action, { caseInsensitive: true }));
  if (st.notAction)
    return !st.notAction.some((p) => matchesPattern(p, action, { caseInsensitive: true }));
  return false;
}

function resourceMatches(
  st: NormalizedStatement,
  resource: string,
  useVariables: boolean,
  context: Record<string, ContextValue>,
): boolean {
  const opts = { caseInsensitive: false, useVariables, context };
  if (st.resource) return st.resource.some((p) => matchesPolicyString(p, resource, opts));
  if (st.notResource) return !st.notResource.some((p) => matchesPolicyString(p, resource, opts));
  return false;
}

function principalApplies(st: NormalizedStatement, request: EvalRequest): PrincipalMatch {
  if (st.principal !== undefined) return matchPrincipal(st.principal, request);
  if (st.notPrincipal !== undefined) {
    const m = matchPrincipal(st.notPrincipal, request);
    return { matches: !m.matches, explicit: false };
  }
  return { matches: false, explicit: false };
}

/** Whether a statement applies to the request. For resource and trust kinds, also the principal. */
export function statementApplies(
  st: NormalizedStatement,
  kind: StatementKind,
  request: EvalRequest,
  context: LookupContext,
  useVariables: boolean,
): { applies: boolean; explicitPrincipal: boolean } {
  const no = { applies: false, explicitPrincipal: false };
  if (!actionMatches(st, request.action)) return no;
  const rawContext = Object.fromEntries(context);
  if (kind !== "trust" && !resourceMatches(st, request.resource, useVariables, rawContext))
    return no;
  let explicitPrincipal = false;
  if (kind !== "identity") {
    const p = principalApplies(st, request);
    if (!p.matches) return no;
    explicitPrincipal = p.explicit;
  }
  if (!evaluateConditions(st.condition, context, useVariables)) return no;
  return { applies: true, explicitPrincipal };
}

export function toMatched(policy: PolicySource, st: NormalizedStatement): MatchedStatement {
  return {
    policyId: policy.id,
    policyName: policy.name,
    policyType: policy.type,
    ...(policy.attachedVia ? { attachedVia: policy.attachedVia } : {}),
    statementIndex: st.index,
    ...(st.sid ? { sid: st.sid } : {}),
    effect: st.effect,
    statement: st.raw,
  };
}

/** e.g. `statement "DenyQueues" in policy "NoSqs" (attached via group/devs)` */
export function describeStatement(m: MatchedStatement): string {
  const kind =
    m.policyType === "inline"
      ? "inline policy"
      : m.policyType === "resource-based"
        ? "resource-based policy"
        : m.policyType === "trust"
          ? "trust policy"
          : "policy";
  const where = m.sid
    ? `statement "${m.sid}" in ${kind} "${m.policyName}"`
    : `${kind} "${m.policyName}"`;
  return m.attachedVia ? `${where} (attached via ${m.attachedVia})` : where;
}
