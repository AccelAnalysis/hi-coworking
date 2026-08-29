import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { createPayment, getPayment, updatePaymentStatus } from "../payments/ledger";
import { StripeProvider } from "../payments/stripeProvider";
import {
  availableSeats,
  db,
  hashSecret,
  positiveInt,
  publicEvent,
  randomSecret,
  registrationFromHold,
  releaseTicketHold,
  requirePublished,
  reserveTicketInventory,
  resolveIdentity,
  resolvePricing,
  sellTicketInventory,
} from "./core";
import { enqueueNotification, enqueueRegistrationNotifications } from "./notifications";
import {
  DEFAULT_MAX_TICKETS,
  EVENT_FLOW_VERSION,
  HOLD_MS,
  PUBLIC_SITE_URL,
  WAITLIST_CLAIM_MS,
  type EventDocV2,
  type EventHoldV2,
  type EventIdentityV2,
  type RegistrationDocV2,
  type WaitlistEntryV2,
} from "./types";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

type HoldCreateInput = {
  eventId: string;
  identity: EventIdentityV2;
  ticketTypeId?: string;
  quantity: number;
  source: EventHoldV2["source"];
  expiresAt?: number;
  waitlistEntryId?: string;
  secret?: string;
};

type ConsumeResult =
  | { kind: "confirmed"; registration: RegistrationDocV2; event: EventDocV2; created: boolean; manageToken?: string }
  | { kind: "capacity_conflict"; eventId: string };

async function createHoldForIdentity(input: HoldCreateInput) {
  const holdRef = db().collection("eventHolds").doc();
  const secret = input.secret || randomSecret();
  const manageSecret = randomSecret();

  const hold = await db().runTransaction(async (tx): Promise<EventHoldV2> => {
    const eventRef = db().collection("events").doc(input.eventId);
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
    const event = eventSnap.data() as EventDocV2;
    requirePublished(event);
    if (availableSeats(event) < input.quantity) {
      throw new HttpsError("resource-exhausted", "This event does not have enough seats available.");
    }
    const pricing = resolvePricing(event, input.ticketTypeId, input.identity.member, input.quantity);
    const now = Date.now();
    const nextTickets = reserveTicketInventory(event, pricing.ticketTypeId, input.quantity);
    const nextHold: EventHoldV2 = {
      id: holdRef.id,
      eventId: event.id,
      uid: input.identity.uid,
      guestName: input.identity.displayName,
      guestEmail: input.identity.email,
      ticketTypeId: pricing.ticketTypeId,
      ticketTypeName: pricing.ticketTypeName,
      quantity: input.quantity,
      publicUnitPriceCents: pricing.publicUnitPriceCents,
      discountCents: pricing.discountCents,
      finalUnitPriceCents: pricing.finalUnitPriceCents,
      totalCents: pricing.totalCents,
      currency: pricing.currency,
      status: "HELD",
      source: input.source,
      secretHash: hashSecret(secret),
      manageSecret,
      createdAt: now,
      expiresAt: input.expiresAt || now + HOLD_MS,
      waitlistEntryId: input.waitlistEntryId,
    };
    tx.set(holdRef, nextHold);
    tx.update(eventRef, {
      heldQuantity: Math.max(0, event.heldQuantity || 0) + input.quantity,
      ticketTypes: nextTickets,
      updatedAt: now,
    });
    return nextHold;
  });

  return { hold, secret };
}

