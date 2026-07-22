const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_SAMPLE_LIMIT,
  SeedLifecycleError,
  coordinateIssues,
  createReviewPacket,
  exportApprovedRows,
  loadJsonLines,
} = require("../scripts/organization-seed-lifecycle.cjs");
const {
  assertExpansionGate,
  assertProjectSafety,
  commitPlans,
  createRollbackManifest,
  importRows,
  planCollectionImport,
  publicProjection,
  validate,
  writeRollbackManifest,
} = require("../scripts/import-organizations.cjs");
const {
  buildRollbackPlan,
  rehearseRollback,
  validateManifest,
} = require("../scripts/rollback-organization-seed.cjs");

const fixture = path.join(__dirname, "../test-fixtures/organization-seed.jsonl");
const reviewedAt = Date.parse("2026-07-22T12:00:00.000Z");

function fakeDb(initial = {}) {
  const documents = new Map(Object.entries(initial));
  const stats = { reads: 0, writes: 0, batchCommits: 0 };
  function ref(name, id) {
    const key = `${name}/${id}`;
    return {
      key,
      async get() {
        stats.reads += 1;
        const value = documents.get(key);
        return { exists: value !== undefined, data: () => value };
      },
      async set(value, options = {}) {
        stats.writes += 1;
        documents.set(key, options.merge === false ? value : { ...(documents.get(key) || {}), ...value });
      },
    };
  }
  return {
    documents,
    stats,
    collection(name) {
      return { doc(id) { return ref(name, id); } };
    },
    batch() {
      const operations = [];
      return {
        set(documentRef, value, options = {}) {
          operations.push({ type: "set", documentRef, value, options });
        },
        delete(documentRef) {
          operations.push({ type: "delete", documentRef });
        },
        async commit() {
          for (const operation of operations) {
            if (operation.type === "delete") {
              documents.delete(operation.documentRef.key);
            } else {
              const previous = documents.get(operation.documentRef.key) || {};
              documents.set(
                operation.documentRef.key,
                operation.options.merge === false ? operation.value : { ...previous, ...operation.value },
              );
            }
            stats.writes += 1;
          }
          stats.batchCommits += 1;
        },
      };
    },
  };
}

function approveReviewRow(row, overrides = {}) {
  const hasCoordinates = typeof row.latitude === "number" && typeof row.longitude === "number";
  const hasAddress = ["address", "addressLine1", "postalCode"]
    .some((key) => typeof row[key] === "string" && row[key].trim());
  return {
    ...row,
    reviewStatus: "approved",
    reviewedBy: "seed-reviewer:test",
    reviewedAt,
    coordinatePublicationApproved: hasCoordinates,
    addressPublicationApproved: hasAddress,
    organizationDecision: row.restrictedMatchOnly === true
      ? "restricted_matching_only"
      : "approve_organization",
    establishmentDecisions: (row.establishmentDecisions || []).map((decision, index) => ({
      ...decision,
      decision: "approve_establishment",
      isPrimary: index === 0,
      isHeadquarters: index === 0,
      addressPublicationApproved: hasAddress,
      coordinatePublicationApproved: hasCoordinates,
    })),
    contactDecisions: (row.contactDecisions || []).map((decision) => ({
      ...decision,
      decision: "approve_private_operational",
      visibility: "private_operational",
    })),
    ...overrides,
  };
}

function approvedRows(candidates, options = {}) {
  const packet = createReviewPacket(candidates, options);
  return exportApprovedRows(packet.rows.map((row) => approveReviewRow(row)), options).rows;
}

function writeJsonLines(t, rows, name = "approved.jsonl") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "organization-seed-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, name);
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, { mode: 0o600 });
  return { directory, file };
}

