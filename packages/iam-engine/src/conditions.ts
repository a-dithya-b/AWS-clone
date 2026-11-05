import { matchesPattern } from "./match";
import type { LookupContext } from "./normalize";
import type { ConditionBlock, ContextValue } from "./types";
import { substituteVariables } from "./variables";

type Matcher = (contextValue: string, policyValue: string) => boolean;

interface BaseOperator {
  /** The positive comparison. Negated operators pass when it does NOT match. */
  match: Matcher;
  negated: boolean;
}

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));

function parseDate(s: string): number {
  const t = s.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t) * 1000; // epoch seconds
  return Date.parse(t);
}

const cmp =
  (parse: (s: string) => number, test: (a: number, b: number) => boolean): Matcher =>
  (c, p) => {
    const a = parse(c);
    const b = parse(p);
    return !Number.isNaN(a) && !Number.isNaN(b) && test(a, b);
  };

function ipv4ToInt(ip: string): number | null {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const ipMatch: Matcher = (c, p) => {
  const [base, bitsText] = p.trim().split("/");
  const ip = ipv4ToInt(c);
  const net = ipv4ToInt(base ?? "");
  if (ip === null || net === null) return c.trim() === p.trim();
  const bits = bitsText === undefined ? 32 : Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  if (bits === 0) return true;
  const size = 2 ** (32 - bits);
  return Math.floor(ip / size) === Math.floor(net / size);
};

const stringEquals: Matcher = (c, p) => c === p;
const stringEqualsIgnoreCase: Matcher = (c, p) => c.toLowerCase() === p.toLowerCase();
const stringLike: Matcher = (c, p) => matchesPattern(p, c, { caseInsensitive: false });
const numericEquals = cmp(num, (a, b) => a === b);
const dateEquals = cmp(parseDate, (a, b) => a === b);
const bool: Matcher = (c, p) => c.toLowerCase() === p.toLowerCase();
const binaryEquals: Matcher = (c, p) => c === p;

const OPERATORS: Record<string, BaseOperator> = {
  StringEquals: { match: stringEquals, negated: false },
  StringNotEquals: { match: stringEquals, negated: true },
  StringEqualsIgnoreCase: { match: stringEqualsIgnoreCase, negated: false },
  StringNotEqualsIgnoreCase: { match: stringEqualsIgnoreCase, negated: true },
  StringLike: { match: stringLike, negated: false },
  StringNotLike: { match: stringLike, negated: true },
  NumericEquals: { match: numericEquals, negated: false },
  NumericNotEquals: { match: numericEquals, negated: true },
  NumericLessThan: { match: cmp(num, (a, b) => a < b), negated: false },
  NumericLessThanEquals: { match: cmp(num, (a, b) => a <= b), negated: false },
  NumericGreaterThan: { match: cmp(num, (a, b) => a > b), negated: false },
  NumericGreaterThanEquals: { match: cmp(num, (a, b) => a >= b), negated: false },
  DateEquals: { match: dateEquals, negated: false },
  DateNotEquals: { match: dateEquals, negated: true },
  DateLessThan: { match: cmp(parseDate, (a, b) => a < b), negated: false },
  DateLessThanEquals: { match: cmp(parseDate, (a, b) => a <= b), negated: false },
  DateGreaterThan: { match: cmp(parseDate, (a, b) => a > b), negated: false },
  DateGreaterThanEquals: { match: cmp(parseDate, (a, b) => a >= b), negated: false },
  Bool: { match: bool, negated: false },
  BinaryEquals: { match: binaryEquals, negated: false },
  IpAddress: { match: ipMatch, negated: false },
  NotIpAddress: { match: ipMatch, negated: true },
  ArnEquals: { match: stringLike, negated: false },
  ArnLike: { match: stringLike, negated: false },
  ArnNotEquals: { match: stringLike, negated: true },
  ArnNotLike: { match: stringLike, negated: true },
};

type SetOperator = "ForAnyValue" | "ForAllValues" | null;

interface ParsedOperator {
  base: string;
  setOperator: SetOperator;
  ifExists: boolean;
}

/** Splits e.g. "ForAllValues:StringLikeIfExists" into its parts. */
export function parseOperator(name: string): ParsedOperator | null {
  let rest = name;
  let setOperator: SetOperator = null;
  const prefix = /^(ForAnyValue|ForAllValues):/i.exec(rest);
  if (prefix) {
    setOperator = prefix[1]?.toLowerCase() === "foranyvalue" ? "ForAnyValue" : "ForAllValues";
    rest = rest.slice(prefix[0].length);
  }
  let ifExists = false;
  if (rest.endsWith("IfExists") && rest !== "IfExists") {
    ifExists = true;
    rest = rest.slice(0, -"IfExists".length);
  }
  if (rest === "Null") {
    // Null can't take IfExists or set operators.
    return ifExists || setOperator ? null : { base: "Null", setOperator: null, ifExists: false };
  }
  if (!(rest in OPERATORS)) return null;
  return { base: rest, setOperator, ifExists };
}

export const isKnownOperator = (name: string) => parseOperator(name) !== null;

function contextStrings(value: ContextValue): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

function policyStrings(
  value: unknown,
  useVariables: boolean,
  context: Record<string, ContextValue>,
): string[] {
  const list = Array.isArray(value) ? value : [value];
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    const text = String(v);
    const substituted = useVariables ? substituteVariables(text, context) : text;
    if (substituted !== null) out.push(substituted);
  }
  return out;
}