async function createCheckoutForHold(hold: EventHoldV2, successUrl: string, cancelUrl: string) {
  if (hold.totalCents <= 0) {
    throw new HttpsError("failed-precondition", "This registration does not require payment.");
  }
  if (hold.paymentId && hold.checkoutUrl) {
    return {
      paymentId: hold.paymentId,
      checkoutUrl: hold.checkoutUrl,
      sessionId: hold.stripeCheckoutSessionId || "",
    };
  }

  const ledgerUid = hold.uid || `guest:${hold.id}`;
  const payment = await createPayment({
    uid: ledgerUid,
    provider: "stripe",
    amount: hold.totalCents,
    currency: hold.currency,
    purpose: "event",
    purposeRefId: hold.eventId,
    status: "pending",
    providerRefs: {
      eventFlowVersion: EVENT_FLOW_VERSION,
      holdId: hold.id,
      eventId: hold.eventId,
    },
  });
  await db().collection("eventHolds").doc(hold.id).update({ paymentId: payment.id });

  try {
    const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    // The payment ledger carries purpose=event. Stripe metadata uses purpose=other so
    // the pre-v2 event webhook finalizer cannot also create a legacy registration.
    const session = await provider.createCheckoutSession({
      uid: ledgerUid,
      amount: hold.totalCents,
      currency: hold.currency,
      purpose: "other",
      purposeRefId: hold.id,
      successUrl,
      cancelUrl,
      mode: "payment",
      lineItemLabel: hold.ticketTypeName || "Hi Coworking event registration",
      metadata: {
        paymentId: payment.id,
        holdId: hold.id,
        eventFlowVersion: EVENT_FLOW_VERSION,
        email: hold.guestEmail,
      },
    });
    await Promise.all([
      updatePaymentStatus(payment.id, "pending", {
        providerRefs: {
          eventFlowVersion: EVENT_FLOW_VERSION,
          holdId: hold.id,
          eventId: hold.eventId,
          stripeCheckoutSessionId: session.sessionId,
        },
      }),
      db().collection("eventHolds").doc(hold.id).update({
        stripeCheckoutSessionId: session.sessionId,
        checkoutUrl: session.url,
      }),
    ]);
    return { paymentId: payment.id, checkoutUrl: session.url, sessionId: session.sessionId };
  } catch (error) {
    await updatePaymentStatus(payment.id, "failed").catch(() => undefined);
    await releaseHold(hold.id, "CANCELLED").catch(() => undefined);
    throw error;
  }
}

async function createFreeRegistration(input: {
  eventId: string;
  identity: EventIdentityV2;
  ticketTypeId?: string;
  quantity: number;
  source: RegistrationDocV2["source"];
}) {
  const registrationRef = db().collection("eventRegistrations").doc();
  const manageSecret = randomSecret();

  const result = await db().runTransaction(async (tx): Promise<{ registration: RegistrationDocV2; event: EventDocV2 }> => {
    const eventRef = db().collection("events").doc(input.eventId);
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
    const event = eventSnap.data() as EventDocV2;
    requirePublished(event);
    if (availableSeats(event) < input.quantity) {
      throw new HttpsError("resource-exhausted", "This event is full.");
    }
    const pricing = resolvePricing(event, input.ticketTypeId, input.identity.member, input.quantity);
    if (pricing.totalCents > 0) {
      throw new HttpsError("failed-precondition", "This registration requires payment.");
    }
    const nextConfirmed = Math.max(0, event.confirmedQuantity ?? event.registrationCount ?? 0) + input.quantity;
    const registration: RegistrationDocV2 = {
      id: registrationRef.id,
      eventId: event.id,
      uid: input.identity.uid,
      displayName: input.identity.displayName,
      email: input.identity.email,
      ticketTypeId: pricing.ticketTypeId,
      ticketTypeName: pricing.ticketTypeName,
      quantity: input.quantity,
      publicUnitPriceCents: pricing.publicUnitPriceCents,
      discountCents: pricing.discountCents,
      finalUnitPriceCents: pricing.finalUnitPriceCents,
      amountPaidCents: 0,
      currency: pricing.currency,
      status: "CONFIRMED",
      attendanceStatus: "NOT_CHECKED_IN",
      checkedInQuantity: 0,
      source: input.source,
      manageSecretHash: hashSecret(manageSecret),
      registeredAt: Date.now(),
    };
    const nextTickets = sellTicketInventory(event, pricing.ticketTypeId, input.quantity, false);
    tx.set(registrationRef, registration);
    tx.update(eventRef, {
      confirmedQuantity: nextConfirmed,
      registrationCount: nextConfirmed,
      ticketTypes: nextTickets,
      updatedAt: Date.now(),
    });
    return {
      registration,
      event: { ...event, confirmedQuantity: nextConfirmed, registrationCount: nextConfirmed, ticketTypes: nextTickets },
    };
  });

  await enqueueRegistrationNotifications(result.registration, result.event, manageSecret);
  return { registration: result.registration, manageSecret };
}

