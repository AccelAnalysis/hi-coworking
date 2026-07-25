import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serializeCallableError } from "../../apps/web/src/lib/callableDiagnostics";
import { diagnoseProfileUpdateError } from "../../apps/web/src/lib/profileUpdateDiagnostics";
import {
  computeProfileCompleteness,
  computeProfileReadiness,
  sanitizeCanonicalProfile,
} from "../../apps/functions/src/profileModel";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("safe callable diagnostics", () => {
  it("classifies HTTP 404 deployment failures without retaining private error text", () => {
    const diagnostic = serializeCallableError({
      status: 404,
      message: "POST failed for private-user@example.test with secret payload",
      details: { requestPayload: { private: true } },
    }, {
      functionName: "profile_update",
      projectId: "development-project",
      region: "us-central1",
    });
    expect(diagnostic).toMatchObject({
      category: "deployment",
      functionName: "profile_update",
      projectId: "development-project",
      region: "us-central1",
      httpStatus: 404,
    });
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain("private-user");
    expect(serialized).not.toContain("secret payload");
    expect(serialized).not.toContain("requestPayload");
  });

  it("distinguishes wrong-project, version-conflict, App Check, and timeout failures", () => {
    expect(diagnoseProfileUpdateError({}, {
      configuredProjectId: "wrong-project",
      expectedProjectId: "configured-development",
    }).code).toBe("WRONG_FIREBASE_PROJECT");
    expect(diagnoseProfileUpdateError({
      code: "functions/aborted",
      details: { diagnosticCode: "PROFILE_VERSION_CONFLICT", requestId: "request-one" },
    }).code).toBe("PROFILE_VERSION_CONFLICT");
    expect(diagnoseProfileUpdateError({ message: "Firebase App Check token rejected" }).code)
      .toBe("APP_CHECK_REJECTED");
    expect(diagnoseProfileUpdateError({ code: "functions/deadline-exceeded" }).code)
      .toBe("REQUEST_TIMEOUT");
  });

  it("distinguishes region, emulator, and deployment-revision mismatches", () => {
    expect(diagnoseProfileUpdateError({}, {
      configuredRegion: "europe-west1",
      expectedRegion: "us-central1",
    }).code).toBe("WRONG_FUNCTION_REGION");
    expect(diagnoseProfileUpdateError({}, {
      configuredEmulatorMode: true,
      expectedEmulatorMode: false,
    }).code).toBe("EMULATOR_REMOTE_MISMATCH");
    expect(diagnoseProfileUpdateError({}, {
      configuredRevision: "old-revision",
      expectedRevision: "accepted-revision",
    }).code).toBe("DEPLOYMENT_REVISION_MISMATCH");
  });
});

describe("canonical profile model", () => {
  it("calculates bounded completeness and readiness from authoritative fields", () => {
    const profile = {
      businessName: "Example LLC",
      bio: "A complete profile",
      website: "https://example.test",
      linkedin: "https://linkedin.com/company/example",
      city: "Armonk",
      naicsCodes: ["541611"],
      certifications: ["WOSB"],
      uei: "UEI-ONE",
      duns: "DUNS-ONE",
      cageCode: "CAGE1",
      capabilityStatementStoragePath: "capabilityStatements/user/capability.pdf",
      photoStoragePath: "profilePhotos/user/photo.png",
      verificationStatus: "verified",
      enrichmentMatchId: "match-one",
      trustStats: { referralsConverted: 1 },
    };
    const score = computeProfileCompleteness(profile);
    expect(score).toBe(100);
    expect(computeProfileReadiness({ ...profile, profileCompletenessScore: score }))
      .toBe("procurement_ready");
    expect(computeProfileReadiness({ ...profile, verificationStatus: "pending" }))
      .toBe("seat_ready");
  });

  it("returns only canonical owner-safe fields", () => {
    const profile = sanitizeCanonicalProfile({
      uid: "owner",
      businessName: "Example LLC",
      enrichmentMatchId: "match-one",
      enrichmentFieldProvenance: { businessName: { provider: "usaspending" } },
      attestationText: "private attestation",
      email: "private@example.test",
    });
    expect(profile).toMatchObject({
      uid: "owner",
      businessName: "Example LLC",
      enrichmentMatchId: "match-one",
    });
    expect(profile).not.toHaveProperty("attestationText");
    expect(profile).not.toHaveProperty("email");
  });
});

describe("registration and profile source contracts", () => {
  it("confirms atomic lightweight business registration before mandatory organization onboarding", () => {
    const registration = read("apps/web/src/app/register/page.tsx");
    expect(registration).toContain("initializeAccount");
    expect(registration).toContain('router.replace("/exchange/onboarding")');
    expect(registration).not.toContain('router.push("/exchange")');
    expect(registration).not.toContain('router.push("/profile?onboarding=1")');
    expect(registration).toContain("businessRepresentativeAttestation");
    expect(registration).toContain("termsAccepted: true");
    expect(registration).toContain("privacyAccepted: true");
    expect(registration).toContain("deleteUser(createdUser)");
    expect(registration).toContain("No partial account was kept");
    expect(registration).not.toContain("Complete account setup");
    expect(registration).not.toContain("professionalTitle");
    expect(registration).not.toContain("preferredPrivatePhone");
  });

  it("requires profile versions, server-side search, and field-level enrichment approval", () => {
    const profiles = read("apps/functions/src/profiles.ts");
    const enrichmentEntry = read("apps/functions/src/enrichment.ts");
    const enrichmentSearch = read("apps/functions/src/enrichmentSearch.ts");
    const enrichmentLink = read("apps/functions/src/enrichmentLegacy.ts");

    expect(profiles).toContain("PROFILE_VERSION_CONFLICT");
    expect(profiles).toContain("sanitizeCanonicalProfile");
    expect(enrichmentEntry).toContain('export { enrichment_search } from "./enrichmentSearch"');
    expect(enrichmentEntry).toContain('export { enrichment_link } from "./enrichmentLegacy"');
    expect(enrichmentSearch).toContain("requestSamGovEntities");
    expect(enrichmentSearch).toContain('method: "POST"');
    expect(enrichmentLink).toContain("selectedFields");
    expect(enrichmentLink).toContain("enrichmentFieldProvenance");
    expect(enrichmentLink).toContain("ENRICHMENT_RELINK_CONFIRMATION_REQUIRED");
  });
});
