import { existsSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createApp, createCore, startServices } from "./app";
import { loadConfig } from "./core/config";
import { openDatabase } from "./core/db";
import { services } from "./services/registry";

const config = loadConfig();
const db = openDatabase(join(config.dataDir, "cloudlearn.db"));
const deps = createCore({ db, services, dataDir: config.dataDir });
const stopServices = startServices(deps);
const loopbackOnly = ["127.0.0.1", "localhost", "::1"].includes(config.host);
const app = createApp(deps, { webDir: config.webDir, loopbackOnly });

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  const host = loopbackOnly ? "localhost" : info.address;
  if (existsSync(join(config.webDir, "index.html"))) {
    console.log(`\n  CloudLearn is running at http://${host}:${info.port}`);
  } else {
    // Dev mode: Vite serves the UI on its own port and forwards /api calls here.
    console.log(`\n  CloudLearn API is running at http://${host}:${info.port}`);
    console.log("  Open the UI at http://localhost:5173");
  }
  console.log(`  Data: ${config.dataDir}\n`);
});

const shutdown = () => {
  stopServices();
  server.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