async function consumeHold(holdId: string, paymentId?: string): Promise<ConsumeResult> {
  const holdRef = db().collection("eventHolds").doc(holdId);
  const registrationRef = db().collection("eventRegistrations").doc(`reg_${holdId}`);

  const result = await db().runTransaction(async (tx): Promise<ConsumeResult> => {
    const holdSnap = await tx.get(holdRef);
    if (!holdSnap.exists) throw new HttpsError("not-found", "Event registration hold not found.");
    const hold = holdSnap.data() as EventHoldV2;
    const eventRef = db().collection("events").doc(hold.eventId);
    const [eventSnap, registrationSnap] = await Promise.all([tx.get(eventRef), tx.get(registrationRef)]);
    if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
    const event = eventSnap.data() as EventDocV2;

    if (registrationSnap.exists) {
      return {
        kind: "confirmed",
        registration: registrationSnap.data() as RegistrationDocV2,
        event,
        created: false,
      };
    }
    if (hold.status === "CANCELLED") {
      throw new HttpsError("failed-precondition", "This registration hold was cancelled.");
    }
    if (hold.status !== "HELD" && hold.status !== "EXPIRED") {
      throw new HttpsError("failed-precondition", "This registration hold is no longer available.");
    }

    const fromHold = hold.status === "HELD";
    let nextTickets;
    try {
      if (!fromHold && availableSeats(event) < hold.quantity) {
        throw new HttpsError("resource-exhausted", "capacity-conflict");
      }
      nextTickets = sellTicketInventory(event, hold.ticketTypeId, hold.quantity, fromHold);
    } catch (error) {
      const capacityConflict = error instanceof HttpsError && error.code === "resource-exhausted";
      if (!capacityConflict) throw error;
      const refundPaymentId = paymentId || hold.paymentId;
      if (!refundPaymentId) throw new HttpsError("internal", "Paid capacity conflict has no payment record.");
      const refundRef = db().collection("eventRefundJobs").doc(`capacity_${refundPaymentId}`);
      tx.set(refundRef, {
        id: refundRef.id,
        eventId: event.id,
        registrationId: null,
        holdId: hold.id,
        paymentId: refundPaymentId,
        amountCents: hold.totalCents,
        reason: "capacity_conflict_after_payment",
        status: "pending",
        attempts: 0,
        nextAttemptAt: Date.now(),
        createdAt: Date.now(),
      }, { merge: true });
      tx.update(holdRef, { status: "CANCELLED", cancelledAt: Date.now() });
      return { kind: "capacity_conflict", eventId: event.id };
    }

    const currentConfirmed = Math.max(0, event.confirmedQuantity ?? event.registrationCount ?? 0);
    const currentHeld = Math.max(0, event.heldQuantity || 0);
    const nextConfirmed = currentConfirmed + hold.quantity;
    const nextHeld = fromHold ? Math.max(0, currentHeld - hold.quantity) : currentHeld;
    const registration = registrationFromHold(hold, registrationRef.id, paymentId || hold.paymentId);
    tx.set(registrationRef, registration);
    tx.update(eventRef, {
      confirmedQuantity: nextConfirmed,
      registrationCount: nextConfirmed,
      heldQuantity: nextHeld,
      ticketTypes: nextTickets,
      updatedAt: Date.now(),
    });
    tx.update(holdRef, {
      status: "CONSUMED",
      consumedAt: Date.now(),
      registrationId: registrationRef.id,
    });
    if (hold.waitlistEntryId) {
      tx.set(db().collection("eventWaitlist").doc(hold.waitlistEntryId), {
        status: "CLAIMED",
        claimedAt: Date.now(),
        updatedAt: Date.now(),
      }, { merge: true });
    }
    return {
      kind: "confirmed",
      registration,
      event: {
        ...event,
        confirmedQuantity: nextConfirmed,
        registrationCount: nextConfirmed,
        heldQuantity: nextHeld,
        ticketTypes: nextTickets,
      },
      created: true,
      manageToken: hold.manageSecret,
    };
  });

  if (result.kind === "capacity_conflict") {
    throw new HttpsError(
      "resource-exhausted",
      "The event filled while payment completed. A full refund has been queued automatically.",
    );
  }
  if (result.created) {
    await enqueueRegistrationNotifications(result.registration, result.event, result.manageToken);
  }
  return result;
}

