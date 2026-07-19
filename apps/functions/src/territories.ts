import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { FieldValue, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";

type TerritoryStatus = "scheduled" | "released" | "paused" | "archived";
type BoundaryGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: unknown;
};

const MAX_BOUNDARY_POSITIONS = 25_000;
const MAX_BOUNDARY_JSON_LENGTH = 700_000;

function isValidCentroid(value: unknown): value is { lat: number; lng: number } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { lat?: unknown; lng?: unknown };
  return typeof candidate.lat === "number"
    && Number.isFinite(candidate.lat)
    && candidate.lat >= -90
    && candidate.lat <= 90
    && typeof candidate.lng === "number"
    && Number.isFinite(candidate.lng)
    && candidate.lng >= -180
    && candidate.lng <= 180;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is [number, number, ...number[]] {
  return Array.isArray(value)
    && value.length >= 2
    && value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
    && value[0] >= -180
    && value[0] <= 180
    && value[1] >= -90
    && value[1] <= 90;
}

function positionsEqual(left: readonly number[], right: readonly number[]): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

function isLinearRing(value: unknown): value is Array<[number, number, ...number[]]> {
  return Array.isArray(value)
    && value.length >= 4
    && value.every(isPosition)
    && positionsEqual(value[0], value[value.length - 1]);
}

function isPolygonCoordinates(value: unknown): value is Array<Array<[number, number, ...number[]]>> {
  return Array.isArray(value) && value.length > 0 && value.every(isLinearRing);
}

function isMultiPolygonCoordinates(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every(isPolygonCoordinates);
}

function countBoundaryPositions(value: unknown): number {
  if (isPosition(value)) return 1;
  if (!Array.isArray(value)) return 0;
  return value.reduce((total, item) => total + countBoundaryPositions(item), 0);
}

function parseBoundaryGeometry(value: unknown): BoundaryGeometry | null {
  if (!isRecord(value) || !("coordinates" in value)) return null;
  if (value.type === "Polygon" && isPolygonCoordinates(value.coordinates)) {
    return { type: "Polygon", coordinates: value.coordinates };
  }
  if (value.type === "MultiPolygon" && isMultiPolygonCoordinates(value.coordinates)) {
    return { type: "MultiPolygon", coordinates: value.coordinates };
  }
  return null;
}

function validateBoundaryGeometry(value: unknown): BoundaryGeometry {
  const geometry = parseBoundaryGeometry(value);
  if (!geometry) {
    throw new HttpsError(
      "invalid-argument",
      "boundaryGeoJSON must be a Polygon or MultiPolygon with finite, closed rings",
    );
  }
  if (
    countBoundaryPositions(geometry.coordinates) > MAX_BOUNDARY_POSITIONS
    || JSON.stringify(geometry).length > MAX_BOUNDARY_JSON_LENGTH
  ) {
    throw new HttpsError("invalid-argument", "boundaryGeoJSON is too large for a territory record");
  }
  return geometry;
}
type TerritoryType = "county" | "city" | "custom_polygon";

function isTerritoryStatus(value: unknown): value is TerritoryStatus {
  return typeof value === "string"
    && (["scheduled", "released", "paused", "archived"] as const).includes(value as TerritoryStatus);
}

function isTerritoryType(value: unknown): value is TerritoryType {
  return typeof value === "string"
    && (["county", "city", "custom_polygon"] as const).includes(value as TerritoryType);
}

type TerritoryStatusHistoryEntry = {
  status: TerritoryStatus;
  at: number;
  by: string;
  note?: string;
};

function getDb() {
  return admin.firestore();
}

function requireAdminRole(request: { auth?: { token?: Record<string, unknown> } | null }) {
  const role = request.auth?.token?.role as string | undefined;
  if (role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Only admin or master users can perform this action");
  }
}

function validateFips(fips: string) {
  if (!/^\d{5}$/.test(fips)) {
    throw new HttpsError("invalid-argument", "fips must be a 5-digit county code");
  }
}

