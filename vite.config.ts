import { defineConfig } from "vitest/config";

// The app is published at https://<user>.github.io/ib-paper-finder/
export default defineConfig({
  base: "/ib-paper-finder/",
  worker: { format: "es" },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  test: { include: ["tests/**/*.test.ts"] },
});
