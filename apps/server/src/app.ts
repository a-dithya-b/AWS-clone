import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authRoutes } from "./core/auth-routes";
import { type Authorizer, rootOnlyAuthorizer } from "./core/authorize";
import { type Clock, systemClock } from "./core/clock";
import { type Db, runMigrations } from "./core/db";
import { AwsError } from "./core/errors";
import { type AppEnv, loadSession, loopbackHostOnly } from "./core/http";
import { coreMigrations } from "./core/migrations";
import { serviceRoutes } from "./core/pipeline";
import type { CoreDeps, ServiceModule } from "./core/service";

export interface CreateCoreOptions {
  db: Db;
  services: ServiceModule[];
  clock?: Clock;
  authorizer?: Authorizer;
}

/** Runs migrations (core first, then each service's) and wires up the shared dependencies. */
export function createCore(opts: CreateCoreOptions): CoreDeps {
  runMigrations(opts.db, [...coreMigrations, ...opts.services.flatMap((s) => s.migrations ?? [])]);
  return {
    db: opts.db,
    clock: opts.clock ?? systemClock,
    authorizer: opts.authorizer ?? rootOnlyAuthorizer,
    services: opts.services,
  };
}

export interface CreateAppOptions {
  /** Built web app to serve. Skipped if missing (in dev, Vite serves the web app). */
  webDir?: string;
  /** Reject requests not addressed to localhost. On unless you bind to a non-loopback interface. */
  loopbackOnly?: boolean;
}

export function createApp(deps: CoreDeps, opts: CreateAppOptions = {}) {
  const app = new Hono<AppEnv>();

  app.use(loopbackHostOnly(opts.loopbackOnly ?? true));
  app.use("/api/*", loadSession(deps));

  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.route("/api/auth", authRoutes(deps));
  app.route("/api/services", serviceRoutes(deps));
  app.all("/api/*", (c) => c.json({ code: "NotFound", message: "No such API route." }, 404));

  const indexFile = opts.webDir ? join(opts.webDir, "index.html") : undefined;
  if (opts.webDir && indexFile && existsSync(indexFile)) {
    const indexHtml = readFileSync(indexFile, "utf8");
    app.use("/*", serveStatic({ root: opts.webDir }));
    // Single-page app: any other GET returns index.html and the browser router takes over.
    app.get("*", (c) => c.html(indexHtml));
  }

  app.onError((err, c) => {
    if (err instanceof AwsError) return c.json(err.toBody(), err.status);
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json(
      { code: "InternalFailure", message: "The request failed because of an unknown error." },
      500,
    );
  });

  return app;
}