export async function releaseHold(holdId: string, nextStatus: "EXPIRED" | "CANCELLED") {
  const holdRef = db().collection("eventHolds").doc(holdId);
  const eventId = await db().runTransaction(async (tx): Promise<string | null> => {
    const holdSnap = await tx.get(holdRef);
    if (!holdSnap.exists) return null;
    const hold = holdSnap.data() as EventHoldV2;
    if (hold.status !== "HELD") return hold.eventId;
    const eventRef = db().collection("events").doc(hold.eventId);
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists) return hold.eventId;
    const event = eventSnap.data() as EventDocV2;
    tx.update(eventRef, {
      heldQuantity: Math.max(0, (event.heldQuantity || 0) - hold.quantity),
      ticketTypes: releaseTicketHold(event, hold.ticketTypeId, hold.quantity),
      updatedAt: Date.now(),
    });
    tx.update(holdRef, {
      status: nextStatus,
      [`${nextStatus.toLowerCase()}At`]: Date.now(),
    });
    if (hold.waitlistEntryId) {
      tx.set(db().collection("eventWaitlist").doc(hold.waitlistEntryId), {
        status: nextStatus === "EXPIRED" ? "EXPIRED" : "REMOVED",
        updatedAt: Date.now(),
      }, { merge: true });
    }
    return hold.eventId;
  });
  if (eventId) await promoteWaitlist(eventId);
}

async function finalizePaidPayment(paymentId: string) {
  const payment = await getPayment(paymentId);
  if (!payment || payment.status !== "paid") return null;
  if (payment.purpose !== "event" || payment.providerRefs?.eventFlowVersion !== EVENT_FLOW_VERSION) return null;
  const holdId = payment.providerRefs?.holdId;
  if (!holdId) return null;
  return consumeHold(holdId, payment.id);
}

export const events_v2BeginRegistration = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    const { eventId, ticketTypeId, quantity: rawQuantity, guest, successUrl, cancelUrl } = request.data as {
      eventId?: string;
      ticketTypeId?: string;
      quantity?: number;
      guest?: { name?: string; email?: string };
      successUrl?: string;
      cancelUrl?: string;
    };
    if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
    const quantity = positiveInt(rawQuantity, 1);
    if (quantity > DEFAULT_MAX_TICKETS) {
      throw new HttpsError("invalid-argument", `A single registration is limited to ${DEFAULT_MAX_TICKETS} tickets.`);
    }
    const identity = await resolveIdentity(request, guest);
    const eventSnap = await db().collection("events").doc(eventId).get();
    if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
    const event = eventSnap.data() as EventDocV2;
    requirePublished(event);
    if (availableSeats(event) < quantity) return { kind: "full", waitlistAvailable: true };
    const pricing = resolvePricing(event, ticketTypeId, identity.member, quantity);
    if (pricing.totalCents === 0) {
      const result = await createFreeRegistration({
        eventId,
        identity,
        ticketTypeId,
        quantity,
        source: identity.uid ? "member" : "web",
      });
      return { kind: "confirmed", registrationId: result.registration.id };
    }
    if (!successUrl || !cancelUrl) {
      throw new HttpsError("invalid-argument", "Checkout return URLs are required for paid registration.");
    }
    const { hold, secret } = await createHoldForIdentity({
      eventId,
      identity,
      ticketTypeId,
      quantity,
      source: identity.uid ? "member" : "web",
    });
    const checkout = await createCheckoutForHold(hold, successUrl, cancelUrl);
    return {
      kind: "checkout",
      holdId: hold.id,
      holdSecret: secret,
      expiresAt: hold.expiresAt,
      paymentId: checkout.paymentId,
      checkoutUrl: checkout.checkoutUrl,
    };
  },
);

