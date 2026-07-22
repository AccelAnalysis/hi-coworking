#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");

const CONFIGURED_DEVELOPMENT_PROJECT = "hi-coworking-plat";
const ISLE_OF_WIGHT_FIPS = "51093";
const CENSUS_LAYER_URL = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/7";
const CENSUS_LAYER_VINTAGE = "January 1, 2025";
const MAX_BOUNDARY_POSITIONS = 25_000;
const MAX_BOUNDARY_JSON_LENGTH = 700_000;

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value) {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function toSerializable(value) {
  if (value === undefined) return { __territoryType: "undefined" };
  if (value === null || typeof value !== "object") return value;
  if (typeof value.toMillis === "function") {
    return { __territoryType: "timestamp", millis: value.toMillis() };
  }
  if (value.constructor?.name === "GeoPoint"
      && typeof value.latitude === "number" && typeof value.longitude === "number") {
    return { __territoryType: "geoPoint", latitude: value.latitude, longitude: value.longitude };
  }
  if (Array.isArray(value)) return value.map(toSerializable);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toSerializable(item)]));
}

function fromSerializable(value) {
  if (value === null || typeof value !== "object") return value;
  if (value.__territoryType === "timestamp") {
    return admin.firestore.Timestamp.fromMillis(value.millis);
  }
  if (value.__territoryType === "geoPoint") {
    return new admin.firestore.GeoPoint(value.latitude, value.longitude);
  }
  if (value.__territoryType === "undefined") return undefined;
  if (Array.isArray(value)) return value.map(fromSerializable);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fromSerializable(item)]));
}

function snapshotHash(value) {
  return contentHash(toSerializable(value));
}

function isPosition(value) {
  return Array.isArray(value)
    && value.length >= 2
    && value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
    && value[0] >= -180 && value[0] <= 180
    && value[1] >= -90 && value[1] <= 90;
}

function positionsEqual(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

function isLinearRing(value) {
  return Array.isArray(value)
    && value.length >= 4
    && value.every(isPosition)
    && positionsEqual(value[0], value[value.length - 1]);
}

function isPolygonCoordinates(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isLinearRing);
}

function isMultiPolygonCoordinates(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isPolygonCoordinates);
}

function countPositions(value) {
  if (isPosition(value)) return 1;
  if (!Array.isArray(value)) return 0;
  return value.reduce((total, item) => total + countPositions(item), 0);
}

function coordinateBounds(value, bounds = {
  minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity,
}) {
  if (isPosition(value)) {
    bounds.minLng = Math.min(bounds.minLng, value[0]);
    bounds.minLat = Math.min(bounds.minLat, value[1]);
    bounds.maxLng = Math.max(bounds.maxLng, value[0]);
    bounds.maxLat = Math.max(bounds.maxLat, value[1]);
    return bounds;
  }
  if (Array.isArray(value)) value.forEach((item) => coordinateBounds(item, bounds));
  return bounds;
}

function validateLayerMetadata(metadata) {
  if (!metadata || metadata.id !== 7 || metadata.name !== "Counties" || metadata.type !== "Feature Layer") {
    throw new Error("Census layer identity changed; refusing authoritative territory preparation");
  }
  if (!String(metadata.description || "").includes(CENSUS_LAYER_VINTAGE)) {
    throw new Error(`Census layer vintage is not ${CENSUS_LAYER_VINTAGE}`);
  }
  if (!/U\.S\. Census Bureau/i.test(String(metadata.copyrightText || ""))) {
    throw new Error("Census layer publisher could not be verified");
  }
  const fields = new Set((metadata.fields || []).map((field) => field.name));
  for (const required of ["GEOID", "STATE", "COUNTY", "NAME", "CENTLAT", "CENTLON", "INTPTLAT", "INTPTLON"]) {
    if (!fields.has(required)) throw new Error(`Census layer is missing required field ${required}`);
  }
}

