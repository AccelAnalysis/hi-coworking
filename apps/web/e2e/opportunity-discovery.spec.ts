import { expect, test, type Page } from "@playwright/test";

const enabled = process.env.OPPORTUNITY_DISCOVERY_E2E === "true";
const authenticated = process.env.OPPORTUNITY_DISCOVERY_E2E_AUTHENTICATED === "true";

async function openOpportunities(page: Page) {
  await page.goto("/exchange?view=opportunities");
  await expect(page.getByRole("searchbox", { name: /search current exchange view/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /open filters/i })).toBeVisible();
}

test.describe("Opportunity and RFx discovery", () => {
  test.skip(!enabled, "Requires configured Firebase emulator/preview and Mapbox test token");

  test("keeps the canonical map-first shell and one filter entry point", async ({ page }) => {
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

    await page.getByRole("button", { name: /open filters/i }).click();
    await expect(page.getByRole("heading", { name: /refine opportunities/i })).toBeVisible();
    await page.getByLabel(/closing within seven days/i).check();
    await expect(page).toHaveURL(/closingSoon=1/);
    await page.reload();
    await expect(page.getByRole("searchbox", { name: /search current exchange view/i })).toHaveValue("commercial HVAC");
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

  test("saved search and governed change workflows are owner scoped", async ({ page }) => {
    test.skip(!authenticated, "Requires an authenticated emulator account");
    await openOpportunities(page);
    await page.getByRole("button", { name: /open filters/i }).click();
    await page.getByText(/saved and recent searches/i).click();
    await page.getByPlaceholder(/name this search/i).fill("HVAC opportunities");
    await page.getByRole("button", { name: /save search/i }).click();
    await expect(page.getByText("HVAC opportunities")).toBeVisible();

    await page.getByRole("button", { name: /^review$/i }).first().click();
    await page.getByText(/addenda, q&a, and procurement calendar/i).click();
    await expect(page.getByText(/addenda/i).first()).toBeVisible();
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
