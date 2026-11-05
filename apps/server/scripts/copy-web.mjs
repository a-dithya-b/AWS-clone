// Copies the built web app into dist/public so the server can serve it.
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../../web/dist", import.meta.url));
const to = fileURLToPath(new URL("../dist/public", import.meta.url));

if (!existsSync(from)) {
  console.warn("[copy-web] apps/web/dist not found. Run `pnpm build` from the repo root.");
  process.exit(0);
}
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log("[copy-web] copied web app to dist/public");
