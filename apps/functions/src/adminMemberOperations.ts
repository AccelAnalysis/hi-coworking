import { createHash, randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import { createPayment, updatePaymentStatus } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";
import {
  CONFERENCE_ROOM_HOURLY_RATE_CENTS,
  GUEST_BOOKING_WINDOW_DAYS,
  GUEST_DAILY_CAP_CENTS,
  GUEST_HOURLY_RATE_CENTS,
  MEMBERSHIP_TIERS,
  getDeskMembershipTierById,
  getTierById,
  getTierByPriceId,
} from "./payments/stripeConfig";
import { createAccessGrant, seamApiKey } from "./access";

if (admin.apps.length === 0) admin.initializeApp();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const HOLD_MS = 15 * 60 * 1000;
const INCREMENT_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_HOUR = 8;
const CLOSE_HOUR = 20;
const LOCATION_TIME_ZONE = "America/New_York";
const MAX_CREDIT_ADJUSTMENT_CENTS = 1_000_000;

const RESOURCE_CONFIG: Record<string, {
  name: string;
  type: "SEAT" | "MODE";
  guestRateHourlyCents: number;
  exclusiveGroupId: string;
}> = {
  "seat-1": { name: "Desk 1", type: "SEAT", guestRateHourlyCents: GUEST_HOURLY_RATE_CENTS, exclusiveGroupId: "main_space" },
  "seat-2": { name: "Desk 2", type: "SEAT", guestRateHourlyCents: GUEST_HOURLY_RATE_CENTS, exclusiveGroupId: "main_space" },
  "seat-3": { name: "Desk 3", type: "SEAT", guestRateHourlyCents: GUEST_HOURLY_RATE_CENTS, exclusiveGroupId: "main_space" },
  "seat-4": { name: "Desk 4", type: "SEAT", guestRateHourlyCents: GUEST_HOURLY_RATE_CENTS, exclusiveGroupId: "main_space" },
  "seat-5": { name: "Desk 5", type: "SEAT", guestRateHourlyCents: GUEST_HOURLY_RATE_CENTS, exclusiveGroupId: "main_space" },
  "seat-6": { name: "Desk 6", type: "SEAT", guestRateHourlyCents: GUEST_HOURLY_RATE_CENTS, exclusiveGroupId: "main_space" },
  "mode-conference": { name: "Meeting setup", type: "MODE", guestRateHourlyCents: CONFERENCE_ROOM_HOURLY_RATE_CENTS, exclusiveGroupId: "main_space" },
};

type UsageReservation = { hours: number; expiresAt: number };
type CreditReservation = { amountCents: number; expiresAt: number };
type BusyRecord = { resourceId: string; start: number; end: number; status?: string; expiresAt?: number };
type MembershipUsage = {
  uid: string;
  monthKey: string;
  usedHours: number;
  reservations: Record<string, UsageReservation>;
  updatedAt: number;
};
type BookingQuote = {
  resourceId: string;
  resourceName: string;
  resourceType: "SEAT" | "MODE";
  start: number;
  end: number;
  durationHours: number;
  membershipName: string | null;
  includedHoursRemaining: number;
  includedHoursApplied: number;
  billableHours: number;
  hourlyRateCents: number;
  subtotalCents: number;
  accountCreditAvailableCents: number;
  accountCreditAppliedCents: number;
  totalCents: number;
  dailyCapApplied: boolean;
  currency: string;
};

type AdminHold = {
  id: string;
  kind: "ADMIN_MEMBER";
  bookedForUid: string;
  adminActorUid: string;
  resourceId: string;
  resourceName: string;
  start: number;
  end: number;
  userId: string;
  quote: BookingQuote;
  status: string;
  secretHash: string;
  createdAt: number;
  expiresAt: number;
  membershipUsageId?: string | null;
  accountCreditReservationCents?: number;
  paymentId?: string;
  totalCents?: number;
  bookingId?: string;
};

function db() { return admin.firestore(); }

function requireAdmin(request: { auth?: { uid: string; token: Record<string, unknown> } | null }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  const role = request.auth.token.role;
  if (role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
  return request.auth.uid;
}

async function requireMember(uid: string) {
  if (!uid) throw new HttpsError("invalid-argument", "Member is required.");
  const ref = db().collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Member account not found.");
  const data = snap.data() || {};
  return { ref, data };
}

function safeOrigin(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid protocol");
    return url.origin;
  } catch {
    throw new HttpsError("invalid-argument", "A valid return origin is required.");
  }
}

async function writeAudit(input: {
  action: string;
  memberUid: string;
  adminUid: string;
  details?: Record<string, unknown>;
}) {
  const ref = db().collection("memberOperationAudit").doc();
  await ref.set({
    id: ref.id,
    ...input,
    createdAt: Date.now(),
  });
  return ref.id;
}

function stripeClient() {
  return new Stripe(stripeSecretKey.value(), { apiVersion: "2026-01-28.clover" });
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription) {
  const raw = subscription as unknown as Record<string, unknown>;
  const direct = Number(raw.current_period_end || 0);
  if (direct > 0) return direct;
  const firstItem = subscription.items.data[0] as unknown as Record<string, unknown> | undefined;
  return Number(firstItem?.current_period_end || 0);
}

async function membershipSubscription(uid: string, stripe: Stripe) {
  const { data: user } = await requireMember(uid);
  const candidateIds = new Set<string>();
  const candidateCustomerIds = new Set<string>();
  const features = user.features as Record<string, unknown> | undefined;
  if (typeof features?.stripeSubscriptionId === "string") candidateIds.add(features.stripeSubscriptionId);
  if (typeof user.stripeSubscriptionId === "string") candidateIds.add(user.stripeSubscriptionId);
  if (typeof user.stripeCustomerId === "string") candidateCustomerIds.add(user.stripeCustomerId);

  const paymentSnap = await db().collection("payments").where("uid", "==", uid).get();
  for (const paymentDoc of paymentSnap.docs) {
    const payment = paymentDoc.data();
    if (payment.purpose !== "membership") continue;
    const refs = payment.providerRefs as Record<string, unknown> | undefined;
    if (typeof refs?.stripeSubscriptionId === "string" && refs.stripeSubscriptionId) {
      candidateIds.add(refs.stripeSubscriptionId);
    }
    if (typeof refs?.stripeCustomerId === "string" && refs.stripeCustomerId) {
      candidateCustomerIds.add(refs.stripeCustomerId);
    }
  }

  const retrieved: Stripe.Subscription[] = [];
  for (const subscriptionId of candidateIds) {
    try {
      retrieved.push(await stripe.subscriptions.retrieve(subscriptionId));
    } catch (error) {
      logger.warn("Could not retrieve candidate membership subscription", { uid, subscriptionId, error });
    }
  }

  let preferred = retrieved
    .filter((sub) => sub.status !== "canceled")
    .sort((a, b) => b.created - a.created)[0]
    || retrieved.sort((a, b) => b.created - a.created)[0];

  if (!preferred) {
    for (const customer of candidateCustomerIds) {
      try {
        const subscriptions = await stripe.subscriptions.list({ customer, status: "all", limit: 20 });
        preferred = subscriptions.data
          .filter((sub) => sub.metadata?.uid === uid || !sub.metadata?.uid)
          .sort((a, b) => (a.status === "canceled" ? 1 : 0) - (b.status === "canceled" ? 1 : 0) || b.created - a.created)[0];
        if (preferred) break;
      } catch (error) {
        logger.warn("Could not list customer subscriptions", { uid, customer, error });
      }
    }
  }

  return { user, subscription: preferred || null };
}

function subscriptionState(subscription: Stripe.Subscription | null, userPlan?: string) {
  if (!subscription) {
    return {
      hasSubscription: false,
      subscriptionId: null,
      stripeStatus: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      planId: userPlan || null,
    };
  }
  const priceId = subscription.items.data[0]?.price?.id;
  const mapped = priceId ? getTierByPriceId(priceId) : undefined;
  const periodEnd = subscriptionPeriodEnd(subscription);
  return {
    hasSubscription: true,
    subscriptionId: subscription.id,
    stripeStatus: subscription.status,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    currentPeriodEnd: periodEnd > 0 ? periodEnd * 1000 : null,
    planId: mapped?.id || subscription.metadata?.plan || userPlan || null,
  };
}

export const admin_membershipGetState = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    requireAdmin(request);
    const { uid } = request.data as { uid: string };
    const stripe = stripeClient();
    const { user, subscription } = await membershipSubscription(uid, stripe);
    return {
      ...subscriptionState(subscription, typeof user.plan === "string" ? user.plan : undefined),
      membershipStatus: user.membershipStatus || "none",
      plans: MEMBERSHIP_TIERS.map((tier) => ({
        id: tier.id,
        name: tier.name,
        amountCents: tier.amountCents,
        includedHoursPerMonth: tier.includedHoursPerMonth,
        extraHourlyRateCents: tier.extraHourlyRateCents,
      })),
    };
  },
);

