#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");
const {
  CONFIGURED_DEVELOPMENT_PROJECT,
  SeedLifecycleError,
  assertConfiguredDevelopmentProject,
  contentHash,
} = require("./organization-seed-lifecycle.cjs");
const { snapshotHash } = require("./import-organizations.cjs");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function deserializeFirestore(value, db) {
  if (value === null || typeof value !== "object") return value;
  if (value.__seedType === "undefined") return undefined;
  if (value.__seedType === "timestamp") return admin.firestore.Timestamp.fromMillis(value.millis);
  if (value.__seedType === "geoPoint") return new admin.firestore.GeoPoint(value.latitude, value.longitude);
  if (value.__seedType === "documentReference") return db.doc(value.path);
  if (Array.isArray(value)) return value.map((item) => deserializeFirestore(item, db));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deserializeFirestore(item, db)]));
}

const ALLOWED_ROLLBACK_COLLECTIONS = new Set([
  "orgs",
  "publicOrganizations",
  "organizationSourceCandidates",
]);

function validateManifest(manifest, projectId, environment = manifest?.environment) {
  const errors = [];
  if (manifest.rollbackManifestVersion !== 1) errors.push("rollbackManifestVersion must be 1");
  if (manifest.projectId !== projectId) errors.push("manifest project does not match --project");
  if (manifest.environment !== "development" && manifest.environment !== "emulator") {
    errors.push("manifest environment must be development or emulator");
  }
  if (manifest.environment !== environment) errors.push("manifest environment does not match --environment");
  if (manifest.protectedArtifact !== true) errors.push("protectedArtifact must be true");
  if (typeof manifest.batchId !== "string" || !manifest.batchId) errors.push("batchId is required");
  if (!Number.isSafeInteger(manifest.createdAt) || manifest.createdAt <= 0) {
    errors.push("createdAt must be a positive epoch-millisecond integer");
  }
  if (!Array.isArray(manifest.entries)) errors.push("entries must be an array");
  if (Array.isArray(manifest.entries)) {
    if (manifest.entryCount !== manifest.entries.length) errors.push("entryCount does not match entries");
    const keys = new Set();
    for (const entry of manifest.entries) {
      const key = `${entry.collection}/${entry.id}`;
      if (keys.has(key)) errors.push(`duplicate rollback entry ${key}`);
      keys.add(key);
      if (!entry.collection || typeof entry.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(entry.id)
          || typeof entry.afterHash !== "string" || !/^[a-f0-9]{64}$/.test(entry.afterHash)) {
        errors.push(`invalid rollback entry ${key}`);
      }
      if (!ALLOWED_ROLLBACK_COLLECTIONS.has(entry.collection)) {
        errors.push(`rollback collection is not allowlisted: ${entry.collection}`);
      }
      if (entry.after === null || typeof entry.after !== "object" || Array.isArray(entry.after)) {
        errors.push(`after snapshot must be an object for ${key}`);
      }
      if (typeof entry.beforeExists !== "boolean") {
        errors.push(`beforeExists must be boolean for ${key}`);
      }
      if (entry.beforeExists === true
          && (entry.before === null || typeof entry.before !== "object" || Array.isArray(entry.before))) {
        errors.push(`existing before snapshot must be an object for ${key}`);
      }
      if (entry.beforeExists === false && entry.before !== null) {
        errors.push(`new-record before snapshot must be null for ${key}`);
      }
      if (entry.collection !== "publicOrganizations" && entry.importBatchId !== manifest.batchId) {
        errors.push(`importBatchId does not match manifest for ${key}`);
      }
      if (entry.after && contentHash(entry.after) !== entry.afterHash) {
        errors.push(`after snapshot hash mismatch for ${key}`);
      }
    }
    const expectedAfterSetHash = contentHash(
      manifest.entries.map((entry) => [entry.collection, entry.id, entry.afterHash]),
    );
    if (manifest.afterSetHash !== expectedAfterSetHash) errors.push("afterSetHash does not match entries");
  }
  if (errors.length) throw new SeedLifecycleError("Rollback manifest validation failed.", { errors });
}

function buildRollbackPlan(manifest, currentByKey) {
  const actions = [];
  const blocked = [];
  for (const entry of manifest.entries) {
    const key = `${entry.collection}/${entry.id}`;
    const current = currentByKey.get(key);
    const currentExists = current !== undefined && current !== null;
    if (!currentExists) {
      if (!entry.beforeExists) {
        actions.push({ action: "noop", reason: "created record is already absent", entry });
      } else {
        blocked.push({ key, reason: "record to restore is unexpectedly absent" });
      }
      continue;
    }
    if (snapshotHash(current) === entry.afterHash) {
      actions.push({ action: entry.beforeExists ? "restore" : "delete", entry });
      continue;
    }
    if (entry.beforeExists && snapshotHash(current) === contentHash(entry.before)) {
      actions.push({ action: "noop", reason: "prior snapshot is already restored", entry });
      continue;
    }
    const protectedReason = entry.collection === "orgs" && (
      (typeof current.ownerUid === "string" && current.ownerUid.trim())
      || ![undefined, null, "", "unclaimed"].includes(current.claimStatus)
    );
    blocked.push({
      key,
      reason: protectedReason
        ? "organization was claimed or assigned after import"
        : "record changed after import",
    });
  }
  return { actions, blocked };
}

