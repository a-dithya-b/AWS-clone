import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { z } from "zod";
import { AwsError } from "./errors";
import type { CoreDeps } from "./service";
import { findSession, SESSION_COOKIE, type Session } from "./sessions";

export type AppEnv = { Variables: { session: Session | null } };

/**
 * Reads a JSON body. Requiring Content-Type: application/json also blocks simple cross-site form
 * posts, because browsers must ask permission (CORS preflight) before sending JSON to another site.
 */
export async function readJsonBody(c: Context): Promise<unknown> {
  if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AwsError(
      "UnsupportedMediaType",
      "Requests must use Content-Type: application/json.",
      415,
    );
  }
  try {
    return await c.req.json();
  } catch {
    throw new AwsError("SerializationException", "The request body is not valid JSON.");
  }
}

/** Formats zod issues the way AWS reports validation errors. */
export function validationMessage(error: z.ZodError): string {
  const n = error.issues.length;
  const details = error.issues
    .map((i) => (i.path.length ? `'${i.path.join(".")}': ${i.message}` : i.message))
    .join("; ");
  return `${n} validation error${n === 1 ? "" : "s"} detected: ${details}`;
}

export function parseInput<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  code = "ValidationError",
): z.output<S> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new AwsError(code, validationMessage(result.error));
  return result.data;
}

export function loadSession(deps: CoreDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE);
    c.set("session", (token && findSession(deps.db, deps.clock, token)) || null);
    await next();
  };
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Protects against DNS rebinding: a malicious website pointing its own domain at 127.0.0.1 to read
 * your local server. Requests must name a loopback host. Skipped if you bind to a LAN interface.
 */
export function loopbackHostOnly(enabled: boolean): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (enabled && !LOOPBACK_HOSTNAMES.has(new URL(c.req.url).hostname)) {
      return c.text("CloudLearn only accepts requests addressed to localhost.", 403);
    }
    await next();
  };
}
