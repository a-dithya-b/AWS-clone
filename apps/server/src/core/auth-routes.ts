import {
  type EvaluationSummary,
  type Principal,
  rootArn,
  SignInInput,
  SignUpInput,
  SwitchRoleInput,
} from "@cloudlearn/shared";
import { type Context, Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { authenticateIamUser, switchRole } from "../services/iam/auth";
import { type Account, createAccount, findAccountByEmail } from "./accounts";
import { AwsError } from "./errors";
import { recordEvent } from "./events";
import { type AppEnv, parseInput, readJsonBody } from "./http";
import { hashPassword, verifyPassword } from "./passwords";
import type { CoreDeps } from "./service";
import {
  type CreateSessionOptions,
  createSession,
  deleteSession,
  findSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  type Session,
  toSessionInfo,
} from "./sessions";

const rootPrincipal = (account: Account): Principal => ({
  type: "root",
  name: account.name,
  arn: rootArn(account.id),
  id: account.id,
});

/** The wording the AWS sign-in page uses, so learners recognize it. */
const BAD_CREDENTIALS = "Your authentication information is incorrect. Please try again.";

/**
 * Sign-up, sign-in, sign-out and switch role. These are console pages in AWS, not API actions,
 * so they live outside the service pipeline, but they're still recorded in the event log.
 */
export function authRoutes(deps: CoreDeps) {
  const { db, clock } = deps;
  const routes = new Hono<AppEnv>();

  const setSessionCookie = (c: Context<AppEnv>, token: string) =>
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });

  const startSession = (
    c: Context<AppEnv>,
    account: Account,
    principal: Principal,
    opts?: CreateSessionOptions,
  ): Session => {
    const session = createSession(db, clock, account.id, principal, opts);
    setSessionCookie(c, session.token);
    return session;
  };

  const record = (
    accountId: string,
    principal: Principal,
    fields: {
      eventSource: string;
      eventName: string;
      iamAction: string;
      resourceArn?: string | null;
      error?: AwsError;
      errorMessage?: string;
      request?: unknown;
      evaluation?: EvaluationSummary | null;
    },
  ) =>
    recordEvent(db, {
      accountId,
      time: clock.now(),
      eventSource: fields.eventSource,
      eventName: fields.eventName,
      iamAction: fields.iamAction,
      principalArn: principal.arn,
      principalType: principal.type,
      resourceArn: fields.resourceArn ?? null,
      decision: fields.error ? (fields.evaluation?.decision ?? "ImplicitDeny") : "Allow",
      errorCode: fields.error?.code ?? null,
      errorMessage: fields.errorMessage ?? fields.error?.message ?? null,
      request: fields.request ?? null,
      evaluation: fields.evaluation ?? null,
    });

  // CloudTrail records console sign-ins as ConsoleLogin events, successful or not.
  const recordLogin = (account: Account, principal: Principal, error?: AwsError) =>
    record(account.id, principal, {
      eventSource: "signin.amazonaws.com",
      eventName: "ConsoleLogin",
      iamAction: "signin:ConsoleLogin",
      error,
      errorMessage: error ? "Failed authentication" : undefined,
    });

  routes.get("/session", (c) => {
    const session = c.get("session");
    return c.json(
      session ? { signedIn: true, session: toSessionInfo(session) } : { signedIn: false },
    );
  });

  routes.post("/signup", async (c) => {
    const input = parseInput(SignUpInput, await readJsonBody(c));
    if (findAccountByEmail(db, input.email)) {
      throw new AwsError(
        "EntityAlreadyExists",
        "An account with this email address already exists. Sign in instead.",
        409,
      );
    }
    const account = createAccount(db, {
      email: input.email,
      name: input.accountName,
      rootPasswordHash: await hashPassword(input.password),
      now: clock.now(),
    });
    const principal = rootPrincipal(account);
    const session = startSession(c, account, principal);
    recordLogin(account, principal);
    return c.json({ session: toSessionInfo(session) }, 201);
  });

  routes.post("/signin", async (c) => {
    const input = parseInput(SignInInput, await readJsonBody(c));

    if (input.type === "iam") {
      try {
        const { account, principal } = await authenticateIamUser(deps, input);
        const session = startSession(c, account, principal);
        recordLogin(account, principal);
        return c.json({ session: toSessionInfo(session) });
      } catch (err) {
        const { account, user } = err as {
          account?: Account;
          user?: { name: string; arn: string; id: string };
        };
        if (account && user && err instanceof AwsError) {
          recordLogin(account, { type: "user", name: user.name, arn: user.arn, id: user.id }, err);
        }
        throw err;
      }
    }

    const account = findAccountByEmail(db, input.email);
    if (!account) throw new AwsError("AuthFailure", BAD_CREDENTIALS, 401);
    const principal = rootPrincipal(account);
    if (!(await verifyPassword(input.password, account.rootPasswordHash))) {
      const err = new AwsError("AuthFailure", BAD_CREDENTIALS, 401);
      recordLogin(account, principal, err);
      throw err;
    }
    const session = startSession(c, account, principal);
    recordLogin(account, principal);
    return c.json({ session: toSessionInfo(session) });
  });

  routes.post("/switch-role", async (c) => {
    const session = c.get("session");
    if (!session) throw new AwsError("MissingAuthenticationToken", "You are not signed in.", 401);
    const input = parseInput(SwitchRoleInput, await readJsonBody(c));
    // Switching from a role first returns to the original user, like the console does.
    const caller = (session.parentToken && findSession(db, clock, session.parentToken)) || session;
    const event = {
      eventSource: "sts.amazonaws.com",
      eventName: "AssumeRole",
      iamAction: "sts:AssumeRole",
      request: {
        RoleArn: `${input.account}:role/${input.roleName}`,
        RoleSessionName: caller.principal.name,
      },
    };
    try {
      const result = switchRole(deps, caller, {
        account: input.account,
        roleName: input.roleName,
        sessionName: caller.principal.name,
      });
      const principal = { ...result.principal, name: input.displayName || result.principal.name };
      if (session !== caller) deleteSession(db, session.token);
      const roleSession = startSession(c, result.account, principal, {
        ttlMs: result.ttlMs,
        roleId: result.role.id,
        parentToken: caller.token,
      });
      record(caller.accountId, caller.principal, {
        ...event,
        resourceArn: result.role.arn,
        evaluation: result.evaluation,
      });
      if (result.account.id !== caller.accountId) {
        record(result.account.id, caller.principal, {
          ...event,
          resourceArn: result.role.arn,
          evaluation: result.evaluation,
        });
      }
      return c.json({ session: toSessionInfo(roleSession) });
    } catch (err) {
      if (err instanceof AwsError) {
        record(caller.accountId, caller.principal, {
          ...event,
          error: err,
          evaluation: err.evaluation,
        });
      }
      throw err;
    }
  });

  routes.post("/switch-back", (c) => {
    const session = c.get("session");
    if (!session?.parentToken) {
      throw new AwsError("InvalidAction", "You're not using a switched role.", 400);
    }
    const parent = findSession(db, clock, session.parentToken);
    deleteSession(db, session.token);
    if (!parent) {
      deleteCookie(c, SESSION_COOKIE, { path: "/" });
      return c.json({ signedIn: false });
    }
    setSessionCookie(c, parent.token);
    return c.json({ session: toSessionInfo(parent) });
  });

  routes.post("/signout", (c) => {
    const session = c.get("session");
    if (session) {
      deleteSession(db, session.token);
      if (session.parentToken) deleteSession(db, session.parentToken);
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ signedIn: false });
  });

  return routes;
}
