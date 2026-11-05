import {
  type ContextValue,
  type EvalRequest,
  evaluate,
  type PolicySource,
} from "@cloudlearn/iam-engine";
import { DEFAULT_REGION, type EvaluationSummary } from "@cloudlearn/shared";
import type { AuthorizationRequest, Authorizer } from "../../core/authorize";
import type { Clock } from "../../core/clock";
import type { Db } from "../../core/db";
import type { Session } from "../../core/sessions";
import {
  attachedPolicies,
  defaultDocument,
  findRoleById,
  findUserById,
  groupsForUser,
  type IamGroup,
  type IamRole,
  type IamUser,
  inlinePolicies,
  type PrincipalKind,
} from "./repo";

function managedSources(db: Db, kind: PrincipalKind, id: string, via: string): PolicySource[] {
  return attachedPolicies(db, kind, id).map((p) => ({
    id: p.arn,
    name: p.name,
    type: p.accountId === null ? "aws-managed" : "customer-managed",
    attachedVia: via,
    document: defaultDocument(db, p),
  }));
}

function inlineSources(db: Db, kind: PrincipalKind, id: string, via: string): PolicySource[] {
  return inlinePolicies(db, kind, id).map((p) => ({
    id: `${via}/inline/${p.name}`,
    name: p.name,
    type: "inline",
    attachedVia: via,
    document: p.document,
  }));
}

/** Every identity-based policy that applies to a user: its own plus its groups'. */
export function policiesForUser(db: Db, user: IamUser): PolicySource[] {
  const via = `user/${user.name}`;
  return [
    ...managedSources(db, "user", user.id, via),
    ...inlineSources(db, "user", user.id, via),
    ...groupsForUser(db, user.id).flatMap((g) => policiesForGroup(db, g)),
  ];
}

export function policiesForGroup(db: Db, group: IamGroup): PolicySource[] {
  const via = `group/${group.name}`;
  return [
    ...managedSources(db, "group", group.id, via),
    ...inlineSources(db, "group", group.id, via),
  ];
}

export function policiesForRole(db: Db, role: IamRole): PolicySource[] {
  const via = `role/${role.name}`;
  return [...managedSources(db, "role", role.id, via), ...inlineSources(db, "role", role.id, via)];
}

/** The global condition keys AWS adds to every request (the ones that make sense locally). */
export function globalConditionKeys(
  session: Pick<Session, "accountId" | "principal">,
  clock: Clock,
): Record<string, ContextValue> {
  const now = clock.now();
  const { principal } = session;
  const keys: Record<string, ContextValue> = {
    "aws:PrincipalArn":
      principal.type === "assumed-role" ? roleArnFromSessionArn(principal.arn) : principal.arn,
    "aws:PrincipalAccount": session.accountId,
    "aws:PrincipalType":
      principal.type === "root" ? "Account" : principal.type === "user" ? "User" : "AssumedRole",
    "aws:userid": principal.id,
    "aws:CurrentTime": now.toISOString(),
    "aws:EpochTime": Math.floor(now.getTime() / 1000),
    "aws:RequestedRegion": DEFAULT_REGION,
    "aws:SourceIp": "127.0.0.1",
    "aws:SecureTransport": true,
    "aws:MultiFactorAuthPresent": false,
  };
  if (principal.type === "user") keys["aws:username"] = principal.name;
  return keys;
}

/** arn:aws:sts::1:assumed-role/Admin/alice → arn:aws:iam::1:role/Admin */
export function roleArnFromSessionArn(arn: string): string {
  const match = /^arn:aws:sts::(\d{12}):assumed-role\/([^/]+)\//.exec(arn);
  return match ? `arn:aws:iam::${match[1]}:role/${match[2]}` : arn;
}

const ROOT_SOURCE: PolicySource = {
  id: "root",
  name: "Root user (full access)",
  type: "aws-managed",
  document: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }] },
};

/** Authorizes requests with real IAM policy evaluation. */
export function createIamAuthorizer(db: Db, clock: Clock): Authorizer {
  return {
    authorize(req: AuthorizationRequest): EvaluationSummary {
      const { session } = req;
      const request: EvalRequest = {
        principalArn: session.principal.arn,
        principalAccount: session.accountId,
        action: req.action,
        resource: req.resource,
        context: { ...globalConditionKeys(session, clock), ...req.conditionKeys },
      };

      if (session.principal.type === "root") {
        // Root can't be limited by identity policies. A resource policy's explicit Deny still
        // applies to root, though (that's how people lock themselves out of S3 buckets).
        if (!req.resourcePolicies?.length) {
          return {
            decision: "Allow",
            reason:
              "The root user has full access to every resource in its own account. IAM policies can't limit it.",
            matchedStatements: [],
            policiesEvaluated: [],
          };
        }
        return evaluate({
          identityPolicies: [ROOT_SOURCE],
          resourcePolicies: req.resourcePolicies,
          request,
        });
      }

      let identityPolicies: PolicySource[] = [];
      if (session.principal.type === "user") {
        const user = findUserById(db, session.principal.id);
        if (user) identityPolicies = policiesForUser(db, user);
      } else if (session.roleId) {
        const role = findRoleById(db, session.roleId);
        if (role) identityPolicies = policiesForRole(db, role);
      }

      return evaluate({ identityPolicies, resourcePolicies: req.resourcePolicies, request });
    },
  };
}
