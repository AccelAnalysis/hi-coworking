import { accessResourceForBooking } from "./accessBookingPolicy";
import { randomUUID } from "node:crypto";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
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
  // Deterministic claim prevents retries/concurrent booking hooks from issuing duplicate PINs.
  // Once provider work starts, an ambiguous failure requires staff reconciliation, not blind retry.
  const grantRef = db.collection("accessGrants").doc(`booking_${bookingId}`);
  const now = Date.now();
  const leaseToken = randomUUID();
  const claimed = await db.runTransaction(async (tx) => {
    const existing = await tx.get(grantRef);
    const booking = (await tx.get(db.collection("bookings").doc(bookingId))).data();
    if (!booking || String(booking.status).toUpperCase() !== "CONFIRMED" || booking.start !== start || booking.end !== end || accessResourceForBooking(booking) !== resourceId || booking.userId !== userId) return false;
    const prior = existing.data();
    // Legacy/ambiguous claims have no explicit false marker: never automatically reissue them.
    const safelyRetryable = prior?.providerAttempted === false && prior.status === "pending" &&
      (["blocked", "retryable"].includes(prior.programmingStatus) || Number(prior.leaseExpiresAt || 0) <= now);
    if (existing.exists && !safelyRetryable) return false;
    tx.set(grantRef, {
      id: grantRef.id, bookingId, resourceId, userId,
      startsAt: start - GRACE_PERIOD_MINUTES * 60000,
      endsAt: end + GRACE_PERIOD_MINUTES * 60000,
      status: "pending", programmingStatus: "pending", deliveryStatus: "not_queued",
      activationStatus: "pending", providerAttempted: false, leaseToken, leaseExpiresAt: now + 5 * 60000,
      createdAt: prior?.createdAt || now, updatedAt: now,
    });
    return true;
  });
  if (!claimed) return;
  try {
  const apiKey = seamApiKey.value();

  // 1. Find the door that gates this resource
  const doorsSnap = await db
    .collection("doors")
    .where("resourceIds", "array-contains", resourceId)
    .where("status", "!=", "archived")
    .limit(1)
    .get();

  if (doorsSnap.empty) {
    await grantRef.update({ programmingStatus: "blocked", staffAttentionRequired: true,
      failureReason: "No door configured for resource", updatedAt: Date.now() });
    logger.error("Access requires staff: no door configured", { resourceId, bookingId });
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
  const prepared = await db.runTransaction(async (tx) => {
    const current = await tx.get(grantRef);
    if (current.data()?.leaseToken !== leaseToken || current.data()?.status !== "pending") return false;
    tx.update(grantRef, { ...grant, programmingStatus: "programming" });
    return true;
  });
  if (!prepared) return;

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

  const canProgram = await db.runTransaction(async (tx) => {
    const current = await tx.get(grantRef);
    const booking = (await tx.get(db.collection("bookings").doc(bookingId))).data();
    if (current.data()?.leaseToken !== leaseToken || current.data()?.providerAttempted !== false || current.data()?.status !== "pending") return false;
    if (!booking || String(booking.status).toUpperCase() !== "CONFIRMED" || booking.start !== start || booking.end !== end || accessResourceForBooking(booking) !== resourceId || booking.userId !== userId) return false;
    // Commit the irreversible boundary BEFORE making any network request.
    tx.update(grantRef, { providerAttempted: true, providerAttemptedAt: Date.now(), programmingStatus: "programming", doorId, updatedAt: Date.now() });
    return true;
  });
  if (!canProgram) return;
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
    logger.error("Seam code creation failed", { bookingId, grantId: grantRef.id });
    codeStatus = "failed";
    failureReason = "Credential provisioning failed; staff must reconcile provider state";
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

  // Preserve cancellation/expiry and any activation webhook that raced the provider response.
  const mayDeliver = await db.runTransaction(async (tx) => {
    const current = await tx.get(grantRef);
    if (["revoked", "expired"].includes(current.data()?.status)) return false;
    tx.update(grantRef, {
      status: current.data()?.status === "active" ? "active" : "pending",
      programmingStatus: current.data()?.status === "active" ? "active" : codeStatus,
      staffAttentionRequired: codeStatus === "failed",
      ...(failureReason ? { failureReason: "Credential provisioning failed; staff must reconcile before retry" } : {}),
      updatedAt: Date.now(),
    });
    return true;
  });
  if (!mayDeliver) {
    // Cancellation may have raced code creation before the revoker could discover this code.
    if (seamCodeId) {
      try {
        await deleteCode(apiKey, door.seamDeviceId, seamCodeId);
        await codeRef.update({ status: "revoked", updatedAt: Date.now() });
      } catch {
        await grantRef.update({ staffAttentionRequired: true, failureReason: "Provider credential removal requires reconciliation", updatedAt: Date.now() });
      }
    }
    return;
  }

  // 9. Log code_issued event
  await logAccessEvent({
    bookingId,
    grantId: grantRef.id,
    doorId,
    userId,
    eventType: codeStatus === "failed" ? "code_failed" : "code_issued",
    notes: codeStatus === "failed" ? "Credential provisioning failed; staff reconciliation required" : "Code submitted; awaiting provider activation",
  });

  // 10. Send PIN notification (only if code was created successfully)
  if (plainPin && codeStatus !== "failed") {
    try {
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
    await codeRef.update({ queuedAt: Date.now(), deliveryStatus: "queued", updatedAt: Date.now() });
    await grantRef.update({ deliveryStatus: "queued", updatedAt: Date.now() });
    } catch (error) {
      await grantRef.update({ deliveryStatus: "failed", staffAttentionRequired: true, updatedAt: Date.now() });
      await codeRef.update({ deliveryStatus: "failed", updatedAt: Date.now() });
      logger.error("Credential notification queue failed", { bookingId, grantId: grantRef.id });
    }
  }

  // 11. plain PIN is now out of scope — GC will clean it up
  } catch (error) {
    await db.runTransaction(async (tx) => {
      const current = await tx.get(grantRef);
      if (current.data()?.leaseToken !== leaseToken) return;
      const safeRetry = current.data()?.providerAttempted === false;
      tx.update(grantRef, { programmingStatus: safeRetry ? "retryable" : "failed", staffAttentionRequired: !safeRetry,
        failureReason: safeRetry ? "Setup interrupted before provider attempt; safe retry pending" : "Access setup interrupted; staff reconciliation required", updatedAt: Date.now() });
    });
    throw error;
  }
}

