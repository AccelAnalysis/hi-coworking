import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  createTimeBoundCode,
  deleteCode,
  remoteUnlock,
  getDeviceStatus,
  getCodePin,
  hashPin,
} from "./providers/seamProvider";
import { accessReadyMail, accessReadyNotification, ownerMaySeeCode, retryDecision, type RetryDecision } from "./accessCodes/policy";
import { checkInFromDoorUnlock } from "./frontDeskKiosk/functions";
import { handleSeamWebhookRequest } from "./accessCodes/seamWebhook";
import { runIdempotentWebhook } from "./payments/idempotency";
import {
  internalEventTypeFor,
  isCodeUnlock,
  sanitizeSeamEvent,
  seamCodeStatusFor,
  staffAlertKindForSeamEvent,
  unlockTime,
} from "./accessCodes/noShow";
import { DOOR_ACCESS_SETTINGS_ID, codeWindow, parseDoorAccessSettings, pickDoor } from "./accessCodes/doorSettings";
import {
  buildStaffAlertEvent,
  buildStaffAlertMail,
  isLowBattery,
  STAFF_ALERT_EVENT_TYPE,
  type StaffAlertInput,
} from "./accessCodes/staffAlerts";

const db = admin.firestore();

export const seamApiKey = defineSecret("SEAM_API_KEY");
export const seamWebhookSecret = defineSecret("SEAM_WEBHOOK_SECRET");

const NO_SHOW_GRACE_MINUTES = 30;

export type AccessRevokeReason = "cancellation" | "no_show" | "admin" | "expired" | "refund";
const REVOKE_REASONS: readonly AccessRevokeReason[] = ["cancellation", "no_show", "admin", "expired", "refund"];

/** siteSettings/doorAccess, with the 15-minute default when unset. */
async function loadDoorAccessSettings() {
  try {
    const snap = await db.collection("siteSettings").doc(DOOR_ACCESS_SETTINGS_ID).get();
    return parseDoorAccessSettings(snap.exists ? snap.data() : undefined);
  } catch (err: unknown) {
    logger.warn("Door access settings unavailable; using the default buffer", { error: err instanceof Error ? err.message : String(err) });
    return parseDoorAccessSettings(undefined);
  }
}

function requireAdmin(auth: { uid: string; token: Record<string, unknown> } | undefined): string {
  if (!auth) throw new HttpsError("unauthenticated", "Must be logged in");
  const role = auth.token.role as string | undefined;
  if (role !== "admin" && role !== "master") throw new HttpsError("permission-denied", "Admin or master required");
  return auth.uid;
}

// --- Internal: Create Access Grant ---

/**
 * Called immediately after a booking is confirmed.
 * Finds the door for the resource, creates an AccessGrant, programs a time-bound PIN via Seam,
 * writes an AccessCode doc (hash only), and tells the member their code is
 * ready on SayHi. The code itself is never put in an email or notification.
 */
