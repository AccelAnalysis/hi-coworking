const test = require("node:test");
const assert = require("node:assert/strict");
const {
  allocateFounderNumber,
  calculateCreditExpiration,
  calculateUsableCreditBalance,
  createSearchTokens,
  mapStripeSubscriptionStatus,
  normalizeOrganizationName,
  planFifoCreditSpend,
  resolveCapabilities,
  scoreOrganizationMatch,
} = require("../lib/exchange/model.js");
const { validateFoundingPriceConfiguration } = require("../lib/exchange/membership.js");
const { StripeProvider } = require("../lib/payments/stripeProvider.js");
const Stripe = require("stripe");

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

test("credit expiration is the 12-month anniversary, including leap-day clamping", () => {
  assert.equal(
    calculateCreditExpiration(Date.UTC(2024, 1, 29, 12, 30)),
    Date.UTC(2025, 1, 28, 12, 30),
  );
  assert.equal(
    calculateCreditExpiration(Date.UTC(2026, 6, 17, 9, 15)),
    Date.UTC(2027, 6, 17, 9, 15),
  );
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

test("Founding Stripe catalog validation accepts only the intended test monthly price", () => {
  const valid = {
    id: "price_test_exchange", active: true, livemode: false, currency: "usd",
    unitAmount: 4900, type: "recurring", recurringInterval: "month", recurringIntervalCount: 1,
    productId: "prod_test_exchange", productActive: true, productName: "Hi-Coworking Exchange Founding Membership",
  };
  assert.doesNotThrow(() => validateFoundingPriceConfiguration(valid, {
    priceId: "price_test_exchange", productId: "prod_test_exchange", mode: "test",
  }));
  for (const invalid of [
    { ...valid, active: false },
    { ...valid, productActive: false },
    { ...valid, currency: "eur" },
    { ...valid, unitAmount: 5000 },
    { ...valid, recurringInterval: "year" },
    { ...valid, type: "one_time", recurringInterval: null, recurringIntervalCount: null },
    { ...valid, productId: "prod_wrong" },
    { ...valid, productName: "Different Product" },
    { ...valid, livemode: true },
  ]) {
    assert.throws(() => validateFoundingPriceConfiguration(invalid, {
      priceId: "price_test_exchange", productId: "prod_test_exchange", mode: "test",
    }), /failed validation/);
  }
});

test("Stripe webhook adapter rejects missing and invalid signatures", async () => {
  const provider = new StripeProvider("not-a-real-secret", "test-signing-secret");
  await assert.rejects(provider.handleWebhook(Buffer.from("{}"), {}), /Missing stripe-signature/);
  await assert.rejects(provider.handleWebhook(Buffer.from("{}"), { "stripe-signature": "invalid" }), /Invalid webhook signature/);
});

test("Stripe webhook adapter safely reports unknown signed events", async () => {
  const secret = "test-signing-secret";
  const payload = JSON.stringify({ id: "evt_unknown", object: "event", type: "customer.created", data: { object: { id: "cus_test" } } });
  const stripe = new Stripe("not-a-real-secret");
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const provider = new StripeProvider("not-a-real-secret", secret);
  const result = await provider.handleWebhook(Buffer.from(payload), { "stripe-signature": signature });
  assert.equal(result.action, "unknown");
  assert.equal(result.eventId, "evt_unknown");
});
