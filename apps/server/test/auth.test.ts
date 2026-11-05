import { describe, expect, it } from "vitest";
import { SESSION_TTL_MS } from "../src/core/sessions";
import { createTestApp } from "./helpers";

describe("root sign-up and sign-in", () => {
  it("signs up a root user with a 12-digit account ID and starts a session", async () => {
    const t = createTestApp();
    const res = await t.signUp();
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    const { session } = res.body;
    expect(session.accountId).toMatch(/^[1-9]\d{11}$/);
    expect(session.principal).toEqual({
      type: "root",
      name: "my-sandbox",
      arn: `arn:aws:iam::${session.accountId}:root`,
      id: session.accountId,
    });
    expect(session).not.toHaveProperty("token");

    const me = await t.call("GET", "/api/auth/session");
    expect(me.body).toMatchObject({ signedIn: true, session: { accountId: session.accountId } });
  });

  it("rejects a duplicate email, ignoring case", async () => {
    const t = createTestApp();
    await t.signUp();
    const res = await t.signUp({ email: "LEARNER@example.com" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EntityAlreadyExists");
  });

  it("validates sign-up input with AWS-style messages", async () => {
    const t = createTestApp();
    const res = await t.signUp({ email: "nope", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ValidationError");
    expect(res.body.message).toMatch(/^2 validation errors detected/);
  });

  it("signs in with the right password and rejects the wrong one", async () => {
    const t = createTestApp();
    await t.signUp();
    await t.call("POST", "/api/auth/signout", {});
    expect((await t.call("GET", "/api/auth/session")).body).toEqual({ signedIn: false });

    const bad = await t.call("POST", "/api/auth/signin", {
      type: "root",
      email: "learner@example.com",
      password: "wrong-password",
    });
    expect(bad.status).toBe(401);
    expect(bad.body.message).toBe(
      "Your authentication information is incorrect. Please try again.",
    );

    const good = await t.call("POST", "/api/auth/signin", {
      type: "root",
      email: "learner@example.com",
      password: "correct-horse",
    });
    expect(good.status).toBe(200);
    expect((await t.call("GET", "/api/auth/session")).body.signedIn).toBe(true);
  });

  it("gives the same message for an unknown email as for a wrong password", async () => {
    const t = createTestApp();
    const res = await t.call("POST", "/api/auth/signin", {
      type: "root",
      email: "nobody@example.com",
      password: "whatever",
    });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe(
      "Your authentication information is incorrect. Please try again.",
    );
  });

  it("expires sessions", async () => {
    const t = createTestApp();
    await t.signUp();
    t.clock.advance(SESSION_TTL_MS + 1);
    expect((await t.call("GET", "/api/auth/session")).body).toEqual({ signedIn: false });
  });

  it("requires JSON, which blocks cross-site form posts", async () => {
    const t = createTestApp();
    const res = await t.app.request("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=a@b.co&accountName=x&password=12345678",
    });
    expect(res.status).toBe(415);
  });

  it("rejects requests addressed to a non-local host (DNS rebinding)", async () => {
    const t = createTestApp();
    const res = await t.app.request("http://evil.example/api/health");
    expect(res.status).toBe(403);
    expect((await t.app.request("http://127.0.0.1:4747/api/health")).status).toBe(200);
  });
});