export async function createAccessGrant(
  bookingId: string,
  resourceId: string,
  userId: string,
  start: number,
  end: number
): Promise<void> {
  // 1. Find the door that gates this resource (single-field query; no composite index needed)
  const doorsSnap = await db
    .collection("doors")
    .where("resourceIds", "array-contains", resourceId)
    .get();
  const picked = pickDoor(doorsSnap.docs.map((d) => ({ id: d.id, data: d.data() })));

  if (!picked) {
    logger.warn("No door configured for resource — skipping access grant", { resourceId, bookingId });
    return;
  }

  const door = picked.data;
  const doorId = picked.id;

  // 2. Code window: the booking plus the staff-set buffer on each side (default 15 min)
  const { bufferMinutes } = await loadDoorAccessSettings();
  const { startsAt: gracedStart, endsAt: gracedEnd } = codeWindow(start, end, bufferMinutes);

  // 3. Create AccessGrant doc
  const grantRef = db.collection("accessGrants").doc();
  const now = Date.now();
  const grant = {
    id: grantRef.id,
    bookingId,
    doorId,
    userId,
    startsAt: gracedStart,
    endsAt: gracedEnd,
    gracePeriodMinutes: bufferMinutes,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  await grantRef.set(grant);

  // 4. Log grant_created event
  await logAccessEvent({
    bookingId,
    grantId: grantRef.id,
    doorId,
    userId,
    eventType: "grant_created",
    notes: `Grant created for booking ${bookingId}`,
  });

  // 5. Program a new 6-digit code for this booking
  await programCodeForGrant({ grantRef, grant, doorId, door, notify: true });
}

/**
 * Asks Seam for a new time-bound 6-digit code for one grant, writes the
 * accessCodes doc (hash only), and either tells the member it is ready on
 * SayHi or raises a staff alert. Used for new bookings and the staff Retry.
 */
async function programCodeForGrant(input: {
  grantRef: FirebaseFirestore.DocumentReference;
  grant: { bookingId: string; userId: string; startsAt: number; endsAt: number };
  doorId: string;
  door: FirebaseFirestore.DocumentData;
  notify: boolean;
  performedBy?: string;
}): Promise<{ status: "programming" | "failed"; codeId: string }> {
  const { grantRef, grant, doorId, door } = input;
  const { bookingId, userId, startsAt, endsAt } = grant;
  const apiKey = seamApiKey.value();
  const now = Date.now();

  let seamCodeId: string | undefined;
  let codeHash: string | null = null;
  let codeLast2: string | null = null;
  let codeStatus: "programming" | "failed" = "programming";
  let failureReason: string | undefined;

  const codeRef = db.collection("accessCodes").doc();

  try {
    const result = await createTimeBoundCode(
      apiKey,
      door.seamDeviceId,
      new Date(Math.max(startsAt, now)),
      new Date(endsAt),
      `HiCo-${bookingId.slice(-6)}` // booking reference only; no member name sent to Seam
    );
    seamCodeId = result.seamCodeId;
    codeHash = result.codeHash;
    codeLast2 = result.codeLast2;
    codeStatus = "programming"; // Will move to "active" via Seam webhook

    logger.info("Seam code created", { seamCodeId, bookingId, grantId: grantRef.id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Seam code creation failed", { bookingId, grantId: grantRef.id, error: msg });
    codeStatus = "failed";
    failureReason = msg;
  }

  // Write AccessCode doc (hash only — no plain PIN stored)
  const codeDoc = {
    id: codeRef.id,
    grantId: grantRef.id,
    doorId,
    provider: "seam",
    ...(seamCodeId && { seamCodeId }),
    ...(codeHash && { codeHash }),
    ...(codeLast2 && { codeLast2 }),
    status: codeStatus,
    ...(failureReason && { failureReason }),
    createdAt: now,
    updatedAt: now,
  };
  await codeRef.set(codeDoc);

  if (codeStatus !== "failed") {
    await grantRef.update({ status: "active", updatedAt: Date.now() });
  }

  await logAccessEvent({
    bookingId,
    grantId: grantRef.id,
    doorId,
    userId,
    eventType: codeStatus === "failed" ? "code_failed" : input.performedBy ? "code_retry" : "code_issued",
    ...(input.performedBy ? { performedBy: input.performedBy } : {}),
    notes: codeStatus === "failed" ? failureReason : input.performedBy ? "Staff retried the code" : "Code requested",
  });

  if (codeStatus === "failed") {
    await raiseStaffAlert({
      kind: "code_failed",
      doorId,
      doorName: door.name,
      bookingId,
      grantId: grantRef.id,
      reason: failureReason,
      startsAt,
      endsAt,
      now: Date.now(),
    }, { reopen: Boolean(input.performedBy) });
  } else if (input.notify) {
    // Tell the member the code is ready on SayHi (no code in the notice).
    await sendAccessReadyNotice(userId, {
      bookingId,
      doorName: door.name,
      startsAt,
      endsAt,
    });
    await codeRef.update({ deliveredAt: Date.now(), updatedAt: Date.now() });
  }
  return { status: codeStatus, codeId: codeRef.id };
}

// --- Internal: Revoke Access Grant ---

export async function revokeAccessGrant(
  grantId: string,
  reason: AccessRevokeReason,
  revokedBy: string = "system"
): Promise<void> {
  const apiKey = seamApiKey.value();

  const grantSnap = await db.collection("accessGrants").doc(grantId).get();
  if (!grantSnap.exists) {
    logger.warn("revokeAccessGrant: grant not found", { grantId });
    return;
  }
  const grant = grantSnap.data()!;

  if (grant.status === "revoked" || grant.status === "expired") {
    logger.info("revokeAccessGrant: already revoked/expired", { grantId, status: grant.status });
    return;
  }

  // Only codes this system made for this grant (never the lock's own codes)
  const codesSnap = await db
    .collection("accessCodes")
    .where("grantId", "==", grantId)
    .get();
  const liveCodes = codesSnap.docs.filter((d) => ["programming", "active"].includes(String(d.data().status)));

  const doorSnap = await db.collection("doors").doc(grant.doorId).get();
  const door = doorSnap.data();

  const now = Date.now();

  // Revoke each active code via Seam
  for (const codeDoc of liveCodes) {
    const code = codeDoc.data();
    if (code.seamCodeId && door?.seamDeviceId) {
      try {
        await deleteCode(apiKey, door.seamDeviceId, code.seamCodeId);
        logger.info("Seam code deleted on revoke", { seamCodeId: code.seamCodeId, grantId, reason });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("Failed to delete Seam code on revoke", { seamCodeId: code.seamCodeId, grantId, error: message });
        // An ended booking's time-bound code expires on its own; anything else may still open the door.
        if (reason !== "expired") {
          await raiseStaffAlert({
            kind: "code_remove_failed",
            doorId: grant.doorId,
            doorName: door?.name,
            bookingId: grant.bookingId,
            grantId,
            reason: message,
            startsAt: grant.startsAt,
            endsAt: grant.endsAt,
            now: Date.now(),
          });
        }
      }
    }
    await codeDoc.ref.update({ status: "revoked", updatedAt: now });
  }

  // Update grant status
  await grantSnap.ref.update({
    status: "revoked",
    revokedAt: now,
    revokedBy,
    revokeReason: reason,
    revokeRequestedAt: null,
    updatedAt: now,
  });

  // Log event
  await logAccessEvent({
    bookingId: grant.bookingId,
    grantId,
    doorId: grant.doorId,
    userId: grant.userId,
    eventType: reason === "no_show" ? "no_show_revoke" : "grant_revoked",
    performedBy: revokedBy,
    notes: `Grant revoked: ${reason}`,
  });

  logger.info("Access grant revoked", { grantId, reason, revokedBy });
}

// --- Callable: Get My Access Grants ---

export const access_getMyGrants = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }
    const uid = request.auth.uid;
    const now = Date.now();

    // Return active + upcoming grants (endsAt > now - 1hr). Single-field
    // query, filtered and sorted here, so no composite index is needed.
    const grantsSnap = await db
      .collection("accessGrants")
      .where("userId", "==", uid)
      .get();
    const recent = grantsSnap.docs
      .filter((d) => Number(d.data().endsAt) > now - 60 * 60 * 1000)
      .sort((a, b) => Number(a.data().endsAt) - Number(b.data().endsAt))
      .slice(0, 20);

    const grants = await Promise.all(
      recent.map(async (gDoc) => {
        const grant = gDoc.data();
        const latest = await latestCodeForGrant(gDoc.id);
        const code = latest ? latest.data : null;
        const doorSnap = await db.collection("doors").doc(grant.doorId).get();
        const door = doorSnap.data();
        const fullCode = await ownerCode({ uid, grant, code, codeRef: latest?.ref, now });

        return {
          grantId: gDoc.id,
          bookingId: grant.bookingId,
          doorName: door?.name ?? "Door",
          startsAt: grant.startsAt,
          endsAt: grant.endsAt,
          grantStatus: grant.status,
          codeStatus: code?.status ?? null,
          codeId: latest ? latest.id : null,
          // Full code for the owner's live booking only (SayHi and booking page).
          code: fullCode,
        };
      })
    );

    return { grants };
  }
);