export const admin_membershipChangePlan = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const adminUid = requireAdmin(request);
    const { uid, tierId } = request.data as { uid: string; tierId: string };
    const tier = getTierById(tierId);
    if (!tier) throw new HttpsError("invalid-argument", "Choose a valid membership plan.");

    const stripe = stripeClient();
    const { user, subscription } = await membershipSubscription(uid, stripe);
    if (!subscription || !["active", "trialing", "past_due"].includes(subscription.status)) {
      throw new HttpsError("failed-precondition", "This member does not have an active Stripe subscription to change.");
    }
    if (subscription.cancel_at_period_end) {
      throw new HttpsError("failed-precondition", "Reactivate the pending cancellation before changing plans.");
    }
    const item = subscription.items.data[0];
    if (!item) throw new HttpsError("failed-precondition", "The Stripe subscription has no billable item.");
    const currentTier = getTierByPriceId(item.price.id);
    if (currentTier?.id === tier.id) {
      return { success: true, unchanged: true, planId: tier.id, state: subscriptionState(subscription, tier.id) };
    }

    let updated: Stripe.Subscription;
    try {
      updated = await stripe.subscriptions.update(subscription.id, {
        items: [{ id: item.id, price: tier.stripePriceId }],
        proration_behavior: "always_invoice",
        payment_behavior: "error_if_incomplete",
        metadata: { ...subscription.metadata, uid, plan: tier.id },
        expand: ["latest_invoice"],
      });
    } catch (error) {
      logger.error("Admin membership plan change failed in Stripe", { uid, tierId, subscriptionId: subscription.id, error });
      throw new HttpsError("failed-precondition", "Stripe could not complete the plan change. No Hi Coworking entitlement was changed.");
    }

    const periodEnd = subscriptionPeriodEnd(updated);
    await db().collection("users").doc(uid).set({
      membershipStatus: updated.status === "past_due" ? "pastDue" : "active",
      plan: tier.id,
      expiresAt: periodEnd > 0 ? periodEnd * 1000 : Number(user.expiresAt || Date.now()),
      stripeSubscriptionId: updated.id,
      membershipCancellationPending: false,
      updatedAt: Date.now(),
    }, { merge: true });

    const latestInvoice = typeof updated.latest_invoice === "object" && updated.latest_invoice
      ? updated.latest_invoice as Stripe.Invoice
      : null;
    let paymentId: string | null = null;
    if (latestInvoice && latestInvoice.amount_due > 0) {
      const payment = await createPayment({
        uid,
        provider: "stripe",
        amount: latestInvoice.amount_due,
        currency: latestInvoice.currency || tier.currency,
        purpose: "membership",
        purposeRefId: tier.id,
        status: latestInvoice.status === "paid" ? "paid" : "pending",
        providerRefs: {
          stripeSubscriptionId: updated.id,
          stripeInvoiceId: latestInvoice.id,
          ...(typeof updated.customer === "string" ? { stripeCustomerId: updated.customer } : {}),
        },
      });
      paymentId = payment.id;
    }

    const auditId = await writeAudit({
      action: "membership_plan_changed",
      memberUid: uid,
      adminUid,
      details: {
        fromPlan: currentTier?.id || user.plan || null,
        toPlan: tier.id,
        stripeSubscriptionId: updated.id,
        paymentId,
        prorationBehavior: "always_invoice",
      },
    });
    return { success: true, auditId, paymentId, planId: tier.id, state: subscriptionState(updated, tier.id) };
  },
);

