import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    // Served from localhost, so bundle size matters far less than on the web.
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    // In dev, Vite serves the UI and forwards API calls to the CloudLearn server.
    proxy: { "/api": "http://127.0.0.1:4747" },
  },
});
