const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { importRows, validate } = require("../scripts/import-organizations.cjs");

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
          async set(value) { documents.set(key, { ...(documents.get(key) || {}), ...value }); },
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
  assert.equal(db.documents.size, 2);

  const second = await importRows(db, fixture, "orgs", false, "batch-2", false);
  assert.equal(second.skipped, 2);
  assert.equal(second.updated, 0);
});

test("restricted seed validation rejects personal/contact fields", () => {
  assert.deepEqual(validate({ id: "target_1", name: "Acme", normalizedName: "acme", sources: ["targeting"], restrictedMatchOnly: true }, true), []);
  assert.match(validate({ id: "target_1", name: "Acme", normalizedName: "acme", sources: ["targeting"], restrictedMatchOnly: true, email: "person@example.test" }, true).join(" "), /prohibited/);
});
