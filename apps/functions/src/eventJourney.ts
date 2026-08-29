import { createHash, randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { FieldValue } from "firebase-admin/firestore";
import { createPayment, updatePaymentStatus } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

const HOLD_MS = 15 * 60 * 1000;
const WAITLIST_OFFER_MS = 30 * 60 * 1000;
const REFUND_CUTOFF_MS = 24 * 60 * 60 * 1000;
const MAX_TICKETS_PER_REGISTRATION = 10;

type GuestDetails = { name?: string; email?: string };
type EventTicket = {
  id: string;
  name: string;
  priceCents: number;
  memberPriceCents?: number;
  quantity?: number;
  soldCount?: number;
};
type EventRecord = {
  id: string;
  title: string;
  status: "draft" | "published" | "cancelled" | "completed";
  startTime: number;
  endTime: number;
  seatCap?: number;
  registrationCount?: number;
  confirmedQuantity?: number;
  heldQuantity?: number;
  price?: number;
  memberPriceCents?: number;
  currency?: string;
  ticketTypes?: EventTicket[];
};
type EventHold = {
  id: string;
  eventId: string;
  uid?: string;
  guest?: { name: string; email: string };
  ticketTypeId?: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  currency: string;
  status: "HELD" | "CONSUMED" | "EXPIRED" | "CANCELLED";
  secretHash: string;
  createdAt: number;
  expiresAt: number;
  paymentId?: string;
  stripeCheckoutSessionId?: string;
  registrationId?: string;
  waitlistEntryId?: string;
};

type RegistrationRecord = {
  id: string;
  eventId: string;
  uid?: string;
  displayName: string;
  email: string;
  ticketTypeId?: string;
  quantity: number;
  unitPriceCents: number;
  amountPaidCents: number;
  currency: string;
  paymentId?: string;
  status: "CONFIRMED" | "CANCELLED" | "REFUND_PENDING" | "REFUNDED";
  attendanceStatus: "NOT_CHECKED_IN" | "CHECKED_IN" | "NO_SHOW";
  checkedInQuantity: number;
  source: "web" | "member" | "staff_walkin" | "waitlist";
  manageSecretHash: string;
  registeredAt: number;
  cancelledAt?: number;
  refundedAt?: number;
};

function db() {
  return admin.firestore();
}

function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function normalizedEmail(value?: string) {
  return value?.trim().toLowerCase() || "";
}

function confirmedQuantity(event: EventRecord) {
  return Math.max(0, Number(event.confirmedQuantity ?? event.registrationCount ?? 0));
}

function heldQuantity(event: EventRecord) {
  return Math.max(0, Number(event.heldQuantity ?? 0));
}

function availableSeats(event: EventRecord) {
  if (typeof event.seatCap !== "number") return Number.POSITIVE_INFINITY;
  return Math.max(0, event.seatCap - confirmedQuantity(event) - heldQuantity(event));
}

function requirePublishedAndOpen(event: EventRecord) {
  if (event.status !== "published") {
    throw new HttpsError("failed-precondition", "This event is not accepting registrations.");
  }
  if (event.endTime <= Date.now()) {
    throw new HttpsError("failed-precondition", "This event has already ended.");
  }
}

async function isActiveMember(uid?: string) {
  if (!uid) return false;
  const user = (await db().collection("users").doc(uid).get()).data();
  return user?.membershipStatus === "active";
}

function resolveTicket(event: EventRecord, ticketTypeId?: string) {
  if (!event.ticketTypes?.length) return null;
  const ticket = ticketTypeId
    ? event.ticketTypes.find((item) => item.id === ticketTypeId)
    : event.ticketTypes[0];
  if (!ticket) throw new HttpsError("not-found", "Ticket type not found.");
  return ticket;
}

async function authoritativePrice(event: EventRecord, ticketTypeId: string | undefined, uid?: string) {
  const ticket = resolveTicket(event, ticketTypeId);
  const publicPrice = Math.max(0, Math.round(ticket?.priceCents ?? event.price ?? 0));
  const memberPrice = ticket?.memberPriceCents ?? event.memberPriceCents;
  if (await isActiveMember(uid) && typeof memberPrice === "number") {
    return Math.max(0, Math.round(memberPrice));
  }
  return publicPrice;
}

function validateQuantity(quantity: unknown) {
  const normalized = Math.floor(Number(quantity || 1));
  if (!Number.isFinite(normalized) || normalized < 1 || normalized > MAX_TICKETS_PER_REGISTRATION) {
    throw new HttpsError("invalid-argument", `Choose between 1 and ${MAX_TICKETS_PER_REGISTRATION} tickets.`);
  }
  return normalized;
}

function ownershipMatches(
  request: { auth?: { uid: string } | null },
  record: { uid?: string; manageSecretHash?: string; secretHash?: string },
  suppliedSecret?: string,
) {
  if (request.auth?.uid && record.uid === request.auth.uid) return true;
  const expected = record.manageSecretHash || record.secretHash;
  return Boolean(suppliedSecret && expected && hashSecret(suppliedSecret) === expected);
}

async function createRegistrationFromHold(
  tx: FirebaseFirestore.Transaction,
  holdRef: FirebaseFirestore.DocumentReference,
  hold: EventHold,
  eventRef: FirebaseFirestore.DocumentReference,
  event: EventRecord,
) {
  const registrationId = hold.registrationId || `ereg_${hold.id}`;
  const registrationRef = db().collection("eventRegistrations").doc(registrationId);
  const existingRegistration = await tx.get(registrationRef);
  if (existingRegistration.exists) return registrationId;

  if (hold.status !== "HELD") {
    if (hold.status === "CONSUMED" && hold.registrationId) return hold.registrationId;
    throw new HttpsError("failed-precondition", "This event hold is no longer active.");
  }

  const now = Date.now();
  const holdStillActive = hold.expiresAt > now;
  if (!holdStillActive && availableSeats(event) < hold.quantity) {
    throw new HttpsError("resource-exhausted", "The held seats expired and the event is now full.");
  }

  const displayName = hold.uid
    ? String((await tx.get(db().collection("users").doc(hold.uid))).data()?.displayName || "Member")
    : hold.guest?.name || "Guest";
  const email = hold.uid
    ? normalizedEmail(String((await tx.get(db().collection("users").doc(hold.uid))).data()?.email || ""))
    : normalizedEmail(hold.guest?.email);

  const registration: RegistrationRecord = {
    id: registrationId,
    eventId: hold.eventId,
    ...(hold.uid ? { uid: hold.uid } : {}),
    displayName,
    email,
    ...(hold.ticketTypeId ? { ticketTypeId: hold.ticketTypeId } : {}),
    quantity: hold.quantity,
    unitPriceCents: hold.unitPriceCents,
    amountPaidCents: hold.totalCents,
    currency: hold.currency,
    ...(hold.paymentId ? { paymentId: hold.paymentId } : {}),
    status: "CONFIRMED",
    attendanceStatus: "NOT_CHECKED_IN",
    checkedInQuantity: 0,
    source: hold.waitlistEntryId ? "waitlist" : hold.uid ? "member" : "web",
    manageSecretHash: hold.secretHash,
    registeredAt: now,
  };

  tx.set(registrationRef, registration);
  tx.update(holdRef, {
    status: "CONSUMED",
    consumedAt: now,
    registrationId,
  });
  tx.set(eventRef, {
    confirmedQuantity: confirmedQuantity(event) + hold.quantity,
    registrationCount: confirmedQuantity(event) + hold.quantity,
    heldQuantity: Math.max(0, heldQuantity(event) - (holdStillActive ? hold.quantity : 0)),
    updatedAt: now,
  }, { merge: true });

  if (hold.ticketTypeId && event.ticketTypes?.length) {
    tx.set(eventRef, {
      ticketTypes: event.ticketTypes.map((ticket) => ticket.id === hold.ticketTypeId
        ? { ...ticket, soldCount: Math.max(0, Number(ticket.soldCount || 0)) + hold.quantity }
        : ticket),
    }, { merge: true });
  }
  if (hold.waitlistEntryId) {
    tx.set(db().collection("eventWaitlist").doc(hold.waitlistEntryId), {
      status: "CLAIMED",
      claimedAt: now,
      registrationId,
      updatedAt: now,
    }, { merge: true });
  }
  return registrationId;
}

export async function finalizeEventHoldFromPaymentMetadata(metadata?: Record<string, string>) {
  const holdId = metadata?.holdId;
  if (!holdId || metadata?.purpose !== "event" || metadata?.eventFlowVersion !== "2") return null;
  const holdRef = db().collection("eventHolds").doc(holdId);
  const eventId = metadata.eventId;
  if (!eventId) return null;
  const eventRef = db().collection("events").doc(eventId);

  return db().runTransaction(async (tx) => {
    const [holdSnap, eventSnap] = await Promise.all([tx.get(holdRef), tx.get(eventRef)]);
    if (!holdSnap.exists || !eventSnap.exists) return null;
    const hold = holdSnap.data() as EventHold;
    if (hold.status === "CONSUMED") return hold.registrationId || null;
    const event = eventSnap.data() as EventRecord;
    return createRegistrationFromHold(tx, holdRef, hold, eventRef, event);
  });
}

export const events_beginRegistration = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    const { eventId, ticketTypeId, quantity: rawQuantity, guest, successUrl, cancelUrl } = request.data as {
      eventId?: string;
      ticketTypeId?: string;
      quantity?: number;
      guest?: GuestDetails;
      successUrl?: string;
      cancelUrl?: string;
    };
    if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
    if (!request.auth && (!guest?.name?.trim() || !normalizedEmail(guest.email))) {
      throw new HttpsError("invalid-argument", "Name and email are required.");
    }
    const quantity = validateQuantity(rawQuantity);
    const eventRef = db().collection("events").doc(eventId);
    const initialSnap = await eventRef.get();
    if (!initialSnap.exists) throw new HttpsError("not-found", "Event not found.");
    const initialEvent = initialSnap.data() as EventRecord;
    requirePublishedAndOpen(initialEvent);
    const unitPriceCents = await authoritativePrice(initialEvent, ticketTypeId, request.auth?.uid);
    const totalCents = unitPriceCents * quantity;
    const holdRef = db().collection("eventHolds").doc();
    const secret = randomBytes(24).toString("hex");
    const now = Date.now();

    const hold: EventHold = {
      id: holdRef.id,
      eventId,
      ...(request.auth?.uid ? { uid: request.auth.uid } : {}),
      ...(!request.auth ? { guest: { name: guest!.name!.trim(), email: normalizedEmail(guest!.email) } } : {}),
      ...(ticketTypeId ? { ticketTypeId } : {}),
      quantity,
      unitPriceCents,
      totalCents,
      currency: initialEvent.currency || "usd",
      status: "HELD",
      secretHash: hashSecret(secret),
      createdAt: now,
      expiresAt: now + HOLD_MS,
    };

    await db().runTransaction(async (tx) => {
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
      const event = eventSnap.data() as EventRecord;
      requirePublishedAndOpen(event);
      if (availableSeats(event) < quantity) {
        throw new HttpsError("resource-exhausted", "This event does not have enough seats available.");
      }
      const ticket = resolveTicket(event, ticketTypeId);
      if (ticket?.quantity != null && Math.max(0, ticket.quantity - Number(ticket.soldCount || 0)) < quantity) {
        throw new HttpsError("resource-exhausted", "That ticket type is sold out.");
      }
      tx.set(holdRef, hold);
      tx.set(eventRef, { heldQuantity: heldQuantity(event) + quantity, updatedAt: now }, { merge: true });
    });

    if (totalCents === 0) {
      const registrationId = await db().runTransaction(async (tx) => {
        const [holdSnap, eventSnap] = await Promise.all([tx.get(holdRef), tx.get(eventRef)]);
        if (!holdSnap.exists || !eventSnap.exists) throw new HttpsError("not-found", "Registration hold not found.");
        return createRegistrationFromHold(tx, holdRef, holdSnap.data() as EventHold, eventRef, eventSnap.data() as EventRecord);
      });
      return { kind: "confirmed", registrationId, manageSecret: secret };
    }

    if (!successUrl || !cancelUrl) {
      await db().runTransaction(async (tx) => {
        const eventSnap = await tx.get(eventRef);
        const latestHold = await tx.get(holdRef);
        if (!eventSnap.exists || !latestHold.exists) return;
        const event = eventSnap.data() as EventRecord;
        tx.update(holdRef, { status: "CANCELLED", cancelledAt: Date.now() });
        tx.set(eventRef, { heldQuantity: Math.max(0, heldQuantity(event) - quantity), updatedAt: Date.now() }, { merge: true });
      });
      throw new HttpsError("invalid-argument", "Return URLs are required for paid registration.");
    }

    const payerId = request.auth?.uid || `guest:${holdRef.id}`;
    const payment = await createPayment({
      uid: payerId,
      provider: "stripe",
      amount: totalCents,
      currency: hold.currency,
      purpose: "event",
      purposeRefId: holdRef.id,
      status: "pending",
      providerRefs: { holdId: holdRef.id, eventId },
    });
    await holdRef.update({ paymentId: payment.id });
    const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    const session = await provider.createCheckoutSession({
      uid: payerId,
      amount: totalCents,
      currency: hold.currency,
      purpose: "event",
      purposeRefId: holdRef.id,
      successUrl,
      cancelUrl,
      mode: "payment",
      lineItemLabel: `${initialEvent.title} · ${quantity} ticket${quantity === 1 ? "" : "s"}`,
      metadata: {
        paymentId: payment.id,
        purpose: "event",
        purposeRefId: holdRef.id,
        eventFlowVersion: "2",
        eventId,
        holdId: holdRef.id,
        quantity: String(quantity),
        ...(ticketTypeId ? { ticketTypeId } : {}),
        ...(!request.auth ? { email: normalizedEmail(guest?.email), displayName: guest?.name?.trim() || "" } : {}),
      },
    });
    await Promise.all([
      updatePaymentStatus(payment.id, "pending", {
        providerRefs: { holdId: holdRef.id, eventId, stripeCheckoutSessionId: session.sessionId },
      }),
      holdRef.update({ stripeCheckoutSessionId: session.sessionId }),
    ]);
    return {
      kind: "checkout",
      holdId: holdRef.id,
      holdSecret: secret,
      expiresAt: hold.expiresAt,
      paymentId: payment.id,
      checkoutUrl: session.url,
    };
  },
);