/**
 * The full code for the signed-in owner's live booking, read from Seam and
 * checked against the stored hash. Never cached, stored or logged.
 */
async function ownerCode(input: {
  uid: string;
  grant: FirebaseFirestore.DocumentData;
  code: FirebaseFirestore.DocumentData | null;
  codeRef?: FirebaseFirestore.DocumentReference;
  now: number;
}): Promise<string | null> {
  if (!ownerMaySeeCode({ requesterUid: input.uid, grant: input.grant, code: input.code, now: input.now })) return null;
  const seamCodeId = input.code?.seamCodeId;
  if (typeof seamCodeId !== "string" || !seamCodeId) return null;
  try {
    const pin = await getCodePin(seamApiKey.value(), seamCodeId);
    if (!pin || (input.code?.codeHash && hashPin(pin) !== input.code.codeHash)) return null;
    // Seam can assign the digits after create; keep the hash (front-desk
    // check-in looks codes up by hash) without ever storing the code.
    if (!input.code?.codeHash && input.codeRef) {
      await input.codeRef.update({ codeHash: hashPin(pin), codeLast2: pin.slice(-2), updatedAt: Date.now() }).catch(() => undefined);
    }
    return pin;
  } catch {
    logger.warn("Access code lookup failed", { grantBooking: input.grant.bookingId });
    return null;
  }
}

