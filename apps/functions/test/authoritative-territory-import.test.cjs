const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CENSUS_LAYER_VINTAGE,
  CONFIGURED_DEVELOPMENT_PROJECT,
  assertProjectSafety,
  buildTerritoryDocument,
  createRollbackManifest,
  planTerritoryImport,
  rollbackTerritory,
  snapshotHash,
  validateFeatureCollection,
  validateLayerMetadata,
  validateRollbackManifest,
} = require("../scripts/import-authoritative-territory.cjs");

function metadata(overrides = {}) {
  return {
    id: 7,
    name: "Counties",
    type: "Feature Layer",
    description: `Counties (or statistically equivalent entities); ${CENSUS_LAYER_VINTAGE} vintage`,
    copyrightText: "Source: U.S. Census Bureau",
    fields: ["GEOID", "STATE", "COUNTY", "NAME", "CENTLAT", "CENTLON", "INTPTLAT", "INTPTLON"]
      .map((name) => ({ name })),
    ...overrides,
  };
}

function featureCollection(overrides = {}) {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {
        GEOID: "51093",
        STATE: "51",
        COUNTY: "093",
        NAME: "Isle of Wight County",
        CENTLAT: "+36.9000000",
        CENTLON: "-076.7000000",
        INTPTLAT: "+36.9100000",
        INTPTLON: "-076.6900000",
      },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-76.9, 36.7],
          [-76.4, 36.7],
          [-76.4, 37.2],
          [-76.9, 37.2],
          [-76.9, 36.7],
        ]],
      },
      ...overrides,
    }],
  };
}

function source() {
  const territory = validateFeatureCollection(featureCollection());
  return {
    ...territory,
    authoritativeSourceHash: "a".repeat(64),
    source: {
      publisher: "U.S. Census Bureau",
      dataset: "TIGERweb State_County Counties",
      layerId: 7,
      vintage: CENSUS_LAYER_VINTAGE,
      spatialReference: "EPSG:4326",
      metadataUrl: "https://tigerweb.geo.census.gov/metadata",
      queryUrl: "https://tigerweb.geo.census.gov/query",
    },
  };
}

function fakeDb(initial) {
  let value = initial;
  let exists = initial !== undefined;
  const stats = { reads: 0, writes: 0, deletes: 0 };
  const ref = {
    async get() {
      stats.reads += 1;
      return { exists, data: () => value };
    },
    async set(next) {
      stats.writes += 1;
      value = next;
      exists = true;
    },
    async delete() {
      stats.deletes += 1;
      value = undefined;
      exists = false;
    },
  };
  return {
    stats,
    current: () => value,
    collection(name) {
      assert.equal(name, "territories");
      return {
        doc(id) {
          assert.equal(id, "51093");
          return ref;
        },
      };
    },
  };
}

test("Census layer identity, publisher, vintage, and required fields are pinned", () => {
  assert.doesNotThrow(() => validateLayerMetadata(metadata()));
  assert.throws(() => validateLayerMetadata(metadata({ id: 8 })), /identity changed/);
  assert.throws(
    () => validateLayerMetadata(metadata({ description: "Counties; January 1, 2024 vintage" })),
    /vintage/,
  );
  assert.throws(() => validateLayerMetadata(metadata({ copyrightText: "Unknown" })), /publisher/);
});

test("only the exact authoritative county polygon and official centroid are accepted", () => {
  const territory = validateFeatureCollection(featureCollection());
  assert.equal(territory.fips, "51093");
  assert.equal(territory.geometry.type, "Polygon");
  assert.equal(territory.positions, 5);
  assert.deepEqual(territory.centroid, { lat: 36.9, lng: -76.7 });
  assert.match(territory.geometrySha256, /^[a-f0-9]{64}$/);

  const wrongCounty = featureCollection();
  wrongCounty.features[0].properties.GEOID = "51095";
  assert.throws(() => validateFeatureCollection(wrongCounty), /identifiers/);

  const openRing = featureCollection();
  openRing.features[0].geometry.coordinates[0].pop();
  assert.throws(() => validateFeatureCollection(openRing), /valid Polygon/);

  const outsideCentroid = featureCollection();
  outsideCentroid.features[0].properties.CENTLAT = "+38.0000000";
  assert.throws(() => validateFeatureCollection(outsideCentroid), /outside/);
});

test("development writes are exact-project and explicit-confirmation guarded", () => {
  assert.doesNotThrow(() => assertProjectSafety({
    projectId: CONFIGURED_DEVELOPMENT_PROJECT,
    environment: "development",
    apply: false,
  }));
  assert.throws(() => assertProjectSafety({
    projectId: "production-project",
    environment: "development",
    apply: false,
  }), /Only configured development/);
  assert.throws(() => assertProjectSafety({
    projectId: CONFIGURED_DEVELOPMENT_PROJECT,
    environment: "development",
    apply: true,
  }), /confirm-development/);
  assert.doesNotThrow(() => assertProjectSafety({
    projectId: CONFIGURED_DEVELOPMENT_PROJECT,
    environment: "development",
    apply: true,
    confirmation: CONFIGURED_DEVELOPMENT_PROJECT,
  }));
});

test("territory planning creates an authoritative record and replay is a no-op", async () => {
  const db = fakeDb();
  const prepared = source();
  const first = await planTerritoryImport(db, prepared, { now: 1_721_668_800_000 });
  assert.equal(first.noOp, false);
  assert.equal(first.after.fips, "51093");
  assert.equal(first.after.status, "released");
  assert.equal(first.after.boundarySha256, prepared.geometrySha256);
  assert.equal(first.after.authoritativeSource.publisher, "U.S. Census Bureau");
  assert.equal(first.after.notes.includes("no organization coordinates are inferred"), true);
  await first.ref.set(first.after, { merge: false });

  const replay = await planTerritoryImport(db, prepared, { now: 1_721_668_801_000 });
  assert.equal(replay.noOp, true);
});

test("an existing territory without reviewed Census provenance is protected", async () => {
  const db = fakeDb({ fips: "51093", status: "released", name: "Manual polygon" });
  await assert.rejects(() => planTerritoryImport(db, source()), /refusing overwrite/);
  assert.equal(db.stats.writes, 0);
});

test("rollback is hash-protected, rehearsable, and restores the prior snapshot", async () => {
  const prepared = source();
  const before = {
    fips: "51093",
    status: "scheduled",
    authoritativeSource: { publisher: "U.S. Census Bureau" },
  };
  const after = buildTerritoryDocument(prepared, before, 1_721_668_800_000, "released");
  const plan = { existing: before, after, now: 1_721_668_800_000 };
  const manifest = createRollbackManifest(CONFIGURED_DEVELOPMENT_PROJECT, plan);
  validateRollbackManifest(manifest, CONFIGURED_DEVELOPMENT_PROJECT);
  const db = fakeDb(after);

  const rehearsal = await rollbackTerritory(db, manifest);
  assert.deepEqual(rehearsal, { ready: true, applied: false, action: "restore" });
  assert.equal(db.stats.writes, 0);

  const applied = await rollbackTerritory(db, manifest, { apply: true });
  assert.deepEqual(applied, { ready: true, applied: true, action: "restored" });
  assert.deepEqual(db.current(), before);

  const changed = { ...after, notes: "changed after import" };
  const changedDb = fakeDb(changed);
  assert.notEqual(snapshotHash(changed), manifest.afterHash);
  await assert.rejects(() => rollbackTerritory(changedDb, manifest), /no longer matches/);
});
