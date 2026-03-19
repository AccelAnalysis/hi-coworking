import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

type TerritoryStatus = "scheduled" | "released" | "paused" | "archived";
type TerritoryType = "county" | "city" | "custom_polygon";

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
  };

  if (!fips || !name || !state) {
    throw new HttpsError("invalid-argument", "fips, name, and state are required");
  }

  validateFips(fips);

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
    centroid: centroid && Number.isFinite(centroid.lat) && Number.isFinite(centroid.lng)
      ? { lat: centroid.lat, lng: centroid.lng }
      : undefined,
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
  };

  if (!fips) {
    throw new HttpsError("invalid-argument", "fips is required");
  }
  validateFips(fips);

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
    updates.releaseDate = admin.firestore.FieldValue.delete();
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
    updates.centroid = admin.firestore.FieldValue.delete();
  } else if (
    centroid &&
    Number.isFinite(centroid.lat) &&
    Number.isFinite(centroid.lng)
  ) {
    updates.centroid = { lat: centroid.lat, lng: centroid.lng };
  }

  if (statusHistoryEntry) {
    updates.statusHistory = admin.firestore.FieldValue.arrayUnion(statusHistoryEntry);
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
  const releasedSnap = await db
    .collection("territories")
    .where("status", "==", "released")
    .orderBy("name", "asc")
    .get();

  const scheduledSnap = await db
    .collection("territories")
    .where("status", "==", "scheduled")
    .orderBy("releaseDate", "asc")
    .get();

  return {
    released: releasedSnap.docs.map((d) => d.data()),
    scheduled: scheduledSnap.docs.map((d) => d.data()),
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