// Booking creation is the durable outbox. Retry is safe because createAccessGrant claims once.
export const access_onBookingCreated = onDocumentCreated(
  { document: "bookings/{bookingId}", secrets: [seamApiKey], retry: true },
  async (event) => {
    // Re-read to avoid provisioning a booking cancelled since the event was emitted.
    const current = await event.data?.ref.get();
    const booking = current?.data();
    if (!booking || String(booking.status).toUpperCase() !== "CONFIRMED" || Number(booking.end) <= Date.now()) return;
    const resourceId = accessResourceForBooking(booking);
    if (!resourceId || !booking.userId || !Number.isFinite(booking.start) || !Number.isFinite(booking.end)) {
      logger.error("Booking lacks access provisioning fields", { bookingId: event.params.bookingId });
      return;
    }
    await createAccessGrant(event.params.bookingId, resourceId, booking.userId, booking.start, booking.end);
  },
);

// A crash after provider submission cannot safely be retried without provider reconciliation.
// Surface stale/ambiguous work for staff rather than silently leaving it 'preparing' forever.
export const access_escalateStalled = onSchedule({ schedule: "every 15 minutes", secrets: [seamApiKey] }, async () => {
  const now = Date.now();
  const pending = await db.collection("accessGrants").where("status", "in", ["pending", "active"]).get();
  for (const doc of pending.docs) {
    const grant = doc.data();
    if (grant.endsAt <= now) continue;
    if (grant.providerAttempted === false && (["blocked", "retryable"].includes(grant.programmingStatus) || grant.leaseExpiresAt <= now)) {
      try {
        const booking = (await db.collection("bookings").doc(grant.bookingId).get()).data();
        const resourceId = booking && accessResourceForBooking(booking);
        if (booking && resourceId && String(booking.status).toUpperCase() === "CONFIRMED") {
          await createAccessGrant(grant.bookingId, resourceId, booking.userId, booking.start, booking.end);
        }
      } catch { logger.warn("Safe pre-provider retry deferred", { grantId: doc.id }); }
      continue;
    }
    if (grant.staffAttentionRequired || now - grant.updatedAt < 15 * 60000) continue;
    if (grant.status === "active" && grant.deliveryStatus !== "queued" && grant.deliveryStatus !== "not_queued") continue;
    await doc.ref.update({ staffAttentionRequired: true,
      failureReason: grant.status === "active" ? "Credential email queue has no confirmed send outcome; staff delivery recovery required" : "Credential activation not confirmed; staff must reconcile provider state",
      updatedAt: now });
  }
});