export const territory_create = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }
  requireAdminRole(request);

  const {
    fips,
    name,
    state,
    status,
    releaseDate,
    notes,
    centroid,
    type,
    timezone,
    autoReleaseEnabled,
    autoPauseEnabled,
    regionTag,
    needsReview,
    fipsStateCode,
    boundaryGeoJSON,
  } = request.data as {
    fips?: string;
    name?: string;
    state?: string;
    status?: TerritoryStatus;
    releaseDate?: number;
    notes?: string;
    centroid?: { lat: number; lng: number };
    type?: TerritoryType;
    timezone?: string;
    autoReleaseEnabled?: boolean;
    autoPauseEnabled?: boolean;
    regionTag?: string;
    needsReview?: boolean;
    fipsStateCode?: string;
    boundaryGeoJSON?: unknown;
  };

  if (!fips || !name || !state) {
    throw new HttpsError("invalid-argument", "fips, name, and state are required");
  }

  validateFips(fips);
  if (centroid !== undefined && !isValidCentroid(centroid)) {
    throw new HttpsError("invalid-argument", "centroid must contain valid latitude and longitude");
  }
  if (status !== undefined && !isTerritoryStatus(status)) {
    throw new HttpsError("invalid-argument", "status is not a supported territory status");
  }
  if (type !== undefined && !isTerritoryType(type)) {
    throw new HttpsError("invalid-argument", "type is not a supported territory type");
  }

  const finalStatus: TerritoryStatus = status ?? "scheduled";
  const db = getDb();
  const ref = db.collection("territories").doc(fips);
  const existing = await ref.get();
  if (existing.exists) {
    throw new HttpsError("already-exists", `Territory ${fips} already exists`);
  }

  const now = Date.now();
  const createdBy = request.auth.uid;
  const historyEntry: TerritoryStatusHistoryEntry = {
    status: finalStatus,
    at: now,
    by: createdBy,
    note: "Territory created",
  };

  await ref.set({
    fips,
    name: name.trim(),
    state: state.trim(),
    type: type ?? "county",
    timezone: typeof timezone === "string" && timezone.trim() ? timezone.trim() : "America/New_York",
    autoReleaseEnabled: typeof autoReleaseEnabled === "boolean" ? autoReleaseEnabled : true,
    autoPauseEnabled: typeof autoPauseEnabled === "boolean" ? autoPauseEnabled : false,
    regionTag: typeof regionTag === "string" ? regionTag.trim() : "",
    needsReview: Boolean(needsReview),
    fipsStateCode: typeof fipsStateCode === "string" ? fipsStateCode.trim() : fips.slice(0, 2),
    status: finalStatus,
    releaseDate: typeof releaseDate === "number" ? releaseDate : undefined,
    pausedAt: finalStatus === "paused" ? now : undefined,
    notes: notes?.trim() || "",
    centroid: centroid && isValidCentroid(centroid)
      ? { lat: centroid.lat, lng: centroid.lng }
      : undefined,
    boundaryGeoJSON: boundaryGeoJSON === undefined
      ? undefined
      : validateBoundaryGeometry(boundaryGeoJSON),
    createdAt: now,
    updatedAt: now,
    updatedBy: createdBy,
    createdBy,
    statusHistory: [historyEntry],
  });

  logger.info("Territory created", { fips, status: finalStatus, by: request.auth.uid });
  return { success: true, fips };
});

export const territory_update = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }
  requireAdminRole(request);

  const {
    fips,
    status,
    releaseDate,
    notes,
    centroid,
    name,
    state,
    type,
    timezone,
    autoReleaseEnabled,
    autoPauseEnabled,
    regionTag,
    needsReview,
    fipsStateCode,
    boundaryGeoJSON,
  } = request.data as {
    fips?: string;
    status?: TerritoryStatus;
    releaseDate?: number | null;
    notes?: string;
    centroid?: { lat: number; lng: number } | null;
    name?: string;
    state?: string;
    type?: TerritoryType;
    timezone?: string;
    autoReleaseEnabled?: boolean;
    autoPauseEnabled?: boolean;
    regionTag?: string;
    needsReview?: boolean;
    fipsStateCode?: string;
    boundaryGeoJSON?: unknown | null;
  };

  if (!fips) {
    throw new HttpsError("invalid-argument", "fips is required");
  }
  validateFips(fips);
  if (status !== undefined && !isTerritoryStatus(status)) {
    throw new HttpsError("invalid-argument", "status is not a supported territory status");
  }
  if (type !== undefined && !isTerritoryType(type)) {
    throw new HttpsError("invalid-argument", "type is not a supported territory type");
  }

  const db = getDb();
  const ref = db.collection("territories").doc(fips);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Territory not found");
  }

  const now = Date.now();
  const updates: Record<string, unknown> = {
    updatedAt: now,
    updatedBy: request.auth.uid,
  };
  let statusHistoryEntry: TerritoryStatusHistoryEntry | null = null;

  if (status) {
    updates.status = status;
    if (status === "paused") {
      updates.pausedAt = now;
    }
    statusHistoryEntry = {
      status,
      at: now,
      by: request.auth.uid,
      note: "Status updated",
    };
  }
  if (typeof releaseDate === "number") {
    updates.releaseDate = releaseDate;
  }
  if (releaseDate === null) {
    updates.releaseDate = FieldValue.delete();
  }
  if (typeof notes === "string") {
    updates.notes = notes.trim();
  }
  if (typeof name === "string" && name.trim()) {
    updates.name = name.trim();
  }
  if (typeof state === "string" && state.trim()) {
    updates.state = state.trim();
  }
  if (type) {
    updates.type = type;
  }
  if (typeof timezone === "string" && timezone.trim()) {
    updates.timezone = timezone.trim();
  }
  if (typeof autoReleaseEnabled === "boolean") {
    updates.autoReleaseEnabled = autoReleaseEnabled;
  }
  if (typeof autoPauseEnabled === "boolean") {
    updates.autoPauseEnabled = autoPauseEnabled;
  }
  if (typeof regionTag === "string") {
    updates.regionTag = regionTag.trim();
  }
  if (typeof needsReview === "boolean") {
    updates.needsReview = needsReview;
  }
  if (typeof fipsStateCode === "string" && fipsStateCode.trim()) {
    updates.fipsStateCode = fipsStateCode.trim();
  }
  if (centroid === null) {
    updates.centroid = FieldValue.delete();
  } else if (centroid !== undefined && !isValidCentroid(centroid)) {
    throw new HttpsError("invalid-argument", "centroid must contain valid latitude and longitude");
  } else if (centroid && isValidCentroid(centroid)) {
    updates.centroid = { lat: centroid.lat, lng: centroid.lng };
  }
  if (boundaryGeoJSON === null) {
    updates.boundaryGeoJSON = FieldValue.delete();
  } else if (boundaryGeoJSON !== undefined) {
    updates.boundaryGeoJSON = validateBoundaryGeometry(boundaryGeoJSON);
  }

  if (statusHistoryEntry) {
    updates.statusHistory = FieldValue.arrayUnion(statusHistoryEntry);
  }

  await ref.update(updates);

  logger.info("Territory updated", { fips, updates: Object.keys(updates), by: request.auth.uid });
  return { success: true, fips };
});

