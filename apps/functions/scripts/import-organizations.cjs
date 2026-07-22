#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");
const {
  CONFIGURED_DEVELOPMENT_PROJECT,
  DEFAULT_SAMPLE_LIMIT,
  SeedLifecycleError,
  assertConfiguredDevelopmentProject,
  assertDevelopmentExpansionGate,
  baseCandidateIssues,
  contentHash,
  loadJsonLines,
  reviewMetadataIssues,
  stableJson,
} = require("./organization-seed-lifecycle.cjs");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function rows(file) {
  return loadJsonLines(file);
}

function validate(row, restricted) {
  const errors = [
    ...baseCandidateIssues(row, restricted),
    ...reviewMetadataIssues(row, { restricted, requireApproved: true }),
  ];
  if (!row || typeof row !== "object" || Array.isArray(row)) return [...new Set(errors)];
  if (![1, 2].includes(row.approvedExportVersion)) errors.push("approvedExportVersion must be 1 or 2");
  if (row.approvedExportVersion === 2) {
    if (row.seedPackageVersion !== 2) errors.push("seedPackageVersion must be 2");
    if (![row.establishments, row.contactPoints, row.communicationRoutes].every(Array.isArray)) {
      errors.push("version 2 seed packages require establishments, contactPoints, and communicationRoutes arrays");
    }
    if (typeof row.seedPackageHash !== "string" || row.seedPackageHash !== contentHash({
      organizationId: row.id,
      establishments: row.establishments,
      contactPoints: row.contactPoints,
      communicationRoutes: row.communicationRoutes,
    })) errors.push("seedPackageHash is invalid");
  }
  if (row.publicationApproved === false) errors.push("approved export cannot explicitly disable publication");
  return [...new Set(errors)];
}

function cleanPublicString(value, maximumLength) {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maximumLength) : undefined;
}

function publicStringList(value, maximum = 50) {
  return Array.isArray(value)
    ? value
      .filter((item) => typeof item === "string" && item.trim())
      .map((item) => item.trim().slice(0, 160))
      .slice(0, maximum)
    : [];
}

function publicProjection(row) {
  if (row.restrictedMatchOnly === true) {
    throw new SeedLifecycleError("Restricted matching candidates never receive a public projection.", {
      id: row.id || null,
    });
  }
  const privacySuppressed = row.homeBased === true || row.privacySuppressed === true;
  const publicationApproved = row.publicationApproved === true
    && row.reviewStatus === "approved"
    && row.approvedExportVersion === 1;
  const resourceProviderStatus = row.resourceProviderStatus === "approved"
    ? "approved"
    : "not_provider";
  const issuerStatus = row.issuerStatus === "approved" ? "approved" : "not_issuer";
  const projection = {
    id: row.id,
    schemaVersion: 2,
    publicationApproved,
    name: cleanPublicString(row.name, 200) || "Organization",
    normalizedName: cleanPublicString(row.normalizedName, 200) || "",
    slug: cleanPublicString(row.slug, 100) || row.id,
    city: cleanPublicString(row.city, 100) || "",
    county: cleanPublicString(row.county, 100) || "",
    state: cleanPublicString(row.state, 40) || "",
    territoryFips: cleanPublicString(row.territoryFips, 12) || "",
    website: cleanPublicString(row.website, 500) || "",
    organizationType: cleanPublicString(row.organizationType, 100) || "",
    industries: publicStringList(row.industries ?? row.industryLabels),
    description: cleanPublicString(row.description, 2_000) || "",
    naicsCodes: publicStringList(row.naicsCodes),
    capabilityKeywords: publicStringList(row.capabilityKeywords),
    certifications: publicStringList(row.certifications),
    searchTokens: publicStringList(row.searchTokens, 50),
    resourceProviderStatus,
    resourceCategories: resourceProviderStatus === "approved"
      ? publicStringList(row.resourceCategories, 50)
      : [],
    issuerStatus,
    acceptsReferrals: row.acceptsReferrals === true,
    publicContactAvailable: row.publicContactAvailable === true
      || Boolean(cleanPublicString(row.website, 500)),
    publicLocationCount: Number.isInteger(row.activeLocationCount) ? row.activeLocationCount : 0,
    claimStatus: ["unclaimed", "claim_pending", "claimed"].includes(row.claimStatus)
      ? row.claimStatus
      : "unclaimed",
    verificationStatus: cleanPublicString(row.verificationStatus, 40) || "unverified",
    homeBased: row.homeBased === true,
    privacySuppressed,
    status: publicationApproved && row.status === "active" ? "active" : "inactive",
    updatedAt: row.updatedAt,
  };
  if (!privacySuppressed && row.addressPublicationApproved === true) {
    const addressLine1 = cleanPublicString(row.addressLine1 ?? row.address, 300);
    const postalCode = cleanPublicString(row.postalCode, 20);
    if (addressLine1) projection.addressLine1 = addressLine1;
    if (postalCode) projection.postalCode = postalCode;
    if (projection.addressLine1 || projection.postalCode) {
      projection.addressPublicationApproved = true;
    }
  }
  if (!privacySuppressed && row.coordinatePublicationApproved === true) {
    if (typeof row.latitude === "number" && Number.isFinite(row.latitude)) {
      projection.latitude = row.latitude;
    }
    if (typeof row.longitude === "number" && Number.isFinite(row.longitude)) {
      projection.longitude = row.longitude;
    }
    const geohash = cleanPublicString(row.geohash, 100);
    if (geohash) projection.geohash = geohash;
    if (["authoritative", "verified", "approximate"].includes(row.coordinateConfidence)) {
      projection.coordinateConfidence = row.coordinateConfidence;
    }
    if (typeof projection.latitude === "number" && typeof projection.longitude === "number") {
      projection.coordinatePublicationApproved = true;
    } else {
      delete projection.latitude;
      delete projection.longitude;
      delete projection.geohash;
      delete projection.coordinateConfidence;
    }
  }
  return Object.fromEntries(Object.entries(projection).filter(([, value]) => value !== undefined));
}

