/**
 * Stripe refund webhook handler (charge.refunded, refund.updated,
 * refund.failed). Called from stripe_webhook's "refund" action.
 *
 * 1. Ledger: finds the payments/{id} doc for the charge and records the
 *    charge's refund state (status refunded / partially_refunded, or back to
 *    paid when every refund failed; amountRefunded; refundedAt). Derived from
 *    the charge's current state, so replays converge on the same result.
 * 2. Membership refunds only (a membership payment or a subscription
 *    invoice): users/{uid}.lastRefund for My Hi, an in-app notification and
 *    a refund confirmation email, each once per refund. Event, booking and
 *    bookstore refunds keep the notices their own refund flows send.
 *
 * Membership status is never changed here (see stripeRefund.ts).
 * Notification and email failures are logged and never fail the webhook.
 */

import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { sendRefundEmail } from "./memberNoticeEmails";
import {
  formatMoney,
  isNotifiableRefund,
  memberRefundSummary,
  refundDestination,
  refundLedgerUpdates,
  type MemberRefundSummary,
} from "./stripeRefund";
import type { StripeRefundLine, StripeRefundSnapshot, WebhookResult } from "./types";

function getDb() { return admin.firestore(); }

/** Refunds older than this get the ledger update but no new notice. */
export const REFUND_NOTICE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * payments/{id} for a refunded charge: the paymentId in Stripe metadata, the
 * first (Checkout) invoice of a subscription, or the PaymentIntent.
 * Renewal invoices have no payments doc (renewals update users/{uid} only).
 */
export async function findRefundedPayment(
  db: FirebaseFirestore.Firestore,
  snapshot: StripeRefundSnapshot,
): Promise<FirebaseFirestore.DocumentReference | null> {
  const payments = db.collection("payments");
  if (snapshot.paymentId) {
    const ref = payments.doc(snapshot.paymentId);
    if ((await ref.get()).exists) return ref;
  }
  if (snapshot.subscriptionId && snapshot.billingReason === "subscription_create") {
    const bySubscription = await payments
      .where("providerRefs.stripeSubscriptionId", "==", snapshot.subscriptionId)
      .limit(1)
      .get();
    if (!bySubscription.empty) return bySubscription.docs[0].ref;
  }
  if (snapshot.paymentIntentId && !snapshot.invoiceId) {
    const byIntent = await payments
      .where("providerRefs.stripePaymentIntentId", "==", snapshot.paymentIntentId)
      .limit(1)
      .get();
    if (!byIntent.empty) return byIntent.docs[0].ref;
  }
  return null;
}

async function resolveMember(
  db: FirebaseFirestore.Firestore,
  snapshot: StripeRefundSnapshot,
  paymentUid: string,
): Promise<string> {
  if (snapshot.uid) return snapshot.uid;
  if (paymentUid) return paymentUid;
  const users = db.collection("users");
  const lookups: Array<[string, string]> = [];
  if (snapshot.subscriptionId) {
    lookups.push(["features.stripeSubscriptionId", snapshot.subscriptionId]);
    lookups.push(["stripeSubscriptionId", snapshot.subscriptionId]);
  }
  for (const [field, value] of lookups) {
    const snap = await users.where(field, "==", value).limit(1).get();
    if (!snap.empty) return snap.docs[0].id;
  }
  return "";
}

export function refundNotification(
  uid: string,
  snapshot: StripeRefundSnapshot,
  refund: StripeRefundLine,
  now: number,
) {
  const id = `refund_${refund.id}`;
  return {
    id,
    uid,
    type: "payment" as const,
    title: "Refund issued",
    body: `We refunded ${formatMoney(refund.amountCents, snapshot.currency)} to ${refundDestination(snapshot)}. It usually takes 5–10 business days to appear on your statement.`,
    linkTo: "/my-hi",
    read: false,
    createdAt: now,
  };
}

export async function handleStripeRefund(
  result: WebhookResult,
  resendApiKey?: string,
): Promise<void> {
  const snapshot = result.refund;
  if (!snapshot?.chargeId) return;
  const db = getDb();
  const logContext = {
    eventId: result.eventId,
    chargeId: snapshot.chargeId,
    refundId: snapshot.refundId,
  };

  // 1. Ledger
  let paymentUid = "";
  let purpose = "";
  const paymentRef = await findRefundedPayment(db, snapshot);
  if (paymentRef) {
    const outcome = await db.runTransaction(async (tx) => {
      const doc = await tx.get(paymentRef);
      const data = doc.data() || {};
      const next = refundLedgerUpdates(data, snapshot, Date.now());
      tx.update(paymentRef, next.updates);
      return {
        uid: typeof data.uid === "string" ? data.uid : "",
        purpose: typeof data.purpose === "string" ? data.purpose : "",
        previous: data.status,
        status: next.status,
      };
    });
    paymentUid = outcome.uid;
    purpose = outcome.purpose;
    logger.info("Refund recorded on payment", {
      ...logContext,
      paymentId: paymentRef.id,
      previousStatus: outcome.previous,
      status: outcome.status,
      amountRefunded: snapshot.amountRefundedCents,
    });
  } else {
    logger.info("No ledger payment for refunded charge", {
      ...logContext,
      invoiceId: snapshot.invoiceId,
      billingReason: snapshot.billingReason,
    });
  }

  // 2. Membership refund notices
  const isMembership = purpose === "membership" || Boolean(snapshot.subscriptionId);
  if (!isMembership) return;
  const uid = await resolveMember(db, snapshot, paymentUid);
  if (!uid) {
    logger.warn("Membership refund: no member found", logContext);
    return;
  }

  try {
    const userRef = db.collection("users").doc(uid);
    await db.runTransaction(async (tx) => {
      const user = await tx.get(userRef);
      if (!user.exists) return;
      const existing = (user.data()?.lastRefund || null) as Partial<MemberRefundSummary> | null;
      const summary = memberRefundSummary(existing, snapshot);
      if (summary) tx.update(userRef, { lastRefund: summary, updatedAt: Date.now() });
    });
  } catch (error) {
    logger.error("Membership refund: could not update My Hi summary (non-fatal)", {
      ...logContext,
      uid,
      error: String(error),
    });
  }

  const now = Date.now();
  const notifiable = snapshot.refunds.filter(
    (refund) => isNotifiableRefund(refund) && now - refund.createdMs <= REFUND_NOTICE_MAX_AGE_MS,
  );
  for (const refund of notifiable) {
    const notification = refundNotification(uid, snapshot, refund, now);
    try {
      // create() fails if it exists, so a replay never resets "read".
      await db.collection("notifications").doc(notification.id).create(notification);
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code !== 6 && code !== "already-exists") {
        logger.error("Refund notification failed (non-fatal)", { ...logContext, uid, error: String(error) });
      }
    }
    await sendRefundEmail(uid, snapshot, refund, { apiKey: resendApiKey });
  }
}
