import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "demo-hi-coworking";
const PASSWORD = "browser-exchange-password";
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8081";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9100";
const adminApp = getApps()[0] || initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(adminApp);
const adminAuth = getAuth(adminApp);

async function clearEmulators() {
  await fetch(`http://127.0.0.1:8081/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:9100/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: "DELETE" });
}

async function register(page: import("@playwright/test").Page, prefix: string) {
  const email = `${prefix}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Full Name").fill(`${prefix} User`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account and explore" }).click();
  await expect(page).toHaveURL(/\/exchange$/);
  await expect(page.getByRole("heading", { name: "RFx Marketplace" })).toBeVisible();
  return email;
}

test.beforeEach(clearEmulators);

test("Path A: registration opens the map before optional organization and Founding checkout", async ({ page }) => {
  const email = await register(page, "browser-founder");
  await page.goto("/exchange/onboarding");
  await expect(page.getByRole("link", { name: "Open Exchange map" })).toBeVisible();
  await page.getByLabel("Organization name").fill("Browser Founder Studio LLC");
  await page.getByLabel("City").fill("Smithfield");
  await page.getByRole("button", { name: "Search organizations" }).click();
  await expect(page.getByText("No likely match found")).toBeVisible();
  await page.getByRole("button", { name: "Create and return to Exchange" }).click();
  await expect(page).toHaveURL(/\/exchange$/);
  await expect(page.getByRole("heading", { name: "RFx Marketplace" })).toBeVisible();

  const user = await adminAuth.getUserByEmail(email);
  const memberships = await db.collection("orgMembers").where("uid", "==", user.uid).get();
  expect(memberships.size).toBe(1);
  const organizationId = String(memberships.docs[0].data().orgId);
  await page.goto(`/exchange/membership?organizationId=${encodeURIComponent(organizationId)}`);
  await expect(page.getByRole("heading", { name: "Free Exchange Member" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Founding Member" })).toBeVisible();
  await page.getByRole("button", { name: "Become a Founding Member" }).click();
  await expect(page).toHaveURL(/\/exchange\/membership\/success\?.*mock=1/);
  await expect(page.getByRole("heading", { name: "Checkout received" })).toBeVisible();
});

test("Path B: claim stays nonblocking, admin approves, and claimant can manage membership", async ({ page, browser }) => {
  await db.collection("orgs").doc("browser-seeded-org").set({
    id: "browser-seeded-org", name: "Browser Seeded Services LLC", normalizedName: "browser seeded services",
    searchTokens: ["browser", "seeded", "services"], city: "Smithfield", state: "VA",
    sources: ["iow_companies"], claimStatus: "unclaimed", verificationStatus: "unverified",
    ownerUid: "", createdAt: Date.now(), updatedAt: Date.now(),
  });
  await register(page, "browser-claimant");
  await page.goto("/exchange/onboarding");
  await page.getByLabel("Organization name").fill("Browser Seeded Services");
  await page.getByLabel("City").fill("Smithfield");
  await page.getByRole("button", { name: "Search organizations" }).click();
  await expect(page.getByText("Browser Seeded Services LLC")).toBeVisible();
  await page.getByRole("button", { name: "Request claim" }).click();
  await expect(page.getByText(/Claim request received/)).toBeVisible();
  await expect(page.getByText("pending", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Continue exploring the Exchange" }).click();
  await expect(page).toHaveURL(/\/exchange$/);
  await expect(page.getByRole("heading", { name: "RFx Marketplace" })).toBeVisible();

  await adminAuth.createUser({ uid: "browser-admin", email: "browser-admin@example.test", password: PASSWORD, emailVerified: true });
  await adminAuth.setCustomUserClaims("browser-admin", { role: "admin" });
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await adminPage.goto("/login");
  await adminPage.getByLabel("Email").fill("browser-admin@example.test");
  await adminPage.getByLabel("Password").fill(PASSWORD);
  await adminPage.getByRole("button", { name: "Open the Exchange" }).click();
  await expect(adminPage).toHaveURL(/\/exchange$/);
  await adminPage.goto("/admin/exchange-claims");
  await expect(adminPage.getByRole("heading", { name: "Browser Seeded Services LLC" })).toBeVisible();
  await adminPage.getByLabel("Review note").fill("Authority confirmed in browser acceptance test");
  await adminPage.getByRole("button", { name: "Approve" }).click();
  await expect(adminPage.getByText("No pending claims.")).toBeVisible();
  await adminContext.close();

  await page.goto("/exchange/onboarding");
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Manage membership" }).click();
  await expect(page).toHaveURL(/\/exchange\/membership\?organizationId=browser-seeded-org/);
  await expect(page.getByRole("heading", { name: "Free Exchange Member" })).toBeVisible();
  await page.getByRole("button", { name: "Become a Founding Member" }).click();
  await expect(page).toHaveURL(/\/exchange\/membership\/success\?.*mock=1/);
});
