import { createHash, randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { createPayment, getPayment, updatePaymentStatus } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";
import {
  EVENT_HOLD_MS,
  EVENT_MAX_TICKETS_PER_REGISTRATION,
  EVENT_WAITLIST_CLAIM_MS,
  evaluateEventCancellation,
} from "./eventPolicy";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

function db() { return admin.firestore(); }

function requireAdmin(auth: { token?: Record<string, unknown> } | null | undefined) {
  const role = auth?.token?.role as string | undefined;
  if (role !== "admin" && role !== "master") throw new HttpsError("permission-denied", "Admin access is required.");
}

function requireStaff(auth: { token?: Record<string, unknown> } | null | undefined) {
  const role = auth?.token?.role as string | undefined;
  if (!["staff", "admin", "master"].includes(role || "")) throw new HttpsError("permission-denied", "Staff access is required.");
}

function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}

function normalizeEmail(value?: string) {
  return value?.trim().toLowerCase() || "";
}

function safeQuantity(value: unknown) {
  const quantity = Math.max(1, Math.floor(Number(value) || 1));
  if (quantity > EVENT_MAX_TICKETS_PER_REGISTRATION) {
    throw new HttpsError("invalid-argument", `A registration may include at most ${EVENT_MAX_TICKETS_PER_REGISTRATION} tickets.`);
  }
  return quantity;
}

type EventData = {
  id: string;
  title: string;
  status: string;
  startTime: number;
  endTime: number;
  seatCap?: number;
  registrationCount?: number;
  confirmedQuantity?: number;
  heldQuantity?: number;
  price?: number;
  currency?: string;
  ticketTypes?: Array<{
    id: string;
    name: string;
    priceCents: number;
    quantity?: number;
    soldCount?: number;
    targetAudience?: "public" | "member" | "vip";
    memberPricesCents?: Record<string, number>;
  }>;
};

type RegistrationData = {
  id: string;
  eventId: string;
  uid?: string;
  displayName: string;
  email: string;
  ticketTypeId?: string;
  quantity: number;
  publicUnitPriceCents: number;
  discountCents: number;
  finalUnitPriceCents: number;
  amountPaidCents: number;
  currency: string;
  paymentId?: string;
  status: "CONFIRMED" | "CANCELLED" | "REFUND_PENDING" | "REFUNDED";
  attendanceStatus: "NOT_CHECKED_IN" | "CHECKED_IN" | "NO_SHOW";
  checkedInQuantity: number;
  checkedInAt?: number;
  manageSecretHash?: string;
  source: "web" | "member" | "staff_walkin" | "waitlist";
  registeredAt: number;
  cancelledAt?: number;
  refundedAt?: number;
};

async function loadPublishedEvent(eventId: string) {
  const ref = db().collection("events").doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Event not found.");
  const event = snap.data() as EventData;
  if (event.status !== "published") throw new HttpsError("failed-precondition", "This event is not accepting registrations.");
  if (event.endTime <= Date.now()) throw new HttpsError("failed-precondition", "This event has already ended.");
  return { ref, event };
}

async function resolveEventPrice(event: EventData, ticketTypeId: string | undefined, uid: string | undefined) {
  let publicUnitPriceCents = Math.max(0, Math.round(event.price || 0));
  let finalUnitPriceCents = publicUnitPriceCents;
  let resolvedTicketTypeId: string | undefined;
  let ticketName = "Admission";

  if (event.ticketTypes?.length) {
    if (!ticketTypeId) throw new HttpsError("invalid-argument", "Choose a ticket type.");
    const ticket = event.ticketTypes.find((item) => item.id === ticketTypeId);
    if (!ticket) throw new HttpsError("not-found", "Ticket type not found.");
    publicUnitPriceCents = Math.max(0, Math.round(ticket.priceCents || 0));
    finalUnitPriceCents = publicUnitPriceCents;
    resolvedTicketTypeId = ticket.id;
    ticketName = ticket.name;

    if (ticket.targetAudience === "member" && !uid) {
      throw new HttpsError("unauthenticated", "This ticket is available to signed-in members only.");
    }

    if (uid && ticket.memberPricesCents) {
      const user = (await db().collection("users").doc(uid).get()).data();
      if (user?.membershipStatus === "active" && user?.plan) {
        const memberPrice = ticket.memberPricesCents[user.plan];
        if (typeof memberPrice === "number" && memberPrice >= 0) {
          finalUnitPriceCents = Math.round(memberPrice);
        }
      }
    }
  }

  return {
    ticketTypeId: resolvedTicketTypeId,
    ticketName,
    publicUnitPriceCents,
    finalUnitPriceCents,
    discountCents: Math.max(0, publicUnitPriceCents - finalUnitPriceCents),
  };
}

