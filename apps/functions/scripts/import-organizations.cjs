#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const admin = require("firebase-admin");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function rows(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`${file}:${index + 1}: invalid JSON: ${error.message}`); }
  });
}

function validate(row, restricted) {
  const errors = [];
  if (!row.id || typeof row.id !== "string") errors.push("id is required");
  if (!row.name || typeof row.name !== "string") errors.push("name is required");
  if (!row.normalizedName || typeof row.normalizedName !== "string") errors.push("normalizedName is required");
  if (!Array.isArray(row.sources) || !row.sources.length) errors.push("sources are required");
  if (restricted && row.restrictedMatchOnly !== true) errors.push("restricted targeting rows must be marked restrictedMatchOnly");
  const forbiddenRestrictedKeys = ["email", "phone", "address", "street", "birthDate", "age", "militaryStatus", "contactName"];
  if (restricted && forbiddenRestrictedKeys.some((key) => Object.hasOwn(row, key))) {
    errors.push("restricted targeting row contains prohibited personal/contact fields");
  }
  return errors;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentHash(row) {
  return crypto.createHash("sha256").update(stableJson(row)).digest("hex");
}

async function importRows(db, file, collectionName, restricted, batchId, dryRun) {
  const result = { created: 0, updated: 0, skipped: 0, duplicate: 0, invalid: 0 };
  const seen = new Set();
  for (const row of rows(file)) {
    const errors = validate(row, restricted);
    if (errors.length) { result.invalid += 1; continue; }
    if (seen.has(row.id)) { result.duplicate += 1; continue; }
    seen.add(row.id);
    const ref = db.collection(collectionName).doc(row.id);
    const existing = await ref.get();
    const sourceContentHash = contentHash(row);
    if (existing.data()?.sourceContentHash === sourceContentHash) {
      result.skipped += 1;
      continue;
    }
    const now = Date.now();
    const payload = {
      ...row,
      importBatchId: batchId,
      sourceContentHash,
      sourceRetrievedAt: now,
      updatedAt: now,
      createdAt: existing.data()?.createdAt || now,
      slug: existing.data()?.slug || `${row.normalizedName.replace(/\s+/g, "-").slice(0, 60)}-${row.id.slice(-6)}`,
      ownerUid: existing.data()?.ownerUid || "",
      seatsPurchased: existing.data()?.seatsPurchased || 0,
      seatsUsed: existing.data()?.seatsUsed || 0,
      status: existing.data()?.status || "active",
    };
    if (!dryRun) await ref.set(payload, { merge: true });
    if (existing.exists) result.updated += 1; else result.created += 1;
  }
  return result;
}

async function main() {
  const organizations = argument("--organizations");
  const targeting = argument("--targeting");
  const dryRun = process.argv.includes("--dry-run");
  if (!organizations || !targeting) throw new Error("--organizations and --targeting are required");
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();
  const batchId = argument("--batch-id") || `exchange_seed_${new Date().toISOString().slice(0, 10)}`;
  const organizationResult = await importRows(db, path.resolve(organizations), "orgs", false, batchId, dryRun);
  const targetingResult = await importRows(db, path.resolve(targeting), "organizationSourceCandidates", true, batchId, dryRun);
  console.log(JSON.stringify({ batchId, dryRun, organizations: organizationResult, targeting: targetingResult }, null, 2));
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = { contentHash, importRows, rows, stableJson, validate };