function normalizeSafetyOptions(projectId, optionsOrDryRun, legacyConfirmation) {
  if (typeof optionsOrDryRun === "boolean") {
    return {
      dryRun: optionsOrDryRun,
      apply: !optionsOrDryRun,
      environment: projectId.startsWith("demo-") ? "emulator" : "development",
      confirmDevelopment: legacyConfirmation,
    };
  }
  return {
    dryRun: optionsOrDryRun?.dryRun !== false,
    apply: optionsOrDryRun?.apply === true,
    environment: optionsOrDryRun?.environment || (projectId.startsWith("demo-") ? "emulator" : "development"),
    confirmDevelopment: optionsOrDryRun?.confirmDevelopment,
  };
}

function assertProjectSafety(projectId, optionsOrDryRun = { dryRun: true }, legacyConfirmation) {
  if (!projectId) throw new Error("--project is required; refusing an unscoped import");
  const options = normalizeSafetyOptions(projectId, optionsOrDryRun, legacyConfirmation);
  assertConfiguredDevelopmentProject(projectId, options.environment);
  if (options.dryRun || !options.apply || options.environment === "emulator") return;
  if (options.confirmDevelopment !== CONFIGURED_DEVELOPMENT_PROJECT) {
    throw new Error(`Refusing development write. Re-run with --apply --environment development --confirm-development ${CONFIGURED_DEVELOPMENT_PROJECT} after reviewing the approved-only export and protected rollback manifest.`);
  }
}

function assertRowLimit(count, label, options) {
  if (count <= options.maximumRows) return;
  throw new SeedLifecycleError(`${label} contains ${count} rows; the active gate permits at most ${options.maximumRows}.`, {
    label,
    count,
    maximumRows: options.maximumRows,
  });
}

function assertExpansionGate(projectId, options) {
  if (!options.allowFullDevelopment) return DEFAULT_SAMPLE_LIMIT;
  if (projectId !== CONFIGURED_DEVELOPMENT_PROJECT || options.confirmFullDevelopment !== projectId) {
    throw new Error(`Full development expansion requires --confirm-full-development ${CONFIGURED_DEVELOPMENT_PROJECT}.`);
  }
  if (!options.sampleGateManifest) throw new Error("--sample-gate-manifest is required for full development expansion");
  const gate = JSON.parse(fs.readFileSync(path.resolve(options.sampleGateManifest), "utf8"));
  assertDevelopmentExpansionGate(gate, projectId);
  return 10_000;
}