// --- Callable: Admin Revoke Grant ---

export const access_adminRevoke = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }
    const role = request.auth.token.role as string | undefined;
    if (role !== "admin" && role !== "master") {
      throw new HttpsError("permission-denied", "Admin or master required");
    }

    const { grantId, reason = "admin" } = request.data as {
      grantId: string;
      reason?: AccessRevokeReason;
    };
    if (!grantId) throw new HttpsError("invalid-argument", "grantId required");
    if (!REVOKE_REASONS.includes(reason)) throw new HttpsError("invalid-argument", "Unknown reason");

    await revokeAccessGrant(grantId, reason, request.auth.uid);
    return { success: true, grantId };
  }
);

// --- Callable: Admin Remote Unlock ---

export const access_adminUnlock = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }
    const role = request.auth.token.role as string | undefined;
    if (role !== "admin" && role !== "master") {
      throw new HttpsError("permission-denied", "Admin or master required");
    }

    const { doorId } = request.data as { doorId: string };
    if (!doorId) throw new HttpsError("invalid-argument", "doorId required");

    const doorSnap = await db.collection("doors").doc(doorId).get();
    if (!doorSnap.exists) throw new HttpsError("not-found", "Door not found");
    const door = doorSnap.data()!;

    await remoteUnlock(seamApiKey.value(), door.seamDeviceId);

    await logAccessEvent({
      doorId,
      userId: request.auth.uid,
      eventType: "door_unlock_requested",
      performedBy: request.auth.uid,
      notes: "Admin remote unlock",
    });

    return { success: true, doorId };
  }
);

// --- Callable: Admin Resend PIN ---

export const access_adminResendPin = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }
    const role = request.auth.token.role as string | undefined;
    if (role !== "admin" && role !== "master") {
      throw new HttpsError("permission-denied", "Admin or master required");
    }

    const { grantId } = request.data as { grantId: string };
    if (!grantId) throw new HttpsError("invalid-argument", "grantId required");

    const grantSnap = await db.collection("accessGrants").doc(grantId).get();
    if (!grantSnap.exists) throw new HttpsError("not-found", "Grant not found");
    const grant = grantSnap.data()!;

    if (grant.status !== "pending" && grant.status !== "active") {
      throw new HttpsError("failed-precondition", "This booking's access has ended.");
    }
    const latest = await latestCodeForGrant(grantId);
    if (!latest) throw new HttpsError("not-found", "No code found for grant");
    if (latest.data.status !== "programming" && latest.data.status !== "active") {
      throw new HttpsError("failed-precondition", "This code isn't working. Use Retry to make a new one.");
    }

    // A reminder only: it points the member to SayHi and carries no code
    // and no digits of it (the full code is never stored).
    await sendResendNotification(grant.userId, {
      bookingId: grant.bookingId,
      startsAt: grant.startsAt,
    });

    await logAccessEvent({
      bookingId: grant.bookingId,
      grantId,
      doorId: grant.doorId,
      userId: grant.userId,
      eventType: "code_reminder",
      performedBy: request.auth.uid,
      notes: "Admin sent a SayHi code reminder",
    });

    return { success: true, grantId };
  }
);

// --- Callable: Admin Get Door Status ---

