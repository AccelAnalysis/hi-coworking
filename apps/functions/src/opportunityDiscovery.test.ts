import assert from "node:assert/strict";
import test from "node:test";
import { buildOpportunityDiscoveryProjection } from "./opportunityDiscovery";

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
  assert.ok(projection?.geo);
  assert.notEqual(projection?.geo?.confidence, "exact");
});

test("unapproved or non-open records are not discoverable", () => {
  assert.equal(buildOpportunityDiscoveryProjection("pending", source({ adminApprovalStatus: "pending" })), null);
  assert.equal(buildOpportunityDiscoveryProjection("closed", source({ status: "closed" })), null);
});

test("search tokens include title, issuer, NAICS, capabilities, and synonyms", () => {
  const projection = buildOpportunityDiscoveryProjection("rfx-3", source());
  assert.ok(projection);
  const tokens = new Set(projection.searchTokens);
  for (const token of ["commercial", "automation", "city", "238220", "hvac"]) {
    assert.equal(tokens.has(token), true, `missing token ${token}`);
  }
});
