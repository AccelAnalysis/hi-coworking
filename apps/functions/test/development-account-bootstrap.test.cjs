const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertDevelopmentAccountEmail,
  assertPassword,
  assertSafety,
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
