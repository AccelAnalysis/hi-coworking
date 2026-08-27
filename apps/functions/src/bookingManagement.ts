import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { evaluateCustomerCancellation } from "./bookingPolicy";
import { getPayment, updatePaymentStatus } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";
import { GUEST_BOOKING_WINDOW_DAYS, getTierById } from "./payments/stripeConfig";
import { createAccessGrant, revokeAccessGrant, seamApiKey } from "./access";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const LOCATION_TIME_ZONE = "America/New_York";
const INCREMENT_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_HOUR = 8;
const CLOSE_HOUR = 20;

type ResourceType = "SEAT" | "MODE";
type BookingData = {
  id: string;
  resourceId: string;
  resourceName?: string;
  userId: string;
  start: number;
  end: number;
  status: string;
  totalCents?: number;
  paymentId?: string;
  paymentMethod?: string;
  includedHoursApplied?: number;
};

function db() { return admin.firestore(); }
function resourceType(resourceId: string): ResourceType { return resourceId.startsWith("mode-") ? "MODE" : "SEAT"; }
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) { return aStart < bEnd && aEnd > bStart; }
function monthKey(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: LOCATION_TIME_ZONE, year: "numeric", month: "2-digit" }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}
function clock(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCATION_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { dayKey: `${v.year}-${v.month}-${v.day}`, minutes: Number(v.hour) * 60 + Number(v.minute) };
}
function validateWindow(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new HttpsError("invalid-argument", "Choose a valid time.");
  if (start % INCREMENT_MS !== 0 || end % INCREMENT_MS !== 0) throw new HttpsError("invalid-argument", "Bookings use 30-minute increments.");
  const s = clock(start); const e = clock(end - 1);
  if (s.dayKey !== e.dayKey) throw new HttpsError("invalid-argument", "Bookings must remain within one day.");
  const endClock = clock(end);
  if (s.minutes < OPEN_HOUR * 60 || endClock.minutes > CLOSE_HOUR * 60) throw new HttpsError("failed-precondition", "That time is outside operating hours.");
  if (start < Date.now()) throw new HttpsError("failed-precondition", "The new start time must be in the future.");
}
async function requireOwnedBooking(uid: string, bookingId: string) {
  const ref = db().collection("bookings").doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Booking not found.");
  const booking = snap.data() as BookingData;
  if (booking.userId !== uid) throw new HttpsError("permission-denied", "This booking does not belong to you.");
  if (booking.status !== "CONFIRMED") throw new HttpsError("failed-precondition", "Only confirmed bookings can be changed.");
  return { ref, booking };
}
async function bookingWindowDays(uid: string) {
  const user = (await db().collection("users").doc(uid).get()).data();
  if (user?.membershipStatus !== "active" || !user?.plan) return GUEST_BOOKING_WINDOW_DAYS;
  return getTierById(user.plan)?.bookingWindowDays ?? GUEST_BOOKING_WINDOW_DAYS;
}
async function revokeBookingAccess(bookingId: string) {
  const grants = await db().collection("accessGrants").where("bookingId", "==", bookingId).get();
  for (const grant of grants.docs) {
    const status = grant.data().status;
    if (status === "pending" || status === "active") {
      await revokeAccessGrant(grant.id, "cancellation", "booking-management");
    }
  }
}
async function restoreIncludedHours(booking: BookingData, percent: number) {
  const applied = Math.max(0, Number(booking.includedHoursApplied || 0));
  if (!applied || percent <= 0) return 0;
  const restored = applied * percent / 100;
  const usageRef = db().collection("membershipUsage").doc(`${booking.userId}_${monthKey(booking.start)}`);
  const adjustmentRef = db().collection("membershipHourAdjustments").doc(`booking_cancel_${booking.id}`);
  let appliedNow = false;
  await db().runTransaction(async (tx) => {
    const [usageSnap, adjustmentSnap] = await Promise.all([tx.get(usageRef), tx.get(adjustmentRef)]);
    if (adjustmentSnap.exists) return;
    tx.set(adjustmentRef, {
      id: adjustmentRef.id,
      userId: booking.userId,
      bookingId: booking.id,
      hours: restored,
      reason: "booking_cancellation",
      createdAt: Date.now(),
    });
    if (usageSnap.exists) {
      const usedHours = Math.max(0, Number(usageSnap.data()?.usedHours || 0));
      tx.update(usageRef, { usedHours: Math.max(0, usedHours - restored), updatedAt: Date.now() });
    }
    appliedNow = true;
  });
  return appliedNow ? restored : restored;
}
async function issueAccountCredit(booking: BookingData, amountCents: number) {
  if (amountCents <= 0) return;
  const creditRef = db().collection("accountCredits").doc(`booking_cancel_${booking.id}`);
  const userRef = db().collection("users").doc(booking.userId);
  await db().runTransaction(async (tx) => {
    const existing = await tx.get(creditRef);
    if (existing.exists) return;
    tx.set(creditRef, {
      id: creditRef.id,
      userId: booking.userId,
      bookingId: booking.id,
      amountCents,
      currency: "usd",
      reason: "late_booking_cancellation",
      status: "available",
      createdAt: Date.now(),
    });
    tx.set(userRef, { accountCreditCents: admin.firestore.FieldValue.increment(amountCents), updatedAt: Date.now() }, { merge: true });
  });
}

export const booking_getCancellationPreview = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to manage this booking.");
  const { bookingId } = request.data as { bookingId: string };
  const { booking } = await requireOwnedBooking(request.auth.uid, bookingId);
  const decision = evaluateCustomerCancellation(resourceType(booking.resourceId), booking.start, Date.now());
  const paidCents = Math.max(0, Number(booking.totalCents || 0));
  return {
    bookingId,
    decision,
    refundCents: Math.round(paidCents * decision.refundPercent / 100),
    accountCreditCents: Math.round(paidCents * decision.accountCreditPercent / 100),
    includedHoursToRestore: Number(booking.includedHoursApplied || 0) * decision.restoreIncludedHoursPercent / 100,
    canReschedule: decision.outcome === "FULL_REFUND",
  };
});