function validateFeatureCollection(collection, fips = ISLE_OF_WIGHT_FIPS) {
  if (!collection || collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("Census query did not return a GeoJSON FeatureCollection");
  }
  if (collection.features.length !== 1) {
    throw new Error(`Expected exactly one Census county for FIPS ${fips}; received ${collection.features.length}`);
  }
  const feature = collection.features[0];
  const properties = feature?.properties || {};
  if (properties.GEOID !== fips || properties.STATE !== "51" || properties.COUNTY !== "093") {
    throw new Error("Census feature identifiers do not match Isle of Wight County FIPS 51093");
  }
  if (properties.NAME !== "Isle of Wight County") {
    throw new Error("Census feature name does not match Isle of Wight County");
  }
  const geometry = feature?.geometry;
  const validGeometry = geometry?.type === "Polygon"
    ? isPolygonCoordinates(geometry.coordinates)
    : geometry?.type === "MultiPolygon" && isMultiPolygonCoordinates(geometry.coordinates);
  if (!validGeometry) {
    throw new Error("Census boundary must be a valid Polygon or MultiPolygon with finite, closed rings");
  }
  const positions = countPositions(geometry.coordinates);
  const geometryJson = JSON.stringify(geometry);
  if (positions > MAX_BOUNDARY_POSITIONS || geometryJson.length > MAX_BOUNDARY_JSON_LENGTH) {
    throw new Error("Census boundary exceeds the reviewed Firestore territory geometry limits");
  }
  const centroid = {
    lat: Number(properties.CENTLAT),
    lng: Number(properties.CENTLON),
  };
  const internalPoint = {
    lat: Number(properties.INTPTLAT),
    lng: Number(properties.INTPTLON),
  };
  for (const [label, point] of Object.entries({ centroid, internalPoint })) {
    if (!Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90
        || !Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180) {
      throw new Error(`Census ${label} is invalid`);
    }
  }
  const bounds = coordinateBounds(geometry.coordinates);
  for (const [label, point] of Object.entries({ centroid, internalPoint })) {
    if (point.lng < bounds.minLng || point.lng > bounds.maxLng
        || point.lat < bounds.minLat || point.lat > bounds.maxLat) {
      throw new Error(`Census ${label} falls outside the returned county boundary bounds`);
    }
  }
  return {
    fips,
    name: properties.NAME,
    state: "VA",
    stateCode: properties.STATE,
    countyCode: properties.COUNTY,
    geometry,
    centroid,
    internalPoint,
    bounds,
    positions,
    geometryBytes: geometryJson.length,
    geometrySha256: contentHash(geometry),
  };
}

function censusQueryUrl(fips = ISLE_OF_WIGHT_FIPS) {
  const parameters = new URLSearchParams({
    where: `GEOID='${fips}'`,
    outFields: "GEOID,NAME,BASENAME,STATE,COUNTY,CENTLAT,CENTLON,INTPTLAT,INTPTLON",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  });
  return `${CENSUS_LAYER_URL}/query?${parameters.toString()}`;
}