export const events_v2FinalizeRegistration = onCall(async (request) => {
  const { holdId, holdSecret } = request.data as { holdId?: string; holdSecret?: string };
  if (!holdId) throw new HttpsError("invalid-argument", "holdId is required.");
  const holdSnap = await db().collection("eventHolds").doc(holdId).get();
  if (!holdSnap.exists) throw new HttpsError("not-found", "Registration hold not found.");
  const hold = holdSnap.data() as EventHoldV2;
  const authOwns = Boolean(request.auth?.uid && request.auth.uid === hold.uid);
  const secretMatches = Boolean(holdSecret && hashSecret(holdSecret) === hold.secretHash);
  if (!authOwns && !secretMatches) {
    throw new HttpsError("permission-denied", "This registration hold does not belong to you.");
  }
  if (hold.status === "CONSUMED" && hold.registrationId) {
    return { status: "confirmed", registrationId: hold.registrationId };
  }
  if (!hold.paymentId) return { status: "pending" };
  const payment = await getPayment(hold.paymentId);
  if (!payment) return { status: "pending" };
  if (payment.status === "failed") return { status: "failed" };
  if (payment.status !== "paid") return { status: "pending" };
  const result = await finalizePaidPayment(payment.id);
  return {
    status: "confirmed",
    registrationId: result?.kind === "confirmed" ? result.registration.id : hold.registrationId,
  };
});

