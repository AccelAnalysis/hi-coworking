import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const PROJECT_ID = "demo-hi-coworking";
const PASSWORD = "browser-exchange-password";
const SCREENSHOT_DIR = "docs/exchange/screenshots/week1-org-reconciliation";
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
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/profile\?onboarding=1$/, { timeout: 40_000 });
  await page.getByRole("link", { name: "Continue to Exchange" }).click();
  await expect(page).toHaveURL(/\/exchange$/, { timeout: 40_000 });
  return email;
}

test.beforeEach(async () => {
  await clearEmulators();
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

test("new user creates an organization, saves a profile, and retains the canonical Exchange", async ({ page }) => {
  const email = await register(page, "ordinary-user");

  for (const viewport of [
    { width: 390, height: 844, name: "390x844" },
    { width: 393, height: 852, name: "393x852" },
    { width: 430, height: 932, name: "430x932" },
    { width: 1280, height: 800, name: "1280x800" },
    { width: 1440, height: 900, name: "1440x900" },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/exchange");
    await expect(page).toHaveURL(/\/exchange/);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/exchange-${viewport.name}.png`, fullPage: false });
  }

  await page.goto("/exchange/onboarding");
  await page.getByLabel("Organization name").fill("Browser Founder Studio LLC");
  await page.getByLabel("City").fill("Smithfield");
  await page.getByRole("button", { name: "Search organizations" }).click();
  await expect(page.getByText("No likely match found")).toBeVisible();
  await page.getByRole("button", { name: "Create and return to Exchange" }).click();
  await expect(page).toHaveURL(/\/exchange$/);

  const user = await adminAuth.getUserByEmail(email);
  const memberships = await db.collection("orgMembers").where("uid", "==", user.uid).get();
  expect(memberships.size).toBe(1);
  const organizationId = String(memberships.docs[0].data().orgId);
  expect((await db.collection("exchangeMemberships").doc(organizationId).get()).data()?.tier).toBe("free");
  expect((await db.collection("exchangeCreditAccounts").doc(organizationId).get()).data()?.usableCredits).toBe(0);

  await page.goto("/profile");
  await page.getByPlaceholder("Acme Consulting LLC").fill("Browser Founder Studio LLC");
  await page.getByRole("button", { name: "Save Profile" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
});

test("seeded claim is nonblocking, admin approval is audited, and a legacy admin profile saves", async ({ page, browser }) => {
  const now = Date.now();
  await db.collection("orgs").doc("browser-seeded-org").set({
    id: "browser-seeded-org",
    schemaVersion: 2,
    name: "Browser Seeded Services LLC",
    normalizedName: "browser seeded services",
    searchTokens: ["browser", "seeded", "services"],
    city: "Smithfield",
    county: "Isle of Wight",
    state: "VA",
    sources: ["test_fixture"],
    claimStatus: "unclaimed",
    verificationStatus: "unverified",
    exchangeVerificationStatus: "unverified",
    homeBased: false,
    privacySuppressed: false,
    status: "active",
    ownerUid: "",
    createdAt: now,
    updatedAt: now,
  });

  await register(page, "claimant");
  await page.goto("/exchange/onboarding");
  await page.getByLabel("Organization name").fill("Browser Seeded Services");
  await page.getByLabel("City").fill("Smithfield");
  await page.getByRole("button", { name: "Search organizations" }).click();
  await expect(page.getByText("Browser Seeded Services LLC")).toBeVisible();
  await page.getByLabel("Why are you authorized to claim this organization?").fill("I am the business owner and control its official domain.");
  await page.getByRole("button", { name: "Request claim" }).click();
  await expect(page.getByText(/Claim request received/)).toBeVisible();
  await page.getByRole("link", { name: "Open the Exchange map" }).first().click();
  await expect(page).toHaveURL(/\/exchange$/);

  await adminAuth.createUser({ uid: "legacy-super-admin", email: "legacy-admin@example.test", password: PASSWORD, emailVerified: true });
  await adminAuth.setCustomUserClaims("legacy-super-admin", { role: "master" });
  await db.collection("users").doc("legacy-super-admin").set({
    uid: "legacy-super-admin",
    email: "legacy-admin@example.test",
    role: "master",
    createdAt: now,
    updatedAt: now,
  });
  await db.collection("profiles").doc("legacy-super-admin").set({
    uid: "legacy-super-admin",
    businessName: "Legacy Admin Business",
    published: false,
    createdAt: now - 1000,
    updatedAt: now - 1000,
  });

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await adminPage.goto("/login");
  await adminPage.getByLabel("Email").fill("legacy-admin@example.test");
  await adminPage.getByLabel("Password").fill(PASSWORD);
  await adminPage.getByRole("button", { name: "Sign in" }).click();
  await expect(adminPage).toHaveURL(/\/exchange$/);

  await adminPage.goto("/admin/exchange-claims");
  await expect(adminPage.getByText("Browser Seeded Services LLC")).toBeVisible();
  await adminPage.getByLabel("Review note").fill("Authority confirmed in browser acceptance test.");
  await adminPage.getByRole("button", { name: "Approve" }).click();
  await expect(adminPage.getByText("No pending claims.")).toBeVisible();

  const approvedMembership = await db.collection("orgMembers").doc("browser-seeded-org_claimant").get();
  expect(approvedMembership.exists).toBe(false);
  const approvedClaims = await db.collection("organizationClaims").where("organizationId", "==", "browser-seeded-org").get();
  const claimantUid = String(approvedClaims.docs[0].data().requestedBy);
  expect((await db.collection("orgMembers").doc(`browser-seeded-org_${claimantUid}`).get()).data()?.role).toBe("owner");
  expect((await db.collection("exchangeAudit").where("entityType", "==", "organizationClaim").get()).size).toBeGreaterThan(0);

  await adminPage.goto("/profile");
  await adminPage.getByRole("button", { name: "Save Profile" }).click();
  await expect(adminPage.getByText("Saved", { exact: true })).toBeVisible();
  expect((await db.collection("profiles").doc("legacy-super-admin").get()).data()?.profileSchemaVersion).toBe(3);
  await adminContext.close();
});
