import { compileRegex, escapeLiteral, wildcardToRegexSource } from "./match";
import type { ContextValue } from "./types";

/** A piece of a policy string after variable substitution. */
export type Segment =
  | { kind: "pattern"; text: string } // written in the policy: * and ? are wildcards
  | { kind: "literal"; text: string }; // came from ${*}, ${?}, ${$} or a variable's value

const VARIABLE = /\$\{([^}]*)\}/g;
const KEY_WITH_DEFAULT = /^\s*([^,]+?)\s*(?:,\s*'([^']*)'\s*)?$/;

function lookup(context: Record<string, ContextValue>, key: string): ContextValue | undefined {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(context)) if (k.toLowerCase() === lower) return v;
  return undefined;
}

/**
 * Splits text into segments, replacing ${...} variables. Returns null when a variable has no value
 * and no default (the element then can't match anything, like in AWS).
 */
export function expandVariables(
  text: string,
  context: Record<string, ContextValue>,
): Segment[] | null {
  const segments: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(VARIABLE)) {
    const start = m.index ?? 0;
    if (start > last) segments.push({ kind: "pattern", text: text.slice(last, start) });
    last = start + m[0].length;
    const inner = (m[1] ?? "").trim();
    if (inner === "*" || inner === "?" || inner === "$") {
      segments.push({ kind: "literal", text: inner });
      continue;
    }
    const parsed = KEY_WITH_DEFAULT.exec(inner);
    if (!parsed?.[1]) return null;
    const value = lookup(context, parsed[1]);
    if (value === undefined) {
      if (parsed[2] === undefined) return null;
      segments.push({ kind: "literal", text: parsed[2] });
    } else if (Array.isArray(value)) {
      return null;
    } else {
      segments.push({ kind: "literal", text: String(value) });
    }
  }
  if (last < text.length) segments.push({ kind: "pattern", text: text.slice(last) });
  return segments;
}

/**
 * Replaces policy variables such as ${aws:username}. Also handles ${*}, ${?} and ${$} (literal
 * characters) and ${key, 'default'}. A variable with no value and no default makes the whole
 * string unmatchable, so this returns null.
 */
export function substituteVariables(
  text: string,
  context: Record<string, ContextValue>,
): string | null {
  const segments = expandVariables(text, context);
  return segments ? segments.map((s) => s.text).join("") : null;
}

/** Matches a value against a policy string, with optional variable substitution. */
export function matchesPolicyString(
  policyText: string,
  value: string,
  opts: { caseInsensitive: boolean; useVariables: boolean; context: Record<string, ContextValue> },
): boolean {
  const segments: Segment[] | null = opts.useVariables
    ? expandVariables(policyText, opts.context)
    : [{ kind: "pattern", text: policyText }];
  if (!segments) return false;
  const source = segments
    .map((s) => (s.kind === "pattern" ? wildcardToRegexSource(s.text) : escapeLiteral(s.text)))
    .join("");
  return compileRegex(source, opts.caseInsensitive).test(value);
}

/** Like substituteVariables, but returns the text unchanged when variables are disabled. */
export function maybeSubstitute(
  text: string,
  useVariables: boolean,
  context: Record<string, ContextValue>,
): string | null {
  return useVariables ? substituteVariables(text, context) : text;
}