function confirmed(event: EventData) {
  return Math.max(0, Number(event.confirmedQuantity ?? event.registrationCount ?? 0));
}

function held(event: EventData) {
  return Math.max(0, Number(event.heldQuantity || 0));
}

async function createCapacityHold(input: {
  eventRef: FirebaseFirestore.DocumentReference;
  event: EventData;
  quantity: number;
  uid?: string;
  guest?: { name: string; email: string };
  ticketTypeId?: string;
  ticketName: string;
  publicUnitPriceCents: number;
  finalUnitPriceCents: number;
  discountCents: number;
  source: "web" | "member" | "staff_walkin" | "waitlist";
  waitlistEntryId?: string;
}) {
  const holdRef = db().collection("eventHolds").doc();
  const holdSecret = randomBytes(24).toString("hex");
  const now = Date.now();
  const expiresAt = now + EVENT_HOLD_MS;

  await db().runTransaction(async (tx) => {
    const latestSnap = await tx.get(input.eventRef);
    if (!latestSnap.exists) throw new HttpsError("not-found", "Event not found.");
    const latest = latestSnap.data() as EventData;
    if (latest.status !== "published" || latest.endTime <= now) {
      throw new HttpsError("failed-precondition", "This event is not accepting registrations.");
    }

    const currentConfirmed = confirmed(latest);
    const currentHeld = held(latest);
    if (typeof latest.seatCap === "number" && currentConfirmed + currentHeld + input.quantity > latest.seatCap) {
      throw new HttpsError("resource-exhausted", "This event does not have enough seats available.");
    }

    tx.set(holdRef, {
      id: holdRef.id,
      eventId: latest.id || input.eventRef.id,
      uid: input.uid || null,
      guest: input.guest || null,
      ticketTypeId: input.ticketTypeId || null,
      ticketName: input.ticketName,
      quantity: input.quantity,
      publicUnitPriceCents: input.publicUnitPriceCents,
      finalUnitPriceCents: input.finalUnitPriceCents,
      discountCents: input.discountCents,
      totalCents: input.finalUnitPriceCents * input.quantity,
      currency: latest.currency || "usd",
      source: input.source,
      waitlistEntryId: input.waitlistEntryId || null,
      status: "HELD",
      secretHash: hashSecret(holdSecret),
      createdAt: now,
      expiresAt,
    });
    tx.update(input.eventRef, {
      heldQuantity: currentHeld + input.quantity,
      confirmedQuantity: currentConfirmed,
      registrationCount: currentConfirmed,
      updatedAt: now,
    });
  });

  return { holdRef, holdSecret, expiresAt };
}

