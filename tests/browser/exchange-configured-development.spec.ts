import { expect, test } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const baseURL = process.env.EXCHANGE_DEV_BASE_URL;
const memberEmail = process.env.EXCHANGE_DEV_TEST_EMAIL;
const memberPassword = process.env.EXCHANGE_DEV_TEST_PASSWORD;
const adminEmail = process.env.EXCHANGE_DEV_ADMIN_EMAIL;
const adminPassword = process.env.EXCHANGE_DEV_ADMIN_PASSWORD;
const allowMutations = process.env.EXCHANGE_DEV_ALLOW_MUTATIONS === "true";
const requireSmoke = process.env.EXCHANGE_DEV_REQUIRE_SMOKE === "true";
const allowAccountJourney = process.env.EXCHANGE_DEV_ALLOW_ACCOUNT_JOURNEY === "true";
const allowLegacyJourney = process.env.EXCHANGE_DEV_ALLOW_LEGACY_JOURNEY === "true";
const PROJECT_ID = "hi-coworking-plat";
const EXPECTED_ATTESTATION = "I confirm I am authorized to represent this company.";

function requiredConfiguredDevelopmentInputsPresent() {
  return Boolean(baseURL && memberEmail && memberPassword);
}

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/exchange(?:\?|$)/);
}

