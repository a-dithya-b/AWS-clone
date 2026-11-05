import { defineConfig } from "tsdown";

// Bundles the server and the workspace packages into one file, so it can later ship as `npx cloudlearn`.
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  deps: { alwaysBundle: [/^@cloudlearn\//] },
});