function serializeFirestore(value) {
  if (value === undefined) return { __seedType: "undefined" };
  if (value === null || typeof value !== "object") return value;
  if (typeof value.toMillis === "function") {
    return { __seedType: "timestamp", millis: value.toMillis() };
  }
  if (typeof value.path === "string" && value.firestore) {
    return { __seedType: "documentReference", path: value.path };
  }
  if (typeof value.latitude === "number" && typeof value.longitude === "number"
      && value.constructor?.name === "GeoPoint") {
    return { __seedType: "geoPoint", latitude: value.latitude, longitude: value.longitude };
  }
  if (Array.isArray(value)) return value.map(serializeFirestore);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeFirestore(item)]));
}

function snapshotHash(value) {
  return contentHash(serializeFirestore(value));
}

async function getSnapshots(db, refs) {
  if (!refs.length) return [];
  if (typeof db.getAll === "function") {
    const snapshots = [];
    for (let index = 0; index < refs.length; index += 200) {
      snapshots.push(...await db.getAll(...refs.slice(index, index + 200)));
    }
    return snapshots;
  }
  return Promise.all(refs.map((ref) => ref.get()));
}

function protectedExistingReason(existing) {
  if (!existing) return null;
  if (typeof existing.ownerUid === "string" && existing.ownerUid.trim()) return "ownerUid is present";
  if (![undefined, null, "", "unclaimed"].includes(existing.claimStatus)) {
    return `claimStatus is ${existing.claimStatus}`;
  }
  return null;
}

function organizationPayload(row, existing, batchId, now) {
  const {
    establishments = [], contactPoints: _contactPoints, communicationRoutes: _communicationRoutes,
    establishmentDecisions: _establishmentDecisions, contactDecisions: _contactDecisions,
    communicationRouteDecisions: _communicationRouteDecisions, ...organization
  } = row;
  const primary = establishments.find((location) => location.status === "active" && location.isPrimary === true);
  const headquarters = establishments.find((location) => location.status === "active" && location.isHeadquarters === true);
  return {
    ...organization,
    schemaVersion: 3,
    recordVersion: Number(existing?.recordVersion || 0) + 1,
    activeLocationCount: establishments.filter((location) => location.status === "active").length,
    ...(primary ? { primaryLocationId: primary.id } : {}),
    ...(headquarters ? { headquartersLocationId: headquarters.id } : {}),
    publicationApproved: true,
    importBatchId: batchId,
    sourceContentHash: contentHash(row),
    sourceRetrievedAt: existing?.sourceRetrievedAt || now,
    updatedAt: now,
    createdAt: existing?.createdAt || now,
    slug: existing?.slug || `${row.normalizedName.replace(/\s+/g, "-").slice(0, 60)}-${row.id.slice(-6)}`,
    ownerUid: existing?.ownerUid || "",
    status: existing?.status || "active",
    claimStatus: existing?.claimStatus || row.claimStatus || "unclaimed",
    verificationStatus: existing?.verificationStatus || row.verificationStatus || "unverified",
    exchangeVerificationStatus: existing?.exchangeVerificationStatus
      || existing?.verificationStatus
      || row.verificationStatus
      || "unverified",
  };
}

