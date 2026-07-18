import assert from "node:assert/strict";
import test from "node:test";
import {
  haversineMiles,
  normalizeOpportunitySearchText,
  opportunityDiscoveryQuerySchema,
  opportunityDiscoveryRecordSchema,
  tokenizeOpportunitySearchText,
} from "./opportunityDiscovery";

test("normalizes punctuation, spacing, case, and diacritics", () => {
  assert.equal(
    normalizeOpportunitySearchText("  Café—HVAC / RFP!!!  "),
    "cafe hvac rfp",
  );
});

test("tokenization is deterministic and removes duplicate tokens", () => {
  assert.deepEqual(
    tokenizeOpportunitySearchText("Commercial commercial HVAC services"),
    ["commercial", "hvac", "services"],
  );
});

test("Haversine distance produces a realistic Norfolk to Virginia Beach distance", () => {
  const miles = haversineMiles(36.8508, -76.2859, 36.8529, -75.9780);
  assert.ok(miles > 16 && miles < 20, `unexpected distance ${miles}`);
});

test("query validation permits map bounds without a fabricated point", () => {
  const parsed = opportunityDiscoveryQuerySchema.parse({
    contractVersion: 1,
    query: "roofing",
    filters: {
      naics: [],
      industries: [],
      capabilities: [],
      opportunityTypes: [],
      rfxTypes: [],
      buyerTypes: [],
      workArrangements: [],
      visibility: [],
      requiredCertifications: [],
      setAsideDesignations: [],
      territoryFips: [],
      primeClassifications: [],
      awardClassifications: [],
      personalized: [],
    },
    location: {
      label: "Current map area",
      bounds: { west: -77, south: 36, east: -75, north: 38 },
      includeRemote: false,
    },
    sort: "recommended",
    pageSize: 40,
  });

  assert.equal(parsed.location?.latitude, undefined);
  assert.equal(parsed.location?.longitude, undefined);
});

test("projection schema excludes arbitrary protected fields", () => {
  const candidate = {
    projectionVersion: 1,
    id: "rfx-1",
    title: "Building automation services",
    searchableDescription: "Design and install controls.",
    issuerDisplayName: "Public Works",
    issuerType: "government",
    issuerVerified: true,
    rfxType: "RFP",
    opportunityType: "services",
    naicsCodes: ["238220"],
    industryLabels: ["Plumbing and HVAC contractors"],
    capabilityKeywords: ["building automation"],
    postedAt: Date.now(),
    updatedAt: Date.now(),
    responseDeadline: Date.now() + 86_400_000,
    deadlineTimezone: "America/New_York",
    currency: "USD",
    placeOfPerformance: "Norfolk, Virginia",
    workArrangement: "on_site",
    territoryFips: "51710",
    visibility: "public",
    requiredCertifications: [],
    setAsideDesignations: [],
    primeClassification: "prime",
    awardClassification: "single",
    teamingSuitable: false,
    addendumCount: 0,
    qAndAStatus: "not_open",
    status: "open",
    discoverable: true,
    recommendedRank: 1,
    searchTokens: ["building", "automation"],
    relationship: {
      saved: false,
      viewed: false,
      responded: false,
      managed: false,
      newSinceLastVisit: false,
      updatedSinceViewed: false,
    },
    competingResponses: [{ bidder: "protected" }],
    evaluationScores: [100],
  };

  const parsed = opportunityDiscoveryRecordSchema.parse(candidate);
  assert.equal("competingResponses" in parsed, false);
  assert.equal("evaluationScores" in parsed, false);
});

test("invalid radius is rejected", () => {
  const result = opportunityDiscoveryQuerySchema.safeParse({
    contractVersion: 1,
    query: "",
    filters: {
      naics: [], industries: [], capabilities: [], opportunityTypes: [],
      rfxTypes: [], buyerTypes: [], workArrangements: [], visibility: [],
      requiredCertifications: [], setAsideDesignations: [], territoryFips: [],
      primeClassifications: [], awardClassifications: [], personalized: [],
    },
    location: {
      label: "Too broad",
      latitude: 36.8,
      longitude: -76.2,
      radiusMiles: 5_000,
      includeRemote: true,
    },
    sort: "nearest",
    pageSize: 40,
  });
  assert.equal(result.success, false);
});