test("review packets are pending, explicit, immutable, and never infer approval", () => {
  const candidates = loadJsonLines(fixture);
  const packet = createReviewPacket(candidates);
  assert.equal(packet.report.pendingHumanReview, 2);
  assert.equal(packet.report.humanApproved, 0);
  assert.equal(packet.report.coordinatePublicationApproved, 0);
  for (const row of packet.rows) {
    assert.equal(row.reviewStatus, "pending");
    assert.equal(row.reviewedBy, "");
    assert.equal(row.reviewedAt, null);
    assert.equal(row.coordinatePublicationApproved, false);
    assert.equal(row.addressPublicationApproved, false);
    assert.equal(row.projectionVersion, 1);
    assert.match(row.reviewCandidateHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(row.sourceProvenance, [{ source: "test_fixture" }]);
  }
  assert.throws(
    () => exportApprovedRows(packet.rows),
    (error) => error instanceof SeedLifecycleError && /gate remains closed/.test(error.message),
  );
});

test("approved-only export requires human identity and preserves field-level publication decisions", () => {
  const candidate = {
    id: "org_public",
    name: "Public Organization",
    normalizedName: "public organization",
    sources: ["fixture"],
    territoryFips: "51093",
    addressLine1: "100 Main Street",
    postalCode: "23430",
    latitude: 36.98,
    longitude: -76.63,
    coordinateConfidence: "authoritative",
  };
  const [pending] = createReviewPacket([candidate]).rows;
  assert.throws(
    () => exportApprovedRows([{ ...pending, reviewStatus: "approved" }]),
    (error) => error.report.invalidApproved[0].issues.some((issue) => /reviewedBy/.test(issue)),
  );
  const withheld = exportApprovedRows([approveReviewRow(pending, {
    coordinatePublicationApproved: false,
    addressPublicationApproved: false,
  })]);
  assert.equal(withheld.rows[0].coordinatePublicationApproved, false);
  assert.equal(withheld.rows[0].addressPublicationApproved, false);
  assert.equal(withheld.report.exportedWithCoordinatePublicationApproved, 0);
  assert.equal(withheld.report.exportedWithAddressPublicationApproved, 0);
  const missingCoordinateDecision = approveReviewRow(pending);
  delete missingCoordinateDecision.coordinatePublicationApproved;
  assert.throws(
    () => exportApprovedRows([missingCoordinateDecision]),
    (error) => error.report.invalidApproved[0].issues.some((issue) => /explicitly true or false/.test(issue)),
  );
  const exported = exportApprovedRows([approveReviewRow(pending)]);
  assert.equal(exported.rows.length, 1);
  assert.equal(exported.rows[0].approvedExportVersion, 2);
  assert.equal(exported.rows[0].reviewIssues, undefined);
});

test("coordinate validation rejects zero sentinels and FIPS 51093 out-of-market points", () => {
  assert.match(coordinateIssues({ territoryFips: "51093", latitude: 0, longitude: 0 }).join(" "), /zero\/zero/);
  assert.match(
    coordinateIssues({ territoryFips: "51093", latitude: 38.9, longitude: -77.0 }).join(" "),
    /outside the configured validation envelope/,
  );
  assert.deepEqual(coordinateIssues({ territoryFips: "51093", latitude: 36.98, longitude: -76.63 }), []);
});

test("organization seed import accepts approved exports, is dry-run safe, and is idempotent", async (t) => {
  const rows = approvedRows(loadJsonLines(fixture));
  const { file } = writeJsonLines(t, rows);
  const db = fakeDb();
  const dry = await importRows(db, file, "orgs", false, "batch-1", true);
  assert.equal(dry.created, 2);
  assert.equal(db.documents.size, 0);

  const first = await importRows(db, file, "orgs", false, "batch-1", false);
  assert.equal(first.created, 2);
  assert.equal(db.documents.size, 4);
  assert.equal(db.documents.get("orgs/org_fixture_alpha").publicationApproved, true);

  const second = await importRows(db, file, "orgs", false, "batch-2", false);
  assert.equal(second.skipped, 2);
  assert.equal(second.updated, 0);
  assert.equal(db.documents.size, 4);
});

test("v2 organization package replay preserves child timestamps and is a formal no-op", async (t) => {
  const [row] = approvedRows([{
    id: "org_package_replay", name: "Package Replay LLC", normalizedName: "package replay",
    sources: ["test_source"], addressLine1: "1 Main Street", city: "Smithfield", state: "VA",
    postalCode: "23430", territoryFips: "51093", status: "active", publicationApproved: true,
  }]);
  assert.equal(row.approvedExportVersion, 2);
  assert.equal(row.establishments.length, 1);
  const { file } = writeJsonLines(t, [row], "package-replay.jsonl");
  const db = fakeDb();
  const first = await planCollectionImport(db, file, "orgs", false, "batch-package-1", reviewedAt);
  assert.ok(first.result.packageRecordsPlanned > 0);
  await commitPlans(db, first.plans, db.collection("organizationSeedImports").doc("batch-package-1"), { status: "applied" });

  const replay = await planCollectionImport(db, file, "orgs", false, "batch-package-2", reviewedAt + 1_000);
  assert.equal(replay.plans.length, 0);
  assert.equal(replay.result.skipped, 1);
  assert.equal(replay.result.packageRecordsPlanned, 0);
});

test("replay repairs a stale projection and only then reports a no-op", async (t) => {
  const rows = approvedRows([loadJsonLines(fixture)[0]]);
  const { file } = writeJsonLines(t, rows);
  const db = fakeDb();
  await importRows(db, file, "orgs", false, "batch-1", false);
  db.documents.delete("publicOrganizations/org_fixture_alpha");

  const repair = await planCollectionImport(db, file, "orgs", false, "batch-2", reviewedAt);
  assert.equal(repair.result.projectionRepaired, 1);
  assert.equal(repair.plans[0].writeMain, false);
  assert.ok(repair.plans[0].public);
  await importRows(db, file, "orgs", false, "batch-2", false);

  const replay = await planCollectionImport(db, file, "orgs", false, "batch-3", reviewedAt);
  assert.equal(replay.plans.length, 0);
  assert.equal(replay.result.skipped, 1);
});

test("strict planning aborts invalid and duplicate inputs before database reads or writes", async (t) => {
  const [approved] = approvedRows([loadJsonLines(fixture)[0]]);
  const duplicateFile = writeJsonLines(t, [approved, approved], "duplicate.jsonl").file;
  const invalidFile = writeJsonLines(t, [{ ...approved, reviewedBy: "" }], "invalid.jsonl").file;

  for (const file of [duplicateFile, invalidFile]) {
    const db = fakeDb();
    await assert.rejects(
      planCollectionImport(db, file, "orgs", false, "batch-strict", reviewedAt),
      (error) => error instanceof SeedLifecycleError && /validation failed/.test(error.message),
    );
    assert.deepEqual(db.stats, { reads: 0, writes: 0, batchCommits: 0 });
  }
});

test("claimed or owned organization state is preserved and blocks changed seed input", async (t) => {
  const [approved] = approvedRows([loadJsonLines(fixture)[0]]);
  const { file } = writeJsonLines(t, [approved]);
  const existing = {
    id: approved.id,
    ownerUid: "member-123",
    claimStatus: "claimed",
    sourceContentHash: "different-approved-source",
  };
  const db = fakeDb({ [`orgs/${approved.id}`]: existing });
  await assert.rejects(
    planCollectionImport(db, file, "orgs", false, "batch-claimed", reviewedAt),
    (error) => error instanceof SeedLifecycleError && /claimed or owned/.test(error.message),
  );
  assert.deepEqual(db.documents.get(`orgs/${approved.id}`), existing);
  assert.equal(db.stats.writes, 0);
});

test("unclaimed updates preserve independent verification state", async (t) => {
  const [approved] = approvedRows([loadJsonLines(fixture)[0]]);
  const { file } = writeJsonLines(t, [approved]);
  const existing = {
    id: approved.id,
    ownerUid: "",
    claimStatus: "unclaimed",
    verificationStatus: "verified",
    exchangeVerificationStatus: "verified",
    sourceContentHash: "older-approved-source",
    createdAt: 1,
    sourceRetrievedAt: 1,
  };
  const db = fakeDb({ [`orgs/${approved.id}`]: existing });
  const planned = await planCollectionImport(db, file, "orgs", false, "batch-update", reviewedAt);
  assert.equal(planned.plans.length, 1);
  assert.equal(planned.plans[0].after.verificationStatus, "verified");
  assert.equal(planned.plans[0].after.exchangeVerificationStatus, "verified");
  assert.equal(planned.plans[0].public.after.verificationStatus, "verified");
});

test("replay never repairs or overwrites a claimed organization's public projection", async (t) => {
  const [approved] = approvedRows([loadJsonLines(fixture)[0]]);
  const { file } = writeJsonLines(t, [approved]);
  const imported = fakeDb();
  await importRows(imported, file, "orgs", false, "batch-before-claim", false);
  const claimed = {
    ...imported.documents.get(`orgs/${approved.id}`),
    ownerUid: "member-123",
    claimStatus: "claimed",
  };
  const memberProjection = {
    ...imported.documents.get(`publicOrganizations/${approved.id}`),
    name: "Member Enriched Name",
    claimStatus: "claimed",
  };
  const db = fakeDb({
    [`orgs/${approved.id}`]: claimed,
    [`publicOrganizations/${approved.id}`]: memberProjection,
  });
  const replay = await planCollectionImport(db, file, "orgs", false, "batch-after-claim", reviewedAt);
  assert.equal(replay.plans.length, 0);
  assert.equal(replay.result.protectedUnchanged, 1);
  assert.deepEqual(db.documents.get(`publicOrganizations/${approved.id}`), memberProjection);
  assert.equal(db.stats.writes, 0);
});

test("restricted and home-based validation rejects private fields", () => {
  const restricted = {
    id: "target_1",
    name: "Acme",
    normalizedName: "acme",
    sources: ["targeting"],
    restrictedMatchOnly: true,
    privacySuppressed: true,
  };
  const [validRestricted] = approvedRows([restricted], { restricted: true });
  assert.deepEqual(validate(validRestricted, true), []);
  assert.match(validate(validRestricted, false).join(" "), /cannot enter the public organization import/);
  assert.throws(() => publicProjection(validRestricted), /never receive a public projection/);

  const [privateRestricted] = createReviewPacket([{ ...restricted, email: "person@example.test" }], { restricted: true }).rows;
  assert.match(validate(approveReviewRow({ ...privateRestricted, approvedExportVersion: 1 }), true).join(" "), /prohibited/);

  const home = {
    id: "home_1",
    name: "Home",
    normalizedName: "home",
    sources: ["test"],
    homeBased: true,
    privacySuppressed: true,
    addressLine1: "Private",
  };
  const [privateHome] = createReviewPacket([home]).rows;
  assert.match(validate(approveReviewRow({ ...privateHome, approvedExportVersion: 1 }), false).join(" "), /privacy-suppressed/);
});

test("public projection publishes only explicitly approved address and coordinate fields", () => {
  const base = {
    id: "public_1",
    name: "Public",
    normalizedName: "public",
    slug: "public-1",
    territoryFips: "51093",
    addressLine1: "100 Main Street",
    postalCode: "23430",
    latitude: 36.9,
    longitude: -76.7,
    coordinateConfidence: "authoritative",
    reviewStatus: "approved",
    approvedExportVersion: 1,
    projectionVersion: 1,
    publicationApproved: true,
    status: "active",
    updatedAt: 1,
    ownerUid: "private-owner",
    sourceIds: { duns: "private" },
    reviewedBy: "private-reviewer",
  };
  const withheld = publicProjection({
    ...base,
    addressPublicationApproved: false,
    coordinatePublicationApproved: false,
  });
  assert.equal(withheld.publicationApproved, true);
  assert.equal(withheld.addressLine1, undefined);
  assert.equal(withheld.latitude, undefined);

  const published = publicProjection({
    ...base,
    addressPublicationApproved: true,
    coordinatePublicationApproved: true,
  });
  assert.equal(published.addressLine1, "100 Main Street");
  assert.equal(published.addressPublicationApproved, true);
  assert.equal(published.postalCode, "23430");
  assert.equal(published.latitude, 36.9);
  assert.equal(published.coordinatePublicationApproved, true);
  assert.equal(published.coordinateConfidence, "authoritative");
  assert.equal(published.ownerUid, undefined);
  assert.equal(published.sourceIds, undefined);
  assert.equal(published.reviewedBy, undefined);
  assert.equal(published.projectionVersion, undefined);
  assert.equal(published.sources, undefined);
  assert.deepEqual(Object.keys(published).sort(), [
    "acceptsReferrals",
    "addressLine1",
    "addressPublicationApproved",
    "capabilityKeywords",
    "certifications",
    "city",
    "claimStatus",
    "coordinateConfidence",
    "coordinatePublicationApproved",
    "county",
    "description",
    "homeBased",
    "id",
    "industries",
    "issuerStatus",
    "latitude",
    "longitude",
    "naicsCodes",
    "name",
    "normalizedName",
    "organizationType",
    "postalCode",
    "privacySuppressed",
    "publicContactAvailable",
    "publicLocationCount",
    "publicationApproved",
    "resourceCategories",
    "resourceProviderStatus",
    "schemaVersion",
    "searchTokens",
    "slug",
    "state",
    "status",
    "territoryFips",
    "updatedAt",
    "verificationStatus",
    "website",
  ].sort());

  const suppressed = publicProjection({
    ...base,
    homeBased: true,
    privacySuppressed: true,
    addressPublicationApproved: true,
    coordinatePublicationApproved: true,
  });
  assert.equal(suppressed.addressLine1, undefined);
  assert.equal(suppressed.latitude, undefined);
});

test("restricted imports stay server-only and are explicitly non-public", async (t) => {
  const candidate = {
    id: "target_1",
    name: "Restricted Match",
    normalizedName: "restricted match",
    sources: ["targeting"],
    restrictedMatchOnly: true,
    privacySuppressed: true,
  };
  const rows = approvedRows([candidate], { restricted: true });
  const { file } = writeJsonLines(t, rows);
  const db = fakeDb();
  await importRows(db, file, "organizationSourceCandidates", true, "batch-target", false);
  assert.equal(db.documents.get("organizationSourceCandidates/target_1").publicationApproved, false);
  assert.equal([...db.documents.keys()].some((key) => key.startsWith("publicOrganizations/")), false);
});

test("project, sample, and evidence-rich expansion gates are exact", (t) => {
  assert.doesNotThrow(() => assertProjectSafety("demo-hi-coworking", {
    dryRun: false, apply: true, environment: "emulator",
  }));
  assert.doesNotThrow(() => assertProjectSafety("hi-coworking-plat", {
    dryRun: true, apply: false, environment: "development",
  }));
  assert.throws(
    () => assertProjectSafety("other-project", { dryRun: true, apply: false, environment: "development" }),
    /exact project hi-coworking-plat/,
  );
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
    () => assertProjectSafety("hi-coworking-prod", { dryRun: true, apply: false, environment: "production" }),
    /Production seed operations are not authorized/,
  );
  assert.equal(assertExpansionGate("hi-coworking-plat", {}), DEFAULT_SAMPLE_LIMIT);
  const expansionGate = {
    sampleGateVersion: 1,
    projectId: "hi-coworking-plat",
    environment: "development",
    sampleBatchId: "exchange-sample-1",
    sampleRecordCount: 100,
    acceptedBy: "exchange-acceptance:test",
    acceptedAt: reviewedAt,
    sampleAccepted: true,
    replayNoOp: true,
    rollbackRehearsalPassed: true,
    browserAccepted: true,
    markerBehaviorAccepted: true,
    publicProjectionAccepted: true,
    privacyAccepted: true,
    zeroUnauthorizedFields: true,
  };
  const gateFile = writeJsonLines(t, [expansionGate], "sample-gate.json").file;
  assert.equal(assertExpansionGate("hi-coworking-plat", {
    allowFullDevelopment: true,
    confirmFullDevelopment: "hi-coworking-plat",
    sampleGateManifest: gateFile,
  }), 10_000);
  const incompleteGateFile = writeJsonLines(t, [{ ...expansionGate, replayNoOp: false }], "bad-gate.json").file;
  assert.throws(() => assertExpansionGate("hi-coworking-plat", {
    allowFullDevelopment: true,
    confirmFullDevelopment: "hi-coworking-plat",
    sampleGateManifest: incompleteGateFile,
  }), /incomplete/);
  assert.throws(
    () => exportApprovedRows([], { limit: DEFAULT_SAMPLE_LIMIT + 1 }),
    /between 1 and 100/,
  );
  const expansionCandidates = Array.from({ length: DEFAULT_SAMPLE_LIMIT + 1 }, (_, index) => ({
    id: `org_expansion_${index}`,
    name: `Expansion ${index}`,
    normalizedName: `expansion ${index}`,
    sources: ["fixture"],
  }));
  const expansionReview = createReviewPacket(expansionCandidates).rows.map((row) => approveReviewRow(row));
  assert.equal(exportApprovedRows(expansionReview, {
    limit: DEFAULT_SAMPLE_LIMIT + 1,
    maximumLimit: 10_000,
  }).rows.length, DEFAULT_SAMPLE_LIMIT + 1);
});

