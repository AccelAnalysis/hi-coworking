import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 30_000,
    restoreMocks: true,
    testTimeout: 30_000,
  },
});