// Observe the documented Trigger Email extension state when that extension is installed.
// SUCCESS means the SMTP send completed, not that the guest received/read the message.
// https://firebase.google.com/docs/extensions/official/firestore-send-email/delivery-status
export const access_onMailUpdated = onDocumentUpdated("mail/{mailId}", async (event) => {
  const current = await event.data?.after.ref.get();
  const mail = current?.data();
  if (!mail?.grantId || !event.params.mailId.startsWith("access_")) return;
  const state = mail.delivery?.state;
  if (state !== "SUCCESS" && state !== "ERROR") return;
  const grantRef = db.collection("accessGrants").doc(mail.grantId);
  if (!(await grantRef.get()).exists) return;
  await grantRef.update({
    deliveryStatus: state === "SUCCESS" ? "accepted" : "failed",
    ...(state === "ERROR" ? { staffAttentionRequired: true, failureReason: "Credential email failed; staff delivery recovery required" } : { deliveryAcceptedAt: Date.now() }),
    updatedAt: Date.now(),
  });
});

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
        const doorSnap = grant.doorId ? await db.collection("doors").doc(grant.doorId).get() : null;
        const door = doorSnap?.data();

        return {
          grantId: gDoc.id,
          bookingId: grant.bookingId,
          doorName: door?.name ?? "Door",
          startsAt: grant.startsAt,
          endsAt: grant.endsAt,
          grantStatus: grant.status,
          programmingStatus: grant.programmingStatus ?? "pending",
          deliveryStatus: grant.deliveryStatus ?? "unknown",
          activationStatus: grant.activationStatus ?? "pending",
          staffAttentionRequired: Boolean(grant.staffAttentionRequired),
          codeStatus: code?.status ?? null,
          codeLast2: code?.codeLast2 ?? null,
          codeId: code ? codesSnap.docs[0].id : null,
        };
      })
    );

    return { grants };
  }
);

