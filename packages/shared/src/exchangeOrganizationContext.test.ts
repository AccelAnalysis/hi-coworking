import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  exchangeOrganizationPerspectiveSchema,
  exchangePublicOrganizationProjectionSchema,
  exchangeWorkspaceContextSchema,
} from "./exchangeOrganizationContext";

test("workspace context keeps viewer, actor, subject, and secondary concepts distinct", () => {
  const parsed = exchangeWorkspaceContextSchema.parse({
    contractVersion: 1,
    viewer: { authenticated: true, uid: "viewer-1", platformRole: "member" },
    actor: {
      organizationId: "actor-org",
      name: "Actor Organization",
      membershipRole: "owner",
      capabilities: ["view_exchange"],
      valid: true,
      fallbackApplied: false,
    },
    subject: {
      organizationId: "subject-org",
      contextType: "external_claimed",
      claimedStatus: "claimed",
      resourceProviderStatus: "not_provider",
    },
    secondary: { type: "opportunity", id: "opportunity-1" },
    activeMode: "opportunities",
  });

  assert.equal(parsed.actor.organizationId, "actor-org");
  assert.equal(parsed.subject?.organizationId, "subject-org");
  assert.equal(parsed.secondary?.id, "opportunity-1");
});

test("public organization contract rejects private authority fields", () => {
  const result = exchangePublicOrganizationProjectionSchema.safeParse({
    id: "subject-org",
    schemaVersion: 2,
    name: "Subject",
    normalizedName: "subject",
    slug: "subject",
    city: "Smithfield",
    county: "Isle of Wight",
    state: "VA",
    territoryFips: "51093",
    claimStatus: "claimed",
    verificationStatus: "verified",
    organizationType: "business",
    industries: [],
    description: "",
    website: "",
    naicsCodes: [],
    capabilityKeywords: [],
    certifications: [],
    searchTokens: ["subject"],
    resourceProviderStatus: "not_provider",
    resourceCategories: [],
    issuerStatus: "not_issuer",
    acceptsReferrals: false,
    publicContactAvailable: false,
    status: "active",
    publicationApproved: true,
    updatedAt: 1,
    ownerUid: "must-not-cross-boundary",
  });
  assert.equal(result.success, false);
});

test("perspective contract rejects relationship paths and private external fields", () => {
  const result = exchangeOrganizationPerspectiveSchema.safeParse({
    contractVersion: 1,
    viewer: { authenticated: true, uid: "viewer-1", platformRole: "member" },
    actor: {
      organizationId: "actor-org",
      name: "Actor",
      membershipRole: "owner",
      capabilities: ["view_exchange"],
      valid: true,
      fallbackApplied: false,
    },
    subject: {
      organizationId: "subject-org",
      contextType: "external_claimed",
      claimedStatus: "claimed",
      resourceProviderStatus: "not_provider",
    },
    relationship: {
      exists: true,
      type: "undisclosed",
      disclosureLevel: "indicator",
      trustedIntroductionMayBeAvailable: true,
      path: ["private-person"],
    },
    perspective: {
      mode: "referrals",
      projectionLevel: "public_claimed",
      allowedActions: ["request_introduction"],
      isModeResultEligible: true,
      contextMarkerOnly: false,
      heading: "Subject",
    },
    organization: null,
    saved: false,
  });
  assert.equal(result.success, false);
});
