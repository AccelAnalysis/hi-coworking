/**
 * Admin and staff event operations: cancel, complete, roster, check-in and
 * walk-in (audit P0-4).
 *
 * These live apart from management.ts so the isolated admin-event-save
 * codebase can deploy them without the Stripe refund worker or the Resend
 * notification worker.
 *
 * Safety rules (Jonathan, Oct 24):
 * - Cancelling an event never emails registrants and never refunds money on
 *   its own. Paid registrations are flagged for an admin to review, and their
 *   refund job is written as "needs_admin_review", a status the scheduled
 *   refund worker never picks up (it only reads "pending").
 * - Walk-ins are checked in on the spot and get no confirmation email.
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { adminEventCallableOptions } from "./adminEventCors";
import {
  availableSeats,
  confirmedQuantity,
  db,
  hashSecret,
  normalizeEmail,
  positiveInt,
  publicEvent,
  randomSecret,
  requireAdmin,
  requireStaff,
  resolvePricing,
  sellTicketInventory,
} from "./core";
import {
  type AttendanceStatusV2,
  type EventDocV2,
  type RegistrationDocV2,
} from "./types";

/** Refund job status the scheduled refund worker ignores. */
export const ADMIN_REVIEW_REFUND_STATUS = "needs_admin_review";

type ActorAuth = { uid: string; token?: Record<string, unknown> };

function actorFields(auth: ActorAuth) {
  return {
    actorUid: auth.uid,
    actorRole: String(auth.token?.role || ""),
  };
}

/** What happens to one registration when Hi Coworking cancels the event. */
export function eventCancellationOutcome(registration: Pick<RegistrationDocV2, "status" | "amountPaidCents" | "paymentId">) {
  if (!["CONFIRMED", "REFUND_PENDING"].includes(registration.status)) return "unchanged" as const;
  const paid = Number(registration.amountPaidCents || 0) > 0 && Boolean(registration.paymentId);
  return paid ? "refund_review" as const : "cancelled" as const;
}

/** Roster rows never expose the manage-link hash. */
export function rosterRegistration(registration: RegistrationDocV2) {
  const { manageSecretHash: _hash, ...rest } = registration as RegistrationDocV2 & { manageSecretHash?: string };
  return rest;
}

export const events_v2AdminCancelEvent = onCall(adminEventCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  requireAdmin(request.auth);
  const { eventId, reason } = (request.data || {}) as { eventId?: string; reason?: string };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  const eventRef = db().collection("events").doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const event = eventSnap.data() as EventDocV2;
  if (event.status !== "published") {
    throw new HttpsError("failed-precondition", "Only published events can be cancelled.");
  }
  const [registrationsSnap, holdsSnap, waitlistSnap] = await Promise.all([
    db().collection("eventRegistrations").where("eventId", "==", eventId).get(),
    db().collection("eventHolds").where("eventId", "==", eventId).get(),
    db().collection("eventWaitlist").where("eventId", "==", eventId).get(),
  ]);
  const now = Date.now();
  const batch = db().batch();
  batch.update(eventRef, {
    status: "cancelled",
    confirmedQuantity: 0,
    registrationCount: 0,
    heldQuantity: 0,
    ticketTypes: (event.ticketTypes || []).map((ticket) => ({ ...ticket, heldCount: 0 })),
    cancelledAt: now,
    cancelledBy: request.auth.uid,
    updatedAt: now,
  });
  let cancelled = 0;
  let refundReview = 0;
  for (const doc of registrationsSnap.docs) {
    const registration = doc.data() as RegistrationDocV2;
    const outcome = eventCancellationOutcome(registration);
    if (outcome === "unchanged") continue;
    batch.set(doc.ref, {
      status: outcome === "refund_review" ? "REFUND_PENDING" : "CANCELLED",
      cancelledAt: now,
      updatedAt: now,
    }, { merge: true });
    if (outcome === "refund_review" && registration.paymentId) {
      refundReview += 1;
      const refundRef = db().collection("eventRefundJobs").doc(`event_cancel_${registration.id}`);
      batch.set(refundRef, {
        id: refundRef.id,
        eventId,
        registrationId: registration.id,
        paymentId: registration.paymentId,
        amountCents: Number(registration.amountPaidCents || 0),
        reason: "event_cancelled_by_hi",
        status: ADMIN_REVIEW_REFUND_STATUS,
        attempts: 0,
        createdAt: now,
      }, { merge: true });
    } else {
      cancelled += 1;
    }
  }
  for (const doc of holdsSnap.docs) {
    if (doc.data().status === "HELD") batch.set(doc.ref, { status: "CANCELLED", cancelledAt: now }, { merge: true });
  }
  for (const doc of waitlistSnap.docs) {
    if (["WAITING", "OFFERED"].includes(String(doc.data().status))) {
      batch.set(doc.ref, { status: "REMOVED", updatedAt: now }, { merge: true });
    }
  }
  const auditRef = db().collection("eventOperationAudit").doc();
  batch.set(auditRef, {
    id: auditRef.id,
    action: "event_cancel",
    eventId,
    eventTitle: event.title,
    reason: String(reason || "").trim().slice(0, 500) || null,
    cancelledRegistrations: cancelled,
    refundReviewRegistrations: refundReview,
    emailsSent: 0,
    refundsIssued: 0,
    ...actorFields(request.auth),
    createdAt: now,
  });
  await batch.commit();
  return {
    success: true,
    eventId,
    affectedRegistrations: cancelled + refundReview,
    cancelledRegistrations: cancelled,
    refundReviewRegistrations: refundReview,
    emailsSent: 0,
  };
});