async function fetchJson(url, fetchImplementation = globalThis.fetch) {
  if (typeof fetchImplementation !== "function") throw new Error("Node 20 fetch is required");
  const response = await fetchImplementation(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Authoritative source returned HTTP ${response.status}`);
  return response.json();
}

async function fetchAuthoritativeTerritory(fetchImplementation = globalThis.fetch) {
  const metadataUrl = `${CENSUS_LAYER_URL}?f=json`;
  const queryUrl = censusQueryUrl();
  const [metadata, collection] = await Promise.all([
    fetchJson(metadataUrl, fetchImplementation),
    fetchJson(queryUrl, fetchImplementation),
  ]);
  validateLayerMetadata(metadata);
  const territory = validateFeatureCollection(collection);
  const authoritativeSourceHash = contentHash({
    fips: territory.fips,
    vintage: CENSUS_LAYER_VINTAGE,
    geometry: territory.geometry,
    centroid: territory.centroid,
    internalPoint: territory.internalPoint,
  });
  return {
    ...territory,
    authoritativeSourceHash,
    source: {
      publisher: "U.S. Census Bureau",
      dataset: "TIGERweb State_County Counties",
      layerId: 7,
      vintage: CENSUS_LAYER_VINTAGE,
      spatialReference: "EPSG:4326",
      metadataUrl,
      queryUrl,
    },
  };
}

function assertProjectSafety({ projectId, environment, apply, confirmation }) {
  if (environment === "emulator") {
    if (!projectId?.startsWith("demo-")) {
      throw new Error("Emulator territory operations require an explicit demo-* project");
    }
    return;
  }
  if (environment !== "development" || projectId !== CONFIGURED_DEVELOPMENT_PROJECT) {
    throw new Error(`Only configured development project ${CONFIGURED_DEVELOPMENT_PROJECT} is allowed`);
  }
  if (apply && confirmation !== CONFIGURED_DEVELOPMENT_PROJECT) {
    throw new Error(`Development writes require --confirm-development ${CONFIGURED_DEVELOPMENT_PROJECT}`);
  }
}

function equivalentAuthoritativeDocument(existing, source, status) {
  return existing?.authoritativeSourceHash === source.authoritativeSourceHash
    && existing?.boundarySha256 === source.geometrySha256
    && existing?.status === status
    && existing?.fips === source.fips
    && existing?.name === source.name
    && existing?.state === source.state
    && existing?.type === "county"
    && existing?.centroid?.lat === source.centroid.lat
    && existing?.centroid?.lng === source.centroid.lng;
}

function buildTerritoryDocument(source, existing, now, status = "released") {
  if (!["scheduled", "released", "paused"].includes(status)) {
    throw new Error("--status must be scheduled, released, or paused");
  }
  const actor = "system:census-territory-import";
  const priorHistory = Array.isArray(existing?.statusHistory) ? existing.statusHistory.slice(-49) : [];
  const statusChanged = existing?.status !== status;
  return {
    fips: source.fips,
    name: source.name,
    state: source.state,
    type: "county",
    timezone: "America/New_York",
    fipsStateCode: source.stateCode,
    countyCode: source.countyCode,
    status,
    autoReleaseEnabled: false,
    autoPauseEnabled: false,
    regionTag: "isle-of-wight-launch-market",
    needsReview: false,
    notes: "Authoritative county boundary imported from the U.S. Census Bureau; no organization coordinates are inferred from this geometry.",
    centroid: source.centroid,
    internalPoint: source.internalPoint,
    boundaryBounds: source.bounds,
    boundaryGeoJSON: JSON.stringify(source.geometry),
    boundaryPositions: source.positions,
    boundaryBytes: source.geometryBytes,
    boundarySha256: source.geometrySha256,
    sourceVersion: source.source.vintage,
    authoritativeSource: { ...source.source, retrievedAt: now },
    authoritativeSourceHash: source.authoritativeSourceHash,
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || actor,
    updatedAt: now,
    updatedBy: actor,
    statusHistory: statusChanged || priorHistory.length === 0
      ? [...priorHistory, {
        status,
        at: now,
        by: actor,
        note: "Authoritative Census territory import",
      }]
      : priorHistory,
  };
}

async function planTerritoryImport(db, source, options = {}) {
  const now = options.now || Date.now();
  const status = options.status || "released";
  const ref = db.collection("territories").doc(source.fips);
  const snapshot = await ref.get();
  const existing = snapshot.exists ? snapshot.data() : null;
  if (existing && !equivalentAuthoritativeDocument(existing, source, status)) {
    const publisher = existing.authoritativeSource?.publisher;
    if (publisher !== "U.S. Census Bureau") {
      throw new Error(`Territory ${source.fips} already exists without the reviewed Census provenance; refusing overwrite`);
    }
  }
  if (equivalentAuthoritativeDocument(existing, source, status)) {
    return { ref, existing, after: existing, noOp: true, now, status };
  }
  return {
    ref,
    existing,
    after: buildTerritoryDocument(source, existing, now, status),
    noOp: false,
    now,
    status,
  };
}

function createRollbackManifest(projectId, plan) {
  return {
    manifestVersion: 1,
    projectId,
    environment: "development",
    fips: plan.after.fips,
    createdAt: plan.now,
    protectedArtifact: true,
    beforeExists: Boolean(plan.existing),
    before: toSerializable(plan.existing),
    afterHash: snapshotHash(plan.after),
    authoritativeSourceHash: plan.after.authoritativeSourceHash,
    instructions: "Use this script with --rollback, then rehearse before an explicitly confirmed development apply.",
  };
}

function writeProtectedJson(file, value) {
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return resolved;
}

async function applyTerritoryPlan(plan) {
  if (plan.noOp) return { writes: 0, noOp: true };
  await plan.ref.set(plan.after, { merge: false });
  return { writes: 1, noOp: false };
}

function validateRollbackManifest(manifest, projectId) {
  if (manifest?.manifestVersion !== 1 || manifest.projectId !== projectId
      || manifest.environment !== "development" || manifest.fips !== ISLE_OF_WIGHT_FIPS
      || typeof manifest.afterHash !== "string" || manifest.afterHash.length !== 64) {
    throw new Error("Territory rollback manifest is invalid or belongs to another environment");
  }
}

async function rollbackTerritory(db, manifest, { apply = false } = {}) {
  const ref = db.collection("territories").doc(manifest.fips);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshotHash(snapshot.data()) !== manifest.afterHash) {
    throw new Error("Live territory no longer matches the protected post-import hash; refusing rollback");
  }
  if (!apply) {
    return { ready: true, applied: false, action: manifest.beforeExists ? "restore" : "delete" };
  }
  if (manifest.beforeExists) await ref.set(fromSerializable(manifest.before), { merge: false });
  else await ref.delete();
  return { ready: true, applied: true, action: manifest.beforeExists ? "restored" : "deleted" };
}

async function main() {
  const projectId = argument("--project");
  const environment = argument("--environment") || "development";
  const apply = hasFlag("--apply");
  assertProjectSafety({
    projectId,
    environment,
    apply,
    confirmation: argument("--confirm-development"),
  });
  if (!admin.apps.length) admin.initializeApp({ projectId });
  const db = admin.firestore();
  const rollbackFile = argument("--rollback");
  if (rollbackFile) {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(rollbackFile), "utf8"));
    validateRollbackManifest(manifest, projectId);
    const result = await rollbackTerritory(db, manifest, { apply });
    console.log(JSON.stringify({ projectId, environment, mode: "rollback", ...result }, null, 2));
    return;
  }

  const source = await fetchAuthoritativeTerritory();
  const plan = await planTerritoryImport(db, source, {
    status: argument("--status") || "released",
  });
  if (hasFlag("--expect-no-op") && !plan.noOp) {
    throw new Error("Authoritative territory replay is not a no-op");
  }
  let rollbackArtifact = null;
  let commit = { writes: 0, noOp: plan.noOp };
  if (apply && !plan.noOp) {
    const output = argument("--rollback-output");
    if (!output) throw new Error("--rollback-output is required before a territory write");
    rollbackArtifact = writeProtectedJson(output, createRollbackManifest(projectId, plan));
    commit = await applyTerritoryPlan(plan);
  }
  console.log(JSON.stringify({
    projectId,
    environment,
    apply,
    dryRun: !apply,
    fips: source.fips,
    name: source.name,
    status: plan.status,
    source: source.source,
    authoritativeSourceHash: source.authoritativeSourceHash,
    geometrySha256: source.geometrySha256,
    geometryType: source.geometry.type,
    geometryPositions: source.positions,
    geometryBytes: source.geometryBytes,
    centroid: source.centroid,
    internalPoint: source.internalPoint,
    noFabricatedBoundary: true,
    organizationCoordinatesInferred: 0,
    noOp: plan.noOp,
    rollbackArtifactCreatedBeforeWrite: Boolean(rollbackArtifact),
    rollbackArtifact: rollbackArtifact ? path.relative(process.cwd(), rollbackArtifact) : null,
    commit,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  CENSUS_LAYER_URL,
  CENSUS_LAYER_VINTAGE,
  CONFIGURED_DEVELOPMENT_PROJECT,
  ISLE_OF_WIGHT_FIPS,
  applyTerritoryPlan,
  assertProjectSafety,
  buildTerritoryDocument,
  censusQueryUrl,
  contentHash,
  createRollbackManifest,
  equivalentAuthoritativeDocument,
  fetchAuthoritativeTerritory,
  fromSerializable,
  planTerritoryImport,
  rollbackTerritory,
  snapshotHash,
  toSerializable,
  validateFeatureCollection,
  validateLayerMetadata,
  validateRollbackManifest,
  writeProtectedJson,
};