export const events_finalizeRegistration = onCall(async (request) => {
  const { holdId, holdSecret } = request.data as { holdId?: string; holdSecret?: string };
  if (!holdId) throw new HttpsError("invalid-argument", "holdId is required.");
  const holdRef = db().collection("eventHolds").doc(holdId);
  const holdSnap = await holdRef.get();
  if (!holdSnap.exists) throw new HttpsError("not-found", "Registration hold not found.");
  const hold = holdSnap.data() as EventHold;
  if (!ownershipMatches(request, hold, holdSecret)) throw new HttpsError("permission-denied", "This registration hold is not yours.");
  if (hold.status === "CONSUMED") return { status: "confirmed", registrationId: hold.registrationId };
  if (hold.status !== "HELD") return { status: hold.status.toLowerCase() };
  if (!hold.paymentId) return { status: "pending" };
  const paymentSnap = await db().collection("payments").doc(hold.paymentId).get();
  if (!paymentSnap.exists || paymentSnap.data()?.status !== "paid") return { status: "pending" };
  const registrationId = await finalizeEventHoldFromPaymentMetadata({
    purpose: "event",
    eventFlowVersion: "2",
    eventId: hold.eventId,
    holdId,
  });
  return { status: "confirmed", registrationId };
});

export const events_joinWaitlistV2 = onCall(async (request) => {
  const { eventId, quantity: rawQuantity, guest } = request.data as {
    eventId?: string;
    quantity?: number;
    guest?: GuestDetails;
  };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  if (!request.auth && (!guest?.name?.trim() || !normalizedEmail(guest.email))) {
    throw new HttpsError("invalid-argument", "Name and email are required.");
  }
  const quantity = validateQuantity(rawQuantity);
  const eventSnap = await db().collection("events").doc(eventId).get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const event = eventSnap.data() as EventRecord;
  requirePublishedAndOpen(event);
  if (availableSeats(event) >= quantity) {
    throw new HttpsError("failed-precondition", "Seats are currently available. Register instead.");
  }
  const id = db().collection("eventWaitlist").doc().id;
  const secret = randomBytes(24).toString("hex");
  await db().collection("eventWaitlist").doc(id).set({
    id,
    eventId,
    ...(request.auth?.uid ? { uid: request.auth.uid } : {}),
    displayName: request.auth?.token.name || guest?.name?.trim() || "Guest",
    email: normalizedEmail(String(request.auth?.token.email || guest?.email || "")),
    quantity,
    status: "WAITING",
    manageSecretHash: hashSecret(secret),
    joinedAt: Date.now(),
    updatedAt: Date.now(),
  });
  return { success: true, waitlistEntryId: id, manageSecret: secret };
});