export const events_v2AdminCompleteEvent = onCall(adminEventCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  requireStaff(request.auth);
  const { eventId } = (request.data || {}) as { eventId?: string };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  const eventRef = db().collection("events").doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const event = eventSnap.data() as EventDocV2;
  if (event.status !== "published" || event.endTime > Date.now()) {
    throw new HttpsError("failed-precondition", "Only published events that have ended can be completed.");
  }
  const regs = await db().collection("eventRegistrations").where("eventId", "==", eventId).get();
  const now = Date.now();
  const batch = db().batch();
  batch.set(eventRef, { status: "completed", completedAt: now, updatedAt: now }, { merge: true });
  let noShows = 0;
  for (const doc of regs.docs) {
    const registration = doc.data() as RegistrationDocV2;
    if (registration.status !== "CONFIRMED") continue;
    const checkedIn = Math.max(0, registration.checkedInQuantity || 0);
    const attendanceStatus: AttendanceStatusV2 = checkedIn === 0
      ? "NO_SHOW"
      : checkedIn >= registration.quantity ? "CHECKED_IN" : "PARTIAL";
    if (attendanceStatus === "NO_SHOW") noShows += 1;
    batch.set(doc.ref, { attendanceStatus, updatedAt: now }, { merge: true });
  }
  const auditRef = db().collection("eventOperationAudit").doc();
  batch.set(auditRef, {
    id: auditRef.id,
    action: "event_complete",
    eventId,
    eventTitle: event.title,
    noShows,
    ...actorFields(request.auth),
    createdAt: now,
  });
  await batch.commit();
  return { success: true, eventId, noShows };
});

export const events_v2StaffGetRoster = onCall(adminEventCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  requireStaff(request.auth);
  const { eventId } = (request.data || {}) as { eventId?: string };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  // Sorted in memory so the roster never depends on a composite index.
  const [eventSnap, regs, waitlist] = await Promise.all([
    db().collection("events").doc(eventId).get(),
    db().collection("eventRegistrations").where("eventId", "==", eventId).get(),
    db().collection("eventWaitlist").where("eventId", "==", eventId).get(),
  ]);
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const registrations = regs.docs
    .map((doc) => doc.data() as RegistrationDocV2)
    .sort((a, b) => Number(a.registeredAt || 0) - Number(b.registeredAt || 0))
    .map(rosterRegistration);
  const waitlistRows = waitlist.docs
    .map((doc) => doc.data() as Record<string, unknown>)
    .sort((a, b) => Number(a.joinedAt || 0) - Number(b.joinedAt || 0))
    .map(({ manageSecretHash: _hash, ...rest }) => rest);
  return {
    event: publicEvent(eventSnap.data() as EventDocV2),
    registrations,
    waitlist: waitlistRows,
  };
});