function publicLocationProjection(location) {
  if (location.status !== "active") return null;
  const privateHome = location.privateHome === true;
  const result = {
    id: location.id, organizationId: location.organizationId,
    name: privateHome ? (location.serviceArea?.city ? `${location.serviceArea.city} service area` : "Service area") : location.name,
    locationType: privateHome ? "service_location" : location.locationType, isHeadquarters: location.isHeadquarters === true,
    isPrimary: location.isPrimary === true,
    city: location.serviceArea?.city || (location.addressPublicationApproved ? location.physicalAddress?.locality : undefined),
    county: location.serviceArea?.county || (location.addressPublicationApproved ? location.physicalAddress?.county : undefined),
    administrativeArea: location.serviceArea?.region || (location.addressPublicationApproved ? location.physicalAddress?.administrativeArea : undefined),
    countryCode: location.serviceArea?.countryCode || (location.addressPublicationApproved ? location.physicalAddress?.countryCode : undefined),
    addressPublicationApproved: !privateHome && location.addressPublicationApproved === true,
    coordinatePublicationApproved: !privateHome && location.coordinatePublicationApproved === true
      && !["mailing_only", "virtual"].includes(location.locationType),
    publicContactAvailable: location.publicContactAvailable === true,
    version: 1, updatedAt: location.updatedAt,
  };
  if (result.addressPublicationApproved && location.physicalAddress) {
    result.addressLine1 = location.physicalAddress.line1;
    if (location.physicalAddress.postalCode) result.postalCode = location.physicalAddress.postalCode;
  }
  if (result.coordinatePublicationApproved && Number.isFinite(location.geocode?.latitude) && Number.isFinite(location.geocode?.longitude)
      && !(location.geocode.latitude === 0 && location.geocode.longitude === 0)) {
    result.latitude = location.geocode.latitude; result.longitude = location.geocode.longitude;
    if (location.geocode.geohash) result.geohash = location.geocode.geohash;
    result.coordinatePrecision = location.geocode.precision || "unknown";
  } else result.coordinatePublicationApproved = false;
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}

function publicContactProjection(contact) {
  if (contact.status !== "active" || contact.visibility !== "public" || contact.publicationStatus !== "approved" || contact.type === "member_route") return null;
  return { id: contact.id, organizationId: contact.organizationId, ...(contact.locationId ? { locationId: contact.locationId } : {}),
    type: contact.type, purposes: contact.purposes, displayValue: contact.displayValue || contact.normalizedValue,
    visibility: "public", publicationStatus: "approved", status: "active", version: 1, updatedAt: contact.updatedAt };
}

async function planPackageRecords(db, row, batchId, now) {
  if (row.approvedExportVersion !== 2) return [];
  const specs = [
    ["organizationLocations", row.establishments, "publicOrganizationLocations", publicLocationProjection],
    ["organizationContactPoints", row.contactPoints, "publicOrganizationContactPoints", publicContactProjection],
    ["organizationCommunicationRoutes", row.communicationRoutes, null, null],
  ];
  const plans = [];
  for (const [collection, records, publicCollection, projector] of specs) {
    for (const record of records) {
      if (!record?.id || record.organizationId !== row.id) throw new SeedLifecycleError("Seed package child ownership is invalid.", { organizationId: row.id, collection, recordId: record?.id });
      const ref = db.collection(collection).doc(record.id); const snapshot = await ref.get(); const sourceContentHash = contentHash(record);
      if (snapshot.exists && snapshot.data()?.sourceContentHash !== sourceContentHash) throw new SeedLifecycleError("Refusing to overwrite a changed seed package child.", { organizationId: row.id, collection, recordId: record.id });
      // Preserve an unchanged imported record byte-for-byte so its public
      // projection also remains stable on replay. A fresh updatedAt here would
      // turn every v2 package replay into a spurious projection repair.
      const after = snapshot.exists
        ? snapshot.data()
        : { ...record, importBatchId: batchId, sourceContentHash, updatedAt: now };
      const plan = { collection, id: record.id, ref, beforeExists: snapshot.exists, before: snapshot.data?.() || null, after, merge: false, writeMain: !snapshot.exists };
      if (publicCollection && projector) {
        const projected = projector(after); const publicRef = db.collection(publicCollection).doc(record.id); const publicSnapshot = await publicRef.get();
        if (projected && (!publicSnapshot.exists || snapshotHash(publicSnapshot.data()) !== snapshotHash(projected))) {
          plan.public = { collection: publicCollection, id: record.id, ref: publicRef, beforeExists: publicSnapshot.exists, before: publicSnapshot.data?.() || null, after: projected, merge: false, writeMain: true };
        }
      }
      if (plan.writeMain || plan.public) plans.push(plan);
    }
  }
  return plans;
}