async function promoteWaitlist(eventId: string) {
  const eventRef = db().collection("events").doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) return null;
  const event = eventSnap.data() as EventRecord;
  const available = availableSeats(event);
  if (available < 1 || event.status !== "published") return null;
  const waiting = await db().collection("eventWaitlist")
    .where("eventId", "==", eventId)
    .where("status", "==", "WAITING")
    .orderBy("joinedAt", "asc")
    .limit(25)
    .get();
  const candidate = waiting.docs.find((doc) => Number(doc.data().quantity || 1) <= available);
  if (!candidate) return null;
  const entry = candidate.data();
  const quantity = validateQuantity(entry.quantity);
  const secret = randomBytes(24).toString("hex");
  const holdRef = db().collection("eventHolds").doc();
  const now = Date.now();
  const unitPriceCents = await authoritativePrice(event, entry.ticketTypeId, entry.uid);
  const hold: EventHold = {
    id: holdRef.id,
    eventId,
    ...(entry.uid ? { uid: String(entry.uid) } : {}),
    ...(!entry.uid ? { guest: { name: String(entry.displayName || "Guest"), email: normalizedEmail(String(entry.email || "")) } } : {}),
    ...(entry.ticketTypeId ? { ticketTypeId: String(entry.ticketTypeId) } : {}),
    quantity,
    unitPriceCents,
    totalCents: unitPriceCents * quantity,
    currency: event.currency || "usd",
    status: "HELD",
    secretHash: hashSecret(secret),
    createdAt: now,
    expiresAt: now + WAITLIST_OFFER_MS,
    waitlistEntryId: candidate.id,
  };
  await db().runTransaction(async (tx) => {
    const [latestEvent, latestEntry] = await Promise.all([tx.get(eventRef), tx.get(candidate.ref)]);
    if (!latestEvent.exists || !latestEntry.exists || latestEntry.data()?.status !== "WAITING") return;
    const currentEvent = latestEvent.data() as EventRecord;
    if (availableSeats(currentEvent) < quantity) return;
    tx.set(holdRef, hold);
    tx.set(eventRef, { heldQuantity: heldQuantity(currentEvent) + quantity, updatedAt: now }, { merge: true });
    tx.set(candidate.ref, {
      status: "OFFERED",
      offerHoldId: holdRef.id,
      offerSecretHash: hashSecret(secret),
      offerExpiresAt: hold.expiresAt,
      offeredAt: now,
      updatedAt: now,
    }, { merge: true });
  });
  return { waitlistEntryId: candidate.id, holdId: holdRef.id, offerSecret: secret, email: entry.email };
}

