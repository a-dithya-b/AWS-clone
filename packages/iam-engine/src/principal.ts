import { toArray } from "./normalize";
import type { EvalRequest, PrincipalBlock } from "./types";

export interface PrincipalMatch {
  matches: boolean;
  /** The match named the caller's exact ARN (or its role), not "*", an account ID or root. */
  explicit: boolean;
}

const ROOT_ARN = /^arn:[^:]+:iam::(\d{12}):root$/;
const ASSUMED_ROLE = /^arn:([^:]+):sts::(\d{12}):assumed-role\/([^/]+)\/[^/]+$/;

/** Does a Principal block include the request's principal? */
export function matchPrincipal(
  block: PrincipalBlock | undefined,
  request: EvalRequest,
): PrincipalMatch {
  if (block === undefined) return { matches: false, explicit: false };
  if (block === "*") return { matches: true, explicit: false };
  if (typeof block !== "object" || block === null) return { matches: false, explicit: false };

  const entries = toArray(block.AWS) ?? [];
  const assumed = ASSUMED_ROLE.exec(request.principalArn);
  let result: PrincipalMatch = { matches: false, explicit: false };

  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    if (entry === request.principalArn) return { matches: true, explicit: true };
    if (assumed) {
      const [, , account, roleName] = assumed;
      const roleArn = new RegExp(
        `^arn:[^:]+:iam::${account}:role/(?:.*/)?${escapeRegex(roleName ?? "")}$`,
      );
      if (roleArn.test(entry)) return { matches: true, explicit: true };
    }
    if (entry === "*") result = { matches: true, explicit: false };
    else if (entry === request.principalAccount) result = { matches: true, explicit: false };
    else {
      const root = ROOT_ARN.exec(entry);
      if (root && root[1] === request.principalAccount) result = { matches: true, explicit: false };
    }
  }
  return result;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