async function gotoStable(page: import("@playwright/test").Page, path: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path.replaceAll("/", "\\/")}(?:\\?|$)`));
      return;
    } catch (error) {
      lastError = error;
      const message = String(error).toLowerCase();
      if (
        !message.includes("interrupted by another navigation")
        && !message.includes("frame load interrupted")
      ) throw error;
    }
  }
  throw lastError;
}

function captureSanitizedFunctionDiagnostics(page: import("@playwright/test").Page) {
  const diagnostics: Array<Record<string, unknown>> = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.hostname.endsWith("cloudfunctions.net")) return;
    diagnostics.push({
      type: "response",
      functionName: url.pathname.split("/").filter(Boolean).at(-1),
      status: response.status(),
    });
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (!url.hostname.endsWith("cloudfunctions.net")) return;
    diagnostics.push({
      type: "request-failed",
      functionName: url.pathname.split("/").filter(Boolean).at(-1),
      failure: request.failure()?.errorText || "unknown",
    });
  });
  return diagnostics;
}

async function deleteQueryDocuments(
  db: ReturnType<typeof getFirestore>,
  collection: string,
  field: string,
  value: string,
) {
  const snapshot = await db.collection(collection).where(field, "==", value).get();
  await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
}

test.beforeEach(async ({}, testInfo) => {
  const usesDisposableIdentity = testInfo.title.includes("disposable registration")
    || testInfo.title.includes("synthetic legacy master");
  if (usesDisposableIdentity) return;
  if (!requiredConfiguredDevelopmentInputsPresent() && requireSmoke) {
    throw new Error(
      "Configured-development smoke credentials are required. Set EXCHANGE_DEV_BASE_URL, EXCHANGE_DEV_TEST_EMAIL, and EXCHANGE_DEV_TEST_PASSWORD.",
    );
  }
  test.skip(
    !requiredConfiguredDevelopmentInputsPresent(),
    "Configured-development smoke environment is not supplied.",
  );
});

test("configured development permits sign-in, Exchange access, and a profile save", async ({ page }, testInfo) => {
  const functionDiagnostics = captureSanitizedFunctionDiagnostics(page);
  await login(page, memberEmail!, memberPassword!);

  await gotoStable(page, "/exchange");
  await expect(page).toHaveURL(/\/exchange/);
  await expect(page.locator("body")).toContainText(/Intelligence|Referrals|Opportunities|Resources/);

  await gotoStable(page, "/profile");
  await expect(page.getByRole("button", { name: "Save Profile" })).toBeVisible();
  await page.getByRole("button", { name: "Save Profile" }).click();
  const outcome = await Promise.race([
    page.getByText("Saved", { exact: true }).waitFor({ state: "visible" }).then(() => "saved" as const),
    page.getByText(/Diagnostic:/).waitFor({ state: "visible" }).then(() => "error" as const),
  ]);
  await testInfo.attach("configured-function-diagnostics.json", {
    body: Buffer.from(JSON.stringify(functionDiagnostics, null, 2)),
    contentType: "application/json",
  });
  expect(outcome, `Configured profile save failed: ${JSON.stringify(functionDiagnostics)}`).toBe("saved");
});

test("configured development completes a disposable registration, profile, and enrichment journey", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "configured-development-chromium", "The disposable mutation runs once in Chromium.");
  test.skip(!allowAccountJourney, "Set EXCHANGE_DEV_ALLOW_ACCOUNT_JOURNEY=true for the guarded disposable journey.");

  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const email = `codex-exchange-smoke-${suffix}@example.test`;
  const password = `Codex!${crypto.randomUUID()}9a`;
  const displayName = "Codex Journey Acceptance";
  const adminApp = getApps().find((app) => app.name === "configured-account-journey")
    ?? initializeApp({ projectId: PROJECT_ID }, "configured-account-journey");
  const adminAuth = getAuth(adminApp);
  const db = getFirestore(adminApp);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.name));

  let uid: string | undefined;
  try {
    await page.goto("/register");
    await page.getByLabel("Full Name").fill(displayName);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/profile\?onboarding=1$/, { timeout: 40_000 });

    await expect.poll(async () => {
      try {
        const record = await adminAuth.getUserByEmail(email);
        uid = record.uid;
        const [userDocument, profileDocument] = await Promise.all([
          db.collection("users").doc(record.uid).get(),
          db.collection("profiles").doc(record.uid).get(),
        ]);
        return {
          role: record.customClaims?.role,
          userRole: userDocument.data()?.role,
          membershipStatus: userDocument.data()?.membershipStatus,
          profileVersion: profileDocument.data()?.profileVersion,
          published: profileDocument.data()?.published,
        };
      } catch {
        return null;
      }
    }).toEqual({
      role: "member",
      userRole: "member",
      membershipStatus: "none",
      profileVersion: 0,
      published: false,
    });
    expect(uid).toBeTruthy();
    expect((await db.collection("orgMembers").where("uid", "==", uid!).get()).empty).toBe(true);
    expect((await adminAuth.getUser(uid!)).customClaims).not.toHaveProperty("adminMarketingEmail");

    await page.getByPlaceholder("Acme Consulting LLC").fill("International Business Machines Corporation");
    await page.getByLabel("City").fill("Armonk");
    await page.getByLabel("State / region").fill("NY");
    await page.getByLabel("Business domain").fill("ibm.com");
    await page.getByRole("button", { name: "Save Profile" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByPlaceholder("Acme Consulting LLC"))
      .toHaveValue("International Business Machines Corporation");
    await expect(page.getByLabel("City")).toHaveValue("Armonk");

    await page.getByRole("button", { name: "Search candidate matches" }).click();
    await expect(page.getByText(/SAM\.gov: unavailable · USAspending: ok/i)).toBeVisible({ timeout: 30_000 });
    const review = page.getByRole("group", { name: "Choose the exact fields to apply" });
    await expect(review).toBeVisible();
    const fieldCheckboxes = review.getByRole("checkbox");
    expect(await fieldCheckboxes.count()).toBeGreaterThanOrEqual(2);
    for (let index = 0; index < await fieldCheckboxes.count(); index += 1) {
      await fieldCheckboxes.nth(index).check();
    }
    await page.getByPlaceholder(EXPECTED_ATTESTATION).fill(EXPECTED_ATTESTATION);
    await page.getByLabel(/I certify this information is mine/).check();
    await page.getByLabel(/I understand false representation/).check();
    const linkResponse = page.waitForResponse((response) =>
      response.url().endsWith("/enrichment_link") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Link selected company" }).click();
    expect((await linkResponse).status()).toBe(200);

    const linkedProfile = (await db.collection("profiles").doc(uid!).get()).data();
    expect(linkedProfile).toMatchObject({
      uid,
      profileSchemaVersion: 3,
      profileVersion: 2,
      enrichmentSource: "usaspending",
      published: false,
    });
    expect(linkedProfile?.enrichmentMatchId).toEqual(expect.any(String));
    expect(Object.keys(linkedProfile?.enrichmentFieldProvenance || {}).length).toBeGreaterThanOrEqual(2);

    await page.reload();
    await expect(page.getByPlaceholder("Acme Consulting LLC"))
      .toHaveValue(String(linkedProfile?.businessName));
    await page.getByRole("button", { name: "Open account menu" }).click();
    await page.getByRole("button", { name: "Sign Out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await login(page, email, password);
    await gotoStable(page, "/profile");
    await expect(page.getByPlaceholder("Acme Consulting LLC"))
      .toHaveValue(String(linkedProfile?.businessName));
    await page.getByRole("link", { name: "Continue to Exchange" }).click();
    await expect(page).toHaveURL(/\/exchange(?:\?|$)/);

    expect(consoleErrors.filter((message) => message.includes("Profile update failed"))).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    let record;
    try {
      record = await adminAuth.getUserByEmail(email);
    } catch {
      record = null;
    }
    if (record) {
      const createdAt = Date.parse(record.metadata.creationTime);
      const safeIdentity = email.startsWith("codex-exchange-smoke-")
        && email.endsWith("@example.test")
        && record.displayName === displayName
        && Date.now() - createdAt < 60 * 60 * 1_000;
      if (!safeIdentity) throw new Error("Refusing cleanup because the disposable identity guard did not match");
      await adminAuth.deleteUser(record.uid);
      await Promise.all([
        deleteQueryDocuments(db, "enrichmentRequests", "uid", record.uid),
        deleteQueryDocuments(db, "enrichmentRateLimit", "uid", record.uid),
        deleteQueryDocuments(db, "exchangeAudit", "actorUid", record.uid),
        deleteQueryDocuments(db, "verificationAuditLog", "uid", record.uid),
      ]);
      await Promise.all([
        db.collection("publicProfiles").doc(record.uid).delete(),
        db.collection("profiles").doc(record.uid).delete(),
        db.collection("users").doc(record.uid).delete(),
      ]);
    }
  }
});

test("configured development migrates a guarded synthetic legacy master profile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "configured-development-chromium", "The legacy mutation runs once in Chromium.");
  test.skip(!allowLegacyJourney, "Set EXCHANGE_DEV_ALLOW_LEGACY_JOURNEY=true for the guarded legacy journey.");

  const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const email = `codex-legacy-master-${suffix}@example.test`;
  const password = `Codex!${crypto.randomUUID()}9a`;
  const displayName = "Codex Legacy Master Acceptance";
  const legacyBusinessName = "Codex Legacy Business";
  const adminApp = getApps().find((app) => app.name === "configured-legacy-journey")
    ?? initializeApp({ projectId: PROJECT_ID }, "configured-legacy-journey");
  const adminAuth = getAuth(adminApp);
  const db = getFirestore(adminApp);
  let uid: string | undefined;

  try {
    const record = await adminAuth.createUser({ email, password, displayName });
    uid = record.uid;
    await adminAuth.setCustomUserClaims(uid, {
      role: "master",
      developmentTestAccount: true,
      developmentTestPurpose: "configured-legacy-profile-acceptance",
    });
    const now = Date.now();
    await Promise.all([
      db.collection("users").doc(uid).set({
        uid,
        email,
        displayName,
        role: "master",
        membershipStatus: "none",
        createdAt: now,
        updatedAt: now,
      }),
      db.collection("profiles").doc(uid).set({
        uid,
        businessName: legacyBusinessName,
        bio: "Synthetic legacy profile for configured-development migration acceptance.",
        published: false,
        createdAt: now,
        updatedAt: now,
      }),
    ]);

    await login(page, email, password);
    await gotoStable(page, "/profile");
    await expect(page.getByPlaceholder("Acme Consulting LLC")).toHaveValue(legacyBusinessName);
    await expect.poll(async () => {
      const [authRecord, profileSnapshot] = await Promise.all([
        adminAuth.getUser(uid!),
        db.collection("profiles").doc(uid!).get(),
      ]);
      return {
        role: authRecord.customClaims?.role,
        schema: profileSnapshot.data()?.profileSchemaVersion ?? null,
        version: profileSnapshot.data()?.profileVersion,
      };
    }).toEqual({ role: "master", schema: null, version: 0 });

    await page.getByRole("button", { name: "Save Profile" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect.poll(async () => {
      const [authRecord, profileSnapshot] = await Promise.all([
        adminAuth.getUser(uid!),
        db.collection("profiles").doc(uid!).get(),
      ]);
      return {
        role: authRecord.customClaims?.role,
        schema: profileSnapshot.data()?.profileSchemaVersion,
        version: profileSnapshot.data()?.profileVersion,
        migrated: Number.isFinite(profileSnapshot.data()?.legacyMigratedAt),
        published: profileSnapshot.data()?.published,
      };
    }).toEqual({ role: "master", schema: 3, version: 1, migrated: true, published: false });

    await page.reload();
    await expect(page.getByPlaceholder("Acme Consulting LLC")).toHaveValue(legacyBusinessName);
  } finally {
    let record;
    try {
      record = await adminAuth.getUserByEmail(email);
    } catch {
      record = null;
    }
    if (record) {
      const createdAt = Date.parse(record.metadata.creationTime);
      const safeIdentity = email.startsWith("codex-legacy-master-")
        && email.endsWith("@example.test")
        && record.displayName === displayName
        && record.customClaims?.developmentTestPurpose === "configured-legacy-profile-acceptance"
        && Date.now() - createdAt < 60 * 60 * 1_000;
      if (!safeIdentity) throw new Error("Refusing cleanup because the synthetic legacy identity guard did not match");
      await adminAuth.deleteUser(record.uid);
      await Promise.all([
        deleteQueryDocuments(db, "exchangeAudit", "actorUid", record.uid),
        deleteQueryDocuments(db, "verificationAuditLog", "uid", record.uid),
      ]);
      await Promise.all([
        db.collection("publicProfiles").doc(record.uid).delete(),
        db.collection("profiles").doc(record.uid).delete(),
        db.collection("users").doc(record.uid).delete(),
      ]);
    }
  }
});

test("configured development can create a disposable organization when explicitly enabled", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "configured-development-chromium", "Mutating smoke runs once in Chromium.");
  test.skip(!allowMutations, "Set EXCHANGE_DEV_ALLOW_MUTATIONS=true to exercise controlled development writes.");

  await login(page, memberEmail!, memberPassword!);
  const suffix = `${Date.now()}-${testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const organizationName = `Exchange Development Smoke ${suffix}`;
  const city = process.env.EXCHANGE_DEV_TEST_CITY || "Smithfield";

  await gotoStable(page, "/exchange/onboarding");
  await page.getByLabel("Organization name").fill(organizationName);
  await page.getByLabel("City").fill(city);
  await page.getByRole("button", { name: "Search organizations" }).click();
  await expect(page.getByText("No likely match found")).toBeVisible();
  await page.getByRole("button", { name: "Create and return to Exchange" }).click();
  await expect(page).toHaveURL(/\/exchange(?:\?|$)/);
});

