#!/usr/bin/env node
"use strict";

const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const admin = require("firebase-admin");

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const name = token.slice(2);
    if (name === "apply") result[name] = true;
    else result[name] = argv[index + 1], index += 1;
  }
  return result;
}

function contentHash(value) {
  const stable = (item) => Array.isArray(item) ? item.map(stable)
    : item && typeof item === "object" ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])])) : item;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function deserializeFirestore(db, value) {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (value.__firestoreType === "timestamp") return admin.firestore.Timestamp.fromMillis(value.millis);
  if (value.__firestoreType === "geopoint") return new admin.firestore.GeoPoint(value.latitude, value.longitude);
  if (value.__firestoreType === "reference") return db.doc(value.path);
  if (Array.isArray(value)) return value.map((item) => deserializeFirestore(db, item));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deserializeFirestore(db, item)]));
}

async function main() {
  const options = args(process.argv.slice(2));
  const projectId = String(options.project || "");
  if (!projectId || !options.input) throw new Error("--project and --input are required");
  if (options.apply && (projectId !== "hi-coworking-plat" || options["confirm-development"] !== projectId)) {
    throw new Error("Rollback apply requires exact configured development confirmation");
  }
  const manifest = JSON.parse(readFileSync(options.input, "utf8"));
  if (manifest.projectId !== projectId || manifest.migrationVersion !== 1 || !Array.isArray(manifest.records)) {
    throw new Error("Rollback manifest does not match project or migration version");
  }
  admin.initializeApp({ projectId });
  const db = admin.firestore();
  if (options.apply) {
    // Validate the entire rollback set before the first mutation so a changed
    // organization or establishment cannot produce a partial rollback.
    const current = await Promise.all(manifest.records.map(async (record) => ({ record,
      organization: await db.collection("orgs").doc(record.organizationId).get(),
      location: await db.collection("organizationLocations").doc(record.locationId).get(),
    })));
    for (const { record, organization, location } of current) {
      if (organization.get("organizationLocationMigrationHash") !== record.hash) {
        throw new Error(`Hash mismatch for ${record.organizationId}; refusing rollback`);
      }
      if (!location.exists || !record.locationAfterHash || contentHash(location.data()) !== record.locationAfterHash) {
        throw new Error(`Location changed for ${record.organizationId}; refusing rollback`);
      }
    }
    for (const { record } of current) {
      const batch = db.batch();
      batch.delete(db.collection("organizationLocations").doc(record.locationId));
      batch.delete(db.collection("publicOrganizationLocations").doc(record.locationId));
      if (record.organizationBefore) batch.set(db.collection("orgs").doc(record.organizationId), deserializeFirestore(db, record.organizationBefore));
      await batch.commit();
    }
  }
  process.stdout.write(`${JSON.stringify({ projectId, mode: options.apply ? "apply" : "rehearse", records: manifest.records.length })}\n`);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
