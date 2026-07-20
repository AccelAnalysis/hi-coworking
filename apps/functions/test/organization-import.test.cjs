const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  assertProjectSafety,
  importRows,
  publicProjection,
  validate,
} = require("../scripts/import-organizations.cjs");

function fakeDb() {
  const documents = new Map();
  return {
    documents,
    collection(name) {
      return { doc(id) {
        const key = `${name}/${id}`;
        return {
          async get() {
            const value = documents.get(key);
            return { exists: value !== undefined, data: () => value };
          },
          async set(value, options = {}) {
            documents.set(key, options.merge === false ? value : { ...(documents.get(key) || {}), ...value });
          },
        };
      } };
    },
  };
}

const fixture = path.join(__dirname, "../test-fixtures/organization-seed.jsonl");

test("organization seed import is dry-run safe and idempotent", async () => {
  const db = fakeDb();
  const dry = await importRows(db, fixture, "orgs", false, "batch-1", true);
  assert.equal(dry.created, 2);
  assert.equal(db.documents.size, 0);

  const first = await importRows(db, fixture, "orgs", false, "batch-1", false);
  assert.equal(first.created, 2);
  assert.equal(db.documents.size, 4);

  const second = await importRows(db, fixture, "orgs", false, "batch-2", false);
  assert.equal(second.skipped, 2);
  assert.equal(second.updated, 0);
  assert.equal(db.documents.size, 4);
});

test("restricted and home-based validation rejects private fields", () => {
  assert.deepEqual(validate({ id: "target_1", name: "Acme", normalizedName: "acme", sources: ["targeting"], restrictedMatchOnly: true, privacySuppressed: true }, true), []);
  assert.match(validate({ id: "target_1", name: "Acme", normalizedName: "acme", sources: ["targeting"], restrictedMatchOnly: true, email: "person@example.test" }, true).join(" "), /prohibited/);
  assert.match(validate({ id: "home_1", name: "Home", normalizedName: "home", sources: ["test"], homeBased: true, addressLine1: "Private" }, false).join(" "), /privacy-suppressed/);
});

test("public projection suppresses ownership, source IDs, and home address", () => {
  const publicRow = publicProjection({
    id: "home_1",
    name: "Home",
    normalizedName: "home",
    slug: "home-1",
    homeBased: true,
    privacySuppressed: true,
    addressLine1: "Private",
    postalCode: "23430",
    ownerUid: "private-owner",
    sourceIds: { duns: "private" },
    territoryFips: "51093",
    coordinateConfidence: "authoritative",
    updatedAt: 1,
  });
  assert.equal(publicRow.addressLine1, undefined);
  assert.equal(publicRow.postalCode, undefined);
  assert.equal(publicRow.ownerUid, undefined);
  assert.equal(publicRow.sourceIds, undefined);
  assert.equal(publicRow.territoryFips, "51093");
  assert.equal(publicRow.coordinateConfidence, undefined);
});

test("public projection retains only approved map provenance for non-suppressed records", () => {
  const publicRow = publicProjection({
    id: "public_1",
    name: "Public",
    normalizedName: "public",
    slug: "public-1",
    territoryFips: "51093",
    latitude: 36.9,
    longitude: -76.7,
    coordinateConfidence: "authoritative",
    updatedAt: 1,
  });
  assert.equal(publicRow.territoryFips, "51093");
  assert.equal(publicRow.coordinateConfidence, "authoritative");
  assert.equal(publicRow.latitude, 36.9);
});

test("project guard is dry-run first and distinguishes development from production", () => {
  assert.doesNotThrow(() => assertProjectSafety("demo-hi-coworking", { dryRun: false, apply: true, environment: "emulator" }));
  assert.doesNotThrow(() => assertProjectSafety("hi-coworking-plat", { dryRun: true, apply: false, environment: "development" }));
  assert.throws(
    () => assertProjectSafety("hi-coworking-plat", { dryRun: false, apply: true, environment: "development" }),
    /confirm-development/,
  );
  assert.doesNotThrow(() => assertProjectSafety("hi-coworking-plat", {
    dryRun: false,
    apply: true,
    environment: "development",
    confirmDevelopment: "hi-coworking-plat",
  }));
  assert.throws(
    () => assertProjectSafety("hi-coworking-prod", { dryRun: false, apply: true, environment: "production" }),
    /confirm-production/,
  );
  assert.doesNotThrow(() => assertProjectSafety("hi-coworking-prod", {
    dryRun: false,
    apply: true,
    environment: "production",
    confirmProduction: "hi-coworking-prod",
  }));
});

test("legacy project guard behavior remains compatible", () => {
  assert.doesNotThrow(() => assertProjectSafety("demo-hi-coworking", false));
  assert.doesNotThrow(() => assertProjectSafety("hi-coworking-prod", true));
  assert.throws(() => assertProjectSafety("hi-coworking-prod", false), /Refusing/);
  assert.doesNotThrow(() => assertProjectSafety("hi-coworking-prod", false, "hi-coworking-prod"));
});