export const admin_membershipCancel = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const adminUid = requireAdmin(request);
    const { uid } = request.data as { uid: string };
    const stripe = stripeClient();
    const { user, subscription } = await membershipSubscription(uid, stripe);
    if (!subscription || !["active", "trialing", "past_due"].includes(subscription.status)) {
      throw new HttpsError("failed-precondition", "This member does not have an active Stripe subscription to cancel.");
    }
    const updated = subscription.cancel_at_period_end
      ? subscription
      : await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });
    const periodEnd = subscriptionPeriodEnd(updated);
    await db().collection("users").doc(uid).set({
      membershipCancellationPending: true,
      membershipCancellationRequestedAt: Date.now(),
      membershipCancellationEffectiveAt: periodEnd > 0 ? periodEnd * 1000 : null,
      stripeSubscriptionId: updated.id,
      updatedAt: Date.now(),
      ...(periodEnd > 0 ? { expiresAt: periodEnd * 1000 } : {}),
    }, { merge: true });
    const auditId = await writeAudit({
      action: "membership_cancel_at_period_end",
      memberUid: uid,
      adminUid,
      details: {
        plan: user.plan || null,
        stripeSubscriptionId: updated.id,
        effectiveAt: periodEnd > 0 ? periodEnd * 1000 : null,
      },
    });
    return { success: true, auditId, state: subscriptionState(updated, typeof user.plan === "string" ? user.plan : undefined) };
  },
);

export const admin_membershipReactivate = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    const adminUid = requireAdmin(request);
    const { uid, tierId, returnOrigin } = request.data as { uid: string; tierId?: string; returnOrigin?: string };
    const stripe = stripeClient();
    const { user, subscription } = await membershipSubscription(uid, stripe);

    if (subscription && ["active", "trialing", "past_due"].includes(subscription.status)) {
      const updated = subscription.cancel_at_period_end
        ? await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: false })
        : subscription;
      const currentPriceId = updated.items.data[0]?.price?.id;
      const plan = currentPriceId ? getTierByPriceId(currentPriceId) : getTierById(String(user.plan || ""));
      const periodEnd = subscriptionPeriodEnd(updated);
      await db().collection("users").doc(uid).set({
        membershipStatus: updated.status === "past_due" ? "pastDue" : "active",
        ...(plan ? { plan: plan.id } : {}),
        stripeSubscriptionId: updated.id,
        membershipCancellationPending: false,
        membershipCancellationEffectiveAt: null,
        ...(periodEnd > 0 ? { expiresAt: periodEnd * 1000 } : {}),
        updatedAt: Date.now(),
      }, { merge: true });
      const auditId = await writeAudit({
        action: "membership_reactivated",
        memberUid: uid,
        adminUid,
        details: { stripeSubscriptionId: updated.id, plan: plan?.id || user.plan || null },
      });
      return { success: true, kind: "reactivated", auditId, state: subscriptionState(updated, plan?.id || String(user.plan || "")) };
    }

    const tier = getTierById(tierId || String(user.plan || ""));
    if (!tier) throw new HttpsError("invalid-argument", "Choose the plan the member should restart.");
    if (!returnOrigin) throw new HttpsError("invalid-argument", "returnOrigin is required to create reactivation checkout.");
    const origin = safeOrigin(returnOrigin);
    const payment = await createPayment({
      uid,
      provider: "stripe",
      amount: tier.amountCents,
      currency: tier.currency,
      purpose: "membership",
      purposeRefId: tier.id,
      status: "pending",
    });
    const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    const session = await provider.createCheckoutSession({
      uid,
      amount: tier.amountCents,
      currency: tier.currency,
      purpose: "membership",
      purposeRefId: tier.id,
      successUrl: `${origin}/pricing?membership=reactivated`,
      cancelUrl: `${origin}/pricing?membership=cancelled`,
      metadata: {
        email: String(user.email || ""),
        stripePriceId: tier.stripePriceId,
        paymentId: payment.id,
        plan: tier.id,
      },
    });
    await updatePaymentStatus(payment.id, "pending", {
      providerRefs: { stripeCheckoutSessionId: session.sessionId },
    });
    const auditId = await writeAudit({
      action: "membership_reactivation_checkout_created",
      memberUid: uid,
      adminUid,
      details: { plan: tier.id, paymentId: payment.id, stripeCheckoutSessionId: session.sessionId },
    });
    return { success: true, kind: "checkout", auditId, paymentId: payment.id, checkoutUrl: session.url, planId: tier.id };
  },
);

function activeCreditReservations(reservations: Record<string, CreditReservation> | undefined, now = Date.now()) {
  return Object.fromEntries(Object.entries(reservations || {}).filter(([, reservation]) => reservation.expiresAt > now));
}

function reservedCreditCents(reservations: Record<string, CreditReservation>) {
  return Object.values(reservations).reduce((sum, reservation) => sum + Math.max(0, Math.round(Number(reservation.amountCents || 0))), 0);
}

