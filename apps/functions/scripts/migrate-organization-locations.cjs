#!/usr/bin/env node
"use strict";

const { writeFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const admin = require("firebase-admin");
const {
  planLegacyOrganizationLocationMigration,
  applyLegacyOrganizationClaimPolicy,
} = require("../lib/exchange/organizationLocationMigration.js");
const {
  assertDevelopmentMigrationGuard,
  projectPublicEstablishment,
} = require("../lib/exchange/organizationEstablishments.js");

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    if (["apply", "include-claimed", "confirm-claimed", "expect-no-op", "summary-only"].includes(name)) result[name] = true;
    else result[name] = argv[index + 1], index += 1;
  }
  return result;
}

function contentHash(value) {
  const stable = (item) => Array.isArray(item) ? item.map(stable)
    : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])])) : item;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function serializeFirestore(value) {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (value instanceof admin.firestore.Timestamp) return { __firestoreType: "timestamp", millis: value.toMillis() };
  if (value instanceof admin.firestore.GeoPoint) return { __firestoreType: "geopoint", latitude: value.latitude, longitude: value.longitude };
  if (value instanceof admin.firestore.DocumentReference) return { __firestoreType: "reference", path: value.path };
  if (Array.isArray(value)) return value.map(serializeFirestore);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeFirestore(item)]));
}

async function main() {
  const options = args(process.argv.slice(2));
  const projectId = String(options.project || process.env.GCLOUD_PROJECT || "");
  const apply = options.apply === true;
  const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));
  if (!projectId) throw new Error("--project is required");
  assertDevelopmentMigrationGuard(projectId, apply, options["confirm-development"]);
  if (options["include-claimed"] && !options["confirm-claimed"]) throw new Error("--include-claimed requires --confirm-claimed");
  admin.initializeApp({ projectId });
  const db = admin.firestore();
  const snapshot = await db.collection("orgs").orderBy(admin.firestore.FieldPath.documentId()).limit(limit).get();
  const plans = snapshot.docs.map((document) => applyLegacyOrganizationClaimPolicy(
    planLegacyOrganizationLocationMigration(document.id, document.data(), Date.now()),
    document.data(),
    options["include-claimed"] === true,
  ));
  const actionable = plans.filter((plan) => plan.outcome === "create");
  if (options["expect-no-op"] && actionable.length) throw new Error(`Expected no-op but ${actionable.length} writes were planned`);
  const rollback = { projectId, migrationVersion: 1, createdAt: Date.now(), records: [] };
  if (apply) {
    if (!options.rollback) throw new Error("Applied migration requires --rollback output path");

    // Resolve every pre-image and create the protected rollback artifact before
    // the first configured-development write. Existing deterministic locations
    // are idempotent skips and do not need rollback entries.
    const prepared = [];
    for (const plan of actionable) {
      const locationRef = db.collection("organizationLocations").doc(plan.location.id);
      const [locationBefore, orgBefore] = await Promise.all([locationRef.get(), db.collection("orgs").doc(plan.organizationId).get()]);
      if (locationBefore.exists) continue;
      rollback.records.push({ organizationId: plan.organizationId, locationId: plan.location.id,
        organizationBefore: serializeFirestore(orgBefore.data() || null), locationBefore: null,
        locationAfterHash: contentHash(plan.location), hash: plan.hash });
      prepared.push({ plan, locationRef });
    }
    writeFileSync(options.rollback, `${JSON.stringify(rollback, null, 2)}\n`, { flag: "wx", mode: 0o600 });

    for (const { plan, locationRef } of prepared) {
      const batch = db.batch();
      batch.create(locationRef, plan.location);
      const publicProjection = projectPublicEstablishment(plan.location);
      if (publicProjection) batch.set(db.collection("publicOrganizationLocations").doc(plan.location.id), publicProjection);
      batch.set(db.collection("orgs").doc(plan.organizationId), { ...plan.organizationPatch, organizationLocationMigrationHash: plan.hash }, { merge: true });
      await batch.commit();
    }
  }
  process.stdout.write(`${JSON.stringify({ projectId, mode: apply ? "apply" : "dry-run", scanned: plans.length,
    actionable: actionable.length, outcomes: Object.fromEntries([...new Set(plans.map((plan) => plan.reason))].map((reason) => [reason, plans.filter((plan) => plan.reason === reason).length])),
    ...(options["summary-only"] ? {} : { plans }) }, null, 2)}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
