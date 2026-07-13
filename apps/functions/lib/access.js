"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_SHOW_GRACE_MINUTES = exports.access_seamWebhook = exports.access_adminGetDoorStatus = exports.access_adminResendPin = exports.access_adminUnlock = exports.access_adminRevoke = exports.access_getMyGrants = exports.seamWebhookSecret = exports.seamApiKey = void 0;
exports.createAccessGrant = createAccessGrant;
exports.revokeAccessGrant = revokeAccessGrant;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const seamProvider_1 = require("./providers/seamProvider");
const db = admin.firestore();
exports.seamApiKey = (0, params_1.defineSecret)("SEAM_API_KEY");
exports.seamWebhookSecret = (0, params_1.defineSecret)("SEAM_WEBHOOK_SECRET");
const GRACE_PERIOD_MINUTES = 5;
const NO_SHOW_GRACE_MINUTES = 30;
exports.NO_SHOW_GRACE_MINUTES = NO_SHOW_GRACE_MINUTES;
// --- Internal: Create Access Grant ---
/**
 * Called immediately after a booking is confirmed.
 * Finds the door for the resource, creates an AccessGrant, programs a time-bound PIN via Seam,
 * writes an AccessCode doc (hash only), and sends notifications.
 */
async function createAccessGrant(bookingId, resourceId, userId, start, end) {
    const apiKey = exports.seamApiKey.value();
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
    let plainPin = null;
    let seamCodeId;
    let codeHash;
    let codeLast2;
    let codeStatus = "programming";
    let failureReason;
    const codeRef = db.collection("accessCodes").doc();
    try {
        const result = await (0, seamProvider_1.createTimeBoundCode)(apiKey, door.seamDeviceId, new Date(gracedStart), new Date(gracedEnd), `HiCo-${bookingId.slice(-6)}-${userName.split(" ")[0]}`);
        plainPin = result.plainPin;
        seamCodeId = result.seamCodeId;
        codeHash = result.codeHash;
        codeLast2 = result.codeLast2;
        codeStatus = "programming"; // Will move to "active" via Seam webhook
        logger.info("Seam code created", { seamCodeId, bookingId, grantId: grantRef.id });
    }
    catch (err) {
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
            codeLast2: codeLast2,
            startsAt: gracedStart,
            endsAt: gracedEnd,
            userName,
        });
        await codeRef.update({ deliveredAt: Date.now(), updatedAt: Date.now() });
    }
    // 11. plain PIN is now out of scope — GC will clean it up
}
// --- Internal: Revoke Access Grant ---
async function revokeAccessGrant(grantId, reason, revokedBy = "system") {
    const apiKey = exports.seamApiKey.value();
    const grantSnap = await db.collection("accessGrants").doc(grantId).get();
    if (!grantSnap.exists) {
        logger.warn("revokeAccessGrant: grant not found", { grantId });
        return;
    }
    const grant = grantSnap.data();
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
                await (0, seamProvider_1.deleteCode)(apiKey, door.seamDeviceId, code.seamCodeId);
                logger.info("Seam code deleted on revoke", { seamCodeId: code.seamCodeId, grantId, reason });
            }
            catch (err) {
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
exports.access_getMyGrants = (0, https_1.onCall)({ secrets: [exports.seamApiKey] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
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
    const grants = await Promise.all(grantsSnap.docs.map(async (gDoc) => {
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
    }));
    return { grants };
});
// --- Callable: Admin Revoke Grant ---
exports.access_adminRevoke = (0, https_1.onCall)({ secrets: [exports.seamApiKey] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const role = request.auth.token.role;
    if (role !== "admin" && role !== "master") {
        throw new https_1.HttpsError("permission-denied", "Admin or master required");
    }
    const { grantId, reason = "admin" } = request.data;
    if (!grantId)
        throw new https_1.HttpsError("invalid-argument", "grantId required");
    await revokeAccessGrant(grantId, reason, request.auth.uid);
    return { success: true, grantId };
});
// --- Callable: Admin Remote Unlock ---
exports.access_adminUnlock = (0, https_1.onCall)({ secrets: [exports.seamApiKey] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const role = request.auth.token.role;
    if (role !== "admin" && role !== "master") {
        throw new https_1.HttpsError("permission-denied", "Admin or master required");
    }
    const { doorId } = request.data;
    if (!doorId)
        throw new https_1.HttpsError("invalid-argument", "doorId required");
    const doorSnap = await db.collection("doors").doc(doorId).get();
    if (!doorSnap.exists)
        throw new https_1.HttpsError("not-found", "Door not found");
    const door = doorSnap.data();
    await (0, seamProvider_1.remoteUnlock)(exports.seamApiKey.value(), door.seamDeviceId);
    await logAccessEvent({
        doorId,
        userId: request.auth.uid,
        eventType: "door_unlock_requested",
        performedBy: request.auth.uid,
        notes: "Admin remote unlock",
    });
    return { success: true, doorId };
});
// --- Callable: Admin Resend PIN ---
exports.access_adminResendPin = (0, https_1.onCall)({ secrets: [exports.seamApiKey] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const role = request.auth.token.role;
    if (role !== "admin" && role !== "master") {
        throw new https_1.HttpsError("permission-denied", "Admin or master required");
    }
    const { grantId } = request.data;
    if (!grantId)
        throw new https_1.HttpsError("invalid-argument", "grantId required");
    const grantSnap = await db.collection("accessGrants").doc(grantId).get();
    if (!grantSnap.exists)
        throw new https_1.HttpsError("not-found", "Grant not found");
    const grant = grantSnap.data();
    const codeSnap = await db
        .collection("accessCodes")
        .where("grantId", "==", grantId)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();
    if (codeSnap.empty)
        throw new https_1.HttpsError("not-found", "No code found for grant");
    const code = codeSnap.docs[0].data();
    const doorSnap = await db.collection("doors").doc(grant.doorId).get();
    const door = doorSnap.data();
    const userSnap = await db.collection("users").doc(grant.userId).get();
    const user = userSnap.data();
    if (!code.codeLast2) {
        throw new https_1.HttpsError("failed-precondition", "Code details unavailable — PIN cannot be resent");
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
});
// --- Callable: Admin Get Door Status ---
exports.access_adminGetDoorStatus = (0, https_1.onCall)({ secrets: [exports.seamApiKey] }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be logged in");
    }
    const role = request.auth.token.role;
    if (role !== "admin" && role !== "master") {
        throw new https_1.HttpsError("permission-denied", "Admin or master required");
    }
    const { doorId } = request.data;
    if (!doorId)
        throw new https_1.HttpsError("invalid-argument", "doorId required");
    const doorSnap = await db.collection("doors").doc(doorId).get();
    if (!doorSnap.exists)
        throw new https_1.HttpsError("not-found", "Door not found");
    const door = doorSnap.data();
    const status = await (0, seamProvider_1.getDeviceStatus)(exports.seamApiKey.value(), door.seamDeviceId);
    // Update cached status in Firestore
    await doorSnap.ref.update({
        status: status.online ? "online" : "offline",
        ...(status.batteryLevel !== undefined && { batteryLevel: status.batteryLevel }),
        lastSeenAt: Date.now(),
        updatedAt: Date.now(),
    });
    return { doorId, ...status };
});
// --- HTTP: Seam Webhook Handler ---
exports.access_seamWebhook = (0, https_1.onRequest)({ secrets: [exports.seamApiKey, exports.seamWebhookSecret] }, async (req, res) => {
    if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
    }
    // Validate signature
    const sig = req.headers["seam-signature"];
    if (sig) {
        const rawBody = JSON.stringify(req.body);
        const valid = (0, seamProvider_1.validateSeamSignature)(rawBody, sig, exports.seamWebhookSecret.value());
        if (!valid) {
            logger.warn("Seam webhook signature invalid");
            res.status(401).send("Invalid signature");
            return;
        }
    }
    const event = req.body;
    logger.info("Seam webhook received", { event_type: event.event_type, device_id: event.device_id });
    try {
        await handleSeamEvent(event);
        res.status(200).json({ ok: true });
    }
    catch (err) {
        logger.error("Seam webhook handler error", { error: err instanceof Error ? err.message : String(err) });
        res.status(500).json({ error: "Internal error" });
    }
});
async function handleSeamEvent(event) {
    const now = Date.now();
    const { event_type, device_id, access_code_id } = event;
    // Find door by seamDeviceId
    let doorId;
    let grantId;
    let bookingId;
    if (device_id) {
        const doorSnap = await db
            .collection("doors")
            .where("seamDeviceId", "==", device_id)
            .limit(1)
            .get();
        if (!doorSnap.empty)
            doorId = doorSnap.docs[0].id;
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
            let newStatus;
            if (event_type === "access_code.set")
                newStatus = "active";
            else if (event_type === "access_code.removed")
                newStatus = "revoked";
            else if (event_type === "access_code.failed")
                newStatus = "failed";
            if (newStatus) {
                await codeSnap.docs[0].ref.update({ status: newStatus, updatedAt: now });
            }
            // Get bookingId from grant
            if (grantId) {
                const grantSnap = await db.collection("accessGrants").doc(grantId).get();
                if (grantSnap.exists) {
                    bookingId = grantSnap.data().bookingId;
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
    const eventTypeMap = {
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
            eventType: internalEventType,
            providerPayload: event,
            notes: `Seam webhook: ${event_type}`,
        });
    }
}
// --- Helpers ---
async function logAccessEvent(params) {
    const ref = db.collection("accessEvents").doc();
    await ref.set({
        id: ref.id,
        provider: "seam",
        ...params,
        createdAt: Date.now(),
    });
}
async function sendPinNotification(userId, params) {
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
async function sendResendNotification(userId, params) {
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
