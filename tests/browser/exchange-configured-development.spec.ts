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

test.beforeEach(async ({}, testInfo) => {
  if (!requiredConfiguredDevelopmentInputsPresent()) {
    if (requireSmoke) {
      throw new Error(
        "Configured-development smoke credentials are required. Set EXCHANGE_DEV_BASE_URL, EXCHANGE_DEV_TEST_EMAIL, and EXCHANGE_DEV_TEST_PASSWORD.",
      );
    }
    testInfo.skip(true, "Configured-development smoke environment is not supplied.");
  }
});

test("configured development permits sign-in, Exchange access, and a profile save", async ({ page }) => {
  await login(page, memberEmail!, memberPassword!);

  await page.goto("/exchange");
  await expect(page).toHaveURL(/\/exchange/);
  await expect(page.locator("body")).toContainText(/Intelligence|Referrals|Opportunities|Resources/);

  await page.goto("/profile");
  await expect(page.getByRole("button", { name: "Save Profile" })).toBeVisible();
  await page.getByRole("button", { name: "Save Profile" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
});

test("configured development can create a disposable organization when explicitly enabled", async ({ page }, testInfo) => {
  testInfo.skip(!allowMutations, "Set EXCHANGE_DEV_ALLOW_MUTATIONS=true to exercise controlled development writes.");

  await login(page, memberEmail!, memberPassword!);
  const suffix = `${Date.now()}-${testInfo.project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const organizationName = `Exchange Development Smoke ${suffix}`;
  const city = process.env.EXCHANGE_DEV_TEST_CITY || "Smithfield";

  await page.goto("/exchange/onboarding");
  await page.getByLabel("Organization name").fill(organizationName);
  await page.getByLabel("City").fill(city);
  await page.getByRole("button", { name: "Search organizations" }).click();
  await expect(page.getByText("No likely match found")).toBeVisible();
  await page.getByRole("button", { name: "Create and return to Exchange" }).click();
  await expect(page).toHaveURL(/\/exchange(?:\?|$)/);
});

test("configured development can submit and review a dedicated seeded claim when explicitly enabled", async ({ page, browser }, testInfo) => {
  const claimOrganizationName = process.env.EXCHANGE_DEV_CLAIM_ORGANIZATION_NAME;
  const claimOrganizationCity = process.env.EXCHANGE_DEV_CLAIM_ORGANIZATION_CITY || "Smithfield";
  const reviewAction = process.env.EXCHANGE_DEV_CLAIM_REVIEW_ACTION === "approve" ? "Approve" : "Reject";
  const claimInputsPresent = Boolean(
    allowMutations
    && claimOrganizationName
    && adminEmail
    && adminPassword,
  );

  testInfo.skip(
    !claimInputsPresent,
    "Set mutation mode, a dedicated seeded organization, and development admin credentials to exercise claim review.",
  );

  await login(page, memberEmail!, memberPassword!);
  await page.goto("/exchange/onboarding");
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
  await adminPage.goto("/admin/exchange-claims");

  const claimCard = adminPage.locator("article").filter({ hasText: claimOrganizationName! }).first();
  await expect(claimCard).toBeVisible();
  await claimCard.getByLabel("Review note").fill(
    `Configured-development smoke review: ${reviewAction.toLowerCase()} at ${new Date().toISOString()}.`,
  );
  await claimCard.getByRole("button", { name: reviewAction }).click();
  await expect(claimCard).not.toBeVisible();
  await adminContext.close();
});