test("sample writes are atomic with the import manifest", async () => {
  const db = fakeDb();
  const organizationRef = db.collection("orgs").doc("org_1");
  const publicRef = db.collection("publicOrganizations").doc("org_1");
  const plans = [{
    ref: organizationRef,
    after: { id: "org_1" },
    merge: true,
    writeMain: true,
    public: { ref: publicRef, after: { id: "org_1" }, merge: false, writeMain: true },
  }];
  const result = await commitPlans(
    db,
    plans,
    db.collection("organizationSeedImports").doc("batch-1"),
    { status: "applied" },
  );
  assert.deepEqual(result, { atomicSample: true, batches: 1 });
  assert.equal(db.stats.batchCommits, 1);
  assert.equal(db.documents.size, 3);
});

test("rollback artifacts are protected, rehearsable, environment-bound, and tamper guarded", async (t) => {
  const rows = approvedRows([loadJsonLines(fixture)[0]]);
  const { directory, file } = writeJsonLines(t, rows);
  const db = fakeDb();
  const organizationPlan = await planCollectionImport(db, file, "orgs", false, "batch-rollback", reviewedAt);
  const targetingPlan = { plans: [], sourceRows: [] };
  const manifest = createRollbackManifest({
    projectId: "hi-coworking-plat",
    environment: "development",
    batchId: "batch-rollback",
    organizationPlan,
    targetingPlan,
    now: reviewedAt,
  });
  assert.doesNotThrow(() => validateManifest(manifest, "hi-coworking-plat", "development"));
  assert.equal(rehearseRollback(manifest, 10).status, "passed");

  const rollbackFile = path.join(directory, "rollback.json");
  writeRollbackManifest(rollbackFile, manifest);
  assert.equal(fs.statSync(rollbackFile).mode & 0o777, 0o600);
  assert.throws(() => writeRollbackManifest(rollbackFile, manifest), /EEXIST/);
  assert.throws(
    () => validateManifest(manifest, "hi-coworking-plat", "emulator"),
    /validation failed/,
  );
  const tampered = {
    ...manifest,
    entries: [{ ...manifest.entries[0], collection: "users" }],
  };
  assert.throws(
    () => validateManifest(tampered, "hi-coworking-plat", "development"),
    /validation failed/,
  );
});

test("rollback refuses claimed or subsequently modified records", async (t) => {
  const rows = approvedRows([loadJsonLines(fixture)[0]]);
  const { file } = writeJsonLines(t, rows);
  const planDb = fakeDb();
  const organizationPlan = await planCollectionImport(planDb, file, "orgs", false, "batch-rollback", reviewedAt);
  const manifest = createRollbackManifest({
    projectId: "hi-coworking-plat",
    environment: "development",
    batchId: "batch-rollback",
    organizationPlan,
    targetingPlan: { plans: [], sourceRows: [] },
    now: reviewedAt,
  });
  const organizationEntry = manifest.entries.find((entry) => entry.collection === "orgs");
  const current = new Map([[
    `${organizationEntry.collection}/${organizationEntry.id}`,
    { ...organizationEntry.after, ownerUid: "member-123", claimStatus: "claimed" },
  ]]);
  const rollback = buildRollbackPlan({ ...manifest, entries: [organizationEntry] }, current);
  assert.equal(rollback.actions.length, 0);
  assert.match(rollback.blocked[0].reason, /claimed or assigned/);
});