async function consumeHold(holdId: string, paymentId?: string) {
  const holdRef = db().collection("eventHolds").doc(holdId);
  let registrationId = "";

  await db().runTransaction(async (tx) => {
    const holdSnap = await tx.get(holdRef);
    if (!holdSnap.exists) throw new HttpsError("not-found", "Registration hold not found.");
    const hold = holdSnap.data() as Record<string, any>;
    if (hold.status === "CONSUMED" && hold.registrationId) {
      registrationId = String(hold.registrationId);
      return;
    }
    if (hold.status !== "HELD") throw new HttpsError("failed-precondition", "This registration hold is no longer active.");

    const eventRef = db().collection("events").doc(String(hold.eventId));
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
    const event = eventSnap.data() as EventData;
    const currentHeld = held(event);
    const currentConfirmed = confirmed(event);
    const quantity = safeQuantity(hold.quantity);

    // If the hold expired, allow recovery only if capacity is still available after releasing this hold.
    const expired = Number(hold.expiresAt || 0) <= Date.now();
    const effectiveOtherHeld = Math.max(0, currentHeld - quantity);
    if (expired && typeof event.seatCap === "number" && currentConfirmed + effectiveOtherHeld + quantity > event.seatCap) {
      throw new HttpsError("resource-exhausted", "Your checkout completed after the seat hold expired and the event is now full.");
    }

    registrationId = `ereg_${holdRef.id}`;
    const regRef = db().collection("eventRegistrations").doc(registrationId);
    const existing = await tx.get(regRef);
    if (!existing.exists) {
      const guest = hold.guest || {};
      const manageSecret = randomBytes(24).toString("hex");
      const registration: RegistrationData & { manageToken?: string } = {
        id: registrationId,
        eventId: String(hold.eventId),
        uid: hold.uid || undefined,
        displayName: String(guest.name || "Member"),
        email: normalizeEmail(guest.email),
        ticketTypeId: hold.ticketTypeId || undefined,
        quantity,
        publicUnitPriceCents: Number(hold.publicUnitPriceCents || 0),
        discountCents: Number(hold.discountCents || 0),
        finalUnitPriceCents: Number(hold.finalUnitPriceCents || 0),
        amountPaidCents: Number(hold.totalCents || 0),
        currency: String(hold.currency || "usd"),
        paymentId: paymentId || hold.paymentId || undefined,
        status: "CONFIRMED",
        attendanceStatus: "NOT_CHECKED_IN",
        checkedInQuantity: 0,
        manageSecretHash: hold.uid ? undefined : hashSecret(manageSecret),
        source: (hold.source || "web") as RegistrationData["source"],
        registeredAt: Date.now(),
      };
      tx.set(regRef, registration);
      if (!hold.uid) tx.update(holdRef, { manageToken: manageSecret });
    }

    tx.update(eventRef, {
      heldQuantity: Math.max(0, currentHeld - quantity),
      confirmedQuantity: currentConfirmed + quantity,
      registrationCount: currentConfirmed + quantity,
      updatedAt: Date.now(),
    });
    tx.update(holdRef, {
      status: "CONSUMED",
      registrationId,
      paymentId: paymentId || hold.paymentId || null,
      consumedAt: Date.now(),
    });

    if (hold.waitlistEntryId) {
      tx.set(db().collection("eventWaitlist").doc(String(hold.waitlistEntryId)), {
        status: "CLAIMED",
        claimedAt: Date.now(),
        registrationId,
      }, { merge: true });
    }
  });

  const finalHold = (await holdRef.get()).data() as Record<string, any> | undefined;
  return { registrationId, manageToken: finalHold?.manageToken as string | undefined };
}

export const events_beginRegistrationV2 = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    const { eventId, ticketTypeId, quantity: rawQuantity, guest, successUrl, cancelUrl } = request.data as any;
    if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
    const quantity = safeQuantity(rawQuantity);
    const uid = request.auth?.uid;
    const guestName = guest?.name?.trim();
    const guestEmail = normalizeEmail(guest?.email);
    if (!uid && (!guestName || !guestEmail)) throw new HttpsError("invalid-argument", "Name and email are required.");

    const { ref: eventRef, event } = await loadPublishedEvent(eventId);
    const price = await resolveEventPrice(event, ticketTypeId, uid);
    const hold = await createCapacityHold({
      eventRef,
      event,
      quantity,
      uid,
      guest: uid ? undefined : { name: guestName, email: guestEmail },
      ticketTypeId: price.ticketTypeId,
      ticketName: price.ticketName,
      publicUnitPriceCents: price.publicUnitPriceCents,
      finalUnitPriceCents: price.finalUnitPriceCents,
      discountCents: price.discountCents,
      source: uid ? "member" : "web",
    });

    if (price.finalUnitPriceCents === 0) {
      const consumed = await consumeHold(hold.holdRef.id);
      return { kind: "confirmed", ...consumed };
    }

    if (!successUrl || !cancelUrl) throw new HttpsError("invalid-argument", "Return URLs are required for paid registration.");
    const holdData = (await hold.holdRef.get()).data() as Record<string, any>;
    const paymentUid = uid || `guest:${hold.holdRef.id}`;
    const payment = await createPayment({
      uid: paymentUid,
      provider: "stripe",
      amount: Number(holdData.totalCents),
      currency: String(holdData.currency || "usd"),
      purpose: "event",
      purposeRefId: eventId,
      status: "pending",
      providerRefs: { eventId, holdId: hold.holdRef.id },
    });
    await hold.holdRef.update({ paymentId: payment.id });

    const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    const session = await provider.createCheckoutSession({
      uid: paymentUid,
      amount: Number(holdData.totalCents),
      currency: String(holdData.currency || "usd"),
      purpose: "event",
      purposeRefId: eventId,
      successUrl,
      cancelUrl,
      mode: "payment",
      lineItemLabel: `${price.ticketName} · ${event.title}`,
      metadata: {
        paymentId: payment.id,
        eventId,
        holdId: hold.holdRef.id,
        checkoutType: "event_v2_ticket",
        eventFlowVersion: "2",
        ...(guestEmail ? { email: guestEmail } : {}),
      },
    });
    await Promise.all([
      updatePaymentStatus(payment.id, "pending", { providerRefs: { eventId, holdId: hold.holdRef.id, stripeCheckoutSessionId: session.sessionId } }),
      hold.holdRef.update({ stripeCheckoutSessionId: session.sessionId }),
    ]);

    return { kind: "checkout", holdId: hold.holdRef.id, holdSecret: hold.holdSecret, expiresAt: hold.expiresAt, paymentId: payment.id, checkoutUrl: session.url };
  }
);

