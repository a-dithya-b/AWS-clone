import { isKnownOperator } from "./conditions";
import { findJsonError } from "./json-position";
import { matchesPattern } from "./match";
import type {
  ActionCatalogEntry,
  PolicyDocument,
  PolicyIssue,
  ValidateOptions,
  ValidationResult,
} from "./types";

const SYNTAX = "Syntax errors in policy.";
const VENDOR = "Actions/Conditions must be prefaced by a vendor, e.g., iam, sdb, ec2, etc.";
const TOP_LEVEL_KEYS = new Set(["Version", "Id", "Statement"]);
const STATEMENT_KEYS = new Set([
  "Sid",
  "Effect",
  "Principal",
  "NotPrincipal",
  "Action",
  "NotAction",
  "Resource",
  "NotResource",
  "Condition",
]);
const PRINCIPAL_KEYS = new Set(["AWS", "Service", "Federated", "CanonicalUser"]);
const ACTION_FORMAT = /^[A-Za-z0-9-]+:[A-Za-z0-9*?]+$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function lineAndColumn(json: string, position: number) {
  const before = json.slice(0, position);
  const line = before.split("\n").length;
  const column = position - before.lastIndexOf("\n");
  return { line, column };
}

/** Parses JSON, returning an AWS-style syntax error instead of throwing. */
export function parsePolicyJson(
  json: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  if (json.trim() === "") {
    return { ok: false, message: "This policy contains a syntax error: the policy is empty." };
  }
  try {
    return { ok: true, value: JSON.parse(json) };
  } catch (err) {
    const found = findJsonError(json);
    if (found) {
      const { line, column } = lineAndColumn(json, found.position);
      return {
        ok: false,
        message: `This policy contains a syntax error: ${found.message} (line ${line}, column ${column})`,
      };
    }
    const raw = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `This policy contains a syntax error: ${raw}` };
  }
}

function strings(value: unknown): string[] | null {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string"))
    return value as string[];
  return null;
}

const elementPath = (base: string, value: unknown, i: number) =>
  Array.isArray(value) ? `${base}[${i}]` : base;

/** The short name used in messages: "SQS", "IAM", or the full service name. */
function shortName(service: string, entries: ActionCatalogEntry[]) {
  return service.length <= 3 ? service.toUpperCase() : (entries[0]?.serviceName ?? service);
}

