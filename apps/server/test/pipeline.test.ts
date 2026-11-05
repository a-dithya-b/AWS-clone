import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AwsError } from "../src/core/errors";
import { defineAction, defineService } from "../src/core/service";
import { services } from "../src/services/registry";
import { createTestApp } from "./helpers";

// A throwaway service to test the pipeline itself.
const demoService = defineService({
  id: "demo",
  name: "Demo",
  actions: [
    defineAction({
      name: "Echo",
      iamAction: "demo:Echo",
      accessLevel: "Read",
      input: z.object({ Name: z.string().min(1) }),
      resource: (input, { session }) =>
        `arn:aws:demo:us-east-1:${session.accountId}:thing/${input.Name}`,
      handler: (input) => ({ Echoed: input.Name }),
    }),
    defineAction({
      name: "Fail",
      iamAction: "demo:Fail",
      accessLevel: "Write",
      input: z.object({}),
      handler: () => {
        throw new AwsError("ThingNotFound", "The thing does not exist.", 404);
      },
    }),
  ],
});

const denyAll = {
  authorize: () => ({
    decision: "ImplicitDeny" as const,
    reason: "test",
    matchedStatements: [],
  }),
};

const lookup = async (t: ReturnType<typeof createTestApp>) =>
  (await t.action("cloudtrail", "LookupEvents")).body.Events;

describe("action pipeline", () => {
  it("requires a session", async () => {
    const t = createTestApp();
    const res = await t.action("sts", "GetCallerIdentity");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("MissingAuthenticationToken");
  });

  it("returns InvalidAction for unknown services and actions", async () => {
    const t = createTestApp();
    await t.signUp();
    expect((await t.action("nope", "Thing")).body.code).toBe("InvalidAction");
    expect((await t.action("sts", "Nope")).body.code).toBe("InvalidAction");
  });

  it("GetCallerIdentity returns the root identity", async () => {
    const t = createTestApp();
    const { session } = (await t.signUp()).body;
    const res = await t.action("sts", "GetCallerIdentity");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      UserId: session.accountId,
      Account: session.accountId,
      Arn: `arn:aws:iam::${session.accountId}:root`,
    });
  });

  it("GetCallerIdentity works even when every permission is denied", async () => {
    const t = createTestApp({ authorizer: denyAll });
    await t.signUp();
    expect((await t.action("sts", "GetCallerIdentity")).status).toBe(200);
  });

  it("denies with an AWS-style AccessDenied message plus the evaluation", async () => {
    const t = createTestApp({ services: [...services, demoService], authorizer: denyAll });
    const { session } = (await t.signUp()).body;
    const res = await t.action("demo", "Echo", { Name: "x" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("AccessDenied");
    expect(res.body.message).toBe(
      `User: arn:aws:iam::${session.accountId}:root is not authorized to perform: demo:Echo on resource: arn:aws:demo:us-east-1:${session.accountId}:thing/x because no identity-based policy allows the demo:Echo action`,
    );
    expect(res.body.evaluation.decision).toBe("ImplicitDeny");
  });

  it("records allowed, denied, invalid and failed calls in the event log, newest first", async () => {
    const t = createTestApp({ services: [...services, demoService] });
    await t.signUp();
    await t.action("demo", "Echo", { Name: "ok" });
    await t.action("demo", "Echo", { Name: "" });
    await t.action("demo", "Fail");

    const events = await lookup(t);
    expect(events.map((e: { EventName: string }) => e.EventName)).toEqual([
      "Fail",
      "Echo",
      "Echo",
      "ConsoleLogin",
    ]);
    const [fail, invalid, ok, login] = events;
    expect(fail).toMatchObject({ Decision: "Allow", ErrorCode: "ThingNotFound" });
    expect(invalid).toMatchObject({ ErrorCode: "ValidationError" });
    expect(ok).toMatchObject({
      Decision: "Allow",
      ErrorCode: null,
      EventSource: "demo.amazonaws.com",
      Username: "root",
      Request: { Name: "ok" },
    });
    expect(login).toMatchObject({ EventSource: "signin.amazonaws.com", Decision: "Allow" });
  });

  it("records failed sign-ins and never stores passwords", async () => {
    const t = createTestApp();
    await t.signUp();
    await t.call("POST", "/api/auth/signout", {});
    await t.call("POST", "/api/auth/signin", {
      type: "root",
      email: "learner@example.com",
      password: "wrong-password",
    });
    await t.call("POST", "/api/auth/signin", {
      type: "root",
      email: "learner@example.com",
      password: "correct-horse",
    });
    const events = await lookup(t);
    expect(events[1]).toMatchObject({
      EventName: "ConsoleLogin",
      ErrorMessage: "Failed authentication",
    });
    expect(JSON.stringify(events)).not.toContain("correct-horse");
  });

  it("paginates the event log", async () => {
    const t = createTestApp();
    await t.signUp();
    for (let i = 0; i < 4; i++) await t.action("sts", "GetCallerIdentity");
    const first = await t.action("cloudtrail", "LookupEvents", { MaxResults: 3 });
    expect(first.body.Events).toHaveLength(3);
    const second = await t.action("cloudtrail", "LookupEvents", {
      MaxResults: 3,
      NextToken: first.body.NextToken,
    });
    expect(second.body.Events).toHaveLength(2);
    expect(second.body.NextToken).toBeUndefined();
  });

  it("keeps each account's events separate", async () => {
    const t = createTestApp();
    await t.signUp();
    await t.action("sts", "GetCallerIdentity");
    t.clearCookies();
    await t.signUp({ email: "other@example.com" });
    const events = await lookup(t);
    expect(events).toHaveLength(1);
    expect(events[0].EventName).toBe("ConsoleLogin");
  });
});
