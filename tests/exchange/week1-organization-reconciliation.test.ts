import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("Week 1 organization reconciliation contract", () => {
  it("preserves the canonical map-centered Exchange route and four modes", () => {
    const route = read("apps/web/src/app/exchange/page.tsx");
    const navigation = read("apps/web/src/features/exchange/components/ExchangeMobileNavigation.tsx");
    expect(route).toContain("ExchangeWorkspace");
    expect(route).not.toContain("RfxMarketplace");
    for (const mode of ["intelligence", "referrals", "opportunities", "resources"]) {
      expect(navigation.toLowerCase()).toContain(mode);
    }
  });

  it("uses Run 4 commercial collections instead of the obsolete Week 1 ledger", () => {
    const organizations = read("apps/functions/src/exchange/organizations.ts");
    expect(organizations).toContain('collection("exchangeMemberships")');
    expect(organizations).toContain('collection("exchangeCreditAccounts")');
    expect(organizations).not.toContain('collection("organizationMemberships")');
    expect(organizations).not.toContain('collection("organizationCreditLots")');
  });

  it("keeps organization authority and claim review server-authoritative", () => {
    const organizations = read("apps/functions/src/exchange/organizations.ts");
    const rules = read("firestore.rules");
    expect(organizations).toContain("writeExchangeAudit");
    expect(organizations).toContain('role: "owner"');
    expect(organizations).toContain("Another claim was approved.");
    expect(rules).toContain("match /organizationClaims/{claimId}");
    expect(rules).toContain("allow read, create, update, delete: if false");
    expect(rules).toContain("match /organizationSourceCandidates/{candidateId}");
  });

  it("requires a claimant reason and preserves progressive browsing", () => {
    const onboarding = read("apps/web/src/app/exchange/onboarding/page.tsx");
    expect(onboarding).toContain("Why are you authorized");
    expect(onboarding).toContain("reason.length < 10");
    expect(onboarding).toContain('href="/exchange"');
    expect(onboarding).toContain("Skip for now");
  });

  it("publishes only the privacy-minimized organization projection", () => {
    const model = read("apps/functions/src/exchange/organizationModel.ts");
    expect(model).toContain("sanitizePublicOrganization");
    expect(model).toContain("privacySuppressed");
    expect(model).not.toMatch(/result\.ownerUid\s*=/);
    expect(model).not.toMatch(/result\.sourceIds\s*=/);
  });

  it("distinguishes actionable profile-save failure classes", () => {
    const diagnostics = read("apps/web/src/lib/profileUpdateDiagnostics.ts");
    for (const code of [
      "FUNCTION_NOT_DEPLOYED",
      "WRONG_FIREBASE_PROJECT",
      "UNAUTHENTICATED",
      "STALE_AUTH_TOKEN",
      "PERMISSION_DENIED",
      "INVALID_PROFILE_DATA",
      "LEGACY_PROFILE_REQUIRES_MIGRATION",
      "STORAGE_REFERENCE_INVALID",
      "NETWORK_UNAVAILABLE",
      "UNKNOWN",
    ]) {
      expect(diagnostics).toContain(code);
    }
    const page = read("apps/web/src/app/profile/page.tsx");
    expect(page).toContain("diagnoseProfileUpdateError");
    expect(page).not.toContain('setError("Failed to save. Please try again.")');
  });

  it("links enrichment only from a server-owned, caller-scoped request", () => {
    const entry = read("apps/functions/src/enrichment.ts");
    const search = read("apps/functions/src/enrichmentSearch.ts");
    const link = read("apps/functions/src/enrichmentLegacy.ts");
    const browserFunctions = read("apps/web/src/lib/functions.ts");
    expect(entry).toContain('export { enrichment_search } from "./enrichmentSearch"');
    expect(entry).toContain('export { enrichment_link } from "./enrichmentLegacy"');
    expect(search).toContain('collection("enrichmentRequests")');
    expect(link).toContain("enrichmentRequest?.uid !== uid");
    expect(link).toContain("Selected match was not returned by this enrichment request");
    expect(browserFunctions).toContain("requestId: string");
    expect(browserFunctions).not.toContain("selectedCandidate: Record<string, unknown>");
  });

  it("keeps seed imports guarded, idempotent, and privacy-reporting", () => {
    const importer = read("apps/functions/scripts/import-organizations.cjs");
    const lifecycle = read("apps/functions/scripts/organization-seed-lifecycle.cjs");
    expect(lifecycle).toContain('CONFIGURED_DEVELOPMENT_PROJECT = "hi-coworking-plat"');
    expect(importer).toContain("CONFIGURED_DEVELOPMENT_PROJECT");
    expect(importer).toContain("Refusing development write");
    expect(importer).not.toContain("--confirm-production");
    expect(importer).toContain("sourceContentHash");
    expect(importer).toContain("publicOrganizations");
    expect(importer).toContain("fabricatedCoordinates: false");
    expect(importer).toContain("coordinateApprovalRequiredForPublication: true");
  });
});