export const events_finalizeRegistrationV2 = onCall(async (request) => {
  const { holdId, holdSecret } = request.data as { holdId?: string; holdSecret?: string };
  if (!holdId) throw new HttpsError("invalid-argument", "holdId is required.");
  const holdRef = db().collection("eventHolds").doc(holdId);
  const snap = await holdRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Registration hold not found.");
  const hold = snap.data() as Record<string, any>;
  const authOwns = Boolean(request.auth?.uid && request.auth.uid === hold.uid);
  const secretMatches = Boolean(holdSecret && hold.secretHash === hashSecret(holdSecret));
  if (!authOwns && !secretMatches) throw new HttpsError("permission-denied", "This registration hold does not belong to you.");
  if (hold.status === "CONSUMED") return { status: "confirmed", registrationId: hold.registrationId, manageToken: hold.manageToken };
  if (!hold.paymentId) return { status: "pending" };
  const payment = await getPayment(String(hold.paymentId));
  if (!payment || payment.status === "pending") return { status: "pending" };
  if (payment.status !== "paid") return { status: payment.status };
  try {
    const consumed = await consumeHold(holdId, payment.id);
    return { status: "confirmed", ...consumed };
  } catch (error) {
    if (!(error instanceof HttpsError) || error.code !== "resource-exhausted") throw error;
    return { status: "capacity_conflict", refundRequired: true };
  }
});

export async function finalizeEventV2CheckoutFromWebhook(input: { holdId: string; paymentId?: string }) {
  return consumeHold(input.holdId, input.paymentId);
}

