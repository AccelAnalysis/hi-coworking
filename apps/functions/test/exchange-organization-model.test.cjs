const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSearchTokens,
  normalizeOrganizationName,
  normalizeWebsiteDomain,
  sanitizePublicOrganization,
  scoreOrganizationMatch,
} = require("../lib/exchange/organizationModel.js");

test("organization matching normalizes legal suffixes and domains", () => {
  assert.equal(normalizeOrganizationName("Alpha Builders, LLC"), "alpha builders");
  assert.equal(normalizeWebsiteDomain("https://www.Example.com/about"), "example.com");
  assert.deepEqual(createSearchTokens("Alpha Alpha Builders LLC"), ["alpha", "builders"]);
  const match = scoreOrganizationMatch(
    { name: "Alpha Builders LLC", city: "Smithfield", state: "VA", website: "https://alpha.example" },
    { name: "Alpha Builders, Inc.", city: "Smithfield", state: "VA", websiteDomain: "alpha.example" },
  );
  assert.equal(match.score, 100);
  assert.ok(match.reasons.includes("same website domain"));
});

test("public organization projection suppresses private home-business location", () => {
  const result = sanitizePublicOrganization("org_home", {
    name: "Home Office",
    normalizedName: "home office",
    status: "active",
    ownerUid: "private",
    sourceIds: { duns: "private" },
    homeBased: true,
    publicationApproved: true,
    coordinatePublicationApproved: true,
    addressLine1: "Private",
    postalCode: "23430",
    latitude: 36.9,
    longitude: -76.7,
    coordinateConfidence: "authoritative",
    territoryFips: "51093",
    city: "Smithfield",
    state: "VA",
    sources: ["fixture"],
  });
  assert.equal(result.city, "Smithfield");
  assert.equal(result.addressLine1, undefined);
  assert.equal(result.latitude, undefined);
  assert.equal(result.coordinateConfidence, undefined);
  assert.equal(result.territoryFips, "51093");
  assert.equal(result.ownerUid, undefined);
  assert.equal(result.sourceIds, undefined);
});

test("public organization projection preserves approved coordinate confidence", () => {
  const result = sanitizePublicOrganization("org_public", {
    name: "Public Office",
    normalizedName: "public office",
    status: "active",
    publicationApproved: true,
    coordinatePublicationApproved: true,
    latitude: 36.9,
    longitude: -76.7,
    coordinateConfidence: "verified",
    territoryFips: "51093",
  });
  assert.equal(result.latitude, 36.9);
  assert.equal(result.longitude, -76.7);
  assert.equal(result.coordinateConfidence, "verified");
  assert.equal(result.territoryFips, "51093");
});

test("public organization projection requires explicit coordinate publication approval", () => {
  const result = sanitizePublicOrganization("org_not_approved", {
    name: "Public Office",
    normalizedName: "public office",
    status: "active",
    publicationApproved: true,
    latitude: 36.9,
    longitude: -76.7,
    coordinateConfidence: "verified",
  });
  assert.equal(result.latitude, undefined);
  assert.equal(result.longitude, undefined);
  assert.equal(result.coordinatePublicationApproved, undefined);
});

test("public organization projection separates claim and verification status", () => {
  const result = sanitizePublicOrganization("org_claimed", {
    name: "Claimed Office",
    normalizedName: "claimed office",
    status: "active",
    publicationApproved: true,
    claimStatus: "claimed",
    verificationStatus: "pending",
    exchangeVerificationStatus: "claimed",
  });
  assert.equal(result.claimStatus, "claimed");
  assert.equal(result.verificationStatus, "pending");
});