function restrictedPayload(row, existing, batchId, now) {
  return {
    ...row,
    schemaVersion: 2,
    publicationApproved: false,
    importBatchId: batchId,
    sourceContentHash: contentHash(row),
    sourceRetrievedAt: existing?.sourceRetrievedAt || now,
    updatedAt: now,
    createdAt: existing?.createdAt || now,
  };
}

async function planCollectionImport(db, file, collectionName, restricted, batchId, now = Date.now()) {
  const sourceRows = rows(file);
  const result = {
    inputRows: sourceRows.length,
    created: 0,
    updated: 0,
    skipped: 0,
    duplicate: 0,
    invalid: 0,
    invalidRows: [],
    protectedExisting: [],
    protectedUnchanged: 0,
    projectionRepaired: 0,
    packageRecordsPlanned: 0,
  };
  const seen = new Set();
  const prepared = [];
  for (const [index, row] of sourceRows.entries()) {
    const errors = validate(row, restricted);
    if (errors.length) {
      result.invalid += 1;
      result.invalidRows.push({ line: index + 1, id: row.id || null, errors });
      continue;
    }
    if (seen.has(row.id)) {
      result.duplicate += 1;
      continue;
    }
    seen.add(row.id);
    prepared.push({ row, ref: db.collection(collectionName).doc(row.id) });
  }
  if (result.invalid || result.duplicate) {
    throw new SeedLifecycleError(`Strict ${collectionName} validation failed; no reads or writes were applied.`, result);
  }

  const snapshots = await getSnapshots(db, prepared.map((entry) => entry.ref));
  const publicRefs = collectionName === "orgs"
    ? prepared.map((entry) => db.collection("publicOrganizations").doc(entry.row.id))
    : [];
  const publicSnapshots = await getSnapshots(db, publicRefs);
  const plans = [];
  for (const [index, entry] of prepared.entries()) {
    const existingSnapshot = snapshots[index];
    const existing = existingSnapshot.data?.();
    const sourceContentHash = contentHash(entry.row);
    const sourceUnchanged = existing?.sourceContentHash === sourceContentHash;
    if (!restricted) {
      const protectedReason = protectedExistingReason(existing);
      if (protectedReason && !sourceUnchanged) {
        result.protectedExisting.push({ id: entry.row.id, reason: protectedReason });
        continue;
      }
      if (protectedReason && sourceUnchanged) {
        result.protectedUnchanged += 1;
        result.skipped += 1;
        continue;
      }
    }
    const after = sourceUnchanged
      ? existing
      : restricted
        ? restrictedPayload(entry.row, existing, batchId, now)
        : organizationPayload(entry.row, existing, batchId, now);
    const plan = {
      collection: collectionName,
      id: entry.row.id,
      ref: entry.ref,
      beforeExists: existingSnapshot.exists === true,
      before: existing || null,
      after,
      merge: true,
      writeMain: !sourceUnchanged,
    };
    if (!restricted) {
      const publicExisting = publicSnapshots[index];
      const publicBefore = publicExisting.data?.() || null;
      const publicAfter = publicProjection(after);
      if (!publicExisting.exists || snapshotHash(publicBefore) !== snapshotHash(publicAfter)) {
        plan.public = {
          collection: "publicOrganizations",
          id: entry.row.id,
          ref: publicRefs[index],
          beforeExists: publicExisting.exists === true,
          before: publicBefore,
          after: publicAfter,
          merge: false,
          writeMain: true,
        };
      }
      plan.package = await planPackageRecords(db, entry.row, batchId, now);
      result.packageRecordsPlanned += plan.package.length;
    }
    if (!plan.writeMain && !plan.public && !plan.package?.length) {
      result.skipped += 1;
      continue;
    }
    if (!plan.writeMain && plan.public) {
      result.projectionRepaired += 1;
    }
    plans.push(plan);
    if (plan.writeMain) {
      if (existingSnapshot.exists) result.updated += 1;
      else result.created += 1;
    }
  }
  if (result.protectedExisting.length) {
    throw new SeedLifecycleError(`Refusing to change claimed or owned ${collectionName} records.`, result);
  }
  return { result, plans, sourceRows };
}

