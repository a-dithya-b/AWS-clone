import { createApp, createCore } from "../src/app";
import type { Authorizer } from "../src/core/authorize";
import { FakeClock } from "../src/core/clock";
import { openDatabase } from "../src/core/db";
import type { ServiceModule } from "../src/core/service";
import { services as defaultServices } from "../src/services/registry";

/** A fresh in-memory app with a fake clock, plus a tiny client that remembers cookies. */
export function createTestApp(opts: { services?: ServiceModule[]; authorizer?: Authorizer } = {}) {
  const clock = new FakeClock();
  const db = openDatabase(":memory:");
  const deps = createCore({
    db,
    clock,
    services: opts.services ?? defaultServices,
    authorizer: opts.authorizer,
  });
  const app = createApp(deps);

  let cookie = "";
  async function call(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
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
    const json = text ? JSON.parse(text) : undefined;
    return { status: res.status, body: json, headers: res.headers };
  }

  return {
    app,
    deps,
    clock,
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
    clearCookies: () => {
      cookie = "";
    },
  };
}
