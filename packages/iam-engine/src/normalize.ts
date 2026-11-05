import type { ContextValue, PolicyDocument, PrincipalBlock, Statement } from "./types";

/** Turns a string-or-array policy element into an array. Missing → undefined. */
export function toArray<T>(value: T | T[] | undefined): T[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

export interface NormalizedStatement {
  index: number;
  sid?: string;
  effect: "Allow" | "Deny";
  action?: string[];
  notAction?: string[];
  resource?: string[];
  notResource?: string[];
  principal?: PrincipalBlock;
  notPrincipal?: PrincipalBlock;
  condition?: Statement["Condition"];
  raw: Statement;
}

export interface NormalizedPolicy {
  /** Policy variables like ${aws:username} only work with Version 2012-10-17. */
  useVariables: boolean;
  statements: NormalizedStatement[];
}

const strings = (v: unknown): string[] | undefined => {
  const arr = toArray(v as string | string[] | undefined);
  return arr?.filter((x): x is string => typeof x === "string");
};

export function normalizePolicy(doc: PolicyDocument): NormalizedPolicy {
  const raw = toArray(doc?.Statement) ?? [];
  const statements: NormalizedStatement[] = [];
  raw.forEach((st, index) => {
    if (!st || typeof st !== "object") return;
    statements.push({
      index,
      sid: typeof st.Sid === "string" ? st.Sid : undefined,
      effect: st.Effect === "Deny" ? "Deny" : "Allow",
      action: strings(st.Action),
      notAction: strings(st.NotAction),
      resource: strings(st.Resource),
      notResource: strings(st.NotResource),
      principal: st.Principal,
      notPrincipal: st.NotPrincipal,
      condition: st.Condition,
      raw: st,
    });
  });
  return { useVariables: doc?.Version === "2012-10-17", statements };
}

/** Context with lowercased keys, because AWS condition keys are case-insensitive. */
export type LookupContext = Map<string, ContextValue>;

export function buildContext(context: Record<string, ContextValue> | undefined): LookupContext {
  const map: LookupContext = new Map();
  for (const [k, v] of Object.entries(context ?? {})) map.set(k.toLowerCase(), v);
  return map;
}