function evaluateKey(
  op: ParsedOperator,
  policyValue: unknown,
  contextValue: ContextValue | undefined,
  useVariables: boolean,
  rawContext: Record<string, ContextValue>,
): boolean {
  const present =
    contextValue !== undefined && !(Array.isArray(contextValue) && contextValue.length === 0);

  if (op.base === "Null") {
    const wanted = policyStrings(policyValue, false, rawContext).map((s) => s.toLowerCase());
    // "true": the key must be absent. "false": it must be present.
    return wanted.some((w) => (w === "true" ? !present : w === "false" ? present : false));
  }

  const base = OPERATORS[op.base];
  if (!base) return false;

  if (!present) {
    if (op.ifExists) return true;
    if (op.setOperator === "ForAllValues") return true;
    if (op.setOperator === "ForAnyValue") return false;
    return base.negated;
  }

  const values = policyStrings(policyValue, useVariables, rawContext);
  const ctxValues = contextStrings(contextValue);
  const anyMatch = (c: string) => values.some((p) => base.match(c, p));
  const satisfies = (c: string) => (base.negated ? !anyMatch(c) : anyMatch(c));

  if (op.setOperator === "ForAllValues") return ctxValues.every(satisfies);
  if (op.setOperator === "ForAnyValue") return ctxValues.some(satisfies);
  // Single-valued use: a negated operator must hold for every value, a positive one for any.
  return base.negated ? ctxValues.every(satisfies) : ctxValues.some(satisfies);
}

/**
 * True when every condition in the block holds. Operators AND together, keys within an operator
 * AND together, and multiple values for one key OR together.
 */
export function evaluateConditions(
  block: ConditionBlock | undefined,
  context: LookupContext,
  useVariables: boolean,
): boolean {
  if (!block || typeof block !== "object") return true;
  const rawContext = Object.fromEntries(context);
  for (const [operatorName, keys] of Object.entries(block)) {
    const op = parseOperator(operatorName);
    if (!op || !keys || typeof keys !== "object") return false;
    for (const [key, policyValue] of Object.entries(keys)) {
      const contextValue = context.get(key.toLowerCase());
      if (!evaluateKey(op, policyValue, contextValue, useVariables, rawContext)) return false;
    }
  }
  return true;
}
