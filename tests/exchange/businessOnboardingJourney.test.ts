import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const registration = readFileSync("apps/web/src/app/register/page.tsx", "utf8");
const login = readFileSync("apps/web/src/app/login/page.tsx", "utf8");
const onboarding = readFileSync("apps/web/src/features/exchange/onboarding/StreamlinedOnboarding.tsx", "utf8");
const geographySearch = readFileSync("apps/web/src/features/exchange/onboarding/geographySearch.ts", "utf8");
const activation = readFileSync("apps/functions/src/exchange/businessActivation.ts", "utf8");
const founding = readFileSync("apps/web/src/app/exchange/founding/page.tsx", "utf8");
const exchangePage = readFileSync("apps/web/src/app/exchange/page.tsx", "utf8");
const enrichmentPage = readFileSync("apps/web/src/app/org/enrichment/page.tsx", "utf8");

describe("RFxchange business onboarding journey", () => {
  it("keeps account registration lightweight and business-only", () => {
    expect(registration).toContain("First name");
    expect(registration).toContain("Last name");
    expect(registration).toContain("Terms of Use");
    expect(registration).toContain("Privacy Policy");
    expect(registration).not.toContain("CAGE");
    expect(registration).not.toContain("UEI");
    expect(registration).not.toContain("Browse as an individual");
    expect(registration).not.toContain("professionalTitle");
  });

  it("repairs interrupted accounts and routes directly to the authoritative resume target", () => {
    expect(login).toContain('state.data.currentStep === "account"');
    expect(login).toContain("repairAccount");
    expect(login).toContain("registrationVersion: 1");
    expect(login).toContain("state.data.safeResumeRoute");
    expect(login).not.toContain('"/register?resume=1"');
    expect(registration).toContain("deleteUser(createdUser)");
    expect(registration).toContain("No partial account was kept");
    expect(registration).not.toContain("Complete account setup");
  });

  it("starts the visible setup at Community rather than a separate welcome gate", () => {
    expect(onboarding).toContain('type Step = "geography" | "organization" | "claim" | "location"');
    expect(onboarding).toContain("Step {Math.max(currentIndex + 1, 1)} of 3");
    expect(onboarding).toContain("Welcome to The RFxchange");
    expect(onboarding).not.toContain("Add My Business");
    expect(onboarding).toContain('action: "welcome_acknowledged"');
  });

  it("supports unrestricted place search while retaining managed territory authority", () => {
    expect(onboarding).toContain("Search any U.S. city, county, ZIP code, or locality");
    expect(geographySearch).toContain("api.mapbox.com/search/geocode/v6/forward");
    expect(geographySearch).toContain('"postcode,place,district,region"');
    expect(geographySearch).toContain("matchManagedTerritory");
    expect(onboarding).toContain('action: "geography_selected"');
  });

  it("places geography and marker activation before optional enrichment", () => {
    const geography = activation.indexOf('return "geography"');
    const organization = activation.indexOf('return "organization_search"');
    const location = activation.indexOf('return "business_location"');
    const marker = activation.indexOf('return "map_activation"');
    expect(geography).toBeGreaterThan(0);
    expect(organization).toBeGreaterThan(geography);
    expect(location).toBeGreaterThan(organization);
    expect(marker).toBeGreaterThan(location);
    expect(onboarding).toContain("Place My Business on the Exchange");
    expect(onboarding).not.toContain("enrichmentSearchFn");
  });

  it("completes organization search when a business is connected, created, or claimed", () => {
    const milestone = "patch.organizationSearchCompletedAt = state.organizationSearchCompletedAt ?? now";
    expect(activation.split(milestone).length - 1).toBeGreaterThanOrEqual(2);
    expect(activation).toContain('input.data.action === "organization_selected" || input.data.action === "organization_created"');
    expect(activation).toContain('input.data.action === "organization_claim_started"');
  });

  it("enforces released geography and server-authoritative address matching", () => {
    expect(activation).toContain('state.geography.status !== "released"');
    expect(activation).toContain("addressMatchesGeography");
    expect(onboarding).toContain('preferredOrientation: payload.visibility !== "private"');
    expect(activation).toContain("loadOrgAuthority");
    expect(activation).toContain("organizationClaims");
    expect(activation).toContain('geocoding_failed: "geocoding_failed"');
    expect(onboarding).toContain('action: "geocoding_failed"');
  });

  it("uses one marker progress call instead of serial address/geocode progress calls", () => {
    expect(onboarding).toContain('action: "marker_activated"');
    expect(onboarding).not.toContain('action: "address_confirmed"');
    expect(onboarding).not.toContain('action: "geocoding_completed"');
    expect(onboarding).toContain("authoritative completion transaction");
  });

  it("persists a marker with distinct public privacy modes", () => {
    for (const mode of ["exact", "approximate", "locality", "private"]) {
      expect(activation).toContain(`"${mode}"`);
      expect(onboarding).toContain(`"${mode}"`);
    }
    expect(activation).toContain("publicOrganizationLocations");
    expect(activation).toContain("private_actor_visible");
    expect(activation).toContain("private_home_suppressed");
  });

  it("opens the map in 3D before enrichment or membership conversion", () => {
    expect(onboarding).toContain('z: "17.2"');
    expect(onboarding).toContain('p: "52"');
    expect(onboarding).toContain('onboardingSuccess: "1"');
    expect(exchangePage).toContain("Your business is now on The RFxchange.");
    expect(exchangePage).toContain("Enrich &amp; Complete Profile");
    expect(exchangePage).toContain("Explore the Exchange");
    expect(exchangePage).toContain("Founding Membership");
    expect(exchangePage).toContain("/org/enrichment?organizationId=");
  });

  it("starts organization enrichment from trusted-source search and saves only selected identity suggestions", () => {
    expect(enrichmentPage).toContain("enrichmentSearchFn");
    expect(enrichmentPage).toContain("SAM.gov and USAspending");
    expect(enrichmentPage).toContain("Select what to apply");
    expect(enrichmentPage).toContain("selectedFields.includes");
    expect(enrichmentPage).toContain("exchange_updateOrganizationProfile");
    expect(enrichmentPage).toContain("does <strong>not</strong> verify your business");
    expect(enrichmentPage).toContain("Continue to profile");
  });

  it("does not fire four progress writes merely because the success card rendered", () => {
    expect(exchangePage).not.toContain("Promise.allSettled");
    expect(exchangePage).not.toContain('action: "onboarding_completed"');
    expect(exchangePage).toContain("recordOffer");
  });

  it("allows public exploration while a governed claim remains pending", () => {
    expect(onboarding).toContain('/exchange?claimPreview=1');
    expect(exchangePage).toContain('params.get("claimPreview") === "1"');
    expect(exchangePage).toContain('response.data.currentStep === "organization_claim_pending"');
    expect(activation).toContain('claimPending ? ["view_claim_status", "explore_public_exchange"]');
  });

  it("fails the Founding Membership handoff closed", () => {
    expect(founding).toContain("checkoutOpen");
    expect(founding).toContain("checkout_handoff_initiated");
    expect(founding).toContain("No premium permissions are activated without a valid membership state");
    expect(founding).toContain("No membership change was made");
  });

  it("retains one authoritative resumable state model", () => {
    expect(activation).toContain("exchangeOnboarding");
    expect(activation).toContain("const nextState: OnboardingState = { ...state, ...patch");
    expect(activation).toContain("safeResumeRoute");
    expect(activation).toContain("checkoutHandoffInitiatedAt");
  });
});
