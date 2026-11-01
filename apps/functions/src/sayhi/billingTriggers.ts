/**
 * SayHi billing triggers (Jonathan, Oct 31, 2026). Both are exported from the
 * booking-transactions deploy source, which already binds the Stripe and
 * Seam secrets they need, and both do nothing unless SAYHI_FLOW_ENABLED is
 * exactly "true" (off in every committed env file).
 *
 *  - chargeOvertimeForVisit: when a kiosk visit closes with extra time past
 *    the booking, take it from a live plan's remaining included hours first,
 *    then charge any rest right away (the member's default payment method,
 *    or the saved booking card for guests) and record the result.
 *    No card or a failed charge flags the visit for staff review.
 *  - cancelBookingsAfterMembershipEnd: when a membership ends, cancel the
 *    plan bookings scheduled after the end and revoke their door codes.
 */
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { sayhiFlowEnabled } from "./config";
import {
  overtimeDescription,
  overtimeForVisit,
  remainingIncludedMinutes,
  shouldChargeOvertime,
  splitOvertime,
  type OvertimeVisit,
} from "./overtime";
import {
  bookingsToCancelAtMembershipEnd,
  membershipEndAt,
  membershipJustEnded,
  type EndingBookingLike,
  type MembershipUserLike,
} from "./membershipEnd";
import { NoCardOnFileError, StripeProvider } from "../payments/stripeProvider";
import { cancelBookingCore, operatorCancellationAmounts } from "../bookingManagement";
import {
  activeUsageReservations,
  hoursFromBookingDocs,
  localMonthKey,
  reservedHours,
  type MembershipUsage,
  type UsageReservation,
} from "../bookingFlexShared";
import { getDeskMembershipTierById } from "../payments/stripeConfig";
import { compMembershipEnded } from "../payments/compMembership";

const VISITS = "kioskVisits";
const db = () => admin.firestore();

type VisitDoc = OvertimeVisit & { uid?: string; bookingIds?: unknown };

const LIVE_PLAN_STATUSES = ["active", "trial", "pastDue"];

/** The member's desk plan when it is live (same rule as the front desk), else null. */
function livePlanTier(user: FirebaseFirestore.DocumentData | undefined, now: number) {
  if (!user || !LIVE_PLAN_STATUSES.includes(String(user.membershipStatus)) || !user.plan) return null;
  if (compMembershipEnded(user, now)) return null;
  return getDeskMembershipTierById(String(user.plan)) || null;
}

