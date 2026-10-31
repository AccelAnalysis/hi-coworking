/**
 * SayHi billing triggers (Jonathan, Oct 31, 2026). Both are exported from the
 * booking-transactions deploy source, which already binds the Stripe and
 * Seam secrets they need, and both do nothing unless SAYHI_FLOW_ENABLED is
 * exactly "true" (off in every committed env file).
 *
 *  - chargeOvertimeForVisit: when a kiosk visit closes with extra time past
 *    the booking, charge it (subscription invoice item for members, the
 *    saved booking card otherwise) and record the result on the visit.
 *  - cancelBookingsAfterMembershipEnd: when a membership ends, cancel the
 *    plan bookings scheduled after the end and revoke their door codes.
 */
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { sayhiFlowEnabled } from "./config";
import { overtimeDescription, overtimeForVisit, shouldChargeOvertime, type OvertimeVisit } from "./overtime";
import {
  bookingsToCancelAtMembershipEnd,
  membershipEndAt,
  membershipJustEnded,
  type EndingBookingLike,
  type MembershipUserLike,
} from "./membershipEnd";
import { NoCardOnFileError, StripeProvider } from "../payments/stripeProvider";
import { cancelBookingCore, operatorCancellationAmounts } from "../bookingManagement";

const VISITS = "kioskVisits";
const db = () => admin.firestore();

type VisitDoc = OvertimeVisit & { uid?: string; bookingIds?: unknown };

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

  // Claim the visit once so a retried or duplicate event cannot charge twice.
  const claimed = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const visit = snap.data() as VisitDoc | undefined;
    if (!visit || (visit.chargeStatus !== "not_charged" && visit.chargeStatus != null)) return null;
    const overtime = overtimeForVisit(visit);
    if (overtime.cents <= 0) return null;
    tx.update(ref, {
      chargeStatus: "charging",
      overtimeMinutes: overtime.minutes,
      overtimeCents: overtime.cents,
      overtimeClaimedAt: Date.now(),
    });
    return { visit, overtime };
  });
  if (!claimed) return;

  const { visit, overtime } = claimed;
  const uid = String(visit.uid || "");
  const bookingIds = Array.isArray(visit.bookingIds) ? visit.bookingIds.map(String) : [];
  try {
    const user = uid ? (await db().collection("users").doc(uid).get()).data() : undefined;
    const features = (user?.features || {}) as Record<string, unknown>;
    const subscriptionId = ["active", "trial", "pastDue"].includes(String(user?.membershipStatus))
      ? String(features.stripeSubscriptionId || user?.stripeSubscriptionId || "")
      : "";
    let bookingPaymentIntentId = "";
    for (const bookingId of bookingIds) {
      const booking = (await db().collection("bookings").doc(bookingId).get()).data();
      const paymentId = booking?.paymentId ? String(booking.paymentId) : "";
      if (!paymentId) continue;
      const payment = (await db().collection("payments").doc(paymentId).get()).data();
      const intentId = String(payment?.providerRefs?.stripePaymentIntentId || "");
      if (intentId) { bookingPaymentIntentId = intentId; break; }
    }
    const provider = new StripeProvider(input.stripeSecretKey(), input.stripeWebhookSecret());
    const charge = await provider.chargeOvertime({
      amountCents: overtime.cents,
      description: overtimeDescription(overtime.minutes),
      idempotencyKey: `sayhi-overtime-${input.visitId}`,
      metadata: { uid, visitId: input.visitId, purpose: "overtime" },
      subscriptionId: subscriptionId || undefined,
      bookingPaymentIntentId: bookingPaymentIntentId || undefined,
    });
    await ref.update({
      chargeStatus: charge.method === "subscription_invoice_item" ? "billed_next_invoice" : "charged",
      overtimeCharge: { method: charge.method, id: charge.id, status: charge.status, at: Date.now() },
    });
    logger.info("Overtime charged", { visitId: input.visitId, method: charge.method, cents: overtime.cents });
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
