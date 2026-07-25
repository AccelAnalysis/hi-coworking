import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const registration = readFileSync("apps/web/src/app/register/page.tsx", "utf8");
const login = readFileSync("apps/web/src/app/login/page.tsx", "utf8");
const onboarding = readFileSync("apps/web/src/app/exchange/onboarding/page.tsx", "utf8");
const activation = readFileSync("apps/functions/src/exchange/businessActivation.ts", "utf8");
const founding = readFileSync("apps/web/src/app/exchange/founding/page.tsx", "utf8");
const exchangePage = readFileSync("apps/web/src/app/exchange/page.tsx", "utf8");

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

  it("repairs interrupted accounts automatically without a manual setup detour", () => {
    expect(login).toContain('state.data.currentStep === "account"');
    expect(login).toContain("repairAccount");
    expect(login).toContain("registrationVersion: 1");
    expect(login).toContain('router.replace("/exchange/onboarding")');
    expect(login).not.toContain('"/register?resume=1"');
    expect(registration).toContain("deleteUser(createdUser)");
    expect(registration).toContain("No partial account was kept");
    expect(registration).not.toContain('get("resume") === "1"');
    expect(registration).not.toContain("Complete account setup");
    expect(registration).not.toContain("initializationPending");
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
    expect(onboarding).not.toContain("tab=enrichment");
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

  it("persists a marker with distinct public privacy modes", () => {
    for (const mode of ["exact", "approximate", "locality", "private"]) {
      expect(activation).toContain(`"${mode}"`);
      expect(onboarding).toContain(`"${mode}"`);
    }
    expect(activation).toContain("publicOrganizationLocations");
    expect(activation).toContain("private_actor_visible");
    expect(activation).toContain("private_home_suppressed");
  });

  it("opens the map in 3D before profile or membership conversion", () => {
    expect(onboarding).toContain('z: "17.2"');
    expect(onboarding).toContain('p: "52"');
    expect(onboarding).toContain('onboardingSuccess: "1"');
    expect(exchangePage).toContain("Your business is now on The RFxchange.");
    expect(exchangePage).toContain("Complete My Profile");
    expect(exchangePage).toContain("Explore the Exchange");
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
