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
    // Playwright traces retain request headers, including Firebase bearer
    // tokens. Configured-development evidence must remain credential-free.
    trace: "off",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "configured-development-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "configured-development-chromium-large",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "configured-development-firefox",
      use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "configured-development-safari",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "configured-development-mobile-safari",
      use: { ...devices["iPhone 14"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "configured-development-mobile-safari-393",
      use: { ...devices["iPhone 14"], viewport: { width: 393, height: 852 } },
    },
    {
      name: "configured-development-mobile-safari-430",
      use: { ...devices["iPhone 14 Pro Max"], viewport: { width: 430, height: 932 } },
    },
  ],
});