async function getRegistrationForCaller(request: any, registrationId: string, manageToken?: string) {
  const ref = db().collection("eventRegistrations").doc(registrationId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Registration not found.");
  const registration = snap.data() as RegistrationData;
  const role = request.auth?.token?.role as string | undefined;
  const staff = ["staff", "admin", "master"].includes(role || "");
  const owner = Boolean(request.auth?.uid && registration.uid === request.auth.uid);
  const guest = Boolean(manageToken && registration.manageSecretHash === hashSecret(manageToken));
  if (!staff && !owner && !guest) throw new HttpsError("permission-denied", "This registration does not belong to you.");
  return { ref, registration };
}

export const events_getCancellationQuoteV2 = onCall(async (request) => {
  const { registrationId, manageToken } = request.data as any;
  if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
  const { registration } = await getRegistrationForCaller(request, registrationId, manageToken);
  const event = (await db().collection("events").doc(registration.eventId).get()).data() as EventData | undefined;
  if (!event) throw new HttpsError("not-found", "Event not found.");
  return evaluateEventCancellation({ eventStartTime: event.startTime, amountPaidCents: registration.amountPaidCents, status: registration.status, eventCancelledByHi: event.status === "cancelled" });
});

async function promoteWaitlist(eventId: string) {
  const eventRef = db().collection("events").doc(eventId);
  const eventSnap = await eventRef.get();
  if (!eventSnap.exists) return null;
  const event = eventSnap.data() as EventData;
  const available = typeof event.seatCap === "number" ? event.seatCap - confirmed(event) - held(event) : Number.MAX_SAFE_INTEGER;
  if (available <= 0) return null;
  const waiting = await db().collection("eventWaitlist").where("eventId", "==", eventId).where("status", "==", "WAITING").orderBy("joinedAt", "asc").limit(25).get();
  const entryDoc = waiting.docs.find((doc) => Math.max(1, Number(doc.data().quantity || 1)) <= available);
  if (!entryDoc) return null;
  const entry = entryDoc.data() as Record<string, any>;
  const price = await resolveEventPrice(event, entry.ticketTypeId || undefined, entry.uid || undefined);
  const hold = await createCapacityHold({
    eventRef,
    event,
    quantity: safeQuantity(entry.quantity),
    uid: entry.uid || undefined,
    guest: entry.uid ? undefined : { name: entry.displayName, email: entry.email },
    ticketTypeId: price.ticketTypeId,
    ticketName: price.ticketName,
    publicUnitPriceCents: price.publicUnitPriceCents,
    finalUnitPriceCents: price.finalUnitPriceCents,
    discountCents: price.discountCents,
    source: "waitlist",
    waitlistEntryId: entryDoc.id,
  });
  await entryDoc.ref.set({ status: "OFFERED", offeredAt: Date.now(), offerHoldId: hold.holdRef.id, offerExpiresAt: Date.now() + EVENT_WAITLIST_CLAIM_MS }, { merge: true });
  await hold.holdRef.update({ expiresAt: Date.now() + EVENT_WAITLIST_CLAIM_MS });
  return { waitlistEntryId: entryDoc.id, holdId: hold.holdRef.id };
}

export const events_cancelRegistrationV2 = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    const { registrationId, manageToken } = request.data as any;
    if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
    const { ref, registration } = await getRegistrationForCaller(request, registrationId, manageToken);
    const eventRef = db().collection("events").doc(registration.eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
    const event = eventSnap.data() as EventData;
    const decision = evaluateEventCancellation({ eventStartTime: event.startTime, amountPaidCents: registration.amountPaidCents, status: registration.status, eventCancelledByHi: event.status === "cancelled" });
    if (!decision.canCancel) throw new HttpsError("failed-precondition", decision.policyMessage);

    await db().runTransaction(async (tx) => {
      const [regSnap, latestEventSnap] = await Promise.all([tx.get(ref), tx.get(eventRef)]);
      if (!regSnap.exists || !latestEventSnap.exists) throw new HttpsError("not-found", "Registration or event not found.");
      const latestReg = regSnap.data() as RegistrationData;
      if (!["CONFIRMED", "active"].includes(latestReg.status)) return;
      const latestEvent = latestEventSnap.data() as EventData;
      const nextConfirmed = Math.max(0, confirmed(latestEvent) - latestReg.quantity);
      tx.update(eventRef, { confirmedQuantity: nextConfirmed, registrationCount: nextConfirmed, updatedAt: Date.now() });
      tx.update(ref, { status: decision.refundEligible ? "REFUND_PENDING" : "CANCELLED", cancelledAt: Date.now(), updatedAt: Date.now() });
    });

    if (decision.refundEligible && registration.paymentId) {
      const payment = await getPayment(registration.paymentId);
      if (!payment) throw new HttpsError("failed-precondition", "Payment record is unavailable for this refund.");
      try {
        const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
        const refund = await provider.refundCheckoutPayment({
          checkoutSessionId: payment.providerRefs?.stripeCheckoutSessionId,
          ledgerPaymentId: payment.id,
          amountCents: decision.refundCents,
          idempotencyKey: `event_cancel_${registration.id}`,
          metadata: { eventId: registration.eventId, registrationId: registration.id },
        });
        await Promise.all([
          updatePaymentStatus(payment.id, "refunded", { providerRefs: { ...payment.providerRefs, stripeRefundId: refund.refundId } }),
          ref.update({ status: "REFUNDED", refundedAt: Date.now(), stripeRefundId: refund.refundId, updatedAt: Date.now() }),
        ]);
      } catch (error) {
        logger.error("Event refund failed; registration remains REFUND_PENDING", { registrationId, error });
      }
    }

    await promoteWaitlist(registration.eventId);
    const latest = (await ref.get()).data();
    return { success: true, status: latest?.status, refundCents: decision.refundCents, policyMessage: decision.policyMessage };
  }
);

