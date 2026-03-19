import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  createTimeBoundCode,
  deleteCode,
  remoteUnlock,
  getDeviceStatus,
  validateSeamSignature,
} from "./providers/seamProvider";

const db = admin.firestore();

export const seamApiKey = defineSecret("SEAM_API_KEY");
export const seamWebhookSecret = defineSecret("SEAM_WEBHOOK_SECRET");

const GRACE_PERIOD_MINUTES = 5;
const NO_SHOW_GRACE_MINUTES = 30;

// --- Internal: Create Access Grant ---

/**
 * Called immediately after a booking is confirmed.
 * Finds the door for the resource, creates an AccessGrant, programs a time-bound PIN via Seam,
 * writes an AccessCode doc (hash only), and sends notifications.
 */
export async function createAccessGrant(
  bookingId: string,
  resourceId: string,
  userId: string,
  start: number,
  end: number
): Promise<void> {
  const apiKey = seamApiKey.value();

  // 1. Find the door that gates this resource
  const doorsSnap = await db
    .collection("doors")
    .where("resourceIds", "array-contains", resourceId)
    .where("status", "!=", "archived")
    .limit(1)
    .get();

  if (doorsSnap.empty) {
    logger.warn("No door configured for resource — skipping access grant", { resourceId, bookingId });
    return;
  }

  const doorDoc = doorsSnap.docs[0];
  const door = doorDoc.data();
  const doorId = doorDoc.id;

  // 2. Check for overlapping active grants on the same door to prevent duplicate code programming
  const gracedStart = start - GRACE_PERIOD_MINUTES * 60 * 1000;
  const gracedEnd = end + GRACE_PERIOD_MINUTES * 60 * 1000;

  const overlappingGrants = await db
    .collection("accessGrants")
    .where("doorId", "==", doorId)
    .where("endsAt", ">", gracedStart)
    .where("status", "in", ["pending", "active"])
    .get();

  // Log overlap info for debugging — multiple grants per door are allowed (different users)
  logger.info("Existing grants on door", { doorId, count: overlappingGrants.size, bookingId });

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
    gracePeriodMinutes: GRACE_PERIOD_MINUTES,
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

  // 5. Get user email for code naming
  const userSnap = await db.collection("users").doc(userId).get();
  const userData = userSnap.data();
  const userName = userData?.displayName || userData?.email || userId;

  // 6. Program PIN via Seam
  let plainPin: string | null = null;
  let seamCodeId: string | undefined;
  let codeHash: string | undefined;
  let codeLast2: string | undefined;
  let codeStatus: string = "programming";
  let failureReason: string | undefined;

  const codeRef = db.collection("accessCodes").doc();

  try {
    const result = await createTimeBoundCode(
      apiKey,
      door.seamDeviceId,
      new Date(gracedStart),
      new Date(gracedEnd),
      `HiCo-${bookingId.slice(-6)}-${userName.split(" ")[0]}`
    );
    plainPin = result.plainPin;
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

  // 7. Write AccessCode doc (hash only — no plain PIN stored)
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

  // 8. Update grant status to active (or failed)
  await grantRef.update({
    status: codeStatus === "failed" ? "pending" : "active",
    updatedAt: Date.now(),
  });

  // 9. Log code_issued event
  await logAccessEvent({
    bookingId,
    grantId: grantRef.id,
    doorId,
    userId,
    eventType: codeStatus === "failed" ? "code_failed" : "code_issued",
    notes: codeStatus === "failed" ? failureReason : `Code programmed, last2: ${codeLast2}`,
  });

  // 10. Send PIN notification (only if code was created successfully)
  if (plainPin && codeStatus !== "failed") {
    await sendPinNotification(userId, {
      bookingId,
      grantId: grantRef.id,
      codeId: codeRef.id,
      doorName: door.name,
      pin: plainPin,
      codeLast2: codeLast2!,
      startsAt: gracedStart,
      endsAt: gracedEnd,
      userName,
    });
    await codeRef.update({ deliveredAt: Date.now(), updatedAt: Date.now() });
  }

  // 11. plain PIN is now out of scope — GC will clean it up
}

// --- Internal: Revoke Access Grant ---

export async function revokeAccessGrant(
  grantId: string,
  reason: "cancellation" | "no_show" | "admin" | "expired",
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

  // Find associated access code
  const codesSnap = await db
    .collection("accessCodes")
    .where("grantId", "==", grantId)
    .where("status", "in", ["programming", "active"])
    .get();

  const doorSnap = await db.collection("doors").doc(grant.doorId).get();
  const door = doorSnap.data();

  const now = Date.now();

  // Revoke each active code via Seam
  for (const codeDoc of codesSnap.docs) {
    const code = codeDoc.data();
    if (code.seamCodeId && door?.seamDeviceId) {
      try {
        await deleteCode(apiKey, door.seamDeviceId, code.seamCodeId);
        logger.info("Seam code deleted on revoke", { seamCodeId: code.seamCodeId, grantId, reason });
      } catch (err: unknown) {
        logger.error("Failed to delete Seam code on revoke", {
          seamCodeId: code.seamCodeId,
          grantId,
          error: err instanceof Error ? err.message : String(err),
        });
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

    // Return active + upcoming grants (endsAt > now - 1hr)
    const grantsSnap = await db
      .collection("accessGrants")
      .where("userId", "==", uid)
      .where("endsAt", ">", now - 60 * 60 * 1000)
      .orderBy("endsAt", "asc")
      .limit(20)
      .get();

    const grants = await Promise.all(
      grantsSnap.docs.map(async (gDoc) => {
        const grant = gDoc.data();
        // Get code for this grant
        const codesSnap = await db
          .collection("accessCodes")
          .where("grantId", "==", gDoc.id)
          .orderBy("createdAt", "desc")
          .limit(1)
          .get();

        const code = codesSnap.empty ? null : codesSnap.docs[0].data();
        const doorSnap = await db.collection("doors").doc(grant.doorId).get();
        const door = doorSnap.data();

        return {
          grantId: gDoc.id,
          bookingId: grant.bookingId,
          doorName: door?.name ?? "Door",
          startsAt: grant.startsAt,
          endsAt: grant.endsAt,
          grantStatus: grant.status,
          codeStatus: code?.status ?? null,
          codeLast2: code?.codeLast2 ?? null,
          codeId: code ? codesSnap.docs[0].id : null,
        };
      })
    );

    return { grants };
  }
);

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
      reason?: "cancellation" | "no_show" | "admin" | "expired";
    };
    if (!grantId) throw new HttpsError("invalid-argument", "grantId required");

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

    const codeSnap = await db
      .collection("accessCodes")
      .where("grantId", "==", grantId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (codeSnap.empty) throw new HttpsError("not-found", "No code found for grant");
    const code = codeSnap.docs[0].data();

    const doorSnap = await db.collection("doors").doc(grant.doorId).get();
    const door = doorSnap.data();

    const userSnap = await db.collection("users").doc(grant.userId).get();
    const user = userSnap.data();

    if (!code.codeLast2) {
      throw new HttpsError("failed-precondition", "Code details unavailable — PIN cannot be resent");
    }

    // We can only resend the last2 hint (we do not store the plain PIN)
    await sendResendNotification(grant.userId, {
      bookingId: grant.bookingId,
      grantId,
      doorName: door?.name ?? "Door",
      codeLast2: code.codeLast2,
      startsAt: grant.startsAt,
      endsAt: grant.endsAt,
      userName: user?.displayName || user?.email || grant.userId,
    });

    await logAccessEvent({
      bookingId: grant.bookingId,
      grantId,
      doorId: grant.doorId,
      userId: grant.userId,
      eventType: "code_issued",
      performedBy: request.auth.uid,
      notes: "Admin resent PIN reminder",
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

    return { doorId, ...status };
  }
);

// --- HTTP: Seam Webhook Handler ---

export const access_seamWebhook = onRequest(
  { secrets: [seamApiKey, seamWebhookSecret] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    // Validate signature
    const sig = req.headers["seam-signature"] as string | undefined;
    if (sig) {
      const rawBody = JSON.stringify(req.body);
      const valid = validateSeamSignature(rawBody, sig, seamWebhookSecret.value());
      if (!valid) {
        logger.warn("Seam webhook signature invalid");
        res.status(401).send("Invalid signature");
        return;
      }
    }

    const event = req.body as {
      event_type: string;
      device_id?: string;
      access_code_id?: string;
      properties?: Record<string, unknown>;
    };

    logger.info("Seam webhook received", { event_type: event.event_type, device_id: event.device_id });

    try {
      await handleSeamEvent(event);
      res.status(200).json({ ok: true });
    } catch (err: unknown) {
      logger.error("Seam webhook handler error", { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: "Internal error" });
    }
  }
);

async function handleSeamEvent(event: {
  event_type: string;
  device_id?: string;
  access_code_id?: string;
  properties?: Record<string, unknown>;
}): Promise<void> {
  const now = Date.now();
  const { event_type, device_id, access_code_id } = event;

  // Find door by seamDeviceId
  let doorId: string | undefined;
  let grantId: string | undefined;
  let bookingId: string | undefined;

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
      const codeData = codeSnap.docs[0].data();
      grantId = codeData.grantId;
      doorId = doorId ?? codeData.doorId;

      // Map Seam event types to our internal code statuses
      let newStatus: string | undefined;
      if (event_type === "access_code.set") newStatus = "active";
      else if (event_type === "access_code.removed") newStatus = "revoked";
      else if (event_type === "access_code.failed") newStatus = "failed";

      if (newStatus) {
        await codeSnap.docs[0].ref.update({ status: newStatus, updatedAt: now });
      }

      // Get bookingId from grant
      if (grantId) {
        const grantSnap = await db.collection("accessGrants").doc(grantId).get();
        if (grantSnap.exists) {
          bookingId = grantSnap.data()!.bookingId;
          // Update grant status to active when code goes active
          if (event_type === "access_code.set") {
            await grantSnap.ref.update({ status: "active", updatedAt: now });
          }
        }
      }
    }
  }

  // Handle device online/offline
  if (device_id && (event_type === "device.connected" || event_type === "device.disconnected")) {
    const doorSnap = await db
      .collection("doors")
      .where("seamDeviceId", "==", device_id)
      .limit(1)
      .get();
    if (!doorSnap.empty) {
      const isOnline = event_type === "device.connected";
      doorId = doorSnap.docs[0].id;
      await doorSnap.docs[0].ref.update({
        status: isOnline ? "online" : "offline",
        lastSeenAt: now,
        updatedAt: now,
      });
    }
  }

  // Map Seam event types to internal event types
  const eventTypeMap: Record<string, string> = {
    "access_code.set": "code_active",
    "access_code.removed": "code_revoked",
    "access_code.failed": "code_failed",
    "lock.unlocked": "door_unlocked",
    "device.connected": "device_online",
    "device.disconnected": "device_offline",
  };

  const internalEventType = eventTypeMap[event_type];
  if (internalEventType && doorId) {
    await logAccessEvent({
      bookingId,
      grantId,
      doorId,
      eventType: internalEventType as never,
      providerPayload: event as Record<string, unknown>,
      notes: `Seam webhook: ${event_type}`,
    });
  }
}

// --- Helpers ---

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

async function sendPinNotification(
  userId: string,
  params: {
    bookingId: string;
    grantId: string;
    codeId: string;
    doorName: string;
    pin: string;
    codeLast2: string;
    startsAt: number;
    endsAt: number;
    userName: string;
  }
): Promise<void> {
  const { doorName, pin, startsAt, endsAt, userName } = params;
  const startStr = new Date(startsAt).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const endStr = new Date(endsAt).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  // In-app notification
  const notifRef = db.collection("notifications").doc();
  await notifRef.set({
    id: notifRef.id,
    uid: userId,
    type: "access_pin_issued",
    title: "Your Access Code is Ready",
    body: `Code: ${pin} — valid ${startStr}–${endStr} at ${doorName}. Code activates 5 min before your booking.`,
    linkTo: "/dashboard/access",
    read: false,
    createdAt: Date.now(),
  });

  // Email via existing email pattern — write to a mail queue collection
  // The email provider picks this up asynchronously
  const mailRef = db.collection("mail").doc();
  await mailRef.set({
    id: mailRef.id,
    to: userId,
    resolveEmail: true,
    template: "access_pin_issued",
    data: {
      userName,
      doorName,
      pin,
      startTime: startStr,
      endTime: endStr,
      bookingId: params.bookingId,
    },
    createdAt: Date.now(),
  });

  logger.info("PIN notification sent", { userId, bookingId: params.bookingId });
}

async function sendResendNotification(
  userId: string,
  params: {
    bookingId: string;
    grantId: string;
    doorName: string;
    codeLast2: string;
    startsAt: number;
    endsAt: number;
    userName: string;
  }
): Promise<void> {
  const { doorName, codeLast2, startsAt, endsAt, userName } = params;
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
    type: "access_pin_issued",
    title: "Access Code Reminder",
    body: `Your code ends in ••${codeLast2} — valid from ${startStr} at ${doorName}. Contact support if your code isn't working.`,
    linkTo: "/dashboard/access",
    read: false,
    createdAt: Date.now(),
  });

  logger.info("PIN resend notification sent", { userId, codeLast2, userName });
}

export { NO_SHOW_GRACE_MINUTES };
