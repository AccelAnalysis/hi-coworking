import { randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import { getPayment, updatePaymentStatus } from "../payments/ledger";
import { StripeProvider } from "../payments/stripeProvider";
import {
  asMoney,
  availableSeats,
  cancellationDecision,
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
  sanitizeTicketTypes,
  sellTicketInventory,
  slugify,
  unsellTicketInventory,
  validateEventForSave,
} from "./core";
import { enqueueNotification, enqueueRegistrationNotifications } from "./notifications";
import { promoteWaitlist } from "./registration";
import {
  DEFAULT_REFUND_CUTOFF_HOURS,
  type AttendanceStatusV2,
  type EventDocV2,
  type EventTicketTypeV2,
  type RegistrationDocV2,
  type RegistrationStatusV2,
} from "./types";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

async function authorizeRegistration(
  request: { auth?: { uid: string } | null },
  registrationId: string,
  manageToken?: string,
) {
  const ref = db().collection("eventRegistrations").doc(registrationId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Registration not found.");
  const registration = snap.data() as RegistrationDocV2;
  const authOwns = Boolean(request.auth?.uid && registration.uid === request.auth.uid);
  const tokenMatches = Boolean(manageToken && hashSecret(manageToken) === registration.manageSecretHash);
  if (!authOwns && !tokenMatches) {
    throw new HttpsError("permission-denied", "This registration does not belong to you.");
  }
  return { ref, registration };
}

export const events_v2GetRegistration = onCall(async (request) => {
  const { registrationId, manageToken } = request.data as { registrationId?: string; manageToken?: string };
  if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
  const { registration } = await authorizeRegistration(request, registrationId, manageToken);
  const eventSnap = await db().collection("events").doc(registration.eventId).get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const event = eventSnap.data() as EventDocV2;
  return {
    registration,
    event: {
      ...publicEvent(event),
      ...(registration.status === "CONFIRMED" && event.virtualUrl ? { virtualUrl: event.virtualUrl } : {}),
    },
    cancellation: cancellationDecision(registration, event),
  };
});

export const events_v2GetCancellationQuote = onCall(async (request) => {
  const { registrationId, manageToken } = request.data as { registrationId?: string; manageToken?: string };
  if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
  const { registration } = await authorizeRegistration(request, registrationId, manageToken);
  const eventSnap = await db().collection("events").doc(registration.eventId).get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  return cancellationDecision(registration, eventSnap.data() as EventDocV2);
});

export const events_v2CancelRegistration = onCall(async (request) => {
  const { registrationId, manageToken } = request.data as { registrationId?: string; manageToken?: string };
  if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
  const authorized = await authorizeRegistration(request, registrationId, manageToken);
  const eventRef = db().collection("events").doc(authorized.registration.eventId);

  const result = await db().runTransaction(async (tx): Promise<{ refundCents: number; registration: RegistrationDocV2 }> => {
    const [registrationSnap, eventSnap] = await Promise.all([tx.get(authorized.ref), tx.get(eventRef)]);
    if (!registrationSnap.exists || !eventSnap.exists) {
      throw new HttpsError("not-found", "Registration or event not found.");
    }
    const registration = registrationSnap.data() as RegistrationDocV2;
    const event = eventSnap.data() as EventDocV2;
    const decision = cancellationDecision(registration, event);
    if (!decision.canCancel) {
      throw new HttpsError("failed-precondition", "This registration can no longer be cancelled.");
    }
    const nextConfirmed = Math.max(0, confirmedQuantity(event) - registration.quantity);
    const nextStatus: RegistrationStatusV2 = decision.refundCents > 0 ? "REFUND_PENDING" : "CANCELLED";
    const updatedRegistration: RegistrationDocV2 = {
      ...registration,
      status: nextStatus,
      cancelledAt: Date.now(),
    };
    tx.set(authorized.ref, updatedRegistration, { merge: true });
    tx.update(eventRef, {
      confirmedQuantity: nextConfirmed,
      registrationCount: nextConfirmed,
      ticketTypes: unsellTicketInventory(event, registration.ticketTypeId, registration.quantity),
      updatedAt: Date.now(),
    });
    if (decision.refundCents > 0 && registration.paymentId) {
      const refundRef = db().collection("eventRefundJobs").doc(`cancel_${registration.id}`);
      tx.set(refundRef, {
        id: refundRef.id,
        eventId: event.id,
        registrationId: registration.id,
        paymentId: registration.paymentId,
        amountCents: decision.refundCents,
        reason: "customer_cancellation",
        status: "pending",
        attempts: 0,
        nextAttemptAt: Date.now(),
        createdAt: Date.now(),
      }, { merge: true });
    }
    return { refundCents: decision.refundCents, registration: updatedRegistration };
  });

  await enqueueNotification({
    id: `event_cancel_${registrationId}`,
    type: "REGISTRATION_CANCELLED",
    eventId: result.registration.eventId,
    registrationId,
    email: result.registration.email,
    displayName: result.registration.displayName,
    manageToken,
  });
  await promoteWaitlist(result.registration.eventId);
  return { success: true, refundCents: result.refundCents, refundPending: result.refundCents > 0 };
});

export const events_v2ProcessRefundJobs = onSchedule(
  {
    schedule: "*/5 * * * *",
    timeZone: "America/New_York",
    secrets: [stripeSecretKey, stripeWebhookSecret],
  },
  async () => {
    const snap = await db().collection("eventRefundJobs")
      .where("status", "==", "pending")
      .limit(25)
      .get();
    const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    for (const doc of snap.docs) {
      const job = doc.data() as Record<string, unknown>;
      if (Number(job.nextAttemptAt || 0) > Date.now()) continue;
      const paymentId = String(job.paymentId || "");
      if (!paymentId) {
        await doc.ref.set({ status: "failed", error: "payment-missing", updatedAt: Date.now() }, { merge: true });
        continue;
      }
      try {
        const payment = await getPayment(paymentId);
        if (!payment) throw new Error("Payment ledger record not found");
        const refund = await provider.refundCheckoutPayment({
          checkoutSessionId: payment.providerRefs?.stripeCheckoutSessionId,
          ledgerPaymentId: paymentId,
          holdId: String(job.holdId || payment.providerRefs?.holdId || ""),
          amountCents: asMoney(job.amountCents),
          idempotencyKey: `event_refund_${doc.id}`,
          metadata: {
            eventId: String(job.eventId || ""),
            registrationId: String(job.registrationId || ""),
            reason: String(job.reason || "event_refund"),
          },
        });
        await updatePaymentStatus(paymentId, "refunded", {
          providerRefs: {
            stripeRefundId: refund.refundId,
            stripePaymentIntentId: refund.paymentIntentId,
          },
        });
        const registrationId = String(job.registrationId || "");
        if (registrationId) {
          const regRef = db().collection("eventRegistrations").doc(registrationId);
          const regSnap = await regRef.get();
          if (regSnap.exists) {
            const registration = regSnap.data() as RegistrationDocV2;
            await regRef.set({
              status: "REFUNDED",
              refundedAt: Date.now(),
              stripeRefundId: refund.refundId,
              updatedAt: Date.now(),
            }, { merge: true });
            await enqueueNotification({
              id: `event_refund_${registrationId}`,
              type: "REFUND_CONFIRMED",
              eventId: registration.eventId,
              registrationId,
              email: registration.email,
              displayName: registration.displayName,
            });
          }
        }
        await doc.ref.set({
          status: "completed",
          stripeRefundId: refund.refundId,
          completedAt: Date.now(),
          updatedAt: Date.now(),
        }, { merge: true });
      } catch (error) {
        const attempts = Number(job.attempts || 0) + 1;
        await doc.ref.set({
          attempts,
          nextAttemptAt: Date.now() + Math.min(60, Math.pow(2, attempts)) * 60 * 1000,
          error: error instanceof Error ? error.message : String(error),
          updatedAt: Date.now(),
        }, { merge: true });
      }
    }
  },
);

async function uniqueSlug(title: string, eventId?: string) {
  const base = slugify(title);
  let candidate = base;
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const snap = await db().collection("events").where("slug", "==", candidate).limit(2).get();
    if (!snap.docs.some((doc) => doc.id !== eventId)) return candidate;
    candidate = `${base}-${suffix + 1}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export const events_v2AdminSaveEvent = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  requireAdmin(request.auth);
  const input = (request.data || {}) as Record<string, unknown>;
  validateEventForSave(input);
  const id = String(input.id || `evt_${Date.now()}_${randomBytes(3).toString("hex")}`);
  const ref = db().collection("events").doc(id);
  const existingSnap = await ref.get();
  const existing = existingSnap.exists ? existingSnap.data() as EventDocV2 : null;
  const confirmed = existing ? confirmedQuantity(existing) : 0;
  const seatCap = input.seatCap == null || input.seatCap === "" ? undefined : positiveInt(input.seatCap);
  if (seatCap != null && seatCap < confirmed) {
    throw new HttpsError("failed-precondition", "Capacity cannot be lower than the number of confirmed attendees.");
  }
  const title = String(input.title).trim();
  const slug = await uniqueSlug(title, id);
  const now = Date.now();
  const ticketTypes = sanitizeTicketTypes(input.ticketTypes, existing?.ticketTypes || []);
  const event: EventDocV2 = {
    id,
    slug,
    title,
    description: String(input.description).trim(),
    format: String(input.format || "in-person") as EventDocV2["format"],
    location: String(input.location || "").trim() || undefined,
    virtualUrl: String(input.virtualUrl || "").trim() || undefined,
    startTime: Number(input.startTime),
    endTime: Number(input.endTime),
    timezone: String(input.timezone || existing?.timezone || "America/New_York"),
    seatCap,
    registrationCount: confirmed,
    confirmedQuantity: confirmed,
    heldQuantity: existing?.heldQuantity || 0,
    price: asMoney(input.price),
    memberPriceCents: input.memberPriceCents == null || input.memberPriceCents === "" ? undefined : asMoney(input.memberPriceCents),
    currency: String(input.currency || existing?.currency || "usd").toLowerCase(),
    ticketTypes,
    imageUrl: existing?.imageUrl,
    heroImage: input.heroImage && typeof input.heroImage === "object" ? input.heroImage as Record<string, unknown> : existing?.heroImage,
    gallery: Array.isArray(input.gallery) ? input.gallery as Array<Record<string, unknown>> : existing?.gallery || [],
    recordingUrl: String(input.recordingUrl || "").trim() || undefined,
    status: existing?.status || "draft",
    registrationOpenAt: input.registrationOpenAt ? Number(input.registrationOpenAt) : undefined,
    registrationCloseAt: input.registrationCloseAt ? Number(input.registrationCloseAt) : undefined,
    refundCutoffHours: input.refundCutoffHours == null || input.refundCutoffHours === ""
      ? DEFAULT_REFUND_CUTOFF_HOURS
      : Math.max(0, Number(input.refundCutoffHours)),
    reminders: {
      confirmation: input.confirmation !== false,
      reminder24h: input.reminder24h !== false,
      reminder1h: input.reminder1h !== false,
      followUp: input.followUp === true,
    },
    createdBy: existing?.createdBy || request.auth.uid,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    publishedAt: existing?.publishedAt,
  };
  await ref.set(event, { merge: true });
  return { success: true, eventId: id, slug, status: event.status };
});

export const events_v2AdminPublishEvent = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    requireAdmin(request.auth);
    const { eventId } = request.data as { eventId?: string };
    if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
    const ref = db().collection("events").doc(eventId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Event not found.");
    const event = snap.data() as EventDocV2;
    validateEventForSave(event as unknown as Record<string, unknown>);
    if (event.startTime <= Date.now()) throw new HttpsError("failed-precondition", "A past event cannot be published.");
    const paid = (event.price || 0) > 0 || (event.ticketTypes || []).some((ticket) => ticket.priceCents > 0);
    if (paid && !stripeSecretKey.value()) {
      throw new HttpsError("failed-precondition", "Stripe is not configured for paid event registration.");
    }
    await ref.update({ status: "published", publishedAt: Date.now(), updatedAt: Date.now() });
    return { success: true, eventId };
  },
);

export const events_v2AdminCancelEvent = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  requireAdmin(request.auth);
  const { eventId } = request.data as { eventId?: string };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  const eventRef = db().collection("events").doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const [registrationsSnap, holdsSnap, waitlistSnap] = await Promise.all([
    db().collection("eventRegistrations").where("eventId", "==", eventId).get(),
    db().collection("eventHolds").where("eventId", "==", eventId).get(),
    db().collection("eventWaitlist").where("eventId", "==", eventId).get(),
  ]);
  const batch = db().batch();
  batch.update(eventRef, {
    status: "cancelled",
    confirmedQuantity: 0,
    registrationCount: 0,
    heldQuantity: 0,
    cancelledAt: Date.now(),
    updatedAt: Date.now(),
  });
  const notify: RegistrationDocV2[] = [];
  for (const doc of registrationsSnap.docs) {
    const registration = doc.data() as RegistrationDocV2;
    if (!["CONFIRMED", "REFUND_PENDING"].includes(registration.status)) continue;
    const refundNeeded = registration.amountPaidCents > 0 && Boolean(registration.paymentId);
    batch.set(doc.ref, {
      status: refundNeeded ? "REFUND_PENDING" : "CANCELLED",
      cancelledAt: Date.now(),
      updatedAt: Date.now(),
    }, { merge: true });
    if (refundNeeded && registration.paymentId) {
      const refundRef = db().collection("eventRefundJobs").doc(`event_cancel_${registration.id}`);
      batch.set(refundRef, {
        id: refundRef.id,
        eventId,
        registrationId: registration.id,
        paymentId: registration.paymentId,
        amountCents: registration.amountPaidCents,
        reason: "event_cancelled_by_hi",
        status: "pending",
        attempts: 0,
        nextAttemptAt: Date.now(),
        createdAt: Date.now(),
      }, { merge: true });
    }
    notify.push(registration);
  }
  for (const doc of holdsSnap.docs) {
    if (doc.data().status === "HELD") batch.set(doc.ref, { status: "CANCELLED", cancelledAt: Date.now() }, { merge: true });
  }
  for (const doc of waitlistSnap.docs) {
    if (["WAITING", "OFFERED"].includes(String(doc.data().status))) {
      batch.set(doc.ref, { status: "REMOVED", updatedAt: Date.now() }, { merge: true });
    }
  }
  await batch.commit();
  await Promise.all(notify.map((registration) => enqueueNotification({
    id: `event_cancelled_${registration.id}`,
    type: "EVENT_CANCELLED",
    eventId,
    registrationId: registration.id,
    email: registration.email,
    displayName: registration.displayName,
  })));
  return { success: true, eventId, affectedRegistrations: registrationsSnap.size };
});

export const events_v2AdminCompleteEvent = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  requireStaff(request.auth);
  const { eventId } = request.data as { eventId?: string };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  const eventRef = db().collection("events").doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const regs = await db().collection("eventRegistrations").where("eventId", "==", eventId).get();
  const batch = db().batch();
  batch.set(eventRef, { status: "completed", completedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
  for (const doc of regs.docs) {
    const registration = doc.data() as RegistrationDocV2;
    if (registration.status !== "CONFIRMED") continue;
    const checkedIn = Math.max(0, registration.checkedInQuantity || 0);
    const attendanceStatus: AttendanceStatusV2 = checkedIn === 0
      ? "NO_SHOW"
      : checkedIn >= registration.quantity ? "CHECKED_IN" : "PARTIAL";
    batch.set(doc.ref, { attendanceStatus, updatedAt: Date.now() }, { merge: true });
  }
  await batch.commit();
  return { success: true, eventId };
});

export const events_v2StaffGetRoster = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  requireStaff(request.auth);
  const { eventId } = request.data as { eventId?: string };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  const [eventSnap, regs, waitlist] = await Promise.all([
    db().collection("events").doc(eventId).get(),
    db().collection("eventRegistrations").where("eventId", "==", eventId).orderBy("registeredAt", "asc").get(),
    db().collection("eventWaitlist").where("eventId", "==", eventId).orderBy("joinedAt", "asc").get(),
  ]);
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  return {
    event: publicEvent(eventSnap.data() as EventDocV2),
    registrations: regs.docs.map((doc) => doc.data()),
    waitlist: waitlist.docs.map((doc) => doc.data()),
  };
});

export const events_v2StaffCheckIn = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  requireStaff(request.auth);
  const { registrationId, quantity: rawQuantity } = request.data as { registrationId?: string; quantity?: number };
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
  await ref.set({ checkedInQuantity: quantity, checkedInAt: Date.now(), attendanceStatus, updatedAt: Date.now() }, { merge: true });
  return { success: true, registrationId, checkedInQuantity: quantity, attendanceStatus };
});

export const events_v2StaffWalkIn = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  requireStaff(request.auth);
  const { eventId, name, email, ticketTypeId, quantity: rawQuantity } = request.data as {
    eventId?: string;
    name?: string;
    email?: string;
    ticketTypeId?: string;
    quantity?: number;
  };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  const displayName = String(name || "").trim();
  if (!displayName) throw new HttpsError("invalid-argument", "Walk-in name is required.");
  const quantity = positiveInt(rawQuantity, 1);
  const registrationRef = db().collection("eventRegistrations").doc();
  const manageSecret = randomSecret();
  const normalizedEmail = normalizeEmail(email) || `walkin-${registrationRef.id}@invalid.local`;

  const result = await db().runTransaction(async (tx): Promise<{ registration: RegistrationDocV2; event: EventDocV2 }> => {
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
    const registration: RegistrationDocV2 = {
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
      manageSecretHash: hashSecret(manageSecret),
      registeredAt: Date.now(),
    };
    tx.set(registrationRef, registration);
    tx.update(eventRef, {
      confirmedQuantity: nextConfirmed,
      registrationCount: nextConfirmed,
      ticketTypes: nextTickets,
      updatedAt: Date.now(),
    });
    return { registration, event: { ...event, confirmedQuantity: nextConfirmed, registrationCount: nextConfirmed, ticketTypes: nextTickets } };
  });

  if (!normalizedEmail.endsWith("@invalid.local")) {
    await enqueueRegistrationNotifications(result.registration, result.event, manageSecret);
  }
  return { success: true, registrationId: result.registration.id };
});

export const events_v2ListMyRegistrations = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const snap = await db().collection("eventRegistrations")
    .where("uid", "==", request.auth.uid)
    .orderBy("registeredAt", "desc")
    .limit(100)
    .get();
  const registrations = snap.docs.map((doc) => doc.data() as RegistrationDocV2);
  const eventIds = [...new Set(registrations.map((registration) => registration.eventId))];
  const events = await Promise.all(eventIds.map(async (eventId) => {
    const eventSnap = await db().collection("events").doc(eventId).get();
    return eventSnap.exists ? publicEvent(eventSnap.data() as EventDocV2) : null;
  }));
  return { registrations, events: events.filter(Boolean) };
});
