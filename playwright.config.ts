import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run dev --workspace web",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NEXT_PUBLIC_FIREBASE_API_KEY: "demo-key",
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-hi-coworking.firebaseapp.com",
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-hi-coworking",
      NEXT_PUBLIC_EXPECTED_FIREBASE_PROJECT_ID: "demo-hi-coworking",
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-hi-coworking.appspot.com",
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
      NEXT_PUBLIC_FIREBASE_APP_ID: "1:1234567890:web:demo",
      NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "true",
    },
  },
});