export const access_adminGetDoorStatus = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }
    const role = request.auth.token.role as string | undefined;
    if (role !== "admin" && role !== "master") {
      throw new HttpsError("permission-denied", "Admin or master required");
    }

    const { doorId } = request.data as { doorId: string };
    if (!doorId) throw new HttpsError("invalid-argument", "doorId required");

    const doorSnap = await db.collection("doors").doc(doorId).get();
    if (!doorSnap.exists) throw new HttpsError("not-found", "Door not found");
    const door = doorSnap.data()!;

    const status = await getDeviceStatus(seamApiKey.value(), door.seamDeviceId);

    // Update cached status in Firestore
    await doorSnap.ref.update({
      status: status.online ? "online" : "offline",
      ...(status.batteryLevel !== undefined && { batteryLevel: status.batteryLevel }),
      lastSeenAt: Date.now(),
      updatedAt: Date.now(),
    });
    if (!status.online) {
      await raiseStaffAlert({ kind: "lock_offline", doorId, doorName: door.name, now: Date.now() });
    }
    if (isLowBattery(status.batteryLevel)) {
      await raiseStaffAlert({ kind: "low_battery", doorId, doorName: door.name, batteryLevel: status.batteryLevel, now: Date.now() });
    }

    return { doorId, ...status };
  }
);

// --- HTTP: Seam Webhook Handler ---

/**
 * Seam webhooks (delivered by Svix). Fails closed: only requests with a valid
 * Svix signature over the raw body are processed, each svix-id at most once
 * (see accessCodes/seamWebhook.ts). Logs only the event type and outcome.
 */
export const access_seamWebhook = onRequest(
  { secrets: [seamApiKey, seamWebhookSecret] },
  async (req, res) => {
    let secret: string | undefined;
    try {
      secret = seamWebhookSecret.value() || undefined;
    } catch {
      secret = undefined;
    }
    const result = await handleSeamWebhookRequest(
      { method: req.method, headers: req.headers, rawBody: req.rawBody },
      {
        secret,
        nowSeconds: Math.floor(Date.now() / 1000),
        runOnce: async (svixId, process) => {
          const run = await runIdempotentWebhook(`seam_${svixId}`, "seam", process);
          return run.outcome;
        },
        handle: (event) => handleSeamEvent(event, true),
      },
    );
    const log = { eventType: result.eventType ?? null, outcome: result.outcome, reason: result.reason ?? null, status: result.status };
    if (result.outcome === "failed") logger.error("Seam webhook", log);
    else if (result.outcome === "rejected" || result.outcome === "bad_payload") logger.warn("Seam webhook", log);
    else logger.info("Seam webhook", log);
    res.status(result.status).json(result.body);
  }
);

