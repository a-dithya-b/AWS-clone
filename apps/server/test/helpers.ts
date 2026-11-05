import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, createCore } from "../src/app";
import type { Authorizer } from "../src/core/authorize";
import { FakeClock } from "../src/core/clock";
import { openDatabase } from "../src/core/db";
import type { ServiceModule } from "../src/core/service";
import { services as defaultServices } from "../src/services/registry";

export interface CallResult {
  status: number;
  // biome-ignore lint/suspicious/noExplicitAny: test responses are inspected loosely
  body: any;
  headers: Headers;
}

/** A fresh in-memory app with a fake clock. Each client keeps its own cookies (its own browser). */
export function createTestApp(opts: { services?: ServiceModule[]; authorizer?: Authorizer } = {}) {
  const clock = new FakeClock();
  const db = openDatabase(":memory:");
  const deps = createCore({
    db,
    clock,
    services: opts.services ?? defaultServices,
    authorizer: opts.authorizer,
    dataDir: mkdtempSync(join(tmpdir(), "cloudlearn-test-")),
  });
  const app = createApp(deps);

  function client() {
    let cookie = "";
    async function call(
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ): Promise<CallResult> {
      const res = await app.request(path, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0] ?? "";
      const text = await res.text();
      let json: unknown;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        json = text;
      }
      return { status: res.status, body: json, headers: res.headers };
    }

    return {
      call,
      action: (service: string, action: string, input: unknown = {}) =>
        call("POST", `/api/services/${service}/${action}`, input),
      signUp: (overrides: Partial<{ email: string; accountName: string; password: string }> = {}) =>
        call("POST", "/api/auth/signup", {
          email: "learner@example.com",
          accountName: "my-sandbox",
          password: "correct-horse",
          ...overrides,
        }),
      signInIam: (account: string, username: string, password: string) =>
        call("POST", "/api/auth/signin", { type: "iam", account, username, password }),
      clearCookies: () => {
        cookie = "";
      },
    };
  }

  const main = client();
  return { app, deps, clock, client, ...main };
}

export type TestClient = ReturnType<ReturnType<typeof createTestApp>["client"]>;

/** Asserts a call succeeded and returns its body. */
export function ok(res: CallResult) {
  if (res.status >= 400) {
    throw new Error(`Expected success, got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body;
}
