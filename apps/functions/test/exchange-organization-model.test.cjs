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
    ownerUid: "private",
    sourceIds: { duns: "private" },
    homeBased: true,
    addressLine1: "Private",
    postalCode: "23430",
    latitude: 36.9,
    longitude: -76.7,
    city: "Smithfield",
    state: "VA",
    sources: ["fixture"],
  });
  assert.equal(result.city, "Smithfield");
  assert.equal(result.addressLine1, undefined);
  assert.equal(result.latitude, undefined);
  assert.equal(result.ownerUid, undefined);
  assert.equal(result.sourceIds, undefined);
});
