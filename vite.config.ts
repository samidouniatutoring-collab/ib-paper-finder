import { defineConfig } from "vitest/config";

// The app is published at https://<user>.github.io/ib-paper-finder/
export default defineConfig({
  base: "/ib-paper-finder/",
  worker: { format: "es" },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    // Three pages: Paper Finder, the standalone Transcriber and the Portfolio tracker.
    rollupOptions: { input: { main: "index.html", transcribe: "transcribe.html", stocks: "stocks.html" } },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