// Safe retry is deliberately limited to work that never reached the provider.
export const access_adminRetryProvisioning = onCall({ secrets: [seamApiKey] }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in");
  if (!["admin", "master"].includes(String(request.auth.token.role))) throw new HttpsError("permission-denied", "Admin required");
  const bookingId = String(request.data?.bookingId || "");
  if (!bookingId || bookingId.includes("/")) throw new HttpsError("invalid-argument", "bookingId required");
  const booking = (await db.collection("bookings").doc(bookingId).get()).data();
  if (!booking || String(booking.status).toUpperCase() !== "CONFIRMED" || booking.end <= Date.now()) throw new HttpsError("failed-precondition", "An upcoming confirmed booking is required");
  const existing = await db.collection("accessGrants").where("bookingId", "==", bookingId).get();
  if (existing.docs.some((doc) => doc.data().providerAttempted !== false || !["blocked", "retryable"].includes(doc.data().programmingStatus))) {
    throw new HttpsError("failed-precondition", "Provider work may have started; reconcile credentials with staff before retrying");
  }
  const resourceId = accessResourceForBooking(booking);
  if (!resourceId) throw new HttpsError("failed-precondition", "Physical access resource is missing; staff configuration required");
  await createAccessGrant(bookingId, resourceId, booking.userId, booking.start, booking.end);
  return { success: true, bookingId, deliveryConfirmed: false };
});

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

    // Seam uses Svix signatures over the exact raw request bytes, not reserialized JSON.
    const valid = validateSeamSignature(req.rawBody.toString("utf8"), {
      id: req.get("svix-id") || req.get("webhook-id"),
      timestamp: req.get("svix-timestamp") || req.get("webhook-timestamp"),
      signature: req.get("svix-signature") || req.get("webhook-signature"),
    }, seamWebhookSecret.value());
    if (!valid) {
      res.status(401).send("Invalid signature");
      return;
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

export async function handleSeamEvent(event: {
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

      if (grantId) {
        const grantRef = db.collection("accessGrants").doc(grantId);
        await db.runTransaction(async (tx) => {
          const freshCode = await tx.get(codeSnap.docs[0].ref);
          const grantSnap = await tx.get(grantRef);
          if (!grantSnap.exists || !freshCode.exists) return;
          const grant = grantSnap.data()!;
          bookingId = grant.bookingId;
          const bookingSnap = bookingId ? await tx.get(db.collection("bookings").doc(bookingId)) : null;
          const booking = bookingSnap?.data();
          if (["revoked", "expired"].includes(grant.status) || ["revoked", "expired"].includes(freshCode.data()!.status)) return;
          // Revalidate booking status/window in the same transaction: cancellation or rescheduling wins.
          if (newStatus === "active" && (!booking || String(booking.status).toUpperCase() !== "CONFIRMED" ||
              (grant.resourceId && accessResourceForBooking(booking) !== grant.resourceId) ||
              grant.endsAt <= now || grant.startsAt !== booking.start - GRACE_PERIOD_MINUTES * 60000 ||
              grant.endsAt !== booking.end + GRACE_PERIOD_MINUTES * 60000)) return;
          if (newStatus) tx.update(codeSnap.docs[0].ref, { status: newStatus, updatedAt: now });
          if (newStatus === "active") {
            tx.update(grantRef, { status: "active", programmingStatus: "active", activationStatus: "active", updatedAt: now });
          } else if (newStatus === "failed") {
            tx.update(grantRef, { status: "pending", programmingStatus: "failed", activationStatus: "failed", staffAttentionRequired: true, updatedAt: now });
          } else if (newStatus === "revoked") {
            tx.update(grantRef, { status: "revoked", activationStatus: "revoked", updatedAt: now });
          }
        });
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
    ...Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)),
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
  const notifRef = db.collection("notifications").doc(`access_${params.grantId}`);
  await notifRef.set({
    id: notifRef.id,
    uid: userId,
    type: "access_pin_issued",
    title: "Your Access Code is Being Prepared",
    body: `Code: ${pin} — valid ${startStr}–${endStr} at ${doorName}. Activation is pending. Check your booking access status before arrival.`,
    linkTo: "/account/bookings",
    read: false,
    createdAt: Date.now(),
  });

  // Trigger Email-compatible queue payload; enqueue is NOT proof of delivery.
  const user = await db.collection("users").doc(userId).get();
  const email = user.data()?.email;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Delivery address unavailable");
  }
  const mailRef = db.collection("mail").doc(`access_${params.grantId}`);
  await mailRef.set({
    to: [email],
    message: {
      subject: "Your Hi Coworking access code — activation pending",
      text: `Hi ${userName}, your code is ${pin} for ${doorName}, ${startStr}–${endStr}. Check your booking access status before arrival: https://hi-coworking.com/account/bookings`,
    },
    bookingId: params.bookingId,
    grantId: params.grantId,
    createdAt: Date.now(),
  });
  logger.info("PIN notification queued (delivery unverified)", { userId, bookingId: params.bookingId });
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
    linkTo: "/account/bookings",
    read: false,
    createdAt: Date.now(),
  });

  logger.info("PIN resend notification sent", { userId, codeLast2, userName });
}

export { NO_SHOW_GRACE_MINUTES };
