#!/usr/bin/env node

import process from "node:process";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { buildOpportunityDiscoveryProjection } from "../apps/functions/src/opportunityDiscovery";

const argumentsSet = new Set(process.argv.slice(2));
const dryRun = argumentsSet.has("--dry-run");
const explicitProject = process.env.GCLOUD_PROJECT
  ?? process.env.GOOGLE_CLOUD_PROJECT
  ?? process.env.FIREBASE_PROJECT_ID;
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const productionAcknowledgment = process.env.OPPORTUNITY_DISCOVERY_ALLOW_NON_EMULATOR_BACKFILL === "I_UNDERSTAND_THIS_WRITES_DERIVED_DATA";

if (!emulatorHost && !productionAcknowledgment) {
  console.error(
    "Refusing non-emulator backfill. Set FIRESTORE_EMULATOR_HOST, or explicitly acknowledge a controlled target with OPPORTUNITY_DISCOVERY_ALLOW_NON_EMULATOR_BACKFILL=I_UNDERSTAND_THIS_WRITES_DERIVED_DATA.",
  );
  process.exit(1);
}
if (!explicitProject) {
  console.error("A Firebase project ID is required.");
  process.exit(1);
}
if (!getApps().length) {
  initializeApp({
    projectId: explicitProject,
    ...(emulatorHost ? {} : { credential: applicationDefault() }),
  });
}

const db = getFirestore();
const pageSize = 200;
let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
let scanned = 0;
let projected = 0;
let omitted = 0;
let batches = 0;

console.log(JSON.stringify({
  mode: emulatorHost ? "emulator" : "explicit-non-emulator",
  projectId: explicitProject,
  emulatorHost: emulatorHost ?? null,
  dryRun,
}));

while (true) {
  let query = db.collection("rfx")
    .orderBy("__name__")
    .limit(pageSize);
  if (cursor) query = query.startAfter(cursor);
  const snapshot = await query.get();
  if (snapshot.empty) break;

  const batch = db.batch();
  let writes = 0;
  for (const document of snapshot.docs) {
    scanned += 1;
    const projection = buildOpportunityDiscoveryProjection(document.id, document.data());
    if (!projection) {
      omitted += 1;
      continue;
    }
    projected += 1;
    writes += 1;
    if (!dryRun) {
      batch.set(db.collection("opportunityDiscovery").doc(document.id), {
        ...projection,
        backfilledAt: Date.now(),
        backfillSource: "scripts/backfill-opportunity-discovery.ts",
      }, { merge: false });
    }
  }
  if (!dryRun && writes) await batch.commit();
  batches += 1;
  cursor = snapshot.docs.at(-1);
  console.log(JSON.stringify({ batches, scanned, projected, omitted, lastId: cursor?.id }));
  if (snapshot.size < pageSize) break;
}

const sourceOpenApproved = await db.collection("rfx")
  .where("status", "==", "open")
  .where("adminApprovalStatus", "==", "approved")
  .count()
  .get();
const projectionCount = await db.collection("opportunityDiscovery")
  .where("projectionVersion", "==", 1)
  .where("discoverable", "==", true)
  .count()
  .get();

const sourceCount = sourceOpenApproved.data().count;
const targetCount = projectionCount.data().count;
console.log(JSON.stringify({
  complete: !dryRun && sourceCount === targetCount,
  sourceOpenApproved: sourceCount,
  discoverableProjectionV1: targetCount,
  scanned,
  projected,
  omitted,
  batches,
}));

if (!dryRun && sourceCount !== targetCount) {
  console.error("Projection count does not match approved/open source count. Compatibility fallback must remain enabled.");
  process.exitCode = 2;
}
