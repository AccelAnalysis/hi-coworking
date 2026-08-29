import { createHash, randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { FieldValue } from "firebase-admin/firestore";
import { createPayment, getPayment, updatePaymentStatus } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";
import { SendGridProvider } from "./providers/emailProvider";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const sendgridApiKey = defineSecret("SENDGRID_API_KEY");

const EVENT_FLOW_VERSION = "2";
const HOLD_MS = 15 * 60 * 1000;
const WAITLIST_CLAIM_MS = 30 * 60 * 1000;
const DEFAULT_REFUND_CUTOFF_HOURS = 24;
const DEFAULT_MAX_TICKETS = 8;
const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || "https://hi-coworking.com";
const FROM_EMAIL = "events@hi-coworking.com";

interface EventTicketTypeLite {
  id: string;
  name: string;
  priceCents: number;
  quantity?: number;
  soldCount?: number;
  description?: string;
  targetAudience?: "public" | "member" | "vip";
}

interface EventDocV2 {
  id: string;
  slug?: string;
  title: string;
  description: string;
  format: "in-person" | "virtual" | "hybrid";
  location?: string;
  virtualUrl?: string;
  startTime: number;
  endTime: number;
  timezone?: string;
  seatCap?: number;
  registrationCount?: number;
  confirmedQuantity?: number;
  heldQuantity?: number;
  price?: number;
  memberPriceCents?: number;
  currency?: string;
  ticketTypes?: EventTicketTypeLite[];
  heroImage?: Record<string, unknown>;
  gallery?: Array<Record<string, unknown>>;
  recordingUrl?: string;
  status: "draft" | "published" | "cancelled" | "completed";
  registrationOpenAt?: number;
  registrationCloseAt?: number;
  refundCutoffHours?: number;
  reminders?: {
    confirmation?: boolean;
    reminder24h?: boolean;
    reminder1h?: boolean;
    followUp?: boolean;
  };
  createdBy?: string;
  createdAt?: number;
  updatedAt?: number;
  publishedAt?: number;
}

type RegistrationStatus = "CONFIRMED" | "CANCELLED" | "REFUND_PENDING" | "REFUNDED";
type AttendanceStatus = "NOT_CHECKED_IN" | "PARTIAL" | "CHECKED_IN" | "NO_SHOW";

type RegistrationDocV2 = {
  id: string;
  eventId: string;
  uid?: string;
  displayName: string;
  email: string;
  ticketTypeId?: string;
  ticketTypeName?: string;
  quantity: number;
  publicUnitPriceCents: number;
  discountCents: number;
  finalUnitPriceCents: number;
  amountPaidCents: number;
  currency: string;
  paymentId?: string;
  status: RegistrationStatus;
  attendanceStatus: AttendanceStatus;
  checkedInQuantity: number;
  checkedInAt?: number;
  source: "web" | "member" | "staff_walkin" | "waitlist";
  manageSecretHash: string;
  registeredAt: number;
  cancelledAt?: number;
  refundedAt?: number;
  stripeRefundId?: string;
};

type EventHold = {
  id: string;
  eventId: string;
  uid?: string;
  guestName?: string;
  guestEmail?: string;
  ticketTypeId?: string;
  ticketTypeName?: string;
  quantity: number;
  publicUnitPriceCents: number;
  discountCents: number;
  finalUnitPriceCents: number;
  totalCents: number;
  currency: string;
  status: "HELD" | "CONSUMED" | "EXPIRED" | "CANCELLED";
  source: "web" | "member" | "waitlist";
  secretHash: string;
  manageSecret: string;
  createdAt: number;
  expiresAt: number;
  paymentId?: string;
  stripeCheckoutSessionId?: string;
  checkoutUrl?: string;
  registrationId?: string;
  waitlistEntryId?: string;
};

type WaitlistEntry = {
  id: string;
  eventId: string;
  uid?: string;
  displayName: string;
  email: string;
  ticketTypeId?: string;
  quantity: number;
  joinedAt: number;
  status: "WAITING" | "OFFERED" | "CLAIMED" | "EXPIRED" | "REMOVED";
  manageSecretHash: string;
  offerHoldId?: string;
  offerExpiresAt?: number;
  updatedAt?: number;
};

type Pricing = {
  ticketTypeId?: string;
  ticketTypeName?: string;
  publicUnitPriceCents: number;
  discountCents: number;
  finalUnitPriceCents: number;
  totalCents: number;
  currency: string;
};

type Identity = {
  uid?: string;
  displayName: string;
  email: string;
  member: boolean;
};

function db() {
  return admin.firestore();
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function randomSecret() {
  return randomBytes(24).toString("hex");
}

function normalizeEmail(value?: string) {
  return (value || "").trim().toLowerCase();
}

function positiveInt(value: unknown, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function asMoney(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed);
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `event-${Date.now()}`;
}

function availableSeats(event: EventDocV2) {
  if (typeof event.seatCap !== "number") return Number.POSITIVE_INFINITY;
  const confirmed = event.confirmedQuantity ?? event.registrationCount ?? 0;
  const held = event.heldQuantity ?? 0;
  return Math.max(0, event.seatCap - confirmed - held);
}

function confirmedQuantity(event: EventDocV2) {
  return Math.max(0, event.confirmedQuantity ?? event.registrationCount ?? 0);
}

function requirePublished(event: EventDocV2) {
  if (event.status !== "published") {
    throw new HttpsError("failed-precondition", "This event is not open for registration.");
  }
  const now = Date.now();
  if (event.startTime <= now) {
    throw new HttpsError("failed-precondition", "This event has already started.");
  }
  if (event.registrationOpenAt && now < event.registrationOpenAt) {
    throw new HttpsError("failed-precondition", "Registration has not opened yet.");
  }
  if (event.registrationCloseAt && now > event.registrationCloseAt) {
    throw new HttpsError("failed-precondition", "Registration has closed.");
  }
}

function validateEventForSave(input: Record<string, unknown>) {
  const title = String(input.title || "").trim();
  const description = String(input.description || "").trim();
  const startTime = Number(input.startTime);
  const endTime = Number(input.endTime);
  if (!title) throw new HttpsError("invalid-argument", "Event title is required.");
  if (!description) throw new HttpsError("invalid-argument", "Event description is required.");
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    throw new HttpsError("invalid-argument", "Choose a valid event start and end time.");
  }
  const format = String(input.format || "in-person");
  if (!["in-person", "virtual", "hybrid"].includes(format)) {
    throw new HttpsError("invalid-argument", "Choose a valid event format.");
  }
  const seatCap = input.seatCap == null || input.seatCap === "" ? undefined : Number(input.seatCap);
  if (seatCap != null && (!Number.isInteger(seatCap) || seatCap < 1)) {
    throw new HttpsError("invalid-argument", "Capacity must be at least one seat.");
  }
}

function requireAdmin(auth: { token?: Record<string, unknown> } | null | undefined) {
  const role = auth?.token?.role as string | undefined;
  if (role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
}

function requireStaff(auth: { token?: Record<string, unknown> } | null | undefined) {
  const role = auth?.token?.role as string | undefined;
  if (!["staff", "admin", "master"].includes(role || "")) {
    throw new HttpsError("permission-denied", "Staff access is required.");
  }
}

async function resolveIdentity(
  request: { auth?: { uid: string; token: Record<string, unknown> } | null },
  guest?: { name?: string; email?: string },
): Promise<Identity> {
  if (request.auth?.uid) {
    const userSnap = await db().collection("users").doc(request.auth.uid).get();
    const user = userSnap.data() || {};
    const email = normalizeEmail((user.email as string | undefined) || (request.auth.token.email as string | undefined));
    if (!email) throw new HttpsError("failed-precondition", "Your account is missing an email address.");
    return {
      uid: request.auth.uid,
      displayName: String(user.displayName || request.auth.token.name || email),
      email,
      member: user.membershipStatus === "active" && Boolean(user.plan),
    };
  }
  const displayName = (guest?.name || "").trim();
  const email = normalizeEmail(guest?.email);
  if (!displayName || !email || !email.includes("@")) {
    throw new HttpsError("invalid-argument", "Name and a valid email are required.");
  }
  return { displayName, email, member: false };
}

function resolvePricing(
  event: EventDocV2,
  ticketTypeId: string | undefined,
  member: boolean,
  quantity: number,
): Pricing {
  const ticketTypes = event.ticketTypes || [];
  let ticket: EventTicketTypeLite | undefined;
  if (ticketTypes.length) {
    ticket = ticketTypeId
      ? ticketTypes.find((item) => item.id === ticketTypeId)
      : ticketTypes[0];
    if (!ticket) throw new HttpsError("not-found", "Ticket type not found.");
    if (ticket.targetAudience === "member" && !member) {
      throw new HttpsError("permission-denied", "This ticket is available to active members only.");
    }
    if (ticket.targetAudience === "vip") {
      throw new HttpsError("permission-denied", "This ticket requires staff approval.");
    }
    if (typeof ticket.quantity === "number" && (ticket.soldCount || 0) + quantity > ticket.quantity) {
      throw new HttpsError("resource-exhausted", "That ticket type is sold out.");
    }
  }

  const publicUnitPriceCents = asMoney(ticket?.priceCents ?? event.price ?? 0);
  const memberUnitPriceCents = member && !ticket && typeof event.memberPriceCents === "number"
    ? asMoney(event.memberPriceCents)
    : publicUnitPriceCents;
  const finalUnitPriceCents = Math.min(publicUnitPriceCents, memberUnitPriceCents);
  const discountCents = Math.max(0, publicUnitPriceCents - finalUnitPriceCents);

  return {
    ticketTypeId: ticket?.id,
    ticketTypeName: ticket?.name,
    publicUnitPriceCents,
    discountCents,
    finalUnitPriceCents,
    totalCents: finalUnitPriceCents * quantity,
    currency: String(event.currency || "usd").toLowerCase(),
  };
}

function incrementTicketSales(event: EventDocV2, ticketTypeId: string | undefined, delta: number) {
  if (!ticketTypeId || !event.ticketTypes?.length) return event.ticketTypes || [];
  return event.ticketTypes.map((ticket) => (
    ticket.id === ticketTypeId
      ? { ...ticket, soldCount: Math.max(0, (ticket.soldCount || 0) + delta) }
      : ticket
  ));
}

async function enqueueNotification(input: {
  id: string;
  type: string;
  eventId: string;
  registrationId?: string;
  waitlistEntryId?: string;
  email: string;
  displayName: string;
  scheduledFor?: number;
  manageToken?: string;
  actionUrl?: string;
}) {
  const ref = db().collection("eventNotificationJobs").doc(input.id);
  const existing = await ref.get();
  if (existing.exists) return;
  await ref.set({
    ...input,
    scheduledFor: input.scheduledFor || Date.now(),
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
}

async function enqueueRegistrationNotifications(
  registration: RegistrationDocV2,
  event: EventDocV2,
  manageToken?: string,
) {
  if (event.reminders?.confirmation !== false) {
    await enqueueNotification({
      id: `event_confirm_${registration.id}`,
      type: "REGISTRATION_CONFIRMED",
      eventId: event.id,
      registrationId: registration.id,
      email: registration.email,
      displayName: registration.displayName,
      manageToken,
    });
  }
  const now = Date.now();
  if (event.reminders?.reminder24h !== false) {
    const scheduledFor = event.startTime - 24 * 60 * 60 * 1000;
    if (scheduledFor > now) {
      await enqueueNotification({
        id: `event_reminder24_${registration.id}`,
        type: "EVENT_REMINDER_24H",
        eventId: event.id,
        registrationId: registration.id,
        email: registration.email,
        displayName: registration.displayName,
        scheduledFor,
        manageToken,
      });
    }
  }
  if (event.reminders?.reminder1h !== false) {
    const scheduledFor = event.startTime - 60 * 60 * 1000;
    if (scheduledFor > now) {
      await enqueueNotification({
        id: `event_reminder1_${registration.id}`,
        type: "EVENT_REMINDER_1H",
        eventId: event.id,
        registrationId: registration.id,
        email: registration.email,
        displayName: registration.displayName,
        scheduledFor,
        manageToken,
      });
    }
  }
  if (event.reminders?.followUp) {
    await enqueueNotification({
      id: `event_followup_${registration.id}`,
      type: "EVENT_FOLLOW_UP",
      eventId: event.id,
      registrationId: registration.id,
      email: registration.email,
      displayName: registration.displayName,
      scheduledFor: event.endTime + 2 * 60 * 60 * 1000,
      manageToken,
    });
  }
}

function registrationDataFromHold(
  hold: EventHold,
  registrationId: string,
  paymentId?: string,
): RegistrationDocV2 {
  return {
    id: registrationId,
    eventId: hold.eventId,
    uid: hold.uid,
    displayName: hold.uid ? hold.guestName || "Member" : hold.guestName || "Guest",
    email: normalizeEmail(hold.guestEmail),
    ticketTypeId: hold.ticketTypeId,
    ticketTypeName: hold.ticketTypeName,
    quantity: hold.quantity,
    publicUnitPriceCents: hold.publicUnitPriceCents,
    discountCents: hold.discountCents,
    finalUnitPriceCents: hold.finalUnitPriceCents,
    amountPaidCents: hold.totalCents,
    currency: hold.currency,
    paymentId,
    status: "CONFIRMED",
    attendanceStatus: "NOT_CHECKED_IN",
    checkedInQuantity: 0,
    source: hold.source === "waitlist" ? "waitlist" : hold.uid ? "member" : "web",
    manageSecretHash: hashSecret(hold.manageSecret),
    registeredAt: Date.now(),
  };
}

async function consumeHold(
  holdId: string,
  paymentId?: string,
): Promise<{ registration: RegistrationDocV2; event: EventDocV2; created: boolean; manageToken?: string }> {
  const holdRef = db().collection("eventHolds").doc(holdId);
  const registrationRef = db().collection("eventRegistrations").doc(`reg_${holdId}`);
  let created = false;
  let eventAfter: EventDocV2 | null = null;
  let registrationAfter: RegistrationDocV2 | null = null;
  let manageToken: string | undefined;

  await db().runTransaction(async (tx) => {
    const holdSnap = await tx.get(holdRef);
    if (!holdSnap.exists) throw new HttpsError("not-found", "Event registration hold not found.");
    const hold = holdSnap.data() as EventHold;
    const eventRef = db().collection("events").doc(hold.eventId);
    const [eventSnap, registrationSnap] = await Promise.all([
      tx.get(eventRef),
      tx.get(registrationRef),
    ]);
    if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
    const event = eventSnap.data() as EventDocV2;

    if (registrationSnap.exists) {
      registrationAfter = registrationSnap.data() as RegistrationDocV2;
      eventAfter = event;
      return;
    }
    if (hold.status === "CANCELLED") {
      throw new HttpsError("failed-precondition", "This registration hold was cancelled.");
    }

    const wasHeld = hold.status === "HELD";
    if (!wasHeld && hold.status !== "EXPIRED") {
      throw new HttpsError("failed-precondition", "This registration hold is no longer available.");
    }

    const confirmed = confirmedQuantity(event);
    const held = Math.max(0, event.heldQuantity || 0);
    if (!wasHeld && availableSeats(event) < hold.quantity) {
      const refundRef = db().collection("eventRefundJobs").doc(`capacity_${paymentId || hold.id}`);
      tx.set(refundRef, {
        id: refundRef.id,
        eventId: event.id,
        registrationId: null,
        holdId: hold.id,
        paymentId: paymentId || hold.paymentId,
        amountCents: hold.totalCents,
        reason: "capacity_conflict_after_payment",
        status: "pending",
        attempts: 0,
        nextAttemptAt: Date.now(),
        createdAt: Date.now(),
      }, { merge: true });
      tx.update(holdRef, { status: "CANCELLED", cancelledAt: Date.now() });
      throw new HttpsError(
        "resource-exhausted",
        "The event filled while payment completed. A full refund has been queued automatically.",
      );
    }

    const nextConfirmed = confirmed + hold.quantity;
    const nextHeld = wasHeld ? Math.max(0, held - hold.quantity) : held;
    const registration = registrationDataFromHold(hold, registrationRef.id, paymentId || hold.paymentId);
    tx.set(registrationRef, registration);
    tx.update(eventRef, {
      confirmedQuantity: nextConfirmed,
      registrationCount: nextConfirmed,
      heldQuantity: nextHeld,
      ticketTypes: incrementTicketSales(event, hold.ticketTypeId, hold.quantity),
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
    created = true;
    eventAfter = { ...event, confirmedQuantity: nextConfirmed, registrationCount: nextConfirmed, heldQuantity: nextHeld };
    registrationAfter = registration;
    manageToken = hold.manageSecret;
  });

  if (!registrationAfter || !eventAfter) {
    throw new HttpsError("internal", "Registration finalization did not complete.");
  }
  if (created) {
    await enqueueRegistrationNotifications(registrationAfter, eventAfter, manageToken);
  }
  return { registration: registrationAfter, event: eventAfter, created, manageToken };
}

async function releaseHold(holdId: string, nextStatus: "EXPIRED" | "CANCELLED") {
  const holdRef = db().collection("eventHolds").doc(holdId);
  let eventId: string | undefined;
  await db().runTransaction(async (tx) => {
    const holdSnap = await tx.get(holdRef);
    if (!holdSnap.exists) return;
    const hold = holdSnap.data() as EventHold;
    eventId = hold.eventId;
    if (hold.status !== "HELD") return;
    const eventRef = db().collection("events").doc(hold.eventId);
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists) return;
    const event = eventSnap.data() as EventDocV2;
    tx.update(eventRef, {
      heldQuantity: Math.max(0, (event.heldQuantity || 0) - hold.quantity),
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
  });
  if (eventId) await promoteWaitlist(eventId);
}

async function createHoldForIdentity(input: {
  eventId: string;
  identity: Identity;
  ticketTypeId?: string;
  quantity: number;
  source: EventHold["source"];
  expiresAt?: number;
  waitlistEntryId?: string;
  secret?: string;
}) {
  const holdRef = db().collection("eventHolds").doc();
  const secret = input.secret || randomSecret();
  const manageSecret = randomSecret();
  let finalHold: EventHold | null = null;

  await db().runTransaction(async (tx) => {
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
    const hold: EventHold = {
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
    tx.set(holdRef, hold);
    tx.update(eventRef, {
      heldQuantity: Math.max(0, event.heldQuantity || 0) + input.quantity,
      updatedAt: now,
    });
    finalHold = hold;
  });

  if (!finalHold) throw new HttpsError("internal", "Could not create an event registration hold.");
  return { hold: finalHold, secret };
}

async function createCheckoutForHold(
  hold: EventHold,
  successUrl: string,
  cancelUrl: string,
) {
  if (hold.totalCents <= 0) throw new HttpsError("failed-precondition", "This registration does not require payment.");
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
    // Purpose intentionally remains "other" in Stripe metadata so the legacy event
    // commerce finalizer does not process this v2 checkout. The payment ledger above
    // remains authoritative with purpose=event and our payment trigger consumes the hold.
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
        email: hold.guestEmail || "",
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
  identity: Identity;
  ticketTypeId?: string;
  quantity: number;
  source: RegistrationDocV2["source"];
}) {
  const registrationRef = db().collection("eventRegistrations").doc();
  const manageSecret = randomSecret();
  let registration: RegistrationDocV2 | null = null;
  let eventAfter: EventDocV2 | null = null;

  await db().runTransaction(async (tx) => {
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
    const nextConfirmed = confirmedQuantity(event) + input.quantity;
    const doc: RegistrationDocV2 = {
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
    tx.set(registrationRef, doc);
    tx.update(eventRef, {
      confirmedQuantity: nextConfirmed,
      registrationCount: nextConfirmed,
      ticketTypes: incrementTicketSales(event, pricing.ticketTypeId, input.quantity),
      updatedAt: Date.now(),
    });
    registration = doc;
    eventAfter = { ...event, confirmedQuantity: nextConfirmed, registrationCount: nextConfirmed };
  });

  if (!registration || !eventAfter) throw new HttpsError("internal", "Registration did not complete.");
  await enqueueRegistrationNotifications(registration, eventAfter, manageSecret);
  return { registration, manageSecret };
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
    const {
      eventId,
      ticketTypeId,
      quantity: rawQuantity,
      guest,
      successUrl,
      cancelUrl,
    } = request.data as {
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
    if (availableSeats(event) < quantity) {
      return { kind: "full", waitlistAvailable: true };
    }
    const pricing = resolvePricing(event, ticketTypeId, identity.member, quantity);
    if (pricing.totalCents === 0) {
      const { registration } = await createFreeRegistration({
        eventId,
        identity,
        ticketTypeId,
        quantity,
        source: identity.uid ? "member" : "web",
      });
      return { kind: "confirmed", registrationId: registration.id };
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
  const hold = holdSnap.data() as EventHold;
  const authOwns = Boolean(request.auth?.uid && request.auth.uid === hold.uid);
  const secretMatches = Boolean(holdSecret && hashSecret(holdSecret) === hold.secretHash);
  if (!authOwns && !secretMatches) throw new HttpsError("permission-denied", "This registration hold does not belong to you.");
  if (hold.status === "CONSUMED" && hold.registrationId) {
    return { status: "confirmed", registrationId: hold.registrationId };
  }
  if (!hold.paymentId) return { status: "pending" };
  const payment = await getPayment(hold.paymentId);
  if (!payment) return { status: "pending" };
  if (payment.status === "failed") return { status: "failed" };
  if (payment.status !== "paid") return { status: "pending" };
  const result = await finalizePaidPayment(payment.id);
  return { status: "confirmed", registrationId: result?.registration.id || hold.registrationId };
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
  if (!authOwns && !tokenMatches) throw new HttpsError("permission-denied", "This registration does not belong to you.");
  return { ref, registration };
}

function cancellationDecision(registration: RegistrationDocV2, event: EventDocV2) {
  const cutoffHours = Number.isFinite(event.refundCutoffHours)
    ? Math.max(0, Number(event.refundCutoffHours))
    : DEFAULT_REFUND_CUTOFF_HOURS;
  const refundEligible = registration.amountPaidCents > 0
    && Date.now() <= event.startTime - cutoffHours * 60 * 60 * 1000;
  return {
    canCancel: registration.status === "CONFIRMED" && event.status !== "completed",
    refundEligible,
    refundCents: refundEligible ? registration.amountPaidCents : 0,
    cutoffHours,
  };
}

export const events_v2GetRegistration = onCall(async (request) => {
  const { registrationId, manageToken } = request.data as { registrationId?: string; manageToken?: string };
  if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
  const { registration } = await authorizeRegistration(request, registrationId, manageToken);
  const eventSnap = await db().collection("events").doc(registration.eventId).get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const event = eventSnap.data() as EventDocV2;
  return { registration, event, cancellation: cancellationDecision(registration, event) };
});

export const events_v2GetCancellationQuote = onCall(async (request) => {
  const { registrationId, manageToken } = request.data as { registrationId?: string; manageToken?: string };
  if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
  const { registration } = await authorizeRegistration(request, registrationId, manageToken);
  const eventSnap = await db().collection("events").doc(registration.eventId).get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const event = eventSnap.data() as EventDocV2;
  return cancellationDecision(registration, event);
});

export const events_v2CancelRegistration = onCall(async (request) => {
  const { registrationId, manageToken } = request.data as { registrationId?: string; manageToken?: string };
  if (!registrationId) throw new HttpsError("invalid-argument", "registrationId is required.");
  const authorized = await authorizeRegistration(request, registrationId, manageToken);
  const eventRef = db().collection("events").doc(authorized.registration.eventId);
  let refundCents = 0;
  let eventId = authorized.registration.eventId;

  await db().runTransaction(async (tx) => {
    const [registrationSnap, eventSnap] = await Promise.all([
      tx.get(authorized.ref),
      tx.get(eventRef),
    ]);
    if (!registrationSnap.exists || !eventSnap.exists) throw new HttpsError("not-found", "Registration or event not found.");
    const registration = registrationSnap.data() as RegistrationDocV2;
    const event = eventSnap.data() as EventDocV2;
    const decision = cancellationDecision(registration, event);
    if (!decision.canCancel) throw new HttpsError("failed-precondition", "This registration can no longer be cancelled.");
    refundCents = decision.refundCents;
    const nextConfirmed = Math.max(0, confirmedQuantity(event) - registration.quantity);
    const nextStatus: RegistrationStatus = refundCents > 0 ? "REFUND_PENDING" : "CANCELLED";
    tx.update(authorized.ref, {
      status: nextStatus,
      cancelledAt: Date.now(),
      updatedAt: Date.now(),
    });
    tx.update(eventRef, {
      confirmedQuantity: nextConfirmed,
      registrationCount: nextConfirmed,
      ticketTypes: incrementTicketSales(event, registration.ticketTypeId, -registration.quantity),
      updatedAt: Date.now(),
    });
    if (refundCents > 0 && registration.paymentId) {
      const refundRef = db().collection("eventRefundJobs").doc(`cancel_${registration.id}`);
      tx.set(refundRef, {
        id: refundRef.id,
        eventId: event.id,
        registrationId: registration.id,
        paymentId: registration.paymentId,
        amountCents: refundCents,
        reason: "customer_cancellation",
        status: "pending",
        attempts: 0,
        nextAttemptAt: Date.now(),
        createdAt: Date.now(),
      }, { merge: true });
    }
  });

  await enqueueNotification({
    id: `event_cancel_${registrationId}`,
    type: "REGISTRATION_CANCELLED",
    eventId,
    registrationId,
    email: authorized.registration.email,
    displayName: authorized.registration.displayName,
    manageToken,
  });
  await promoteWaitlist(eventId);
  return { success: true, refundCents, refundPending: refundCents > 0 };
});

function waitlistDocId(eventId: string, identity: Identity) {
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
  const entry: WaitlistEntry = {
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

async function promoteWaitlist(eventId: string) {
  const waitingSnap = await db().collection("eventWaitlist")
    .where("eventId", "==", eventId)
    .where("status", "==", "WAITING")
    .orderBy("joinedAt", "asc")
    .limit(20)
    .get();
  if (waitingSnap.empty) return;

  for (const doc of waitingSnap.docs) {
    const entry = doc.data() as WaitlistEntry;
    const eventSnap = await db().collection("events").doc(eventId).get();
    if (!eventSnap.exists) return;
    const event = eventSnap.data() as EventDocV2;
    if (event.status !== "published" || availableSeats(event) < entry.quantity) continue;
    let member = false;
    if (entry.uid) {
      const user = (await db().collection("users").doc(entry.uid).get()).data();
      member = user?.membershipStatus === "active" && Boolean(user?.plan);
    }
    const identity: Identity = {
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
        scheduledFor: Date.now(),
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
    const entry = entrySnap.data() as WaitlistEntry;
    if (entry.status !== "OFFERED" || !entry.offerHoldId) {
      throw new HttpsError("failed-precondition", "This waitlist offer is no longer active.");
    }
    const holdSnap = await db().collection("eventHolds").doc(entry.offerHoldId).get();
    if (!holdSnap.exists) throw new HttpsError("not-found", "Waitlist hold not found.");
    const hold = holdSnap.data() as EventHold;
    if (hold.status !== "HELD" || hold.expiresAt <= Date.now()) {
      throw new HttpsError("deadline-exceeded", "This waitlist offer has expired.");
    }
    if (hashSecret(token) !== hold.secretHash) throw new HttpsError("permission-denied", "Invalid waitlist claim token.");
    if (hold.totalCents === 0) {
      const result = await consumeHold(hold.id);
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
  const entry = snap.data() as WaitlistEntry;
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
    for (const doc of snap.docs) {
      await releaseHold(doc.id, "EXPIRED");
    }
    logger.info("Expired event registration holds processed", { count: snap.size });
  },
);

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
        const attempts = positiveInt(job.attempts, 0) + 1;
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] || char);
}

function eventDateLabel(event: EventDocV2) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: event.timezone || "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(event.startTime));
}

function notificationCopy(type: string, event: EventDocV2, job: Record<string, unknown>) {
  const name = escapeHtml(String(job.displayName || "there"));
  const title = escapeHtml(event.title);
  const date = escapeHtml(eventDateLabel(event));
  const location = escapeHtml(event.location || (event.format === "virtual" ? "Online" : "Hi Coworking"));
  const registrationId = String(job.registrationId || "");
  const manageToken = String(job.manageToken || "");
  const manageUrl = registrationId && manageToken
    ? `${PUBLIC_SITE_URL}/events/manage?registration=${encodeURIComponent(registrationId)}#token=${manageToken}`
    : `${PUBLIC_SITE_URL}/events/detail?event=${encodeURIComponent(event.slug || event.id)}`;
  const actionUrl = String(job.actionUrl || manageUrl);

  if (type === "WAITLIST_OFFER") {
    return {
      subject: `A spot opened for ${event.title}`,
      html: `<p>Hi ${name},</p><p>A spot opened for <strong>${title}</strong>.</p><p>Your spot is temporarily reserved. Claim it before the offer expires.</p><p><a href="${escapeHtml(actionUrl)}">Claim your spot</a></p>`,
    };
  }
  if (type === "WAITLIST_JOINED") {
    return {
      subject: `You're on the waitlist for ${event.title}`,
      html: `<p>Hi ${name},</p><p>You're on the waitlist for <strong>${title}</strong>. We'll email you if a spot opens.</p>`,
    };
  }
  if (type === "REGISTRATION_CANCELLED") {
    return {
      subject: `Registration cancelled: ${event.title}`,
      html: `<p>Hi ${name},</p><p>Your registration for <strong>${title}</strong> has been cancelled.</p>`,
    };
  }
  if (type === "REFUND_CONFIRMED") {
    return {
      subject: `Refund issued: ${event.title}`,
      html: `<p>Hi ${name},</p><p>Your refund for <strong>${title}</strong> has been issued to the original payment method.</p>`,
    };
  }
  if (type === "EVENT_CANCELLED") {
    return {
      subject: `Event cancelled: ${event.title}`,
      html: `<p>Hi ${name},</p><p><strong>${title}</strong> has been cancelled. Any eligible paid registration is being refunded automatically.</p>`,
    };
  }
  if (type === "EVENT_FOLLOW_UP") {
    return {
      subject: `Thanks for joining us at ${event.title}`,
      html: `<p>Hi ${name},</p><p>Thanks for joining us for <strong>${title}</strong>. We hope to see you again at Hi Coworking.</p><p><a href="${PUBLIC_SITE_URL}/events">See upcoming events</a></p>`,
    };
  }
  if (type === "EVENT_REMINDER_24H" || type === "EVENT_REMINDER_1H") {
    return {
      subject: `Reminder: ${event.title}`,
      html: `<p>Hi ${name},</p><p>A reminder that you're registered for <strong>${title}</strong>.</p><p>${date}<br>${location}</p><p><a href="${escapeHtml(manageUrl)}">View registration</a></p>`,
    };
  }
  return {
    subject: `You're registered: ${event.title}`,
    html: `<p>Hi ${name},</p><p>You're registered for <strong>${title}</strong>.</p><p>${date}<br>${location}</p><p><a href="${escapeHtml(manageUrl)}">Manage registration</a></p>`,
  };
}

export const events_v2ProcessNotificationJobs = onSchedule(
  {
    schedule: "*/5 * * * *",
    timeZone: "America/New_York",
    secrets: [sendgridApiKey],
  },
  async () => {
    const snap = await db().collection("eventNotificationJobs")
      .where("status", "==", "pending")
      .where("scheduledFor", "<=", Date.now())
      .orderBy("scheduledFor", "asc")
      .limit(50)
      .get();
    const apiKey = sendgridApiKey.value();
    if (!apiKey) {
      logger.error("Event notifications are pending but SENDGRID_API_KEY is unavailable", { count: snap.size });
      return;
    }
    const provider = new SendGridProvider(apiKey);
    for (const doc of snap.docs) {
      const job = doc.data() as Record<string, unknown>;
      try {
        const eventSnap = await db().collection("events").doc(String(job.eventId || "")).get();
        if (!eventSnap.exists) throw new Error("event-not-found");
        const event = eventSnap.data() as EventDocV2;
        const type = String(job.type || "");
        if ((type.startsWith("EVENT_REMINDER") || type === "EVENT_FOLLOW_UP") && event.status === "cancelled") {
          await doc.ref.set({ status: "cancelled", processedAt: Date.now() }, { merge: true });
          continue;
        }
        if (job.registrationId && (type.startsWith("EVENT_REMINDER") || type === "EVENT_FOLLOW_UP")) {
          const registration = (await db().collection("eventRegistrations").doc(String(job.registrationId)).get()).data() as RegistrationDocV2 | undefined;
          if (!registration || registration.status !== "CONFIRMED") {
            await doc.ref.set({ status: "cancelled", processedAt: Date.now() }, { merge: true });
            continue;
          }
        }
        const copy = notificationCopy(type, event, job);
        await provider.send({
          to: String(job.email || ""),
          from: FROM_EMAIL,
          subject: copy.subject,
          html: copy.html,
          categories: ["event-transactional"],
        });
        await doc.ref.set({ status: "sent", processedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
      } catch (error) {
        const attempts = Number(job.attempts || 0) + 1;
        await doc.ref.set({
          status: attempts >= 3 ? "failed" : "pending",
          attempts,
          error: error instanceof Error ? error.message : String(error),
          scheduledFor: attempts >= 3 ? Number(job.scheduledFor || Date.now()) : Date.now() + attempts * 5 * 60 * 1000,
          updatedAt: Date.now(),
        }, { merge: true });
      }
    }
  },
);

function sanitizeTicketTypes(input: unknown, existing: EventTicketTypeLite[] = []) {
  if (!Array.isArray(input)) return [] as EventTicketTypeLite[];
  return input.map((raw, index) => {
    const item = (raw || {}) as Record<string, unknown>;
    const id = String(item.id || `ticket_${index + 1}`).trim();
    const existingTicket = existing.find((ticket) => ticket.id === id);
    const targetAudience = ["public", "member", "vip"].includes(String(item.targetAudience || "public"))
      ? String(item.targetAudience || "public") as EventTicketTypeLite["targetAudience"]
      : "public";
    return {
      id,
      name: String(item.name || "Ticket").trim(),
      priceCents: asMoney(item.priceCents),
      quantity: item.quantity == null || item.quantity === "" ? undefined : Math.max(1, positiveInt(item.quantity)),
      soldCount: existingTicket?.soldCount || 0,
      description: String(item.description || "").trim() || undefined,
      targetAudience,
    };
  });
}

async function uniqueSlug(title: string, eventId?: string) {
  const base = slugify(title);
  let candidate = base;
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const snap = await db().collection("events").where("slug", "==", candidate).limit(2).get();
    const conflict = snap.docs.some((doc) => doc.id !== eventId);
    if (!conflict) return candidate;
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
  const seatCap = input.seatCap == null || input.seatCap === "" ? undefined : positiveInt(input.seatCap);
  if (seatCap != null && seatCap < confirmedQuantity(existing || ({ registrationCount: 0 } as EventDocV2))) {
    throw new HttpsError("failed-precondition", "Capacity cannot be lower than the number of confirmed attendees.");
  }
  const title = String(input.title).trim();
  const slug = await uniqueSlug(title, id);
  const format = String(input.format || "in-person") as EventDocV2["format"];
  const now = Date.now();
  const event: Partial<EventDocV2> = {
    id,
    slug,
    title,
    description: String(input.description).trim(),
    format,
    location: String(input.location || "").trim() || undefined,
    virtualUrl: String(input.virtualUrl || "").trim() || undefined,
    startTime: Number(input.startTime),
    endTime: Number(input.endTime),
    timezone: String(input.timezone || existing?.timezone || "America/New_York"),
    seatCap,
    price: asMoney(input.price),
    memberPriceCents: input.memberPriceCents == null || input.memberPriceCents === "" ? undefined : asMoney(input.memberPriceCents),
    currency: String(input.currency || existing?.currency || "usd").toLowerCase(),
    ticketTypes: sanitizeTicketTypes(input.ticketTypes, existing?.ticketTypes),
    heroImage: input.heroImage && typeof input.heroImage === "object" ? input.heroImage as Record<string, unknown> : existing?.heroImage,
    gallery: Array.isArray(input.gallery) ? input.gallery as Array<Record<string, unknown>> : existing?.gallery || [],
    recordingUrl: String(input.recordingUrl || "").trim() || undefined,
    registrationOpenAt: input.registrationOpenAt ? Number(input.registrationOpenAt) : undefined,
    registrationCloseAt: input.registrationCloseAt ? Number(input.registrationCloseAt) : undefined,
    refundCutoffHours: input.refundCutoffHours == null || input.refundCutoffHours === "" ? DEFAULT_REFUND_CUTOFF_HOURS : Math.max(0, Number(input.refundCutoffHours)),
    reminders: {
      confirmation: input.confirmation !== false,
      reminder24h: input.reminder24h !== false,
      reminder1h: input.reminder1h !== false,
      followUp: input.followUp === true,
    },
    status: existing?.status || "draft",
    confirmedQuantity: confirmedQuantity(existing || ({ registrationCount: 0 } as EventDocV2)),
    registrationCount: confirmedQuantity(existing || ({ registrationCount: 0 } as EventDocV2)),
    heldQuantity: existing?.heldQuantity || 0,
    createdBy: existing?.createdBy || request.auth.uid,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
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
  const notifications: Array<Promise<void>> = [];
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
    notifications.push(enqueueNotification({
      id: `event_cancelled_${registration.id}`,
      type: "EVENT_CANCELLED",
      eventId,
      registrationId: registration.id,
      email: registration.email,
      displayName: registration.displayName,
    }));
  }
  for (const doc of holdsSnap.docs) {
    const hold = doc.data() as EventHold;
    if (hold.status === "HELD") batch.set(doc.ref, { status: "CANCELLED", cancelledAt: Date.now() }, { merge: true });
  }
  for (const doc of waitlistSnap.docs) {
    const entry = doc.data() as WaitlistEntry;
    if (["WAITING", "OFFERED"].includes(entry.status)) batch.set(doc.ref, { status: "REMOVED", updatedAt: Date.now() }, { merge: true });
  }
  await batch.commit();
  await Promise.all(notifications);
  return { success: true, eventId, affectedRegistrations: registrationsSnap.size };
});

export const events_v2AdminCompleteEvent = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  requireStaff(request.auth);
  const { eventId } = request.data as { eventId?: string };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  const eventRef = db().collection("events").doc(eventId);
  const regs = await db().collection("eventRegistrations").where("eventId", "==", eventId).get();
  const batch = db().batch();
  batch.set(eventRef, { status: "completed", completedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
  for (const doc of regs.docs) {
    const registration = doc.data() as RegistrationDocV2;
    if (registration.status !== "CONFIRMED") continue;
    const checkedIn = Math.max(0, registration.checkedInQuantity || 0);
    const attendanceStatus: AttendanceStatus = checkedIn === 0
      ? "NO_SHOW"
      : checkedIn >= registration.quantity
        ? "CHECKED_IN"
        : "PARTIAL";
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
    event: eventSnap.data(),
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
  if (registration.status !== "CONFIRMED") throw new HttpsError("failed-precondition", "Only confirmed registrations can check in.");
  const quantity = Math.min(registration.quantity, positiveInt(rawQuantity, registration.quantity));
  const attendanceStatus: AttendanceStatus = quantity >= registration.quantity ? "CHECKED_IN" : "PARTIAL";
  await ref.set({
    checkedInQuantity: quantity,
    checkedInAt: Date.now(),
    attendanceStatus,
    updatedAt: Date.now(),
  }, { merge: true });
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
  const identity: Identity = {
    displayName: String(name || "Walk-in").trim(),
    email: normalizeEmail(email) || `walkin-${Date.now()}@invalid.local`,
    member: false,
  };
  const quantity = positiveInt(rawQuantity, 1);
  const eventSnap = await db().collection("events").doc(eventId).get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const event = eventSnap.data() as EventDocV2;
  const pricing = resolvePricing(event, ticketTypeId, false, quantity);
  if (pricing.totalCents > 0) {
    throw new HttpsError("failed-precondition", "Paid walk-ins must use the normal event checkout so payment remains reconciled.");
  }
  const result = await createFreeRegistration({ eventId, identity, ticketTypeId, quantity, source: "staff_walkin" });
  await db().collection("eventRegistrations").doc(result.registration.id).set({
    checkedInQuantity: quantity,
    checkedInAt: Date.now(),
    attendanceStatus: "CHECKED_IN",
    updatedAt: Date.now(),
  }, { merge: true });
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
    return eventSnap.exists ? eventSnap.data() : null;
  }));
  return { registrations, events: events.filter(Boolean) };
});
