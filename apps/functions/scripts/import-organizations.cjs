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
  const forbiddenRestrictedKeys = [
    "email", "phone", "publicPhone", "address", "addressLine1", "street",
    "birthDate", "age", "militaryStatus", "contactName", "latitude", "longitude", "geohash",
  ];
  if (restricted && forbiddenRestrictedKeys.some((key) => Object.hasOwn(row, key))) {
    errors.push("restricted targeting row contains prohibited personal, contact, or precise-location fields");
  }
  const forbiddenSuppressedKeys = ["address", "addressLine1", "postalCode", "publicPhone", "latitude", "longitude", "geohash"];
  if ((row.homeBased === true || row.privacySuppressed === true)
      && forbiddenSuppressedKeys.some((key) => Object.hasOwn(row, key))) {
    errors.push("privacy-suppressed organization contains a precise address or location field");
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

function publicProjection(row) {
  const privacySuppressed = row.homeBased === true || row.privacySuppressed === true;
  const projection = {
    id: row.id,
    schemaVersion: 2,
    name: row.name,
    normalizedName: row.normalizedName,
    slug: row.slug,
    city: row.city || "",
    county: row.county || "",
    state: row.state || "",
    website: row.website || "",
    organizationType: row.organizationType || "",
    description: row.description || "",
    naicsCodes: Array.isArray(row.naicsCodes) ? row.naicsCodes : [],
    capabilityKeywords: Array.isArray(row.capabilityKeywords) ? row.capabilityKeywords : [],
    certifications: Array.isArray(row.certifications) ? row.certifications : [],
    sources: Array.isArray(row.sources) ? row.sources : [],
    claimStatus: row.claimStatus || "unclaimed",
    verificationStatus: row.exchangeVerificationStatus || row.verificationStatus || "unverified",
    homeBased: row.homeBased === true,
    privacySuppressed,
    status: row.status || "active",
    updatedAt: row.updatedAt,
  };
  if (!privacySuppressed) {
    for (const key of ["addressLine1", "postalCode", "latitude", "longitude", "geohash"]) {
      if (row[key] !== undefined && row[key] !== "") projection[key] = row[key];
    }
  }
  return projection;
}

function resolveProjectId() {
  return argument("--project")
    || process.env.GCLOUD_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT
    || process.env.FIREBASE_CONFIG && JSON.parse(process.env.FIREBASE_CONFIG).projectId;
}

function assertProjectSafety(projectId, dryRun, confirmation) {
  if (!projectId) throw new Error("--project is required; refusing an unscoped import");
  if (!dryRun && !projectId.startsWith("demo-") && confirmation !== projectId) {
    throw new Error(`Refusing a non-demo write. Re-run with --confirm-production ${projectId} after reviewing the dry-run, privacy, and rollback reports.`);
  }
}

async function importRows(db, file, collectionName, restricted, batchId, dryRun) {
  const result = { created: 0, updated: 0, skipped: 0, duplicate: 0, invalid: 0, invalidRows: [] };
  const seen = new Set();
  for (const [index, row] of rows(file).entries()) {
    const errors = validate(row, restricted);
    if (errors.length) {
      result.invalid += 1;
      result.invalidRows.push({ line: index + 1, id: row.id || null, errors });
      continue;
    }
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
      schemaVersion: 2,
      importBatchId: batchId,
      sourceContentHash,
      sourceRetrievedAt: now,
      updatedAt: now,
      createdAt: existing.data()?.createdAt || now,
      slug: existing.data()?.slug || `${row.normalizedName.replace(/\s+/g, "-").slice(0, 60)}-${row.id.slice(-6)}`,
      ownerUid: existing.data()?.ownerUid || "",
      status: existing.data()?.status || "active",
      exchangeVerificationStatus: existing.data()?.exchangeVerificationStatus || row.verificationStatus || "unverified",
    };
    if (!dryRun) {
      await ref.set(payload, { merge: true });
      if (collectionName === "orgs") {
        await db.collection("publicOrganizations").doc(row.id).set(publicProjection(payload), { merge: false });
      }
    }
    if (existing.exists) result.updated += 1; else result.created += 1;
  }
  return result;
}

async function main() {
  const organizations = argument("--organizations");
  const targeting = argument("--targeting");
  const dryRun = process.argv.includes("--dry-run");
  if (!organizations || !targeting) throw new Error("--organizations and --targeting are required");
  const projectId = resolveProjectId();
  assertProjectSafety(projectId, dryRun, argument("--confirm-production"));
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();
  const batchId = argument("--batch-id") || `exchange_seed_${new Date().toISOString().slice(0, 10)}`;
  const organizationResult = await importRows(db, path.resolve(organizations), "orgs", false, batchId, dryRun);
  const targetingResult = await importRows(db, path.resolve(targeting), "organizationSourceCandidates", true, batchId, dryRun);
  const report = {
    projectId,
    batchId,
    dryRun,
    organizations: organizationResult,
    targeting: targetingResult,
    privacy: {
      publicProjection: true,
      suppressedHomeAddresses: true,
      restrictedTargetingServerOnly: true,
      fabricatedCoordinates: false,
    },
  };
  if (!dryRun) {
    await db.collection("organizationSeedImports").doc(batchId).set({
      ...report,
      rollback: {
        queryField: "importBatchId",
        queryValue: batchId,
        collections: ["orgs", "publicOrganizations", "organizationSourceCandidates"],
      },
      createdAt: Date.now(),
    });
  }
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}

module.exports = {
  assertProjectSafety,
  contentHash,
  importRows,
  publicProjection,
  rows,
  stableJson,
  validate,
};
