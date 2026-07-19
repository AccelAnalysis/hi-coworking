import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.EXCHANGE_DEV_BASE_URL || "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: /exchange-configured-development\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 25_000 },
  use: {
    baseURL,
    actionTimeout: 20_000,
    navigationTimeout: 40_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "configured-development-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "configured-development-mobile-safari",
      use: { ...devices["iPhone 14"] },
    },
  ],
});
