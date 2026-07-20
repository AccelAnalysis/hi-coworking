import { expect, test } from "@playwright/test";

const baseURL = process.env.EXCHANGE_DEV_BASE_URL;
const memberEmail = process.env.EXCHANGE_DEV_TEST_EMAIL;
const memberPassword = process.env.EXCHANGE_DEV_TEST_PASSWORD;
const adminEmail = process.env.EXCHANGE_DEV_ADMIN_EMAIL;
const adminPassword = process.env.EXCHANGE_DEV_ADMIN_PASSWORD;
const allowMutations = process.env.EXCHANGE_DEV_ALLOW_MUTATIONS === "true";
const requireSmoke = process.env.EXCHANGE_DEV_REQUIRE_SMOKE === "true";

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
      if (!String(error).includes("interrupted by another navigation")) throw error;
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

test.beforeEach(async () => {
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
