import { type Principal, rootArn, SignInInput, SignUpInput } from "@cloudlearn/shared";
import { type Context, Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { type Account, createAccount, findAccountByEmail } from "./accounts";
import { AwsError } from "./errors";
import { recordEvent } from "./events";
import { type AppEnv, parseInput, readJsonBody } from "./http";
import { hashPassword, verifyPassword } from "./passwords";
import type { CoreDeps } from "./service";
import {
  createSession,
  deleteSession,
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

/** Sign-up, sign-in and sign-out. These are console pages in AWS, not API actions. */
export function authRoutes(deps: CoreDeps) {
  const { db, clock } = deps;
  const routes = new Hono<AppEnv>();

  const startSession = (c: Context<AppEnv>, account: Account, principal: Principal): Session => {
    const session = createSession(db, clock, account.id, principal);
    setCookie(c, SESSION_COOKIE, session.token, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return session;
  };

  // CloudTrail records console sign-ins as ConsoleLogin events, successful or not.
  const recordLogin = (account: Account, principal: Principal, error?: AwsError) =>
    recordEvent(db, {
      accountId: account.id,
      time: clock.now(),
      eventSource: "signin.amazonaws.com",
      eventName: "ConsoleLogin",
      iamAction: "signin:ConsoleLogin",
      principalArn: principal.arn,
      principalType: principal.type,
      resourceArn: null,
      decision: error ? "ImplicitDeny" : "Allow",
      errorCode: error?.code ?? null,
      errorMessage: error ? "Failed authentication" : null,
      request: null,
      evaluation: null,
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
      throw new AwsError(
        "NotImplemented",
        "IAM user sign-in isn't available yet. It arrives together with IAM users.",
        501,
      );
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

  routes.post("/signout", (c) => {
    const session = c.get("session");
    if (session) deleteSession(db, session.token);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ signedIn: false });
  });

  return routes;
}