export const events_v2OnPaymentUpdated = onDocumentUpdated("payments/{paymentId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after || before?.status === "paid" || after.status !== "paid") return;
  if (after.purpose !== "event" || after.providerRefs?.eventFlowVersion !== EVENT_FLOW_VERSION) return;
  try {
    await finalizePaidPayment(event.params.paymentId);
  } catch (error) {
    logger.error("Events v2 payment finalization failed", {
      paymentId: event.params.paymentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export const events_v2ListPublicEvents = onCall(async (request) => {
  const scope = String((request.data as { scope?: string } | undefined)?.scope || "upcoming");
  const descending = scope === "past";
  const snap = await db().collection("events")
    .orderBy("startTime", descending ? "desc" : "asc")
    .limit(250)
    .get();
  const now = Date.now();
  const rows = snap.docs
    .map((doc) => doc.data() as EventDocV2)
    .filter((event) => {
      if (scope === "past") {
        return (event.status === "published" || event.status === "completed") && event.endTime < now;
      }
      return event.status === "published" && event.endTime >= now;
    })
    .map(publicEvent);
  return { events: rows };
});

export const events_v2GetPublicEvent = onCall(async (request) => {
  const identifier = String((request.data as { identifier?: string } | undefined)?.identifier || "").trim();
  if (!identifier) throw new HttpsError("invalid-argument", "Event identifier is required.");
  const direct = await db().collection("events").doc(identifier).get();
  let event: EventDocV2 | null = direct.exists ? direct.data() as EventDocV2 : null;
  if (!event) {
    const bySlug = await db().collection("events").where("slug", "==", identifier).limit(1).get();
    event = bySlug.empty ? null : bySlug.docs[0].data() as EventDocV2;
  }
  if (!event || (event.status !== "published" && event.status !== "completed")) {
    throw new HttpsError("not-found", "Event not found.");
  }
  return { event: publicEvent(event) };
});

function waitlistDocId(eventId: string, identity: EventIdentityV2) {
  const key = identity.uid || identity.email;
  return `wl_${hashSecret(`${eventId}:${key}`).slice(0, 28)}`;
}

export const events_v2JoinWaitlist = onCall(async (request) => {
  const { eventId, ticketTypeId, quantity: rawQuantity, guest } = request.data as {
    eventId?: string;
    ticketTypeId?: string;
    quantity?: number;
    guest?: { name?: string; email?: string };
  };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  const quantity = positiveInt(rawQuantity, 1);
  if (quantity > DEFAULT_MAX_TICKETS) throw new HttpsError("invalid-argument", "Requested ticket quantity is too large.");
  const identity = await resolveIdentity(request, guest);
  const eventSnap = await db().collection("events").doc(eventId).get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const event = eventSnap.data() as EventDocV2;
  requirePublished(event);
  resolvePricing(event, ticketTypeId, identity.member, quantity);
  if (availableSeats(event) >= quantity) {
    throw new HttpsError("failed-precondition", "Seats are still available. Register for the event instead.");
  }
  const id = waitlistDocId(eventId, identity);
  const ref = db().collection("eventWaitlist").doc(id);
  const existing = await ref.get();
  if (existing.exists && ["WAITING", "OFFERED"].includes(String(existing.data()?.status))) {
    return { success: true, entryId: id, alreadyJoined: true };
  }
  const manageSecret = randomSecret();
  const entry: WaitlistEntryV2 = {
    id,
    eventId,
    uid: identity.uid,
    displayName: identity.displayName,
    email: identity.email,
    ticketTypeId,
    quantity,
    joinedAt: Date.now(),
    status: "WAITING",
    manageSecretHash: hashSecret(manageSecret),
  };
  await ref.set(entry);
  await enqueueNotification({
    id: `waitlist_joined_${id}`,
    type: "WAITLIST_JOINED",
    eventId,
    waitlistEntryId: id,
    email: identity.email,
    displayName: identity.displayName,
    manageToken: manageSecret,
  });
  return { success: true, entryId: id, alreadyJoined: false };
});

export async function promoteWaitlist(eventId: string) {
  const waitingSnap = await db().collection("eventWaitlist")
    .where("eventId", "==", eventId)
    .where("status", "==", "WAITING")
    .orderBy("joinedAt", "asc")
    .limit(20)
    .get();
  if (waitingSnap.empty) return;

  for (const doc of waitingSnap.docs) {
    const entry = doc.data() as WaitlistEntryV2;
    const eventSnap = await db().collection("events").doc(eventId).get();
    if (!eventSnap.exists) return;
    const event = eventSnap.data() as EventDocV2;
    if (event.status !== "published" || availableSeats(event) < entry.quantity) continue;
    let member = false;
    if (entry.uid) {
      const user = (await db().collection("users").doc(entry.uid).get()).data();
      member = user?.membershipStatus === "active" && Boolean(user?.plan);
    }
    const identity: EventIdentityV2 = {
      uid: entry.uid,
      displayName: entry.displayName,
      email: entry.email,
      member,
    };
    const claimSecret = randomSecret();
    try {
      const { hold } = await createHoldForIdentity({
        eventId,
        identity,
        ticketTypeId: entry.ticketTypeId,
        quantity: entry.quantity,
        source: "waitlist",
        expiresAt: Date.now() + WAITLIST_CLAIM_MS,
        waitlistEntryId: entry.id,
        secret: claimSecret,
      });
      await db().collection("eventWaitlist").doc(entry.id).set({
        status: "OFFERED",
        offerHoldId: hold.id,
        offerExpiresAt: hold.expiresAt,
        updatedAt: Date.now(),
      }, { merge: true });
      const actionUrl = `${PUBLIC_SITE_URL}/events/waitlist?entry=${encodeURIComponent(entry.id)}#token=${claimSecret}`;
      await enqueueNotification({
        id: `waitlist_offer_${entry.id}_${hold.id}`,
        type: "WAITLIST_OFFER",
        eventId,
        waitlistEntryId: entry.id,
        email: entry.email,
        displayName: entry.displayName,
        actionUrl,
      });
    } catch (error) {
      logger.warn("Could not promote waitlist entry", {
        eventId,
        entryId: entry.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const events_v2ClaimWaitlistOffer = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    const { entryId, token, successUrl, cancelUrl } = request.data as {
      entryId?: string;
      token?: string;
      successUrl?: string;
      cancelUrl?: string;
    };
    if (!entryId || !token) throw new HttpsError("invalid-argument", "Waitlist offer and token are required.");
    const entrySnap = await db().collection("eventWaitlist").doc(entryId).get();
    if (!entrySnap.exists) throw new HttpsError("not-found", "Waitlist entry not found.");
    const entry = entrySnap.data() as WaitlistEntryV2;
    if (entry.status !== "OFFERED" || !entry.offerHoldId) {
      throw new HttpsError("failed-precondition", "This waitlist offer is no longer active.");
    }
    const holdSnap = await db().collection("eventHolds").doc(entry.offerHoldId).get();
    if (!holdSnap.exists) throw new HttpsError("not-found", "Waitlist hold not found.");
    const hold = holdSnap.data() as EventHoldV2;
    if (hold.status !== "HELD" || hold.expiresAt <= Date.now()) {
      throw new HttpsError("deadline-exceeded", "This waitlist offer has expired.");
    }
    if (hashSecret(token) !== hold.secretHash) throw new HttpsError("permission-denied", "Invalid waitlist claim token.");
    if (hold.totalCents === 0) {
      const result = await consumeHold(hold.id);
      if (result.kind !== "confirmed") throw new HttpsError("internal", "Waitlist claim did not complete.");
      return { kind: "confirmed", registrationId: result.registration.id };
    }
    if (!successUrl || !cancelUrl) throw new HttpsError("invalid-argument", "Checkout return URLs are required.");
    const checkout = await createCheckoutForHold(hold, successUrl, cancelUrl);
    return {
      kind: "checkout",
      holdId: hold.id,
      holdSecret: token,
      expiresAt: hold.expiresAt,
      paymentId: checkout.paymentId,
      checkoutUrl: checkout.checkoutUrl,
    };
  },
);

export const events_v2LeaveWaitlist = onCall(async (request) => {
  const { entryId, manageToken } = request.data as { entryId?: string; manageToken?: string };
  if (!entryId) throw new HttpsError("invalid-argument", "entryId is required.");
  const ref = db().collection("eventWaitlist").doc(entryId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Waitlist entry not found.");
  const entry = snap.data() as WaitlistEntryV2;
  const authOwns = Boolean(request.auth?.uid && request.auth.uid === entry.uid);
  const tokenMatches = Boolean(manageToken && hashSecret(manageToken) === entry.manageSecretHash);
  if (!authOwns && !tokenMatches) throw new HttpsError("permission-denied", "This waitlist entry does not belong to you.");
  await ref.set({ status: "REMOVED", updatedAt: Date.now() }, { merge: true });
  if (entry.offerHoldId) await releaseHold(entry.offerHoldId, "CANCELLED");
  return { success: true };
});

export const events_v2ExpireHolds = onSchedule(
  { schedule: "*/5 * * * *", timeZone: "America/New_York" },
  async () => {
    const snap = await db().collection("eventHolds")
      .where("status", "==", "HELD")
      .where("expiresAt", "<=", Date.now())
      .limit(50)
      .get();
    for (const doc of snap.docs) await releaseHold(doc.id, "EXPIRED");
    logger.info("Expired event registration holds processed", { count: snap.size });
  },
);