export const events_getCancellationQuote = onCall(async (request) => {
  const { registrationId, manageSecret } = request.data as { registrationId?: string; manageSecret?: string };
  if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
  const regSnap = await db().collection("eventRegistrations").doc(registrationId).get();
  if (!regSnap.exists) throw new HttpsError("not-found", "Registration not found.");
  const registration = regSnap.data() as RegistrationRecord;
  if (!ownershipMatches(request, registration, manageSecret)) throw new HttpsError("permission-denied", "This registration is not yours.");
  const eventSnap = await db().collection("events").doc(registration.eventId).get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const event = eventSnap.data() as EventRecord;
  const refundCents = registration.amountPaidCents > 0 && event.startTime - Date.now() >= REFUND_CUTOFF_MS
    ? registration.amountPaidCents
    : 0;
  return {
    canCancel: registration.status === "CONFIRMED",
    refundEligible: refundCents > 0,
    refundCents,
    policyMessage: refundCents > 0
      ? "This registration qualifies for a full refund."
      : registration.amountPaidCents > 0
        ? "This registration is inside the 24-hour non-refundable window."
        : "This free registration can be cancelled now.",
  };
});

export const events_cancelRegistrationV2 = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    const { registrationId, manageSecret } = request.data as { registrationId?: string; manageSecret?: string };
    if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
    const regRef = db().collection("eventRegistrations").doc(registrationId);
    const initial = await regRef.get();
    if (!initial.exists) throw new HttpsError("not-found", "Registration not found.");
    const registration = initial.data() as RegistrationRecord;
    if (!ownershipMatches(request, registration, manageSecret)) throw new HttpsError("permission-denied", "This registration is not yours.");
    if (registration.status !== "CONFIRMED") return { success: true, status: registration.status };
    const eventRef = db().collection("events").doc(registration.eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
    const event = eventSnap.data() as EventRecord;
    const refundCents = registration.amountPaidCents > 0 && event.startTime - Date.now() >= REFUND_CUTOFF_MS
      ? registration.amountPaidCents
      : 0;

    await db().runTransaction(async (tx) => {
      const [latestReg, latestEvent] = await Promise.all([tx.get(regRef), tx.get(eventRef)]);
      if (!latestReg.exists || !latestEvent.exists || latestReg.data()?.status !== "CONFIRMED") return;
      const currentEvent = latestEvent.data() as EventRecord;
      tx.set(regRef, {
        status: refundCents > 0 ? "REFUND_PENDING" : "CANCELLED",
        cancelledAt: Date.now(),
        updatedAt: Date.now(),
      }, { merge: true });
      tx.set(eventRef, {
        confirmedQuantity: Math.max(0, confirmedQuantity(currentEvent) - registration.quantity),
        registrationCount: Math.max(0, confirmedQuantity(currentEvent) - registration.quantity),
        updatedAt: Date.now(),
      }, { merge: true });
    });

    if (refundCents > 0 && registration.paymentId) {
      const paymentSnap = await db().collection("payments").doc(registration.paymentId).get();
      const refs = paymentSnap.data()?.providerRefs || {};
      const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
      try {
        const refund = await provider.refundCheckoutPayment({
          checkoutSessionId: refs.stripeCheckoutSessionId,
          ledgerPaymentId: registration.paymentId,
          amountCents: refundCents,
          idempotencyKey: `event_cancel_${registrationId}`,
          metadata: { registrationId, eventId: registration.eventId },
        });
        await Promise.all([
          regRef.set({ status: "REFUNDED", refundedAt: Date.now(), stripeRefundId: refund.refundId, updatedAt: Date.now() }, { merge: true }),
          updatePaymentStatus(registration.paymentId, "refunded", { providerRefs: { ...refs, stripeRefundId: refund.refundId } }),
        ]);
      } catch (error) {
        logger.error("Event refund failed and will require retry", { registrationId, error });
        await db().collection("eventRefundJobs").doc(registrationId).set({
          id: registrationId,
          registrationId,
          eventId: registration.eventId,
          paymentId: registration.paymentId,
          amountCents: refundCents,
          status: "PENDING",
          attempts: 0,
          nextAttemptAt: Date.now() + 5 * 60 * 1000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }, { merge: true });
      }
    }
    await promoteWaitlist(registration.eventId);
    return { success: true, status: refundCents > 0 ? "REFUND_PENDING" : "CANCELLED", refundCents };
  },
);