async function setDocument(plan) {
  await plan.ref.set(plan.after, { merge: plan.merge });
}

async function importRows(db, file, collectionName, restricted, batchId, dryRun) {
  const planned = await planCollectionImport(db, file, collectionName, restricted, batchId);
  if (!dryRun) {
    for (const plan of planned.plans) {
      if (plan.writeMain) await setDocument(plan);
      if (plan.public) await setDocument(plan.public);
    }
  }
  return planned.result;
}

function flattenPlans(plans) {
  return plans.flatMap((plan) => [
    plan.writeMain ? plan : null,
    plan.public,
    ...flattenPlans(plan.package || []),
  ].filter(Boolean));
}

function rollbackEntries(plans) {
  return flattenPlans(plans).map((plan) => ({
    collection: plan.collection,
    id: plan.id,
    beforeExists: plan.beforeExists,
    before: serializeFirestore(plan.before),
    after: serializeFirestore(plan.after),
    afterHash: snapshotHash(plan.after),
    importBatchId: plan.after.importBatchId || null,
  }));
}

function createRollbackManifest({ projectId, environment, batchId, organizationPlan, targetingPlan, now }) {
  const entries = rollbackEntries([...organizationPlan.plans, ...targetingPlan.plans]);
  return {
    rollbackManifestVersion: 1,
    projectId,
    environment,
    batchId,
    createdAt: now,
    protectedArtifact: true,
    entries,
    entryCount: entries.length,
    organizationInputHash: contentHash(organizationPlan.sourceRows),
    targetingInputHash: contentHash(targetingPlan.sourceRows),
    afterSetHash: contentHash(entries.map((entry) => [entry.collection, entry.id, entry.afterHash])),
    instructions: "Use rollback-organization-seed.cjs. It restores only unchanged batch-owned records and refuses claimed or subsequently modified organizations.",
  };
}

function writeRollbackManifest(file, manifest) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolved, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return resolved;
}

async function commitPlans(db, plans, manifestRef, manifestDocument) {
  const operations = flattenPlans(plans);
  if (typeof db.batch !== "function") {
    for (const plan of operations) await setDocument(plan);
    await manifestRef.set(manifestDocument, { merge: false });
    return { atomicSample: false, batches: operations.length + 1 };
  }
  if (operations.length + 1 <= 500) {
    const batch = db.batch();
    for (const plan of operations) batch.set(plan.ref, plan.after, { merge: plan.merge });
    batch.set(manifestRef, manifestDocument, { merge: false });
    await batch.commit();
    return { atomicSample: true, batches: 1 };
  }

  let batches = 0;
  for (let index = 0; index < operations.length; index += 450) {
    const batch = db.batch();
    for (const plan of operations.slice(index, index + 450)) {
      batch.set(plan.ref, plan.after, { merge: plan.merge });
    }
    await batch.commit();
    batches += 1;
  }
  await manifestRef.set(manifestDocument, { merge: false });
  return { atomicSample: false, batches: batches + 1 };
}