/** Validates a policy (JSON string or parsed object) with AWS-style messages. */
export function validatePolicy(input: unknown, opts: ValidateOptions): ValidationResult {
  const issues: PolicyIssue[] = [];
  const error = (message: string, path = "") => issues.push({ severity: "error", message, path });
  const warn = (message: string, path = "") => issues.push({ severity: "warning", message, path });
  const finish = (document?: PolicyDocument): ValidationResult => ({
    valid: !issues.some((i) => i.severity === "error"),
    issues,
    ...(document ? { document } : {}),
  });

  let value = input;
  if (typeof input === "string") {
    const parsed = parsePolicyJson(input);
    if (!parsed.ok) {
      error(parsed.message);
      return finish();
    }
    value = parsed.value;
  }

  if (!isObject(value)) {
    error(SYNTAX);
    return finish();
  }
  for (const key of Object.keys(value)) if (!TOP_LEVEL_KEYS.has(key)) error(SYNTAX, key);

  if (!("Version" in value)) {
    warn(
      'Add a Version of "2012-10-17". Without it, policy variables like ${aws:username} won\'t work.',
      "Version",
    );
  } else if (value.Version !== "2012-10-17" && value.Version !== "2008-10-17") {
    error("The policy failed legacy parsing", "Version");
  }
  if ("Id" in value && typeof value.Id !== "string") error(SYNTAX, "Id");

  const rawStatement = value.Statement;
  if (rawStatement === undefined) {
    error(SYNTAX, "Statement");
    return finish();
  }
  const statementIsArray = Array.isArray(rawStatement);
  if (!statementIsArray && !isObject(rawStatement)) {
    error(SYNTAX, "Statement");
    return finish();
  }
  const statements: unknown[] = statementIsArray ? rawStatement : [rawStatement];
  if (statements.length === 0) error(SYNTAX, "Statement");

  const catalogByService = new Map<string, ActionCatalogEntry[]>();
  for (const entry of opts.catalog ?? []) {
    const key = entry.service.toLowerCase();
    catalogByService.set(key, [...(catalogByService.get(key) ?? []), entry]);
  }
  const sids = new Set<string>();

  statements.forEach((st, i) => {
    const p = statementIsArray ? `Statement[${i}]` : "Statement";
    if (!isObject(st)) {
      error(SYNTAX, p);
      return;
    }
    for (const key of Object.keys(st)) if (!STATEMENT_KEYS.has(key)) error(SYNTAX, `${p}.${key}`);

    // Sid
    if ("Sid" in st) {
      if (typeof st.Sid !== "string") error(SYNTAX, `${p}.Sid`);
      else {
        if (!/^[0-9A-Za-z]*$/.test(st.Sid)) {
          error(
            "Statement IDs (SID) must be alpha-numeric. Check that your input satisfies the regular expression [0-9A-Za-z]*",
            `${p}.Sid`,
          );
        }
        if (st.Sid !== "" && sids.has(st.Sid)) {
          error("Statement IDs (SID) in a single policy must be unique.", `${p}.Sid`);
        }
        sids.add(st.Sid);
      }
    }

    // Effect
    if (!("Effect" in st)) error("Missing required field Effect", `${p}.Effect`);
    else if (st.Effect !== "Allow" && st.Effect !== "Deny") {
      error(`Invalid effect: ${String(st.Effect)}`, `${p}.Effect`);
    }

    // Action / NotAction
    const hasAction = "Action" in st;
    const hasNotAction = "NotAction" in st;
    if (hasAction && hasNotAction) {
      error("Statement cannot contain both Action and NotAction.", p);
    } else if (!hasAction && !hasNotAction) {
      error("Policy statement must contain actions.", p);
    } else {
      const key = hasAction ? "Action" : "NotAction";
      const raw = st[key];
      const list = strings(raw);
      if (!list) error(SYNTAX, `${p}.${key}`);
      else {
        list.forEach((action, j) => {
          const path = elementPath(`${p}.${key}`, raw, j);
          if (action === "*") return;
          if (!ACTION_FORMAT.test(action)) {
            error(VENDOR, path);
            return;
          }
          if (!opts.catalog) return;
          const service = action.slice(0, action.indexOf(":")).toLowerCase();
          const entries = catalogByService.get(service);
          if (!entries) {
            warn(
              `CloudLearn doesn't simulate the "${service}" service, so this action has no effect here.`,
              path,
            );
          } else if (
            !entries.some((e) => matchesPattern(action, e.action, { caseInsensitive: true }))
          ) {
            warn(
              `"${action}" doesn't match any ${shortName(service, entries)} action. Check the spelling.`,
              path,
            );
          }
        });
      }
    }

    // Principal / NotPrincipal
    const hasPrincipal = "Principal" in st;
    const hasNotPrincipal = "NotPrincipal" in st;
    if (opts.kind === "identity") {
      if (hasPrincipal || hasNotPrincipal) {
        error(
          "Policy document should not specify a principal.",
          `${p}.${hasPrincipal ? "Principal" : "NotPrincipal"}`,
        );
      }
    } else {
      if (hasPrincipal && hasNotPrincipal) {
        error("Statement cannot contain both Principal and NotPrincipal.", p);
      } else if (!hasPrincipal && !hasNotPrincipal) {
        error(
          opts.kind === "trust"
            ? "AssumeRolePolicy policy must specify a principal."
            : "Policy document must specify a principal.",
          p,
        );
      } else {
        const key = hasPrincipal ? "Principal" : "NotPrincipal";
        const block = st[key];
        const ok =
          block === "*" ||
          (isObject(block) &&
            Object.keys(block).length > 0 &&
            Object.entries(block).every(([k, v]) => PRINCIPAL_KEYS.has(k) && strings(v) !== null));
        if (!ok) error(SYNTAX, `${p}.${key}`);
      }
    }

    // Resource / NotResource
    const hasResource = "Resource" in st;
    const hasNotResource = "NotResource" in st;
    if (opts.kind === "trust") {
      if (hasResource || hasNotResource) {
        error("Has prohibited field Resource", `${p}.${hasResource ? "Resource" : "NotResource"}`);
      }
    } else if (hasResource && hasNotResource) {
      error("Statement cannot contain both Resource and NotResource.", p);
    } else if (!hasResource && !hasNotResource) {
      error("Policy statement must contain resources.", p);
    } else {
      const key = hasResource ? "Resource" : "NotResource";
      const raw = st[key];
      const list = strings(raw);
      if (!list) error(SYNTAX, `${p}.${key}`);
      else {
        list.forEach((resource, j) => {
          if (resource !== "*" && !resource.startsWith("arn:")) {
            error(
              `Resource ${resource} must be in ARN format or "*".`,
              elementPath(`${p}.${key}`, raw, j),
            );
          }
        });
      }
    }

    // Condition
    if ("Condition" in st) {
      const condition = st.Condition;
      if (!isObject(condition)) error(SYNTAX, `${p}.Condition`);
      else {
        for (const [operator, keys] of Object.entries(condition)) {
          const path = `${p}.Condition.${operator}`;
          if (!isKnownOperator(operator)) {
            error(`Invalid Condition type : ${operator}`, path);
            continue;
          }
          if (!isObject(keys) || Object.keys(keys).length === 0) {
            error(SYNTAX, path);
            continue;
          }
          for (const [key, v] of Object.entries(keys)) {
            if (!key.includes(":")) error(VENDOR, `${path}.${key}`);
            const values = Array.isArray(v) ? v : [v];
            const scalar = (x: unknown) =>
              typeof x === "string" || typeof x === "number" || typeof x === "boolean";
            if (values.length === 0 || !values.every(scalar)) error(SYNTAX, `${path}.${key}`);
          }
        }
      }
    }
  });

  return finish(value as unknown as PolicyDocument);
}
