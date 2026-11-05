import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { authRoutes } from "./core/auth-routes";
import type { Authorizer } from "./core/authorize";
import { buildCatalog } from "./core/catalog";
import { type Clock, systemClock } from "./core/clock";
import { type Db, runMigrations } from "./core/db";
import { AwsError } from "./core/errors";
import { EventBus } from "./core/event-bus";
import { type AppEnv, loadSession, loopbackHostOnly } from "./core/http";
import { coreMigrations } from "./core/migrations";
import { serviceRoutes } from "./core/pipeline";
import type { CoreDeps, ServiceModule } from "./core/service";
import { createIamAuthorizer } from "./services/iam/authorizer";

export interface CreateCoreOptions {
  db: Db;
  services: ServiceModule[];
  clock?: Clock;
  /** Defaults to real IAM policy evaluation. */
  authorizer?: Authorizer;
  /** Folder for files services keep outside SQLite (S3 objects). Tests use a temp folder. */
  dataDir?: string;
}

/**
 * Runs migrations (core first, then each service's), seeds services, and wires up the shared
 * dependencies.
 */
export function createCore(opts: CreateCoreOptions): CoreDeps {
  runMigrations(opts.db, [...coreMigrations, ...opts.services.flatMap((s) => s.migrations ?? [])]);
  const clock = opts.clock ?? systemClock;
  const deps: CoreDeps = {
    db: opts.db,
    clock,
    authorizer: opts.authorizer ?? createIamAuthorizer(opts.db, clock),
    services: opts.services,
    bus: new EventBus(),
    dataDir: opts.dataDir ?? "",
  };
  for (const service of opts.services) service.seed?.(deps);
  return deps;
}

/** Starts every service's background work. Returns a function that stops it all. */
export function startServices(deps: CoreDeps): () => void {
  const stops = deps.services.map((s) => s.start?.(deps)).filter((f): f is () => void => !!f);
  return () => {
    for (const stop of stops) stop();
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
  // Every simulated IAM action, for the policy editor's autocomplete, validation and summaries.
  const catalog = buildCatalog(deps.services);
  app.get("/api/meta/catalog", (c) => c.json({ actions: catalog }));
  app.route("/api/auth", authRoutes(deps));
  app.route("/api/services", serviceRoutes(deps));
  for (const service of deps.services) {
    const extra = service.routes?.(deps);
    if (extra) app.route(`/api/x/${service.id}`, extra);
  }
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
