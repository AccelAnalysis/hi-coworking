const test = require("node:test");
const assert = require("node:assert/strict");
const {
  allocateFounderNumber,
  calculateUsableCreditBalance,
  createSearchTokens,
  mapStripeSubscriptionStatus,
  normalizeOrganizationName,
  planFifoCreditSpend,
  resolveCapabilities,
  scoreOrganizationMatch,
} = require("../lib/exchange/model.js");

test("normalizes legal suffixes and creates searchable tokens", () => {
  assert.equal(normalizeOrganizationName("Acme & Sons, LLC"), "acme and sons");
  assert.deepEqual(createSearchTokens("Acme & Sons, LLC"), ["acme", "and", "sons"]);
});

test("scores exact identifiers above name-only matches", () => {
  const exact = scoreOrganizationMatch(
    { name: "Acme LLC", city: "Smithfield", sourceIds: { duns: "123" } },
    { name: "Acme Incorporated", city: "Smithfield", sourceIds: { duns: "123" } }
  );
  assert.equal(exact.score, 100);
  assert.ok(exact.reasons.includes("same duns identifier"));
});

test("free and founding entitlements resolve centrally", () => {
  assert.ok(!resolveCapabilities("free", "free").includes("exchange.founder.badge"));
  assert.ok(resolveCapabilities("founding", "active").includes("exchange.founder.badge"));
  assert.ok(!resolveCapabilities("founding", "past_due").includes("exchange.credits.use"));
});

test("Stripe statuses map to normalized organization states", () => {
  assert.equal(mapStripeSubscriptionStatus("active"), "active");
  assert.equal(mapStripeSubscriptionStatus("past_due"), "past_due");
  assert.equal(mapStripeSubscriptionStatus("canceled"), "canceled");
});

test("founder allocation handles first, 249th, 250th, and rejects 251st", () => {
  assert.deepEqual(allocateFounderNumber({ activeCount: 0, nextFounderNumber: 1 }), { founderNumber: 1, activeCount: 1, nextFounderNumber: 2 });
  assert.equal(allocateFounderNumber({ activeCount: 248, nextFounderNumber: 249 }).founderNumber, 249);
  assert.equal(allocateFounderNumber({ activeCount: 249, nextFounderNumber: 250 }).founderNumber, 250);
  assert.throws(() => allocateFounderNumber({ activeCount: 250, nextFounderNumber: 251 }), /cap reached/);
});

test("existing founder allocation is idempotent", () => {
  assert.deepEqual(allocateFounderNumber({ activeCount: 250, nextFounderNumber: 251 }, 250), { founderNumber: 250, activeCount: 250, nextFounderNumber: 251 });
});

test("usable balance excludes expired and reversed lots", () => {
  const now = Date.UTC(2026, 6, 17);
  assert.equal(calculateUsableCreditBalance([
    { amount: 25, remainingAmount: 20, expiresAt: now + 1000 },
    { amount: 25, remainingAmount: 25, expiresAt: now - 1 },
    { amount: 10, remainingAmount: 10, expiresAt: now + 1000, reversed: true },
  ], now), 20);
});

test("credit spends consume the oldest eligible lots first", () => {
  assert.deepEqual(planFifoCreditSpend([
    { id: "later", remainingAmount: 20, expiresAt: 200 },
    { id: "first", remainingAmount: 10, expiresAt: 100 },
  ], 25), [
    { id: "first", spend: 10 },
    { id: "later", spend: 15 },
  ]);
  assert.throws(() => planFifoCreditSpend([{ id: "only", remainingAmount: 2, expiresAt: 100 }], 3), /Insufficient/);
});