export async function chargeOvertimeForVisit(input: {
  visitId: string;
  before: VisitDoc | undefined;
  after: VisitDoc | undefined;
  stripeSecretKey: () => string;
  stripeWebhookSecret: () => string;
}): Promise<void> {
  if (!sayhiFlowEnabled()) return;
  if (!shouldChargeOvertime(input.before, input.after)) return;
  const ref = db().collection(VISITS).doc(input.visitId);

  // Claim the visit once so a retried or duplicate event cannot charge twice,
  // and take extra time out of the plan's included hours in the same step.
  const claimed = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const visit = snap.data() as VisitDoc | undefined;
    if (!visit || (visit.chargeStatus !== "not_charged" && visit.chargeStatus != null)) return null;
    const overtime = overtimeForVisit(visit);
    if (overtime.cents <= 0) return null;
    const uid = String(visit.uid || "");
    const now = Date.now();
    const user = uid ? (await tx.get(db().collection("users").doc(uid))).data() : undefined;
    const tier = livePlanTier(user, now);

    let split = splitOvertime(overtime, 0, Number(visit.rateCents) || 0);
    let usageWrite: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> } | null = null;
    if (tier && tier.includedHoursPerMonth > 0) {
      const monthKey = localMonthKey(Number(visit.bookedWindow?.end));
      const usageRef = db().collection("membershipUsage").doc(`${uid}_${monthKey}`);
      const [usageSnap, visitsSnap] = await Promise.all([
        tx.get(usageRef),
        tx.get(db().collection(VISITS).where("uid", "==", uid)),
      ]);
      let usedHours = 0;
      let reservations: Record<string, UsageReservation> = {};
      if (usageSnap.exists) {
        const usage = usageSnap.data() as MembershipUsage;
        usedHours = Math.max(0, usage.usedHours || 0);
        reservations = activeUsageReservations(usage.reservations);
      } else {
        const bookingsSnap = await tx.get(db().collection("bookings").where("userId", "==", uid));
        usedHours = hoursFromBookingDocs(bookingsSnap.docs, monthKey);
      }
      const walkInIncludedMinutes = visitsSnap.docs
        .map((doc) => doc.data())
        .filter((v) => v.monthKey === monthKey && v.allowanceSource === "monthly")
        .reduce((sum, v) => sum + Math.max(0, Number(v.includedMinutesApplied || 0)), 0);
      const remaining = remainingIncludedMinutes({
        includedHoursPerMonth: tier.includedHoursPerMonth,
        usedHours,
        reservedHours: reservedHours(reservations),
        walkInIncludedMinutes,
      });
      split = splitOvertime(overtime, remaining, Number(visit.rateCents) || 0);
      if (split.includedMinutes > 0) {
        usageWrite = {
          ref: usageRef,
          data: { uid, monthKey, usedHours: usedHours + split.includedMinutes / 60, reservations, updatedAt: now },
        };
      }
    }

    if (usageWrite) tx.set(usageWrite.ref, usageWrite.data, { merge: true });
    const covered = split.chargedCents <= 0;
    tx.update(ref, {
      chargeStatus: covered ? "covered_by_plan_hours" : "charging",
      overtimeBilling: tier ? "plan" : "guest",
      overtimeMinutes: split.minutes,
      overtimeIncludedMinutes: split.includedMinutes,
      overtimeChargedMinutes: split.chargedMinutes,
      overtimeCents: split.chargedCents,
      overtimeClaimedAt: now,
    });
    return covered ? null : { visit, user, tier, split };
  });
  if (!claimed) return;

  const { visit, user, tier, split } = claimed;
  const uid = String(visit.uid || "");
  const bookingIds = Array.isArray(visit.bookingIds) ? visit.bookingIds.map(String) : [];
  try {
    const features = (user?.features || {}) as Record<string, unknown>;
    let bookingPaymentIntentId = "";
    if (!tier) {
      for (const bookingId of bookingIds) {
        const booking = (await db().collection("bookings").doc(bookingId).get()).data();
        const paymentId = booking?.paymentId ? String(booking.paymentId) : "";
        if (!paymentId) continue;
        const payment = (await db().collection("payments").doc(paymentId).get()).data();
        const intentId = String(payment?.providerRefs?.stripePaymentIntentId || "");
        if (intentId) { bookingPaymentIntentId = intentId; break; }
      }
    }
    const provider = new StripeProvider(input.stripeSecretKey(), input.stripeWebhookSecret());
    const charge = await provider.chargeOvertime({
      amountCents: split.chargedCents,
      description: overtimeDescription(split.minutes, split.includedMinutes),
      idempotencyKey: `sayhi-overtime-${input.visitId}`,
      metadata: { uid, visitId: input.visitId, purpose: "overtime" },
      member: tier
        ? {
          uid,
          subscriptionId: String(features.stripeSubscriptionId || user?.stripeSubscriptionId || "") || undefined,
          customerId: String(user?.stripeCustomerId || features.stripeCustomerId || "") || undefined,
        }
        : undefined,
      bookingPaymentIntentId: bookingPaymentIntentId || undefined,
    });
    await ref.update({
      chargeStatus: "charged",
      overtimeCharge: { method: charge.method, id: charge.id, status: charge.status, at: Date.now() },
    });
    logger.info("Overtime charged", { visitId: input.visitId, method: charge.method, cents: split.chargedCents, includedMinutes: split.includedMinutes });
  } catch (err) {
    const noCard = err instanceof NoCardOnFileError;
    await ref.update({
      chargeStatus: noCard ? "no_card_on_file" : "charge_failed",
      needsReview: true,
      reviewReason: noCard ? "overtime_no_card" : "overtime_charge_failed",
      overtimeChargeError: noCard ? "no_card_on_file" : String((err as { code?: string })?.code || "stripe_error"),
    });
    logger.warn("Overtime charge not completed", { visitId: input.visitId, noCard });
  }
}

export async function cancelBookingsAfterMembershipEnd(input: {
  uid: string;
  before: MembershipUserLike;
  after: MembershipUserLike;
  now?: number;
}): Promise<{ cancelled: string[] }> {
  if (!sayhiFlowEnabled()) return { cancelled: [] };
  if (!membershipJustEnded(input.before, input.after)) return { cancelled: [] };
  const endAt = membershipEndAt(input.after, input.now ?? Date.now());
  const snap = await db().collection("bookings").where("userId", "==", input.uid).get();
  const candidates = bookingsToCancelAtMembershipEnd(
    snap.docs.map((doc) => ({ ...(doc.data() as Omit<EndingBookingLike, "id">), id: doc.id })),
    endAt,
  );
  const cancelled: string[] = [];
  for (const booking of candidates) {
    try {
      await cancelBookingCore({
        bookingId: booking.id,
        ownerUid: null,
        actorUid: "system:membership-end",
        actorRole: "admin",
        // Paid portions come back as account credit; no card refund is issued.
        decide: (current) => operatorCancellationAmounts(current, "credit"),
        refundReason: "Membership ended before this booking.",
        creditReason: "Membership ended before this booking.",
      });
      cancelled.push(booking.id);
    } catch (err) {
      logger.error("Membership-end booking cancellation failed", { uid: input.uid, bookingId: booking.id, error: String(err) });
    }
  }
  if (candidates.length) logger.info("Membership-end cleanup", { uid: input.uid, cancelled: cancelled.length, of: candidates.length });
  return { cancelled };
}