export const territory_list_released = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in");
  }

  const db = getDb();
  const [releasedSnap, scheduledSnap, pausedSnap, archivedSnap] = await Promise.all(
    (["released", "scheduled", "paused", "archived"] as const).map((status) => db
      .collection("territories")
      .where("status", "==", status)
      .limit(250)
      .get()),
  );

  const projectForMap = (doc: QueryDocumentSnapshot) => {
    const source = doc.data();
    const centroid = isValidCentroid(source.centroid)
      ? { lat: source.centroid.lat, lng: source.centroid.lng }
      : undefined;
    const boundaryGeoJSON = parseBoundaryGeometry(source.boundaryGeoJSON) ?? undefined;
    return {
      fips: typeof source.fips === "string" ? source.fips : doc.id,
      name: typeof source.name === "string" ? source.name : "Territory",
      state: typeof source.state === "string" ? source.state : "",
      status: source.status as TerritoryStatus,
      type: isTerritoryType(source.type) ? source.type : "county",
      ...(typeof source.releaseDate === "number" ? { releaseDate: source.releaseDate } : {}),
      ...(centroid ? { centroid } : {}),
      ...(boundaryGeoJSON ? { boundaryGeoJSON } : {}),
      createdAt: typeof source.createdAt === "number" ? source.createdAt : 0,
      ...(typeof source.updatedAt === "number" ? { updatedAt: source.updatedAt } : {}),
    };
  };

  const byName = (left: ReturnType<typeof projectForMap>, right: ReturnType<typeof projectForMap>) =>
    left.name.localeCompare(right.name) || left.fips.localeCompare(right.fips);
  const byReleaseDate = (left: ReturnType<typeof projectForMap>, right: ReturnType<typeof projectForMap>) =>
    (left.releaseDate ?? Number.MAX_SAFE_INTEGER) - (right.releaseDate ?? Number.MAX_SAFE_INTEGER)
    || byName(left, right);

  return {
    released: releasedSnap.docs.map(projectForMap).sort(byName),
    scheduled: scheduledSnap.docs.map(projectForMap).sort(byReleaseDate),
    unreleased: [...pausedSnap.docs, ...archivedSnap.docs].map(projectForMap).sort(byName),
  };
});

export const territory_release_scheduled = onSchedule(
  {
    schedule: "*/5 * * * *",
    timeZone: "America/New_York",
    memory: "256MiB",
  },
  async () => {
    const db = getDb();
    const now = Date.now();

    const dueSnap = await db
      .collection("territories")
      .where("status", "==", "scheduled")
      .where("releaseDate", "<=", now)
      .get();

    if (dueSnap.empty) {
      logger.info("No scheduled territories due for release");
      return;
    }

    const batch = db.batch();
    dueSnap.docs.forEach((docSnap) => {
      batch.update(docSnap.ref, {
        status: "released",
        updatedAt: now,
      });
    });
    await batch.commit();

    logger.info("Released scheduled territories", {
      count: dueSnap.size,
      territoryFips: dueSnap.docs.map((d) => d.id),
    });
  }
);
