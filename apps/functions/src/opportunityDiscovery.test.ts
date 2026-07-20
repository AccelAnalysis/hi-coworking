import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  buildOpportunityDiscoveryProjection,
  sanitizeOpportunityDiscoveryPage,
} from "./opportunityDiscovery";

const now = Date.now();

function source(overrides: Record<string, unknown> = {}) {
  return {
    title: "Commercial building automation upgrade",
    description: "Upgrade HVAC controls and related electrical systems.",
    status: "open",
    adminApprovalStatus: "approved",
    visibility: "public",
    orgId: "issuer-org",
    createdBy: "issuer-user",
    createdByName: "City Public Works",
    issuerType: "government",
    issuerVerified: true,
    template: "RFP",
    opportunityType: "construction",
    naicsCodes: ["238220", "238210"],
    industryLabels: ["Plumbing and HVAC contractors", "Electrical contractors"],
    capabilityKeywords: ["building automation", "HVAC controls"],
    dueDate: now + 14 * 86_400_000,
    createdAt: now - 2 * 86_400_000,
    updatedAt: now,
    location: "Norfolk, Virginia",
    territoryFips: "51710",
    geo: { lat: 36.8508, lng: -76.2859, geohash: "dq9" },
    geographicConfidence: "place_of_performance",
    budget: "$250,000–$500,000",
    budgetMin: 250_000,
    budgetMax: 500_000,
    currency: "USD",
    workArrangement: "on_site",
    requiredCertifications: ["SWaM"],
    setAsideDesignations: ["small_business"],
    teamingSuitable: true,
    addendumCount: 2,
    qAndAStatus: "open",
    responseCount: 7,
    responses: [{ bidderName: "Protected bidder" }],
    evaluationScores: [{ respondentId: "protected", score: 99 }],
    contactEmail: "private@example.test",
    ...overrides,
  };
}

test("projection omits protected bid, evaluation, and contact fields", () => {
  const projection = buildOpportunityDiscoveryProjection("rfx-1", source());
  assert.ok(projection);
  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes("Protected bidder"), false);
  assert.equal(serialized.includes("respondentId"), false);
  assert.equal(serialized.includes("private@example.test"), false);
  assert.equal("responses" in projection, false);
  assert.equal("evaluationScores" in projection, false);
  assert.equal("contactEmail" in projection, false);
});

test("legacy coordinates are not promoted to exact confidence", () => {
  const projection = buildOpportunityDiscoveryProjection("rfx-2", source({
    geographicConfidence: undefined,
  }));
  const geo = projection?.geo;
  assert.ok(geo && typeof geo === "object" && !Array.isArray(geo));
  assert.notEqual((geo as Record<string, unknown>).confidence, "exact");
});

test("authoritative coordinates remain mappable before a geohash backfill", () => {
  const projection = buildOpportunityDiscoveryProjection("rfx-no-hash", source({
    geo: { lat: 36.8508, lng: -76.2859 },
  }));
  const geo = projection?.geo;
  assert.ok(geo && typeof geo === "object" && !Array.isArray(geo));
  assert.equal((geo as Record<string, unknown>).latitude, 36.8508);
  assert.equal((geo as Record<string, unknown>).longitude, -76.2859);
  assert.equal("geohash" in (geo as Record<string, unknown>), false);
});

test("only approved and open records receive a public discovery projection", () => {
  for (const [id, overrides] of [
    ["draft", { status: "draft" }],
    ["moderated-pending", { status: "under_review", adminApprovalStatus: "pending" }],
    ["moderated-rejected", { status: "under_review", adminApprovalStatus: "rejected" }],
    ["cancelled", { status: "cancelled" }],
    ["closed", { status: "closed" }],
    ["awarded", { status: "awarded" }],
    ["open-pending", { status: "open", adminApprovalStatus: "pending" }],
  ] as const) {
    assert.equal(buildOpportunityDiscoveryProjection(id, source(overrides)), null, id);
  }
  assert.ok(buildOpportunityDiscoveryProjection("approved-open", source()));
});

test("callable sanitizer strips authority, ranking, and protected responder fields", () => {
  const projection = buildOpportunityDiscoveryProjection("rfx-safe", source({
    discloseResponseCount: true,
  }));
  assert.ok(projection);
  const page = sanitizeOpportunityDiscoveryPage({
    records: [{
      ...projection,
      relationship: {
        saved: true,
        viewed: true,
        responded: false,
        managed: false,
        newSinceLastVisit: false,
        updatedSinceViewed: false,
      },
      competingResponses: [{ bidder: "protected competitor" }],
      evaluationScores: [{ respondentId: "protected", score: 99 }],
      capabilityMatchCount: 12,
      relevanceScore: 42,
    }],
    countAccuracy: "exact",
    truncated: false,
    degraded: false,
    warnings: [],
    provider: "test",
    queryDurationMs: 1,
  });
  const sanitized = (page.records as Array<Record<string, unknown>>)[0];
  assert.ok(sanitized);
  for (const field of [
    "ownerUid",
    "createdBy",
    "adminApprovalStatus",
    "discoverable",
    "recommendedRank",
    "normalizedTitle",
    "normalizedIssuer",
    "responseCount",
    "competingResponses",
    "evaluationScores",
    "capabilityMatchCount",
    "relevanceScore",
  ]) {
    assert.equal(field in sanitized, false, field);
  }
  assert.deepEqual(sanitized.searchTokens, []);
  assert.equal(JSON.stringify(sanitized).includes("protected competitor"), false);
});

test("search tokens include title, issuer, NAICS, capabilities, and synonyms", () => {
  const projection = buildOpportunityDiscoveryProjection("rfx-3", source());
  assert.ok(projection);
  assert.ok(Array.isArray(projection.searchTokens));
  const tokens = new Set(projection.searchTokens as unknown[]);
  for (const token of ["commercial", "automation", "city", "238220", "hvac"]) {
    assert.equal(tokens.has(token), true, `missing token ${token}`);
  }
});