export const admin_accountCreditAdjust = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const { uid, deltaCents, reason, note, requestId } = request.data as {
    uid: string;
    deltaCents: number;
    reason: string;
    note?: string;
    requestId: string;
  };
  if (!Number.isInteger(deltaCents) || deltaCents === 0 || Math.abs(deltaCents) > MAX_CREDIT_ADJUSTMENT_CENTS) {
    throw new HttpsError("invalid-argument", "Credit adjustment must be a non-zero whole-cent amount no greater than $10,000.");
  }
  if (!reason?.trim() || reason.trim().length < 3) {
    throw new HttpsError("invalid-argument", "A reason is required for every credit adjustment.");
  }
  if (!requestId || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    throw new HttpsError("invalid-argument", "A valid idempotency request ID is required.");
  }

  const userRef = db().collection("users").doc(uid);
  const adjustmentRef = db().collection("accountCreditAdjustments").doc(requestId);
  const result = await db().runTransaction(async (tx) => {
    const [userSnap, existing] = await Promise.all([tx.get(userRef), tx.get(adjustmentRef)]);
    if (existing.exists) return existing.data() as Record<string, unknown>;
    if (!userSnap.exists) throw new HttpsError("not-found", "Member account not found.");
    const user = userSnap.data() || {};
    const beforeCents = Math.max(0, Math.round(Number(user.accountCreditCents || 0)));
    const reservations = activeCreditReservations(user.accountCreditReservations as Record<string, CreditReservation> | undefined);
    const reservedCents = reservedCreditCents(reservations);
    const afterCents = beforeCents + deltaCents;
    if (afterCents < reservedCents) {
      throw new HttpsError("failed-precondition", "This adjustment would reduce the balance below credit already reserved for an active booking checkout.");
    }
    if (afterCents < 0) throw new HttpsError("failed-precondition", "Account credit cannot become negative.");
    const record = {
      id: requestId,
      userId: uid,
      deltaCents,
      beforeCents,
      afterCents,
      reservedCents,
      reason: reason.trim(),
      note: note?.trim() || "",
      performedBy: adminUid,
      createdAt: Date.now(),
    };
    tx.set(adjustmentRef, record);
    tx.set(userRef, { accountCreditCents: afterCents, updatedAt: Date.now() }, { merge: true });
    return record;
  });
  return { success: true, adjustment: result };
});

function localClock(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute),
  };
}

