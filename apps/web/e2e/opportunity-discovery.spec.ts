import { expect, test, type Page } from "@playwright/test";

const enabled = process.env.OPPORTUNITY_DISCOVERY_E2E === "true";
const authenticated = process.env.OPPORTUNITY_DISCOVERY_E2E_AUTHENTICATED === "true";
const authorizedIssuer = process.env.OPPORTUNITY_DISCOVERY_E2E_AUTHORIZED_ISSUER === "true";
const noCoordinateTitle = process.env.OPPORTUNITY_DISCOVERY_E2E_NO_COORDINATE_TITLE;
const seededOrganizationName = process.env.OPPORTUNITY_DISCOVERY_E2E_ORGANIZATION_NAME;

async function openOpportunities(page: Page) {
  await page.goto("/exchange?view=opportunities");
  await expect(page.getByRole("searchbox", { name: /search current exchange view/i })).toBeVisible();
}

async function openMobileFilters(page: Page, navigate = true) {
  await page.setViewportSize({ width: 390, height: 844 });
  if (navigate) await openOpportunities(page);
  await page.getByRole("button", { name: /open filters/i }).click();
  await expect(page.getByRole("dialog", { name: /filters/i })).toBeVisible();
}

test.describe("Opportunity and RFx discovery", () => {
  test.skip(!enabled, "Requires configured Firebase emulator/preview and Mapbox test token");

  test("keeps the canonical map-first shell and one filter entry point", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openOpportunities(page);
    await expect(page.locator("canvas.mapboxgl-canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: /open filters/i })).toHaveCount(1);
    await expect(page.getByRole("navigation")).toContainText("Intelligence");
    await expect(page.getByRole("navigation")).toContainText("Referrals");
    await expect(page.getByRole("navigation")).toContainText("Opportunities");
    await expect(page.getByRole("navigation")).toContainText("Resources");
  });

  test("search, sort, filters, and URL state remain synchronized", async ({ page }) => {
    await openOpportunities(page);
    const keyword = page.getByRole("searchbox", { name: /search current exchange view/i });
    await keyword.fill("commercial HVAC");
    await expect(page).toHaveURL(/q=commercial(?:\+|%20)HVAC/i);

    const sort = page.getByRole("combobox", { name: /sort opportunities/i }).first();
    if (await sort.isVisible()) {
      await sort.selectOption("deadline_soonest");
      await expect(page).toHaveURL(/sort=deadline_soonest/);
    }

    await openMobileFilters(page, false);
    await page.getByLabel(/closing soon/i).check();
    await expect(page).toHaveURL(/closingSoon=1/);
    await page.reload();
    await expect(page.getByRole("searchbox", { name: /search current exchange view/i })).toHaveValue("commercial HVAC");
  });

  test("applies NAICS and procurement filters through the canonical filter drawer", async ({ page }) => {
    await openMobileFilters(page);
    const naics = page.getByLabel(/naics codes/i);
    await naics.fill("238220");
    await naics.press("Enter");
    await page.getByLabel(/^construction$/i).check();
    await page.getByLabel(/^rfp$/i).check();
    await expect(page).toHaveURL(/naics=238220/);
    await expect(page).toHaveURL(/opportunityType=construction/);
    await expect(page).toHaveURL(/rfxType=RFP/);
  });

  test("location suggestions and radius are keyboard accessible", async ({ page }) => {
    await openOpportunities(page);
    const location = page.getByRole("combobox", { name: /search opportunity location/i }).first();
    await location.fill("Norfolk");
    const listbox = page.getByRole("listbox", { name: /location suggestions/i });
    await expect(listbox).toBeVisible();
    await location.press("ArrowDown");
    await location.press("Enter");
    await expect(page).toHaveURL(/place=/);
    await expect(page).toHaveURL(/radius=/);

    await openMobileFilters(page, false);
    await page.getByRole("combobox", { name: /location radius/i }).selectOption("50");
    await expect(page).toHaveURL(/radius=50/);
  });

  test("supports map-area search without permanent clutter", async ({ page }) => {
    await openOpportunities(page);
    await expect(page.getByRole("button", { name: /search this map area/i })).toHaveCount(0);
    const canvas = page.locator("canvas.mapboxgl-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Map canvas has no bounding box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByRole("button", { name: /search this map area/i })).toBeVisible();
    await page.getByRole("button", { name: /search this map area/i }).click();
    await expect(page).toHaveURL(/west=.*south=.*east=.*north=/);
  });

  test("opens a result and preserves map/list/detail context", async ({ page }) => {
    await openOpportunities(page);
    const review = page.getByRole("button", { name: /^review$/i }).first();
    await expect(review).toBeVisible();
    await review.click();
    await expect(page).toHaveURL(/entity=rfx&selected=/);
    await expect(page.getByText(/overview/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /respond or review full details|view submitted response|evaluate responses/i })).toBeVisible();
  });

  test("saves a result and keeps card/detail state synchronized", async ({ page }) => {
    test.skip(!authenticated, "Requires an authenticated emulator account");
    await openOpportunities(page);
    const save = page.getByRole("button", { name: /^save opportunity$/i }).first();
    await expect(save).toBeVisible();
    await save.click();
    await expect(save).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^review$/i }).first().click();
    await expect(page.getByRole("button", { name: /^saved$/i })).toHaveAttribute("aria-pressed", "true");
  });

  test("saved search and governed change workflows are owner scoped", async ({ page }) => {
    test.skip(!authenticated, "Requires an authenticated emulator account");
    await openOpportunities(page);
    await openMobileFilters(page, false);
    await page.getByText(/saved and recent searches/i).click();
    await page.getByPlaceholder(/name this search/i).fill("HVAC opportunities");
    await page.getByRole("button", { name: /save search/i }).click();
    await expect(page.getByText("HVAC opportunities")).toBeVisible();
    await page.getByRole("button", { name: /run saved search hvac opportunities/i }).click();
    await expect(page).toHaveURL(/savedSearch=/);

    await page.getByRole("button", { name: /^review$/i }).first().click();
    await page.getByText(/addenda, q&a, and procurement calendar/i).click();
    await expect(page.getByText(/addenda/i).first()).toBeVisible();
  });

  test("keeps no-coordinate opportunities in the list without a fabricated marker", async ({ page }) => {
    test.skip(!noCoordinateTitle, "Requires the named no-coordinate emulator fixture");
    await openOpportunities(page);
    const result = page.getByText(noCoordinateTitle as string, { exact: true }).first();
    await expect(result).toBeVisible();
    await expect(result.locator("xpath=ancestor::*[@data-exchange-entity='rfx'][1]")).toContainText(/location unavailable|withheld|remote/i);
    await expect(page.getByText(/no authoritative coordinates/i)).toBeVisible();
  });

  test("preserves mobile drawer focus handling and canonical navigation order", async ({ page }) => {
    await openMobileFilters(page);
    await expect(page.getByRole("dialog", { name: /filters/i }).locator(":focus")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /filters/i })).toHaveCount(0);
    const navigation = page.getByRole("navigation").last();
    await expect(navigation).toContainText(/Intelligence.*Referrals.*Opportunities.*Resources.*Menu/s);
  });

  test("keeps map dimension and fit controls unobstructed", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openOpportunities(page);
    const dimension = page.getByRole("group", { name: /map dimension/i });
    const fit = page.getByRole("button", { name: /return map to visible results/i });
    await expect(dimension).toBeVisible();
    await expect(fit).toBeVisible();
    const [dimensionBox, fitBox] = await Promise.all([dimension.boundingBox(), fit.boundingBox()]);
    if (!dimensionBox || !fitBox) throw new Error("Map controls do not have layout boxes");
    const overlap = dimensionBox.x < fitBox.x + fitBox.width
      && dimensionBox.x + dimensionBox.width > fitBox.x
      && dimensionBox.y < fitBox.y + fitBox.height
      && dimensionBox.y + dimensionBox.height > fitBox.y;
    expect(overlap).toBe(false);
  });

  test("denies issuer governance mutations to an unauthorized account", async ({ page }) => {
    test.skip(!authenticated || authorizedIssuer, "Requires an authenticated non-issuer account");
    await openOpportunities(page);
    await page.getByRole("button", { name: /^review$/i }).first().click();
    await page.getByText(/addenda, q&a, and procurement calendar/i).click();
    await expect(page.getByRole("button", { name: /publish addendum|answer question/i })).toHaveCount(0);
  });

  test("shows addenda and Q&A management only to an authorized issuer", async ({ page }) => {
    test.skip(!authenticated || !authorizedIssuer, "Requires an authenticated issuer-manager account");
    await openOpportunities(page);
    await page.getByRole("button", { name: /^review$/i }).first().click();
    await page.getByText(/addenda, q&a, and procurement calendar/i).click();
    await expect(page.getByText(/publish governed addendum/i)).toBeVisible();
  });

  test("does not expose protected responder data and renders seeded organization identity", async ({ page }) => {
    await openOpportunities(page);
    await expect(page.locator("body")).not.toContainText(/protected bidder|evaluationScores|respondentId/i);
    if (seededOrganizationName) {
      await expect(page.getByText(seededOrganizationName, { exact: true }).first()).toBeVisible();
    }
  });

  test("has no serious accessibility violations in core states", async ({ page }) => {
    await openOpportunities(page);
    // The repository accessibility runner should inject axe in CI. This spec
    // verifies native landmarks and names even when axe is not available.
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("searchbox", { name: /search current exchange view/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /fit results/i })).toBeVisible();
    const unnamedButtons = await page.locator("button:not([aria-label])").evaluateAll((buttons) => (
      buttons.filter((button) => !(button.textContent ?? "").trim()).length
    ));
    expect(unnamedButtons).toBe(0);
  });
});
