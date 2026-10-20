import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/web/src"),
    },
  },
  test: {
    fileParallelism: false,
    hookTimeout: 30_000,
    restoreMocks: true,
    testTimeout: 30_000,
  },
});