function localDayKey(timestamp: number) {
  const value = localClock(timestamp);
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function localMonthKey(timestamp: number) {
  const value = localClock(timestamp);
  return `${value.year}-${String(value.month).padStart(2, "0")}`;
}

function validateWindow(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new HttpsError("invalid-argument", "Choose a valid start and end time.");
  if (start % INCREMENT_MS !== 0 || end % INCREMENT_MS !== 0) throw new HttpsError("invalid-argument", "Bookings must use 30-minute increments.");
  if (localDayKey(start) !== localDayKey(end - 1)) throw new HttpsError("invalid-argument", "Bookings must start and end on the same day.");
  const startClock = localClock(start);
  const endClock = localClock(end);
  const startMinutes = startClock.hour * 60 + startClock.minute;
  const endMinutes = endClock.hour * 60 + endClock.minute;
  if (startMinutes < OPEN_HOUR * 60 || endMinutes > CLOSE_HOUR * 60) throw new HttpsError("failed-precondition", "That time is outside current operating hours.");
  if (start < Date.now() - 60_000) throw new HttpsError("failed-precondition", "That time has already passed.");
}

function resourceConflicts(resourceId: string, start: number, end: number, busy: BusyRecord[]) {
  const target = RESOURCE_CONFIG[resourceId];
  if (!target) return true;
  return busy.some((record) => {
    if (!(start < record.end && end > record.start)) return false;
    if (["CANCELLED", "EXPIRED", "CONSUMED"].includes(String(record.status || ""))) return false;
    if (record.resourceId === resourceId) return true;
    const other = RESOURCE_CONFIG[record.resourceId];
    if (!other || other.exclusiveGroupId !== target.exclusiveGroupId) return false;
    return target.type === "MODE" || other.type === "MODE";
  });
}

function activeUsageReservations(reservations: Record<string, UsageReservation> | undefined, now = Date.now()) {
  return Object.fromEntries(Object.entries(reservations || {}).filter(([, reservation]) => reservation.expiresAt > now));
}

function reservedHours(reservations: Record<string, UsageReservation>) {
  return Object.values(reservations).reduce((sum, reservation) => sum + Math.max(0, Number(reservation.hours || 0)), 0);
}

function usedHoursFromBookings(docs: FirebaseFirestore.QueryDocumentSnapshot[], monthKey: string) {
  return docs.reduce((sum, bookingDoc) => {
    const booking = bookingDoc.data();
    if (booking.status === "CANCELLED" || localMonthKey(Number(booking.start)) !== monthKey) return sum;
    if (!String(booking.resourceId || "").startsWith("seat-")) return sum;
    const applied = Number(booking.includedHoursApplied);
    return sum + (Number.isFinite(applied) ? Math.max(0, applied) : Math.max(0, (Number(booking.end) - Number(booking.start)) / 3_600_000));
  }, 0);
}

async function enforceMemberBookingHorizon(uid: string, start: number) {
  const { data: user } = await requireMember(uid);
  const days = user.membershipStatus === "active" && user.plan
    ? getTierById(String(user.plan))?.bookingWindowDays ?? GUEST_BOOKING_WINDOW_DAYS
    : GUEST_BOOKING_WINDOW_DAYS;
  if (start > Date.now() + days * DAY_MS) throw new HttpsError("failed-precondition", `That date is outside this member's ${days}-day booking window.`);
}

async function busyRecords(start: number, end: number, excludeHoldId?: string) {
  const [bookingSnap, holdSnap] = await Promise.all([
    db().collection("bookings").where("end", ">", start).get(),
    db().collection("bookingHolds").where("end", ">", start).get(),
  ]);
  const now = Date.now();
  return [
    ...bookingSnap.docs.map((doc) => doc.data() as BusyRecord).filter((item) => item.start < end && item.status !== "CANCELLED"),
    ...holdSnap.docs.filter((doc) => doc.id !== excludeHoldId).map((doc) => doc.data() as BusyRecord).filter((item) => item.start < end && Number(item.expiresAt || 0) > now && !["EXPIRED", "CONSUMED"].includes(String(item.status || ""))),
  ];
}

async function memberQuote(uid: string, resourceId: string, start: number, end: number): Promise<BookingQuote> {
  const resource = RESOURCE_CONFIG[resourceId];
  if (!resource) throw new HttpsError("not-found", "Space not found.");
  validateWindow(start, end);
  await enforceMemberBookingHorizon(uid, start);
  const busy = await busyRecords(start, end);
  if (resourceConflicts(resourceId, start, end, busy)) throw new HttpsError("failed-precondition", "That space is no longer available.");
  const { data: user } = await requireMember(uid);
  const durationHours = (end - start) / 3_600_000;
  let membershipName: string | null = null;
  let includedHoursRemaining = 0;
  let includedHoursApplied = 0;
  let billableHours = durationHours;
  let hourlyRateCents = resource.guestRateHourlyCents;
  let subtotalCents = resource.type === "SEAT"
    ? Math.min(Math.round(durationHours * GUEST_HOURLY_RATE_CENTS), GUEST_DAILY_CAP_CENTS)
    : Math.round(durationHours * resource.guestRateHourlyCents);
  let dailyCapApplied = resource.type === "SEAT" && Math.round(durationHours * GUEST_HOURLY_RATE_CENTS) >= GUEST_DAILY_CAP_CENTS;

  if (resource.type === "SEAT" && user.membershipStatus === "active" && user.plan) {
    const tier = getDeskMembershipTierById(String(user.plan));
    if (tier) {
      const key = localMonthKey(start);
      const usageSnap = await db().collection("membershipUsage").doc(`${uid}_${key}`).get();
      let usedHours = 0;
      let reservations: Record<string, UsageReservation> = {};
      if (usageSnap.exists) {
        const usage = usageSnap.data() as MembershipUsage;
        usedHours = Math.max(0, Number(usage.usedHours || 0));
        reservations = activeUsageReservations(usage.reservations);
      } else {
        const memberBookings = await db().collection("bookings").where("userId", "==", uid).get();
        usedHours = usedHoursFromBookings(memberBookings.docs, key);
      }
      includedHoursRemaining = Math.max(0, tier.includedHoursPerMonth - usedHours - reservedHours(reservations));
      includedHoursApplied = Math.min(durationHours, includedHoursRemaining);
      billableHours = Math.max(0, durationHours - includedHoursApplied);
      membershipName = tier.name;
      hourlyRateCents = tier.extraHourlyRateCents;
      subtotalCents = Math.round(billableHours * hourlyRateCents);
      dailyCapApplied = false;
    }
  }

  const creditReservations = activeCreditReservations(user.accountCreditReservations as Record<string, CreditReservation> | undefined);
  const accountCreditAvailableCents = Math.max(0, Math.round(Number(user.accountCreditCents || 0)) - reservedCreditCents(creditReservations));
  const accountCreditAppliedCents = Math.min(subtotalCents, accountCreditAvailableCents);
  return {
    resourceId, resourceName: resource.name, resourceType: resource.type,
    start, end, durationHours, membershipName, includedHoursRemaining, includedHoursApplied,
    billableHours, hourlyRateCents, subtotalCents, accountCreditAvailableCents,
    accountCreditAppliedCents, totalCents: Math.max(0, subtotalCents - accountCreditAppliedCents),
    dailyCapApplied, currency: "usd",
  };
}

export const admin_bookingForMemberGetAvailability = onCall(async (request) => {
  requireAdmin(request);
  const { uid, start, end } = request.data as { uid: string; start: number; end: number };
  validateWindow(start, end);
  await enforceMemberBookingHorizon(uid, start);
  const busy = await busyRecords(start, end);
  return {
    start, end,
    options: Object.entries(RESOURCE_CONFIG).map(([resourceId, resource]) => ({
      resourceId, name: resource.name, type: resource.type,
      available: !resourceConflicts(resourceId, start, end, busy),
    })),
  };
});

export const admin_bookingForMemberQuote = onCall(async (request) => {
  requireAdmin(request);
  const { uid, resourceId, start, end } = request.data as { uid: string; resourceId: string; start: number; end: number };
  return memberQuote(uid, resourceId, start, end);
});

function consumeUsageReservation(tx: FirebaseFirestore.Transaction, usageRef: FirebaseFirestore.DocumentReference, usageSnap: FirebaseFirestore.DocumentSnapshot, holdId: string) {
  if (!usageSnap.exists) return;
  const usage = usageSnap.data() as MembershipUsage;
  const reservations = activeUsageReservations(usage.reservations);
  const reservation = reservations[holdId];
  if (!reservation) return;
  delete reservations[holdId];
  tx.set(usageRef, { ...usage, usedHours: Math.max(0, Number(usage.usedHours || 0)) + Math.max(0, Number(reservation.hours || 0)), reservations, updatedAt: Date.now() }, { merge: true });
}

function consumeCreditReservation(tx: FirebaseFirestore.Transaction, userRef: FirebaseFirestore.DocumentReference, userSnap: FirebaseFirestore.DocumentSnapshot, holdId: string, expectedCents: number) {
  if (!userSnap.exists || expectedCents <= 0) return;
  const user = userSnap.data() || {};
  const reservations = activeCreditReservations(user.accountCreditReservations as Record<string, CreditReservation> | undefined);
  const reserved = Math.max(0, Math.round(Number(reservations[holdId]?.amountCents ?? expectedCents)));
  delete reservations[holdId];
  const current = Math.max(0, Math.round(Number(user.accountCreditCents || 0)));
  const amountCents = Math.min(current, reserved);
  tx.set(userRef, { accountCreditCents: current - amountCents, accountCreditReservations: reservations, updatedAt: Date.now() }, { merge: true });
  tx.set(db().collection("accountCreditRedemptions").doc(`admin_booking_hold_${holdId}`), {
    id: `admin_booking_hold_${holdId}`, userId: userRef.id, holdId, amountCents,
    reason: "admin_booking_for_member", createdAt: Date.now(),
  }, { merge: true });
}

async function createAdminMemberHold(adminUid: string, uid: string, resourceId: string, start: number, end: number, holdSecret: string) {
  const resource = RESOURCE_CONFIG[resourceId];
  if (!resource) throw new HttpsError("not-found", "Space not found.");
  validateWindow(start, end);
  await enforceMemberBookingHorizon(uid, start);
  const holdRef = db().collection("bookingHolds").doc();
  const userRef = db().collection("users").doc(uid);
  const key = localMonthKey(start);
  const usageRef = db().collection("membershipUsage").doc(`${uid}_${key}`);

  const quote = await db().runTransaction(async (tx) => {
    const [userSnap, usageSnap, memberBookings, conflictBookings, conflictHolds] = await Promise.all([
      tx.get(userRef),
      tx.get(usageRef),
      tx.get(db().collection("bookings").where("userId", "==", uid)),
      tx.get(db().collection("bookings").where("end", ">", start)),
      tx.get(db().collection("bookingHolds").where("end", ">", start)),
    ]);
    if (!userSnap.exists) throw new HttpsError("not-found", "Member account not found.");
    const now = Date.now();
    const busy: BusyRecord[] = [
      ...conflictBookings.docs.map((doc) => doc.data() as BusyRecord).filter((item) => item.start < end && item.status !== "CANCELLED"),
      ...conflictHolds.docs.map((doc) => doc.data() as BusyRecord).filter((item) => item.start < end && Number(item.expiresAt || 0) > now && !["EXPIRED", "CONSUMED"].includes(String(item.status || ""))),
    ];
    if (resourceConflicts(resourceId, start, end, busy)) throw new HttpsError("failed-precondition", "That space is no longer available.");

    const user = userSnap.data() || {};
    const durationHours = (end - start) / 3_600_000;
    let membershipName: string | null = null;
    let includedHoursRemaining = 0;
    let includedHoursApplied = 0;
    let billableHours = durationHours;
    let hourlyRateCents = resource.guestRateHourlyCents;
    let subtotalCents = resource.type === "SEAT" ? Math.min(Math.round(durationHours * GUEST_HOURLY_RATE_CENTS), GUEST_DAILY_CAP_CENTS) : Math.round(durationHours * resource.guestRateHourlyCents);
    let dailyCapApplied = resource.type === "SEAT" && Math.round(durationHours * GUEST_HOURLY_RATE_CENTS) >= GUEST_DAILY_CAP_CENTS;
    let reservations: Record<string, UsageReservation> = {};
    let usedHours = 0;
    let useUsage = false;

    if (resource.type === "SEAT" && user.membershipStatus === "active" && user.plan) {
      const tier = getDeskMembershipTierById(String(user.plan));
      if (tier) {
        useUsage = true;
        if (usageSnap.exists) {
          const usage = usageSnap.data() as MembershipUsage;
          usedHours = Math.max(0, Number(usage.usedHours || 0));
          reservations = activeUsageReservations(usage.reservations);
        } else {
          usedHours = usedHoursFromBookings(memberBookings.docs, key);
        }
        includedHoursRemaining = Math.max(0, tier.includedHoursPerMonth - usedHours - reservedHours(reservations));
        includedHoursApplied = Math.min(durationHours, includedHoursRemaining);
        billableHours = Math.max(0, durationHours - includedHoursApplied);
        membershipName = tier.name;
        hourlyRateCents = tier.extraHourlyRateCents;
        subtotalCents = Math.round(billableHours * hourlyRateCents);
        dailyCapApplied = false;
        if (includedHoursApplied > 0) reservations[holdRef.id] = { hours: includedHoursApplied, expiresAt: now + HOLD_MS };
      }
    }

    const creditReservations = activeCreditReservations(user.accountCreditReservations as Record<string, CreditReservation> | undefined);
    const accountCreditAvailableCents = Math.max(0, Math.round(Number(user.accountCreditCents || 0)) - reservedCreditCents(creditReservations));
    const accountCreditAppliedCents = Math.min(subtotalCents, accountCreditAvailableCents);
    if (accountCreditAppliedCents > 0) creditReservations[holdRef.id] = { amountCents: accountCreditAppliedCents, expiresAt: now + HOLD_MS };

    const freshQuote: BookingQuote = {
      resourceId, resourceName: resource.name, resourceType: resource.type,
      start, end, durationHours, membershipName, includedHoursRemaining, includedHoursApplied,
      billableHours, hourlyRateCents, subtotalCents, accountCreditAvailableCents,
      accountCreditAppliedCents, totalCents: Math.max(0, subtotalCents - accountCreditAppliedCents),
      dailyCapApplied, currency: "usd",
    };
    if (useUsage) {
      tx.set(usageRef, { uid, monthKey: key, usedHours, reservations, updatedAt: now }, { merge: true });
    }
    tx.set(userRef, { accountCreditReservations: creditReservations, updatedAt: now }, { merge: true });
    const hold: AdminHold = {
      id: holdRef.id, kind: "ADMIN_MEMBER", bookedForUid: uid, adminActorUid: adminUid,
      resourceId, resourceName: resource.name, start, end, userId: uid, quote: freshQuote,
      status: "HELD", secretHash: createHash("sha256").update(holdSecret).digest("hex"),
      createdAt: now, expiresAt: now + HOLD_MS,
      membershipUsageId: useUsage ? usageRef.id : null,
      accountCreditReservationCents: accountCreditAppliedCents,
    };
    tx.set(holdRef, hold);
    return freshQuote;
  });
  return { holdRef, quote };
}

async function issueAccess(bookingId: string, resourceId: string, uid: string, start: number, end: number) {
  try { await createAccessGrant(bookingId, resourceId, uid, start, end); }
  catch (error) { logger.error("Access grant failed for Admin-created member booking", { bookingId, uid, error }); }
}

async function finalizeAdminMemberHold(holdId: string) {
  const holdRef = db().collection("bookingHolds").doc(holdId);
  const firstSnap = await holdRef.get();
  if (!firstSnap.exists) throw new HttpsError("not-found", "Booking hold not found.");
  const initial = firstSnap.data() as AdminHold;
  if (initial.kind !== "ADMIN_MEMBER") throw new HttpsError("failed-precondition", "This is not an Admin member-booking hold.");
  if (initial.status === "CONSUMED" && initial.bookingId) return { bookingId: initial.bookingId, createdNow: false };
  if (initial.totalCents === 0) return { bookingId: initial.bookingId || "", createdNow: false };
  if (!initial.paymentId) throw new HttpsError("failed-precondition", "No payment is associated with this hold.");
  const paymentSnap = await db().collection("payments").doc(initial.paymentId).get();
  if (!paymentSnap.exists || paymentSnap.data()?.status !== "paid") throw new HttpsError("failed-precondition", "Payment has not been confirmed yet.");

  const bookingRef = db().collection("bookings").doc();
  const result = await db().runTransaction(async (tx) => {
    const latestSnap = await tx.get(holdRef);
    if (!latestSnap.exists) throw new HttpsError("not-found", "Booking hold not found.");
    const hold = latestSnap.data() as AdminHold;
    if (hold.status === "CONSUMED" && hold.bookingId) return { bookingId: hold.bookingId, createdNow: false };
    const [bookingRange, holdRange, userSnap, usageSnap] = await Promise.all([
      tx.get(db().collection("bookings").where("end", ">", hold.start)),
      tx.get(db().collection("bookingHolds").where("end", ">", hold.start)),
      tx.get(db().collection("users").doc(hold.bookedForUid)),
      hold.membershipUsageId ? tx.get(db().collection("membershipUsage").doc(hold.membershipUsageId)) : Promise.resolve(null),
    ]);
    if (!userSnap.exists) throw new HttpsError("not-found", "Member account no longer exists.");
    const now = Date.now();
    const busy: BusyRecord[] = [
      ...bookingRange.docs.map((doc) => doc.data() as BusyRecord).filter((item) => item.start < hold.end && item.status !== "CANCELLED"),
      ...holdRange.docs.filter((doc) => doc.id !== holdId).map((doc) => doc.data() as BusyRecord).filter((item) => item.start < hold.end && Number(item.expiresAt || 0) > now && !["EXPIRED", "CONSUMED"].includes(String(item.status || ""))),
    ];
    if (resourceConflicts(hold.resourceId, hold.start, hold.end, busy)) throw new HttpsError("aborted", "Payment was received but the held space can no longer be finalized automatically. Staff must reconcile this booking.");
    const user = userSnap.data() || {};
    tx.set(bookingRef, {
      id: bookingRef.id,
      resourceId: hold.resourceId,
      resourceName: hold.resourceName,
      userId: hold.bookedForUid,
      userName: user.displayName || user.email || "Member",
      start: hold.start,
      end: hold.end,
      status: "CONFIRMED",
      totalPrice: hold.quote.totalCents / 100,
      totalCents: hold.quote.totalCents,
      subtotalCents: hold.quote.subtotalCents,
      accountCreditAppliedCents: hold.quote.accountCreditAppliedCents,
      paymentMethod: "STRIPE",
      paymentId: hold.paymentId,
      includedHoursApplied: hold.quote.includedHoursApplied,
      createdByAdminUid: hold.adminActorUid,
      createdAt: Date.now(),
    });
    tx.update(holdRef, { status: "CONSUMED", consumedAt: Date.now(), bookingId: bookingRef.id });
    if (hold.membershipUsageId && usageSnap) consumeUsageReservation(tx, db().collection("membershipUsage").doc(hold.membershipUsageId), usageSnap, holdId);
    consumeCreditReservation(tx, db().collection("users").doc(hold.bookedForUid), userSnap, holdId, hold.quote.accountCreditAppliedCents);
    return { bookingId: bookingRef.id, createdNow: true };
  });
  if (result.createdNow) {
    await issueAccess(result.bookingId, initial.resourceId, initial.bookedForUid, initial.start, initial.end);
    await writeAudit({ action: "booking_created_for_member", memberUid: initial.bookedForUid, adminUid: initial.adminActorUid, details: { bookingId: result.bookingId, holdId, paymentId: initial.paymentId, totalCents: initial.quote.totalCents } });
  }
  return result;
}

export const admin_bookingForMemberBeginCheckout = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret, seamApiKey] },
  async (request) => {
    const adminUid = requireAdmin(request);
    const { uid, resourceId, start, end, returnOrigin } = request.data as { uid: string; resourceId: string; start: number; end: number; returnOrigin: string };
    const origin = safeOrigin(returnOrigin);
    const { data: user } = await requireMember(uid);
    const holdSecret = randomBytes(24).toString("hex");
    const { holdRef, quote } = await createAdminMemberHold(adminUid, uid, resourceId, start, end, holdSecret);

    if (quote.totalCents === 0) {
      const bookingRef = db().collection("bookings").doc();
      await db().runTransaction(async (tx) => {
        const [holdSnap, userSnap] = await Promise.all([tx.get(holdRef), tx.get(db().collection("users").doc(uid))]);
        if (!holdSnap.exists || !userSnap.exists) throw new HttpsError("failed-precondition", "The member booking hold could not be finalized.");
        const hold = holdSnap.data() as AdminHold;
        if (Number(hold.expiresAt || 0) <= Date.now()) throw new HttpsError("deadline-exceeded", "The booking hold expired.");
        const usageSnap = hold.membershipUsageId ? await tx.get(db().collection("membershipUsage").doc(hold.membershipUsageId)) : null;
        tx.set(bookingRef, {
          id: bookingRef.id, resourceId, resourceName: quote.resourceName, userId: uid,
          userName: user.displayName || user.email || "Member", start, end, status: "CONFIRMED",
          totalPrice: 0, totalCents: 0, subtotalCents: quote.subtotalCents,
          accountCreditAppliedCents: quote.accountCreditAppliedCents,
          paymentMethod: quote.accountCreditAppliedCents > 0 ? "ACCOUNT_CREDIT" : "MEMBERSHIP_HOURS",
          includedHoursApplied: quote.includedHoursApplied,
          createdByAdminUid: adminUid,
          createdAt: Date.now(),
        });
        tx.update(holdRef, { status: "CONSUMED", consumedAt: Date.now(), bookingId: bookingRef.id });
        if (hold.membershipUsageId && usageSnap) consumeUsageReservation(tx, db().collection("membershipUsage").doc(hold.membershipUsageId), usageSnap, holdRef.id);
        consumeCreditReservation(tx, db().collection("users").doc(uid), userSnap, holdRef.id, quote.accountCreditAppliedCents);
      });
      await issueAccess(bookingRef.id, resourceId, uid, start, end);
      const auditId = await writeAudit({ action: "booking_created_for_member", memberUid: uid, adminUid, details: { bookingId: bookingRef.id, holdId: holdRef.id, totalCents: 0 } });
      return { kind: "confirmed", bookingId: bookingRef.id, auditId, quote };
    }

    const payment = await createPayment({
      uid,
      provider: "stripe",
      amount: quote.totalCents,
      currency: quote.currency,
      purpose: "booking",
      purposeRefId: holdRef.id,
      status: "pending",
      providerRefs: { holdId: holdRef.id },
    });
    await holdRef.update({ paymentId: payment.id });
    const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    const successUrl = `${origin}/book/complete?adminHoldId=${encodeURIComponent(holdRef.id)}&adminHoldSecret=${encodeURIComponent(holdSecret)}`;
    const session = await provider.createCheckoutSession({
      uid,
      amount: quote.totalCents,
      currency: quote.currency,
      purpose: "booking",
      purposeRefId: holdRef.id,
      successUrl,
      cancelUrl: `${origin}/pricing?booking=cancelled`,
      mode: "payment",
      lineItemLabel: `${quote.resourceName} · ${quote.durationHours} hour${quote.durationHours === 1 ? "" : "s"}`,
      metadata: {
        paymentId: payment.id,
        holdId: holdRef.id,
        purpose: "booking",
        purposeRefId: holdRef.id,
        uid,
        email: String(user.email || ""),
        adminBookedFor: "true",
      },
    });
    await Promise.all([
      updatePaymentStatus(payment.id, "pending", { providerRefs: { holdId: holdRef.id, stripeCheckoutSessionId: session.sessionId } }),
      holdRef.update({ stripeCheckoutSessionId: session.sessionId }),
    ]);
    const auditId = await writeAudit({ action: "booking_checkout_created_for_member", memberUid: uid, adminUid, details: { holdId: holdRef.id, paymentId: payment.id, totalCents: quote.totalCents } });
    return { kind: "checkout", holdId: holdRef.id, holdSecret, expiresAt: Date.now() + HOLD_MS, paymentId: payment.id, checkoutUrl: session.url, auditId, quote };
  },
);

