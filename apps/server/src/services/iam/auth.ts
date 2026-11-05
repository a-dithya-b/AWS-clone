import { evaluateTrustPolicy } from "@cloudlearn/iam-engine";
import { accessDeniedMessage, type EvaluationSummary, type Principal } from "@cloudlearn/shared";
import { type Account, findAccountByIdOrAlias } from "../../core/accounts";
import { AwsError } from "../../core/errors";
import { verifyPassword } from "../../core/passwords";
import type { CoreDeps } from "../../core/service";
import type { Session } from "../../core/sessions";
import { globalConditionKeys } from "./authorizer";
import { findRole, findUser, type IamRole, touchRole, touchUserPassword } from "./repo";

const BAD_CREDENTIALS = "Your authentication information is incorrect. Please try again.";

/** Checks an IAM user's console password. Returns the account and principal, or throws. */
export async function authenticateIamUser(
  deps: CoreDeps,
  input: { account: string; username: string; password: string },
): Promise<{ account: Account; principal: Principal; failedAccount?: undefined }> {
  const account = findAccountByIdOrAlias(deps.db, input.account);
  const user = account && findUser(deps.db, account.id, input.username);
  if (
    !account ||
    !user?.passwordHash ||
    !(await verifyPassword(input.password, user.passwordHash))
  ) {
    const error = new AwsError("AuthFailure", BAD_CREDENTIALS, 401);
    // Let the caller record a failed ConsoleLogin when the user exists.
    Object.assign(error, { account, user });
    throw error;
  }
  touchUserPassword(deps.db, user.id, deps.clock.now());
  return {
    account,
    principal: { type: "user", name: user.name, arn: user.arn, id: user.id },
  };
}

export interface SwitchRoleResult {
  account: Account;
  role: IamRole;
  principal: Principal;
  ttlMs: number;
  evaluation: EvaluationSummary;
}

/**
 * The console's "Switch role": checks the role's trust policy and the caller's own permission to
 * call sts:AssumeRole, exactly as AWS does for AssumeRole.
 */
export function switchRole(
  deps: CoreDeps,
  caller: Session,
  input: { account: string; roleName: string; sessionName: string },
): SwitchRoleResult {
  if (caller.principal.type === "root") {
    throw new AwsError(
      "AccessDenied",
      "The root user can't switch roles. Sign in as an IAM user, then switch to the role.",
      403,
    );
  }
  if (caller.principal.type !== "user") {
    throw new AwsError(
      "AccessDenied",
      "Switch back to your IAM user before switching to another role.",
      403,
    );
  }

  const account = findAccountByIdOrAlias(deps.db, input.account);
  const role = account && findRole(deps.db, account.id, input.roleName);
  const roleArn =
    role?.arn ?? `arn:aws:iam::${account?.id ?? input.account}:role/${input.roleName}`;
  const denied = (evaluation: EvaluationSummary, reasonPrefix?: string) =>
    new AwsError(
      "AccessDenied",
      `${reasonPrefix ?? ""}${accessDeniedMessage({
        principalArn: caller.principal.arn,
        action: "sts:AssumeRole",
        resource: roleArn,
        decision: evaluation.decision === "ExplicitDeny" ? "ExplicitDeny" : "ImplicitDeny",
      })}`,
      403,
      evaluation,
    );

  if (!account || !role) {
    // AWS gives the same answer whether the role is missing or not allowed, to avoid leaking names.
    throw denied({
      decision: "ImplicitDeny",
      reason: `There is no role named "${input.roleName}" in account ${input.account}, or you aren't allowed to assume it.`,
      matchedStatements: [],
    });
  }

  const request = {
    principalArn: caller.principal.arn,
    principalAccount: caller.accountId,
    action: "sts:AssumeRole",
    resource: role.arn,
    context: globalConditionKeys(caller, deps.clock),
  };

  // 1. The role must trust the caller.
  const trustSource = {
    id: `${role.arn}/trust`,
    name: `${role.name} trust policy`,
    type: "trust" as const,
    document: role.trustPolicy,
  };
  const trust = evaluateTrustPolicy({ trustPolicy: trustSource, request });
  if (trust.decision !== "Allow") throw denied(trust);

  // 2. The caller needs sts:AssumeRole in its own policies, unless the trust policy names it
  //    directly and it's in the same account.
  const sameAccount = account.id === caller.accountId;
  let evaluation: EvaluationSummary = trust;
  if (!(sameAccount && trust.principalNamedExplicitly)) {
    const identity = deps.authorizer.authorize({
      session: caller,
      action: "sts:AssumeRole",
      resource: role.arn,
      // The trust policy was checked above; this checks the caller's own policies.
      identityOnly: true,
    });
    if (identity.decision !== "Allow") {
      throw denied({
        ...identity,
        reason: `The role trusts you, but your own policies don't allow sts:AssumeRole on it: ${identity.reason} ${
          sameAccount
            ? "Because the trust policy trusts the whole account rather than naming you, your own policies must also allow sts:AssumeRole."
            : "To assume a role in another account, your own policies must allow sts:AssumeRole on it."
        }`,
      });
    }
    evaluation = identity;
  }

  touchRole(deps.db, role.id, deps.clock.now());
  return {
    account,
    role,
    principal: {
      type: "assumed-role",
      name: `${role.name}/${input.sessionName}`,
      arn: `arn:aws:sts::${account.id}:assumed-role/${role.name}/${input.sessionName}`,
      id: `${role.id}:${input.sessionName}`,
    },
    ttlMs: role.maxSessionDuration * 1000,
    evaluation,
  };
}