export const events_expireRegistrationHolds = onSchedule(
  { schedule: "*/5 * * * *", timeZone: "America/New_York" },
  async () => {
    const now = Date.now();
    const snap = await db().collection("eventHolds")
      .where("status", "==", "HELD")
      .where("expiresAt", "<=", now)
      .limit(100)
      .get();
    const affectedEvents = new Set<string>();
    for (const doc of snap.docs) {
      const hold = doc.data() as EventHold;
      const eventRef = db().collection("events").doc(hold.eventId);
      await db().runTransaction(async (tx) => {
        const [latestHold, eventSnap] = await Promise.all([tx.get(doc.ref), tx.get(eventRef)]);
        if (!latestHold.exists || latestHold.data()?.status !== "HELD" || !eventSnap.exists) return;
        const event = eventSnap.data() as EventRecord;
        tx.update(doc.ref, { status: "EXPIRED", expiredAt: now });
        tx.set(eventRef, { heldQuantity: Math.max(0, heldQuantity(event) - hold.quantity), updatedAt: now }, { merge: true });
        if (hold.waitlistEntryId) {
          tx.set(db().collection("eventWaitlist").doc(hold.waitlistEntryId), { status: "EXPIRED", updatedAt: now }, { merge: true });
        }
      });
      affectedEvents.add(hold.eventId);
    }
    for (const eventId of affectedEvents) await promoteWaitlist(eventId);
  },
);