export const admin_bookingForMemberFinalize = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    const { holdId, holdSecret } = request.data as { holdId: string; holdSecret: string };
    if (!holdId || !holdSecret) throw new HttpsError("invalid-argument", "Booking hold credentials are required.");
    const holdSnap = await db().collection("bookingHolds").doc(holdId).get();
    if (!holdSnap.exists) throw new HttpsError("not-found", "Booking hold not found.");
    const hold = holdSnap.data() as AdminHold;
    const secretMatches = hold.secretHash === createHash("sha256").update(holdSecret).digest("hex");
    if (!secretMatches) throw new HttpsError("permission-denied", "Booking hold credentials are invalid.");
    if (hold.status === "CONSUMED" && hold.bookingId) return { success: true, bookingId: hold.bookingId, alreadyFinalized: true };
    if (Number(hold.expiresAt || 0) <= Date.now() && !hold.paymentId) throw new HttpsError("deadline-exceeded", "The booking hold expired.");
    const result = await finalizeAdminMemberHold(holdId);
    return { success: true, bookingId: result.bookingId, alreadyFinalized: !result.createdNow };
  },
);

export const admin_onMemberBookingPaymentUpdated = onDocumentUpdated(
  { document: "payments/{paymentId}", secrets: [seamApiKey] },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || before?.status === "paid" || after.status !== "paid" || after.purpose !== "booking" || !after.purposeRefId) return;
    const holdSnap = await db().collection("bookingHolds").doc(String(after.purposeRefId)).get();
    if (!holdSnap.exists || holdSnap.data()?.kind !== "ADMIN_MEMBER") return;
    try { await finalizeAdminMemberHold(holdSnap.id); }
    catch (error) { logger.error("Automatic finalization of Admin-created member booking failed", { holdId: holdSnap.id, paymentId: event.params.paymentId, error }); }
  },
);