export const events_v2StaffCheckIn = onCall(adminEventCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  requireStaff(request.auth);
  const { registrationId, quantity: rawQuantity } = (request.data || {}) as { registrationId?: string; quantity?: number };
  if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
  const ref = db().collection("eventRegistrations").doc(registrationId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Registration not found.");
  const registration = snap.data() as RegistrationDocV2;
  if (registration.status !== "CONFIRMED") {
    throw new HttpsError("failed-precondition", "Only confirmed registrations can check in.");
  }
  const quantity = Math.min(registration.quantity, positiveInt(rawQuantity, registration.quantity));
  const attendanceStatus: AttendanceStatusV2 = quantity >= registration.quantity ? "CHECKED_IN" : "PARTIAL";
  await ref.set({
    checkedInQuantity: quantity,
    checkedInAt: Date.now(),
    checkedInBy: request.auth.uid,
    attendanceStatus,
    updatedAt: Date.now(),
  }, { merge: true });
  return { success: true, registrationId, checkedInQuantity: quantity, attendanceStatus };
});

export const events_v2StaffWalkIn = onCall(adminEventCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  requireStaff(request.auth);
  const { eventId, name, email, ticketTypeId, quantity: rawQuantity } = (request.data || {}) as {
    eventId?: string;
    name?: string;
    email?: string;
    ticketTypeId?: string;
    quantity?: number;
  };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  const displayName = String(name || "").trim().slice(0, 120);
  if (!displayName) throw new HttpsError("invalid-argument", "Walk-in name is required.");
  const quantity = positiveInt(rawQuantity, 1);
  const registrationRef = db().collection("eventRegistrations").doc();
  const normalizedEmail = normalizeEmail(email) || `walkin-${registrationRef.id}@invalid.local`;
  const actorUid = request.auth.uid;

  const registration = await db().runTransaction(async (tx): Promise<RegistrationDocV2> => {
    const eventRef = db().collection("events").doc(eventId);
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
    const event = eventSnap.data() as EventDocV2;
    if (event.status !== "published" || event.endTime <= Date.now()) {
      throw new HttpsError("failed-precondition", "This event is not accepting walk-ins.");
    }
    if (availableSeats(event) < quantity) throw new HttpsError("resource-exhausted", "This event is full.");
    const pricing = resolvePricing(event, ticketTypeId, false, quantity);
    if (pricing.totalCents > 0) {
      throw new HttpsError("failed-precondition", "Paid walk-ins must use the normal event checkout so payment remains reconciled.");
    }
    const nextConfirmed = confirmedQuantity(event) + quantity;
    const nextTickets = sellTicketInventory(event, pricing.ticketTypeId, quantity, false);
    const created: RegistrationDocV2 = {
      id: registrationRef.id,
      eventId,
      displayName,
      email: normalizedEmail,
      ticketTypeId: pricing.ticketTypeId,
      ticketTypeName: pricing.ticketTypeName,
      quantity,
      publicUnitPriceCents: pricing.publicUnitPriceCents,
      discountCents: pricing.discountCents,
      finalUnitPriceCents: pricing.finalUnitPriceCents,
      amountPaidCents: 0,
      currency: pricing.currency,
      status: "CONFIRMED",
      attendanceStatus: "CHECKED_IN",
      checkedInQuantity: quantity,
      checkedInAt: Date.now(),
      source: "staff_walkin",
      manageSecretHash: hashSecret(randomSecret()),
      registeredAt: Date.now(),
    };
    tx.set(registrationRef, { ...created, checkedInBy: actorUid });
    tx.update(eventRef, {
      confirmedQuantity: nextConfirmed,
      registrationCount: nextConfirmed,
      ticketTypes: nextTickets,
      updatedAt: Date.now(),
    });
    return created;
  });

  return { success: true, registrationId: registration.id, emailSent: false };
});