async function main() {
  const organizations = argument("--organizations");
  const targeting = argument("--targeting");
  const apply = hasFlag("--apply");
  if (apply && hasFlag("--dry-run")) throw new Error("Choose either --apply or --dry-run, not both");
  const dryRun = !apply;
  if (!organizations || !targeting) throw new Error("--organizations and --targeting are required");
  const projectId = argument("--project");
  const environment = argument("--environment") || (projectId?.startsWith("demo-") ? "emulator" : "development");
  assertProjectSafety(projectId, {
    dryRun,
    apply,
    environment,
    confirmDevelopment: argument("--confirm-development"),
  });
  const maximumRows = assertExpansionGate(projectId, {
    allowFullDevelopment: hasFlag("--allow-full-development"),
    confirmFullDevelopment: argument("--confirm-full-development"),
    sampleGateManifest: argument("--sample-gate-manifest"),
  });
  const organizationRows = rows(path.resolve(organizations));
  const targetingRows = rows(path.resolve(targeting));
  assertRowLimit(organizationRows.length, "approved organizations export", { maximumRows });
  assertRowLimit(targetingRows.length, "approved restricted-matching export", { maximumRows });
  assertRowLimit(
    organizationRows.length + targetingRows.length,
    "combined approved seed input",
    { maximumRows },
  );

  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();
  const batchId = argument("--batch-id") || `exchange_seed_${new Date().toISOString().slice(0, 10)}`;
  const now = Date.now();
  const organizationPlan = await planCollectionImport(
    db, path.resolve(organizations), "orgs", false, batchId, now,
  );
  const targetingPlan = await planCollectionImport(
    db, path.resolve(targeting), "organizationSourceCandidates", true, batchId, now,
  );
  const changedRecords = rollbackEntries([...organizationPlan.plans, ...targetingPlan.plans]).length;
  const replay = {
    status: changedRecords === 0 ? "no_op_verified" : "changes_planned",
    noOp: changedRecords === 0,
    comparedRows: organizationRows.length + targetingRows.length,
    changedRecords,
  };
  if (hasFlag("--expect-no-op") && !replay.noOp) {
    throw new SeedLifecycleError("Replay verification failed: changes are still planned.", replay);
  }

  const rollbackFile = argument("--rollback-output");
  let rollback = null;
  let commit = null;
  const report = {
    projectId,
    environment,
    batchId,
    dryRun,
    apply,
    approvedOnly: true,
    maximumRows,
    organizations: organizationPlan.result,
    targeting: targetingPlan.result,
    replay,
    privacy: {
      publicProjectionAllowlisted: true,
      reviewMetadataExcludedFromPublicProjection: true,
      suppressedHomeAddresses: true,
      restrictedTargetingServerOnly: true,
      fabricatedCoordinates: false,
      coordinateApprovalRequiredForPublication: true,
      addressApprovalRequiredForPublication: true,
    },
  };
  if (apply && !replay.noOp) {
    if (!rollbackFile) throw new Error("--rollback-output is required before any apply");
    const rollbackManifest = createRollbackManifest({
      projectId,
      environment,
      batchId,
      organizationPlan,
      targetingPlan,
      now,
    });
    rollback = writeRollbackManifest(rollbackFile, rollbackManifest);
    const manifestRef = db.collection("organizationSeedImports").doc(batchId);
    const manifestDocument = {
      ...report,
      rollback: {
        manifestHash: contentHash(rollbackManifest),
        entryCount: rollbackManifest.entryCount,
        strategy: "protected_local_snapshot_manifest",
        batchId,
        collections: [
          "orgs", "publicOrganizations", "organizationSourceCandidates",
          "organizationLocations", "publicOrganizationLocations",
          "organizationContactPoints", "publicOrganizationContactPoints",
          "organizationCommunicationRoutes",
        ],
      },
      createdAt: now,
      status: "applied",
    };
    commit = await commitPlans(
      db,
      [...organizationPlan.plans, ...targetingPlan.plans],
      manifestRef,
      manifestDocument,
    );
  }
  console.log(JSON.stringify({
    ...report,
    rollbackArtifactCreatedBeforeWrite: Boolean(rollback),
    rollbackArtifact: rollback ? path.relative(process.cwd(), rollback) : null,
    commit,
    nextStep: replay.noOp
      ? "No write was performed. Preserve this formal no-op replay result with the sample evidence."
      : dryRun
      ? "Review this strict report and protected rollback path before an explicitly confirmed apply."
      : "Run --expect-no-op, configured browser acceptance, and a guarded rollback rehearsal before expansion.",
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    if (error instanceof SeedLifecycleError && error.report) console.error(JSON.stringify(error.report, null, 2));
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  assertExpansionGate,
  assertProjectSafety,
  commitPlans,
  contentHash,
  createRollbackManifest,
  flattenPlans,
  importRows,
  normalizeSafetyOptions,
  planCollectionImport,
  protectedExistingReason,
  publicProjection,
  rows,
  serializeFirestore,
  snapshotHash,
  stableJson,
  validate,
  writeRollbackManifest,
};
