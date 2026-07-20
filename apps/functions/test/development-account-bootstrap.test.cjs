const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertDevelopmentAccountEmail,
  assertPassword,
  assertSafety,
  buildAccountSpecs,
} = require("../scripts/bootstrap-development-accounts.cjs");

test("development account bootstrap accepts dedicated smoke identities", () => {
  assert.doesNotThrow(() => assertDevelopmentAccountEmail("member+exchange-dev@example.com", "Member"));
  assert.doesNotThrow(() => assertDevelopmentAccountEmail("admin-exchange-smoke@example.com", "Admin"));
  assert.doesNotThrow(() => assertDevelopmentAccountEmail("member@example.test", "Member"));
});

test("development account bootstrap rejects general-use identities", () => {
  assert.throws(
    () => assertDevelopmentAccountEmail("owner@example.com", "Member"),
    /dedicated development identity/,
  );
});

test("development account bootstrap requires strong environment passwords", () => {
  assert.throws(() => assertPassword("short", "Member"), /at least 12 characters/);
  assert.doesNotThrow(() => assertPassword("development-password-123", "Member"));
});

test("development writes require exact project confirmation while dry runs remain available", () => {
  assert.doesNotThrow(() => assertSafety({ projectId: "hi-coworking-plat", apply: false }));
  assert.throws(
    () => assertSafety({ projectId: "hi-coworking-plat", apply: true }),
    /confirm-development/,
  );
  assert.doesNotThrow(() => assertSafety({
    projectId: "hi-coworking-plat",
    apply: true,
    confirmation: "hi-coworking-plat",
  }));
});

test("development account matrix keeps organization authority roles as dedicated member identities", () => {
  const specs = buildAccountSpecs({
    EXCHANGE_DEV_TEST_EMAIL: "ordinary+exchange-dev@example.test",
    EXCHANGE_DEV_TEST_PASSWORD: "ordinary-development-password",
    EXCHANGE_DEV_ADMIN_EMAIL: "reviewer+exchange-dev@example.test",
    EXCHANGE_DEV_ADMIN_PASSWORD: "reviewer-development-password",
    EXCHANGE_DEV_OWNER_EMAIL: "owner+exchange-dev@example.test",
    EXCHANGE_DEV_OWNER_PASSWORD: "owner-development-password",
    EXCHANGE_DEV_UNRELATED_EMAIL: "unrelated+exchange-dev@example.test",
    EXCHANGE_DEV_UNRELATED_PASSWORD: "unrelated-development-password",
    EXCHANGE_DEV_ISSUER_EMAIL: "issuer+exchange-dev@example.test",
    EXCHANGE_DEV_ISSUER_PASSWORD: "issuer-development-password",
  });

  assert.equal(specs.length, 5);
  assert.deepEqual(specs.map((spec) => spec.role), ["member", "admin", "member", "member", "member"]);
  assert.deepEqual(specs.map((spec) => spec.developmentPurpose), [
    "configured_exchange_ordinary_member",
    "configured_exchange_claim_reviewer",
    "configured_exchange_organization_owner",
    "configured_exchange_unrelated_member",
    "configured_exchange_issuer_manager",
  ]);
});

test("development account matrix rejects partial optional identities and duplicate accounts", () => {
  const base = {
    EXCHANGE_DEV_TEST_EMAIL: "ordinary+exchange-dev@example.test",
    EXCHANGE_DEV_TEST_PASSWORD: "ordinary-development-password",
    EXCHANGE_DEV_ADMIN_EMAIL: "reviewer+exchange-dev@example.test",
    EXCHANGE_DEV_ADMIN_PASSWORD: "reviewer-development-password",
  };
  assert.throws(
    () => buildAccountSpecs({ ...base, EXCHANGE_DEV_OWNER_EMAIL: "owner+exchange-dev@example.test" }),
    /both be supplied or both be omitted/,
  );
  assert.throws(
    () => buildAccountSpecs({ ...base, EXCHANGE_DEV_OWNER_EMAIL: base.EXCHANGE_DEV_TEST_EMAIL, EXCHANGE_DEV_OWNER_PASSWORD: "owner-development-password" }),
    /separate account/,
  );
});