export const booking_cancel = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret, seamApiKey] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to cancel this booking.");
    const { bookingId } = request.data as { bookingId: string };
    const { ref, booking } = await requireOwnedBooking(request.auth.uid, bookingId);
    const decision = evaluateCustomerCancellation(resourceType(booking.resourceId), booking.start, Date.now());
    const paidCents = Math.max(0, Number(booking.totalCents || 0));
    const refundCents = Math.round(paidCents * decision.refundPercent / 100);
    const accountCreditCents = Math.round(paidCents * decision.accountCreditPercent / 100);

    let refundId: string | null = null;
    if (refundCents > 0 && booking.paymentId) {
      const payment = await getPayment(booking.paymentId);
      if (!payment || payment.provider !== "stripe" || payment.status !== "paid") {
        throw new HttpsError("failed-precondition", "The payment must be reconciled before this refund can be issued.");
      }
      const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
      try {
        const refund = await provider.refundCheckoutPayment({
          paymentIntentId: payment.providerRefs?.stripePaymentIntentId,
          checkoutSessionId: payment.providerRefs?.stripeCheckoutSessionId,
          ledgerPaymentId: payment.id,
          amountCents: refundCents,
          idempotencyKey: `booking-cancel-${bookingId}`,
          metadata: { bookingId, paymentId: payment.id, reason: "customer_cancellation" },
        });
        refundId = refund.refundId;
        await updatePaymentStatus(payment.id, "refunded", {
          providerRefs: { stripeRefundId: refund.refundId, stripePaymentIntentId: refund.paymentIntentId },
        });
      } catch (error) {
        logger.error("Booking refund failed", { bookingId, paymentId: payment.id, error });
        throw new HttpsError("internal", "We could not complete the refund. The booking was not cancelled; please try again or contact Hi Coworking.");
      }
    }

    await issueAccountCredit(booking, accountCreditCents);
    const restoredHours = await restoreIncludedHours(booking, decision.restoreIncludedHoursPercent);
    await ref.update({
      status: "CANCELLED",
      cancelledAt: Date.now(),
      cancelledBy: request.auth.uid,
      cancellationOutcome: decision.outcome,
      refundCents,
      accountCreditCents,
      restoredIncludedHours: restoredHours,
      stripeRefundId: refundId,
      updatedAt: Date.now(),
    });
    await revokeBookingAccess(bookingId);

    return { success: true, bookingId, decision, refundCents, accountCreditCents, restoredIncludedHours: restoredHours };
  },
);

export const booking_reschedule = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to reschedule this booking.");
    const { bookingId, start, end } = request.data as { bookingId: string; start: number; end: number };
    validateWindow(start, end);
    const { ref, booking } = await requireOwnedBooking(request.auth.uid, bookingId);
    const decision = evaluateCustomerCancellation(resourceType(booking.resourceId), booking.start, Date.now());
    if (decision.outcome !== "FULL_REFUND") {
      throw new HttpsError("failed-precondition", "This booking is inside the late-cancellation window. Cancel under the displayed policy and make a new booking instead.");
    }
    if (end - start !== booking.end - booking.start) {
      throw new HttpsError("invalid-argument", "Self-service rescheduling keeps the same duration. Cancel and rebook to change duration.");
    }
    if ((booking.includedHoursApplied || 0) > 0 && monthKey(start) !== monthKey(booking.start)) {
      throw new HttpsError("failed-precondition", "A membership-hours booking cannot be moved into a different membership month. Cancel and rebook instead.");
    }
    const horizonDays = await bookingWindowDays(request.auth.uid);
    if (start > Date.now() + horizonDays * DAY_MS) throw new HttpsError("failed-precondition", `That date is outside your ${horizonDays}-day booking window.`);

    await db().runTransaction(async (tx) => {
      const [bookingRange, holds] = await Promise.all([
        tx.get(db().collection("bookings").where("end", ">", start)),
        tx.get(db().collection("bookingHolds").where("end", ">", start)),
      ]);
      const type = resourceType(booking.resourceId);
      const conflict = bookingRange.docs.some((doc) => {
        if (doc.id === bookingId) return false;
        const other = doc.data() as BookingData;
        if (other.status !== "CONFIRMED" || !overlaps(start, end, other.start, other.end)) return false;
        if (other.resourceId === booking.resourceId) return true;
        return type === "MODE" || resourceType(other.resourceId) === "MODE";
      }) || holds.docs.some((doc) => {
        const hold = doc.data();
        if (hold.status === "EXPIRED" || hold.status === "CONSUMED" || Number(hold.expiresAt || 0) <= Date.now()) return false;
        if (!overlaps(start, end, hold.start, hold.end)) return false;
        if (hold.resourceId === booking.resourceId) return true;
        return type === "MODE" || resourceType(hold.resourceId) === "MODE";
      });
      if (conflict) throw new HttpsError("failed-precondition", "That new time is no longer available.");
      tx.update(ref, { start, end, rescheduledAt: Date.now(), previousStart: booking.start, previousEnd: booking.end, updatedAt: Date.now() });
    });

    await revokeBookingAccess(bookingId);
    try {
      await createAccessGrant(bookingId, booking.resourceId, booking.userId, start, end);
    } catch (error) {
      logger.error("Access reissue failed after reschedule", { bookingId, error });
    }
    return { success: true, bookingId, start, end };
  },
);