async function handleSeamEvent(event: {
  event_type: string;
  event_id?: string;
  device_id?: string;
  access_code_id?: string;
  occurred_at?: string;
  properties?: Record<string, unknown>;
}, verified = false): Promise<void> {
  let grantUserId: string | undefined;
  const now = Date.now();
  const { event_type, device_id, access_code_id } = event;

  // Find door by seamDeviceId
  let doorId: string | undefined;
  let grantId: string | undefined;
  let bookingId: string | undefined;
  let codeRef: FirebaseFirestore.DocumentReference | undefined;
  let codeData: FirebaseFirestore.DocumentData | undefined;
  let grantRef: FirebaseFirestore.DocumentReference | undefined;
  let grantData: FirebaseFirestore.DocumentData | undefined;

  if (device_id) {
    const doorSnap = await db
      .collection("doors")
      .where("seamDeviceId", "==", device_id)
      .limit(1)
      .get();
    if (!doorSnap.empty) doorId = doorSnap.docs[0].id;
  }

  if (access_code_id) {
    const codeSnap = await db
      .collection("accessCodes")
      .where("seamCodeId", "==", access_code_id)
      .limit(1)
      .get();
    if (!codeSnap.empty) {
      codeRef = codeSnap.docs[0].ref;
      codeData = codeSnap.docs[0].data();
      grantId = codeData.grantId;
      doorId = doorId ?? codeData.doorId;

      // Map Seam event types (real and older names) to our code statuses
      const newStatus = seamCodeStatusFor(event_type);
      if (newStatus) {
        await codeRef.update({ status: newStatus, updatedAt: now });
      }

      // Get bookingId from grant
      if (grantId) {
        const grantSnap = await db.collection("accessGrants").doc(grantId).get();
        if (grantSnap.exists) {
          grantRef = grantSnap.ref;
          grantData = grantSnap.data()!;
          bookingId = grantData.bookingId;
          grantUserId = grantData.userId;
          // Update grant status to active when code goes active
          if (newStatus === "active" && grantData.status === "pending") {
            await grantSnap.ref.update({ status: "active", updatedAt: now });
          }
        }
      }
    }
  }

  // Lock events: online/offline and battery
  const isDeviceEvent = event_type === "device.connected" || event_type === "device.disconnected"
    || event_type === "device.low_battery" || event_type === "device.battery_status_changed";
  let doorData: FirebaseFirestore.DocumentData | undefined;
  let batteryLevel: number | undefined;
  if (device_id && isDeviceEvent) {
    const doorSnap = await db
      .collection("doors")
      .where("seamDeviceId", "==", device_id)
      .limit(1)
      .get();
    if (!doorSnap.empty) {
      doorId = doorSnap.docs[0].id;
      doorData = doorSnap.docs[0].data();
      const rawLevel = (event as Record<string, unknown>).battery_level;
      batteryLevel = typeof rawLevel === "number" && Number.isFinite(rawLevel) && rawLevel >= 0 && rawLevel <= 1 ? rawLevel : undefined;
      await doorSnap.docs[0].ref.update({
        ...(event_type === "device.connected" ? { status: "online" } : {}),
        ...(event_type === "device.disconnected" ? { status: "offline" } : {}),
        ...(batteryLevel !== undefined ? { batteryLevel } : {}),
        lastSeenAt: now,
        updatedAt: now,
      });
    }
  }

  // Staff alerts (verified events only). Code alerts fire only for codes
  // this system made (codeRef found above); the lock's own codes are ignored.
  if (verified && doorId) {
    let kind = staffAlertKindForSeamEvent(event_type);
    if (event_type === "device.battery_status_changed"
      && isLowBattery(batteryLevel, (event as Record<string, unknown>).battery_status)) {
      kind = "low_battery";
    }
    const isCodeAlert = kind === "code_failed" || kind === "code_delayed" || kind === "code_remove_failed" || kind === "code_changed_outside";
    // A failed removal after the booking ended needs no action: the code's window is over.
    const endedRemoval = kind === "code_remove_failed" && grantData && Number(grantData.endsAt) <= now;
    if (kind && (!isCodeAlert || codeRef) && !endedRemoval) {
      if (!doorData) {
        const doorDoc = await db.collection("doors").doc(doorId).get();
        doorData = doorDoc.data();
      }
      await raiseStaffAlert({
        kind,
        doorId,
        doorName: doorData?.name,
        ...(isCodeAlert ? { bookingId, grantId, startsAt: grantData?.startsAt, endsAt: grantData?.endsAt } : {}),
        ...(kind === "low_battery" && batteryLevel !== undefined ? { batteryLevel } : {}),
        reason: event_type,
        now,
      });
    }
    if (kind === "code_failed" && codeRef) {
      await codeRef.update({ failureReason: "The lock did not accept the code", updatedAt: now });
    }
  }

  // Seam events can carry the PIN (`code`) and device details, so only an
  // allow-listed set of IDs, the type, method and time is stored.
  const payload = sanitizeSeamEvent(event as Record<string, unknown>);
  const internalEventType = internalEventTypeFor(event_type);
  if (internalEventType && doorId) {
    await logAccessEvent({
      bookingId,
      grantId,
      doorId,
      ...(grantUserId && { userId: grantUserId }),
      eventType: internalEventType as never,
      providerPayload: payload,
      notes: `Seam webhook: ${event_type}`,
    });
  }

  // A verified unlock with one of our codes is the member using it. Recorded
  // on the code, the grant and as a code_used event, so the no-show sweep
  // never revokes a member who got in.
  if (verified && isCodeUnlock(event) && codeRef && codeData && grantId && doorId) {
    const usedAt = unlockTime(event.occurred_at, now);
    const usage = (data: FirebaseFirestore.DocumentData | undefined) => ({
      ...(data?.firstUsedAt ? {} : { firstUsedAt: usedAt }),
      lastUsedAt: Math.max(usedAt, Number(data?.lastUsedAt) || 0),
      updatedAt: now,
    });
    await codeRef.update(usage(codeData));
    if (grantRef) await grantRef.update(usage(grantData));
    await logAccessEvent({
      bookingId,
      grantId,
      doorId,
      ...(grantUserId && { userId: grantUserId }),
      eventType: "code_used",
      providerPayload: payload,
      notes: "Member opened the door with their code",
    });
  }

  // Door unlock with a member's own booking code checks them in (Jonathan,
  // Oct 30, 2026). The iPad is then for check-out, extra time, and anyone
  // who didn't use their code.
  if (event_type === "lock.unlocked" && verified && grantUserId && doorId) {
    try {
      await checkInFromDoorUnlock({
        uid: grantUserId,
        doorId,
        eventKey: event.event_id || `${grantId}_${now}`,
        now,
      });
    } catch (err: unknown) {
      logger.error("Door check-in failed", { grantId, bookingId, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

// --- Callable: Admin Retry Code ---

/**
 * Staff "Retry code": makes a new 6-digit code for a live booking whose code
 * failed, was removed outside Hi Coworking, or was never made. A working
 * code is never replaced. The member is told it's ready on SayHi; the code
 * itself is never sent.
 */
export const access_adminRetryCode = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    const uid = requireAdmin(request.auth as never);
    const { grantId } = (request.data || {}) as { grantId?: string };
    if (!grantId || typeof grantId !== "string") throw new HttpsError("invalid-argument", "grantId required");

    const grantRef = db.collection("accessGrants").doc(grantId);
    const grantSnap = await grantRef.get();
    if (!grantSnap.exists) throw new HttpsError("not-found", "Grant not found");
    const grant = grantSnap.data()!;
    const decision = retryDecision({ grant, latestCodeStatus: (await latestCodeForGrant(grantId))?.data.status, now: Date.now() });
    if (decision !== "retry") throw new HttpsError("failed-precondition", RETRY_REFUSALS[decision]);

    const doorSnap = await db.collection("doors").doc(String(grant.doorId)).get();
    const door = doorSnap.data();
    if (!door?.seamDeviceId) throw new HttpsError("failed-precondition", "This booking's door isn't set up.");

    const result = await programCodeForGrant({
      grantRef,
      grant: { bookingId: grant.bookingId, userId: grant.userId, startsAt: grant.startsAt, endsAt: grant.endsAt },
      doorId: doorSnap.id,
      door,
      notify: true,
      performedBy: uid,
    });
    if (result.status === "programming") {
      await resolveStaffAlertsForGrant(grantId, uid);
    }
    return { success: result.status !== "failed", grantId, codeStatus: result.status };
  }
);

const RETRY_REFUSALS: Record<Exclude<RetryDecision, "retry">, string> = {
  ended: "This booking's access has ended.",
  working: "This booking already has a working code.",
};

// --- Callable: Admin Resolve Staff Alert ---

export const access_adminResolveAlert = onCall(
  async (request) => {
    const uid = requireAdmin(request.auth as never);
    const { alertId } = (request.data || {}) as { alertId?: string };
    if (!alertId || typeof alertId !== "string" || !/^alert_[A-Za-z0-9_-]{1,200}$/.test(alertId)) {
      throw new HttpsError("invalid-argument", "alertId required");
    }
    const ref = db.collection("accessEvents").doc(alertId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.eventType !== STAFF_ALERT_EVENT_TYPE) throw new HttpsError("not-found", "Alert not found");
    await ref.update({ alertStatus: "resolved", resolvedAt: Date.now(), resolvedBy: uid });
    return { success: true, alertId };
  }
);

// --- Trigger: revoke requested by another flow (e.g. a booking refund) ---

/**
 * Flows that don't hold the Seam key (the Stripe refund webhook) set
 * accessGrants/{id}.revokeRequestedAt and revokeRequestReason. This removes
 * the code from the lock straight away. access_expireGrants also picks up
 * any request this missed.
 */
export const access_onRevokeRequested = onDocumentWritten(
  { document: "accessGrants/{grantId}", secrets: [seamApiKey], retry: false },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after || !after.revokeRequestedAt) return;
    if (after.status !== "pending" && after.status !== "active") return;
    const before = event.data?.before?.data();
    if (before?.revokeRequestedAt === after.revokeRequestedAt) return;
    const reason = REVOKE_REASONS.includes(after.revokeRequestReason) ? after.revokeRequestReason as AccessRevokeReason : "cancellation";
    await revokeAccessGrant(event.params.grantId, reason, String(after.revokeRequestedBy || "system"));
  }
);

// --- Helpers ---

/** Newest code doc for a grant (single-field query; sorted here). */
async function latestCodeForGrant(grantId: string): Promise<{ id: string; ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData } | null> {
  const snap = await db.collection("accessCodes").where("grantId", "==", grantId).get();
  if (snap.empty) return null;
  const docs = [...snap.docs].sort((a, b) => Number(b.data().createdAt || 0) - Number(a.data().createdAt || 0));
  return { id: docs[0].id, ref: docs[0].ref, data: docs[0].data() };
}

/**
 * Raises one staff alert: an open item on Admin > Access and one email to
 * the staff alert list through the mail queue. Deterministic id, so the same
 * alert is never raised twice (staff Retry may reopen a resolved code alert).
 * Never throws: an alert must not break a booking or a webhook.
 */
async function raiseStaffAlert(input: StaffAlertInput, options: { reopen?: boolean } = {}): Promise<void> {
  try {
    const alert = buildStaffAlertEvent(input);
    const ref = db.collection("accessEvents").doc(alert.id);
    const created = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        if (options.reopen && snap.data()?.alertStatus === "resolved") {
          tx.update(ref, { alertStatus: "open", notes: alert.notes, reopenedAt: input.now });
          return true;
        }
        return false;
      }
      tx.create(ref, alert);
      return true;
    });
    if (!created) return;
    const mailRef = db.collection("mail").doc(`${alert.id}_${input.now}`);
    await mailRef.set({
      id: mailRef.id,
      ...buildStaffAlertMail(input),
      status: "pending",
      attempts: 0,
      createdAt: Date.now(),
    });
    logger.warn("Door staff alert raised", { kind: input.kind, alertId: alert.id });
  } catch (err: unknown) {
    logger.error("Door staff alert failed", { kind: input.kind, error: err instanceof Error ? err.message : String(err) });
  }
}