export const events_processRefundJobs = onSchedule(
  { schedule: "*/10 * * * *", timeZone: "America/New_York", secrets: [stripeSecretKey, stripeWebhookSecret] },
  async () => {
    const jobs = await db().collection("eventRefundJobs")
      .where("status", "==", "PENDING")
      .where("nextAttemptAt", "<=", Date.now())
      .limit(25)
      .get();
    const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    for (const jobDoc of jobs.docs) {
      const job = jobDoc.data();
      try {
        const paymentSnap = await db().collection("payments").doc(job.paymentId).get();
        const refs = paymentSnap.data()?.providerRefs || {};
        const refund = await provider.refundCheckoutPayment({
          checkoutSessionId: refs.stripeCheckoutSessionId,
          ledgerPaymentId: job.paymentId,
          amountCents: Number(job.amountCents),
          idempotencyKey: `event_cancel_${job.registrationId}`,
          metadata: { registrationId: job.registrationId, eventId: job.eventId },
        });
        await Promise.all([
          db().collection("eventRegistrations").doc(job.registrationId).set({ status: "REFUNDED", refundedAt: Date.now(), stripeRefundId: refund.refundId, updatedAt: Date.now() }, { merge: true }),
          updatePaymentStatus(job.paymentId, "refunded", { providerRefs: { ...refs, stripeRefundId: refund.refundId } }),
          jobDoc.ref.set({ status: "COMPLETED", completedAt: Date.now(), updatedAt: Date.now() }, { merge: true }),
        ]);
      } catch (error) {
        const attempts = Number(job.attempts || 0) + 1;
        await jobDoc.ref.set({
          attempts,
          nextAttemptAt: Date.now() + Math.min(60, 5 * attempts) * 60 * 1000,
          lastError: error instanceof Error ? error.message : String(error),
          updatedAt: Date.now(),
        }, { merge: true });
      }
    }
  },
);

export const events_staffSetCheckIn = onCall(async (request) => {
  const role = request.auth?.token.role as string | undefined;
  if (!request.auth || !["staff", "admin", "master"].includes(role || "")) {
    throw new HttpsError("permission-denied", "Staff access is required.");
  }
  const { registrationId, checkedInQuantity: raw } = request.data as { registrationId?: string; checkedInQuantity?: number };
  if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
  const ref = db().collection("eventRegistrations").doc(registrationId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Registration not found.");
  const registration = snap.data() as RegistrationRecord;
  const checkedInQuantity = Math.max(0, Math.min(registration.quantity, Math.floor(Number(raw || 0))));
  await ref.set({
    checkedInQuantity,
    attendanceStatus: checkedInQuantity > 0 ? "CHECKED_IN" : "NOT_CHECKED_IN",
    checkedInAt: checkedInQuantity > 0 ? Date.now() : FieldValue.delete(),
    updatedAt: Date.now(),
  }, { merge: true });
  return { success: true, checkedInQuantity };
});