test("configured development can submit and review a dedicated seeded claim when explicitly enabled", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "configured-development-chromium", "Mutating smoke runs once in Chromium.");

  const claimOrganizationName = process.env.EXCHANGE_DEV_CLAIM_ORGANIZATION_NAME;
  const claimOrganizationCity = process.env.EXCHANGE_DEV_CLAIM_ORGANIZATION_CITY || "Smithfield";
  const reviewAction = process.env.EXCHANGE_DEV_CLAIM_REVIEW_ACTION === "approve" ? "Approve" : "Reject";
  const claimInputsPresent = Boolean(
    allowMutations
    && claimOrganizationName
    && adminEmail
    && adminPassword,
  );

  test.skip(
    !claimInputsPresent,
    "Set mutation mode, a dedicated seeded organization, and development admin credentials to exercise claim review.",
  );

  await login(page, memberEmail!, memberPassword!);
  await gotoStable(page, "/exchange/onboarding");
  await page.getByLabel("Organization name").fill(claimOrganizationName!);
  await page.getByLabel("City").fill(claimOrganizationCity);
  await page.getByRole("button", { name: "Search organizations" }).click();
  await expect(page.getByText(claimOrganizationName!, { exact: false })).toBeVisible();
  await page.getByLabel("Why are you authorized to claim this organization?").fill(
    "Configured-development acceptance request using a dedicated non-production test organization.",
  );
  await page.getByRole("button", { name: "Request claim" }).click();
  await expect(page.getByText(/Claim request received/)).toBeVisible();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, adminEmail!, adminPassword!);
  await gotoStable(adminPage, "/admin/exchange-claims");

  const claimCard = adminPage.locator("article").filter({ hasText: claimOrganizationName! }).first();
  await expect(claimCard).toBeVisible();
  await claimCard.getByLabel("Review note").fill(
    `Configured-development smoke review: ${reviewAction.toLowerCase()} at ${new Date().toISOString()}.`,
  );
  await claimCard.getByRole("button", { name: reviewAction }).click();
  await expect(claimCard).not.toBeVisible();
  await adminContext.close();
});
