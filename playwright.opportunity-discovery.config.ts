import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./apps/web/e2e",
  testMatch: "opportunity-discovery.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.OPPORTUNITY_DISCOVERY_E2E_BASE_URL ?? "http://127.0.0.1:3002",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: process.env.OPPORTUNITY_DISCOVERY_E2E_EXTERNAL_SERVER === "true"
    ? undefined
    : {
        command: "npm run dev:exchange",
        url: "http://127.0.0.1:3002",
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