async function resolveStaffAlertsForGrant(grantId: string, uid: string): Promise<void> {
  for (const kind of ["code_failed", "code_changed_outside", "code_delayed"]) {
    const ref = db.collection("accessEvents").doc(`alert_${kind}_${grantId}`);
    await ref.update({ alertStatus: "resolved", resolvedAt: Date.now(), resolvedBy: uid }).catch(() => undefined);
  }
}

async function logAccessEvent(params: {
  bookingId?: string;
  grantId?: string;
  doorId: string;
  userId?: string;
  eventType: string;
  providerPayload?: Record<string, unknown>;
  performedBy?: string;
  notes?: string;
}): Promise<void> {
  const ref = db.collection("accessEvents").doc();
  await ref.set({
    id: ref.id,
    provider: "seam",
    ...params,
    createdAt: Date.now(),
  });
}

/**
 * Tells the member their code is ready: an in-app notice and a mail-queue
 * entry (sent by mail_sendQueued), both linking to SayHi. Neither contains the code or any digits of
 * it; the code shows only on the signed-in SayHi and booking pages.
 */
async function sendAccessReadyNotice(
  userId: string,
  params: { bookingId: string; doorName: string; startsAt: number; endsAt: number }
): Promise<void> {
  const notice = accessReadyNotification(params);
  const notifRef = db.collection("notifications").doc();
  await notifRef.set({
    id: notifRef.id,
    uid: userId,
    ...notice,
    read: false,
    createdAt: Date.now(),
  });

  const origin = (process.env.PUBLIC_SITE_URL || "https://hi-coworking.com").replace(/\/+$/, "");
  const mail = accessReadyMail({ ...params, origin });
  const mailRef = db.collection("mail").doc();
  await mailRef.set({
    id: mailRef.id,
    to: userId,
    resolveEmail: true,
    ...mail,
    // Sent by mail_sendQueued (accessCodes/mailQueue.ts); never after endsAt.
    endsAt: params.endsAt,
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });

  logger.info("Access code ready notice queued", { userId, bookingId: params.bookingId });
}

async function sendResendNotification(
  userId: string,
  params: { bookingId: string; startsAt: number }
): Promise<void> {
  const { startsAt } = params;
  const startStr = new Date(startsAt).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const notifRef = db.collection("notifications").doc();
  await notifRef.set({
    id: notifRef.id,
    uid: userId,
    type: "access_code_ready",
    title: "Your access code is on SayHi",
    body: `Your access code for ${startStr} is on your SayHi page.`,
    linkTo: "/my-hi",
    read: false,
    createdAt: Date.now(),
  });

  logger.info("Access code reminder sent", { userId, bookingId: params.bookingId });
}

export { NO_SHOW_GRACE_MINUTES };