function rehearseRollback(manifest, subsetSize = 10) {
  if (!Number.isSafeInteger(subsetSize) || subsetSize < 1 || subsetSize > 100) {
    throw new Error("--subset-size must be between 1 and 100");
  }
  const entries = manifest.entries.slice(0, subsetSize);
  const simulatedManifest = { ...manifest, entries };
  const current = new Map(entries.map((entry) => [
    `${entry.collection}/${entry.id}`,
    entry.after,
  ]));
  const plan = buildRollbackPlan(simulatedManifest, current);
  const restored = new Map(current);
  for (const action of plan.actions) {
    const key = `${action.entry.collection}/${action.entry.id}`;
    if (action.action === "delete") restored.delete(key);
    if (action.action === "restore") restored.set(key, action.entry.before);
  }
  const mismatches = entries.filter((entry) => {
    const key = `${entry.collection}/${entry.id}`;
    const value = restored.get(key);
    return entry.beforeExists
      ? value === undefined || contentHash(value) !== contentHash(entry.before)
      : value !== undefined;
  });
  return {
    status: !plan.blocked.length && !mismatches.length ? "passed" : "failed",
    subsetSize: entries.length,
    plannedActions: plan.actions.length,
    blocked: plan.blocked,
    mismatches: mismatches.map((entry) => `${entry.collection}/${entry.id}`),
  };
}

async function fetchCurrent(db, entries) {
  const refs = entries.map((entry) => db.collection(entry.collection).doc(entry.id));
  const snapshots = [];
  for (let index = 0; index < refs.length; index += 200) {
    snapshots.push(...await db.getAll(...refs.slice(index, index + 200)));
  }
  return new Map(snapshots.map((snapshot, index) => [
    `${entries[index].collection}/${entries[index].id}`,
    snapshot.exists ? snapshot.data() : null,
  ]));
}

async function commitRollback(db, manifest, actions) {
  const mutations = actions.filter((action) => action.action !== "noop");
  let batches = 0;
  for (let index = 0; index < mutations.length; index += 450) {
    const batch = db.batch();
    for (const action of mutations.slice(index, index + 450)) {
      const ref = db.collection(action.entry.collection).doc(action.entry.id);
      if (action.action === "delete") batch.delete(ref);
      if (action.action === "restore") {
        batch.set(ref, deserializeFirestore(action.entry.before, db), { merge: false });
      }
    }
    await batch.commit();
    batches += 1;
  }
  await db.collection("organizationSeedImports").doc(manifest.batchId).set({
    status: "rolled_back",
    rolledBackAt: Date.now(),
    rollbackEntryCount: mutations.length,
  }, { merge: true });
  return { mutations: mutations.length, batches: batches + 1 };
}

async function main() {
  const manifestFile = argument("--manifest");
  const projectId = argument("--project");
  const environment = argument("--environment") || "development";
  if (!manifestFile || !projectId) throw new Error("--manifest and --project are required");
  assertConfiguredDevelopmentProject(projectId, environment);
  const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestFile), "utf8"));
  validateManifest(manifest, projectId, environment);

  if (process.argv.includes("--rehearse")) {
    const rehearsal = rehearseRollback(manifest, Number(argument("--subset-size") || 10));
    console.log(JSON.stringify({ projectId, batchId: manifest.batchId, dryRun: true, rehearsal }, null, 2));
    if (rehearsal.status !== "passed") process.exitCode = 1;
    return;
  }

  const apply = process.argv.includes("--apply");
  if (apply && (
    environment !== "development"
    || projectId !== CONFIGURED_DEVELOPMENT_PROJECT
    || argument("--confirm-development") !== CONFIGURED_DEVELOPMENT_PROJECT
    || argument("--confirm-batch") !== manifest.batchId
  )) {
    throw new Error(`Rollback apply requires --confirm-development ${CONFIGURED_DEVELOPMENT_PROJECT} and --confirm-batch ${manifest.batchId}.`);
  }
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();
  const current = await fetchCurrent(db, manifest.entries);
  const plan = buildRollbackPlan(manifest, current);
  const report = {
    projectId,
    batchId: manifest.batchId,
    dryRun: !apply,
    manifestHash: contentHash(manifest),
    entries: manifest.entries.length,
    restores: plan.actions.filter((action) => action.action === "restore").length,
    deletes: plan.actions.filter((action) => action.action === "delete").length,
    noops: plan.actions.filter((action) => action.action === "noop").length,
    blocked: plan.blocked,
  };
  if (plan.blocked.length) throw new SeedLifecycleError("Rollback refused modified or claimed records.", report);
  const commit = apply ? await commitRollback(db, manifest, plan.actions) : null;
  console.log(JSON.stringify({ ...report, commit }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    if (error instanceof SeedLifecycleError && error.report) console.error(JSON.stringify(error.report, null, 2));
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildRollbackPlan,
  commitRollback,
  deserializeFirestore,
  rehearseRollback,
  validateManifest,
};