export const events_joinWaitlistV2 = onCall(async (request) => {
  const { eventId, ticketTypeId, quantity: rawQuantity, guest } = request.data as any;
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  const quantity = safeQuantity(rawQuantity);
  const uid = request.auth?.uid;
  const name = uid ? String(request.auth?.token?.name || request.auth?.token?.email || "Member") : guest?.name?.trim();
  const email = uid ? normalizeEmail(request.auth?.token?.email as string | undefined) : normalizeEmail(guest?.email);
  if (!name || !email) throw new HttpsError("invalid-argument", "Name and email are required.");
  const { event } = await loadPublishedEvent(eventId);
  const available = typeof event.seatCap === "number" ? event.seatCap - confirmed(event) - held(event) : Number.MAX_SAFE_INTEGER;
  if (available >= quantity) throw new HttpsError("failed-precondition", "Seats are currently available; register instead.");
  const secret = randomBytes(24).toString("hex");
  const ref = db().collection("eventWaitlist").doc();
  await ref.set({ id: ref.id, eventId, uid: uid || null, displayName: name, email, ticketTypeId: ticketTypeId || null, quantity, status: "WAITING", manageSecretHash: uid ? null : hashSecret(secret), joinedAt: Date.now() });
  return { success: true, waitlistEntryId: ref.id, manageToken: uid ? undefined : secret };
});

export const events_expireRegistrationHolds = onSchedule({ schedule: "*/5 * * * *", timeZone: "America/New_York" }, async () => {
  const snap = await db().collection("eventHolds").where("status", "==", "HELD").where("expiresAt", "<=", Date.now()).limit(100).get();
  const affected = new Set<string>();
  for (const doc of snap.docs) {
    try {
      await db().runTransaction(async (tx) => {
        const latest = await tx.get(doc.ref);
        if (!latest.exists || latest.data()?.status !== "HELD" || Number(latest.data()?.expiresAt || 0) > Date.now()) return;
        const hold = latest.data() as Record<string, any>;
        const eventRef = db().collection("events").doc(String(hold.eventId));
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) return;
        const event = eventSnap.data() as EventData;
        tx.update(eventRef, { heldQuantity: Math.max(0, held(event) - safeQuantity(hold.quantity)), updatedAt: Date.now() });
        tx.update(doc.ref, { status: "EXPIRED", expiredAt: Date.now() });
        if (hold.waitlistEntryId) tx.set(db().collection("eventWaitlist").doc(String(hold.waitlistEntryId)), { status: "EXPIRED", expiredAt: Date.now() }, { merge: true });
        affected.add(String(hold.eventId));
      });
    } catch (error) {
      logger.error("Failed to expire event hold", { holdId: doc.id, error });
    }
  }
  for (const eventId of affected) await promoteWaitlist(eventId);
});

export const events_staffGetRosterV2 = onCall(async (request) => {
  requireStaff(request.auth);
  const { eventId } = request.data as { eventId?: string };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  const regs = await db().collection("eventRegistrations").where("eventId", "==", eventId).orderBy("registeredAt", "asc").get();
  return { registrations: regs.docs.map((doc) => doc.data()) };
});

export const events_staffCheckInV2 = onCall(async (request) => {
  requireStaff(request.auth);
  const { registrationId, quantity: rawQuantity } = request.data as any;
  if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
  const ref = db().collection("eventRegistrations").doc(registrationId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Registration not found.");
  const reg = snap.data() as RegistrationData;
  if (reg.status !== "CONFIRMED") throw new HttpsError("failed-precondition", "Only confirmed registrations can check in.");
  const quantity = Math.min(reg.quantity, Math.max(1, Math.floor(Number(rawQuantity) || reg.quantity)));
  await ref.update({ checkedInQuantity: quantity, attendanceStatus: quantity > 0 ? "CHECKED_IN" : "NOT_CHECKED_IN", checkedInAt: quantity > 0 ? Date.now() : null, updatedAt: Date.now() });
  return { success: true, checkedInQuantity: quantity };
});

export const events_adminCompleteV2 = onCall(async (request) => {
  requireAdmin(request.auth);
  const { eventId } = request.data as { eventId?: string };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  const regs = await db().collection("eventRegistrations").where("eventId", "==", eventId).where("status", "==", "CONFIRMED").get();
  const batch = db().batch();
  for (const doc of regs.docs) {
    if (Number(doc.data().checkedInQuantity || 0) === 0) batch.update(doc.ref, { attendanceStatus: "NO_SHOW", updatedAt: Date.now() });
  }
  batch.update(db().collection("events").doc(eventId), { status: "completed", completedAt: Date.now(), updatedAt: Date.now() });
  await batch.commit();
  return { success: true, registrationsReviewed: regs.size };
});
