/**
 * Stripe Webhook Handler + Entitlement Updater (PR-10)
 *
 * Receives Stripe webhook events, de-duplicates via runIdempotentWebhook()
 * (processing lease; success recorded only after all side effects; failures
 * are retried on Stripe's next delivery),
 * updates the unified payment ledger, and provisions/revokes membership
 * entitlements on the users/{uid} doc.
 */

import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { StripeProvider } from "./stripeProvider";
import { runIdempotentWebhook } from "./idempotency";
import { updatePaymentStatus } from "./ledger";
import { syncPaymentToQBO } from "./qboAccountingSync";
import type { WebhookResult } from "./types";
import { maybeFinalizeEventV2Checkout } from "../eventWebhookBridge";
import { sendMembershipWelcomeEmail } from "./membershipWelcomeEmail";
import { STRIPE_MEMBERSHIP_SOURCE, shouldIgnoreStripeMembershipEvent } from "./compMembership";
import {
  failedPaymentUpdates,
  isFirstSubscriptionInvoice,
  renewalUpdates,
  type MemberBillingState,
} from "./stripeInvoice";
import {
  subscriptionUpdatedUpdates,
  type MemberSubscriptionState,
} from "./stripeSubscription";
import { handleStripeRefund } from "./stripeRefundHandler";
import {
  sendCancellationScheduledEmail,
  sendMembershipEndedEmail,
} from "./memberNoticeEmails";
import { notifyCancellationScheduled, notifyMembershipEnded } from "./memberNotifications";

function getDb() { return admin.firestore(); }

/**
 * Create a doc with a deterministic ID once. A retried webhook that already
 * created it leaves the first write (and its timestamps) untouched.
 */
async function createOnce(
  ref: FirebaseFirestore.DocumentReference,
  data: Record<string, unknown>,
): Promise<boolean> {
  try {
    await ref.create(data);
    return true;
  } catch (err) {
    if ((err as { code?: unknown })?.code === 6) return false; // ALREADY_EXISTS
    throw err;
  }
}

interface EventDocLite {
  id: string;
  status: "draft" | "published" | "cancelled" | "completed";
  seatCap?: number;
  registrationCount?: number;
  ticketTypes?: Array<{
    id: string;
    name: string;
    priceCents: number;
    soldCount?: number;
  }>;
  sponsorships?: Array<{
    id: string;
    name: string;
    priceCents: number;
    slots: number;
    soldCount: number;
  }>;
}

/**
 * Process a raw Stripe webhook request.
 * Called from the HTTP Cloud Function exported in index.ts.
 */
export async function handleStripeWebhook(
  rawBody: Buffer,
  headers: Record<string, string>,
  stripeSecretKey: string,
  stripeWebhookSecret: string,
  intuitClientId?: string,
  intuitClientSecret?: string,
  resendApiKey?: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const provider = new StripeProvider(stripeSecretKey, stripeWebhookSecret);

  let result: WebhookResult;
  try {
    result = await provider.handleWebhook(rawBody, headers);
  } catch (err) {
    logger.error("Stripe webhook parse error", { err });
    return { status: 400, body: { error: "Invalid webhook" } };
  }

  // Idempotency: a lease while processing, "success" only after every side
  // effect below has completed, and "failed" (retryable) on any error, so a
  // Stripe retry of a failed event is processed again instead of skipped.
  const run = await runIdempotentWebhook(result.eventId, "stripe", () =>
    processWebhookResult(result, intuitClientId, intuitClientSecret, resendApiKey),
  );

  if (run.outcome === "duplicate") {
    return { status: 200, body: { received: true, skipped: true } };
  }
  if (run.outcome === "in_progress") {
    // Non-2xx so Stripe delivers again later, after the current attempt ends.
    return { status: 409, body: { error: "Event is already being processed" } };
  }
  if (run.outcome === "failed") {
    logger.error("Stripe webhook processing error", {
      eventId: result.eventId,
      attempt: run.attempt,
      err: run.error,
    });
    return { status: 500, body: { error: "Processing failed" } };
  }

  return { status: 200, body: { received: true } };
}

/**
 * Route the webhook result to the appropriate handler.
 */
async function processWebhookResult(
  result: WebhookResult,
  intuitClientId?: string,
  intuitClientSecret?: string,
  resendApiKey?: string
): Promise<void> {
  switch (result.action) {
    case "payment_succeeded":
      await handlePaymentSucceeded(result, intuitClientId, intuitClientSecret, resendApiKey);
      break;
    case "payment_failed":
      await handlePaymentFailed(result);
      if (result.metadata?.reason === "subscription_cancelled") {
        // customer.subscription.deleted. Sends only when the handler above
        // actually ended the membership (never for comp members). Never throws.
        await notifyMembershipEnded({
          uid: result.metadata.uid || "",
          subscriptionId: result.metadata.subscriptionId || "",
          endedAtMs: Number(result.metadata.endedAtMs) || 0,
          planId: result.metadata.plan || "",
        });
        await sendMembershipEndedEmail({
          uid: result.metadata.uid || "",
          subscriptionId: result.metadata.subscriptionId || "",
          endedAtMs: Number(result.metadata.endedAtMs) || 0,
          planId: result.metadata.plan || "",
          eventId: result.eventId,
        }, { apiKey: resendApiKey });
      }
      break;
    case "subscription_invoice_paid":
    case "subscription_invoice_failed":
      await handleSubscriptionInvoice(result);
      break;
    case "subscription_updated":
      await handleSubscriptionUpdated(result, resendApiKey);
      break;
    case "refund":
      if (result.refund) {
        await handleStripeRefund(result, resendApiKey);
      } else if (result.paymentId) {
        await updatePaymentStatus(result.paymentId, "refunded");
      }
      break;
    case "unknown":
      // No action needed
      break;
  }
}

/**
 * On successful payment/subscription:
 * 1. Update or create payment doc in ledger
 * 2. Provision membership entitlements on users/{uid}
 * 3. Sync to QBO accounting if connected (PR-14)
 */
async function handlePaymentSucceeded(
  result: WebhookResult,
  intuitClientId?: string,
  intuitClientSecret?: string,
  resendApiKey?: string
): Promise<void> {
  const uid = result.metadata?.uid;
  const subscriptionId = result.metadata?.subscriptionId;
  const plan = result.metadata?.plan;

  // Update existing payment doc if we have a paymentId
  if (result.paymentId) {
    await updatePaymentStatus(result.paymentId, "paid", {
      providerRefs: {
        stripeSubscriptionId: subscriptionId || "",
        stripeCustomerId: result.metadata?.customerId || "",
        ...(result.metadata?.checkoutSessionId ? { stripeCheckoutSessionId: result.metadata.checkoutSessionId } : {}),
        ...(result.metadata?.paymentIntentId ? { stripePaymentIntentId: result.metadata.paymentIntentId } : {}),
      },
    });
  }

  // Events v2 finalization consumes the authoritative capacity hold. Do this
  // before the legacy event commerce branch and return from that branch once
  // handled so a v2 payment cannot create a duplicate legacy registration.
  const handledByEventV2 = await maybeFinalizeEventV2Checkout({
    checkoutType: result.metadata?.checkoutType,
    holdId: result.metadata?.holdId,
    paymentId: result.paymentId,
  });

  // Provision membership entitlements
  if (uid && plan) {
    await provisionMembership(uid, plan, subscriptionId, result.eventId);

    // Welcome email, once per Checkout session. Never throws, so a send
    // failure cannot fail the webhook or undo the activation above.
    if (result.metadata?.purpose === "membership") {
      await sendMembershipWelcomeEmail(result, { apiKey: resendApiKey });
    }
  }

  // Handle Referral Payouts (PR-16)
  if (result.metadata?.purpose === "referral" && result.metadata.purposeRefId) {
    const referralId = result.metadata.purposeRefId;
    await getDb().collection("referrals").doc(referralId).update({
      status: "paid",
      paidAt: Date.now(),
      payoutMethod: "platform",
      payoutPaymentId: result.paymentId || "",
      updatedAt: Date.now(),
    });
    logger.info("Referral marked as paid via platform", { referralId, paymentId: result.paymentId });
  }

  // Handle Bookstore Fulfillment (PR-19)
  if (result.metadata?.bookId) {
    const bookId = result.metadata.bookId;
    const purchaseId = `purchase_${result.eventId}_${bookId}`;
    await createOnce(getDb().collection("bookPurchases").doc(purchaseId), {
      id: purchaseId,
      bookId: bookId,
      userId: uid || null,
      email: result.metadata.email || null,
      stripeSessionId: result.eventId,
      variantId: result.metadata.variantId || null,
      quantity: parseInt(result.metadata.quantity || "1"),
      accessGrantedAt: Date.now(),
      createdAt: Date.now(),
    });
    logger.info("Book purchase fulfilled", { bookId, uid, purchaseId });
  }

  // Handle legacy Event finalization (tickets/sponsorship/vendor tables) only
  // when this was not an Events v2 checkout.
  if (!handledByEventV2 && (result.metadata?.purpose === "event" || result.metadata?.eventId)) {
    await finalizeEventCommerce(result);
  }

  // Sync to QBO accounting (PR-14) — non-fatal
  if (result.paymentId && intuitClientId && intuitClientSecret) {
    try {
      await syncPaymentToQBO(result.paymentId, intuitClientId, intuitClientSecret);
    } catch (err) {
      logger.error("QBO sync after Stripe payment failed (non-fatal)", {
        paymentId: result.paymentId,
        err,
      });
    }
  }
}

async function finalizeEventCommerce(result: WebhookResult): Promise<void> {
  const checkoutType = result.metadata?.checkoutType;

  if (checkoutType === "sponsorship") {
    await finalizeSponsorshipPurchase(result);
    return;
  }

  if (checkoutType === "vendor_table") {
    await finalizeVendorTablePurchase(result);
    return;
  }

  await finalizeTicketPurchase(result);
}

async function finalizeTicketPurchase(result: WebhookResult): Promise<void> {
  const eventId = result.metadata?.eventId || result.metadata?.purposeRefId;
  const uid = result.metadata?.uid;
  if (!eventId || !uid) return;

  const ticketTypeId = result.metadata?.ticketTypeId || "";
  const quantity = Math.max(1, parseInt(result.metadata?.quantity || "1", 10) || 1);

  const db = getDb();
  const eventRef = db.collection("events").doc(eventId);
  const registrationRef = eventRef.collection("registrations").doc(uid);

  await db.runTransaction(async (tx) => {
    const [eventSnap, registrationSnap] = await Promise.all([
      tx.get(eventRef),
      tx.get(registrationRef),
    ]);

    if (!eventSnap.exists || registrationSnap.exists) return;

    const eventDoc = eventSnap.data() as EventDocLite;
    const currentRegistrationCount = eventDoc.registrationCount || 0;
    if (typeof eventDoc.seatCap === "number" && currentRegistrationCount + quantity > eventDoc.seatCap) {
      throw new Error(`Seat cap exceeded during webhook finalization for event ${eventId}`);
    }

    // Only include optional fields that have a value: Firestore rejects
    // `undefined` in this bundle (no ignoreUndefinedProperties).
    const registration = {
      uid,
      eventId,
      ...(result.metadata?.displayName ? { displayName: result.metadata.displayName } : {}),
      ...(result.metadata?.email ? { email: result.metadata.email } : {}),
      registeredAt: Date.now(),
      ...(result.paymentId ? { paymentId: result.paymentId } : {}),
      ...(ticketTypeId ? { ticketTypeId } : {}),
      quantity,
      status: "active",
    };

    tx.set(registrationRef, registration);

    const updatePayload: Record<string, unknown> = {
      registrationCount: FieldValue.increment(quantity),
      updatedAt: Date.now(),
    };

    if (ticketTypeId && eventDoc.ticketTypes?.length) {
      updatePayload.ticketTypes = eventDoc.ticketTypes.map((t) => (
        t.id === ticketTypeId
          ? { ...t, soldCount: (t.soldCount || 0) + quantity }
          : t
      ));
    }

    tx.update(eventRef, updatePayload);
  });
}

async function finalizeSponsorshipPurchase(result: WebhookResult): Promise<void> {
  const eventId = result.metadata?.eventId || result.metadata?.purposeRefId;
  const uid = result.metadata?.uid;
  const sponsorshipTierId = result.metadata?.sponsorshipTierId;
  const paymentId = result.paymentId;
  if (!eventId || !uid || !sponsorshipTierId || !paymentId) return;

  const db = getDb();
  const eventRef = db.collection("events").doc(eventId);
  const sponsorRef = eventRef.collection("sponsors").doc(paymentId);

  await db.runTransaction(async (tx) => {
    const [eventSnap, sponsorSnap] = await Promise.all([tx.get(eventRef), tx.get(sponsorRef)]);
    if (!eventSnap.exists || sponsorSnap.exists) return;

    const eventDoc = eventSnap.data() as EventDocLite;
    const tiers = eventDoc.sponsorships || [];
    const tier = tiers.find((t) => t.id === sponsorshipTierId);
    if (!tier) {
      throw new Error(`Sponsorship tier ${sponsorshipTierId} missing for event ${eventId}`);
    }
    if (tier.soldCount >= tier.slots) {
      throw new Error(`Sponsorship tier ${sponsorshipTierId} sold out during finalization`);
    }

    const nextTiers = tiers.map((t) => (
      t.id === sponsorshipTierId
        ? { ...t, soldCount: t.soldCount + 1 }
        : t
    ));

    tx.set(sponsorRef, {
      id: paymentId,
      paymentId,
      eventId,
      sponsorshipTierId,
      uid,
      createdAt: Date.now(),
      status: "active",
    });
    tx.update(eventRef, { sponsorships: nextTiers, updatedAt: Date.now() });
  });
}

async function finalizeVendorTablePurchase(result: WebhookResult): Promise<void> {
  const eventId = result.metadata?.eventId || result.metadata?.purposeRefId;
  const uid = result.metadata?.uid;
  const paymentId = result.paymentId;
  if (!eventId || !uid || !paymentId) return;

  const db = getDb();
  const vendorTableRef = db.collection("events").doc(eventId).collection("vendorTables").doc(paymentId);
  await createOnce(vendorTableRef, {
    id: paymentId,
    paymentId,
    eventId,
    uid,
    createdAt: Date.now(),
    status: "active",
  });
}

/**
 * On failed payment:
 * 1. Update payment doc
 * 2. Downgrade membership status to pastDue or cancelled
 */
async function handlePaymentFailed(result: WebhookResult): Promise<void> {
  if (result.paymentId) {
    await updatePaymentStatus(result.paymentId, "failed");
  }

  const uid = result.metadata?.uid;
  const reason = result.metadata?.reason;

  if (uid) {
    const userRef = getDb().collection("users").doc(uid);
    const current = (await userRef.get()).data();
    // A complimentary membership has no paid subscription: a failed payment
    // or a deleted (old) subscription must not end or downgrade it.
    if (shouldIgnoreStripeMembershipEvent(current)) {
      logger.info("Complimentary membership left unchanged by Stripe payment failure", {
        uid,
        reason,
      });
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };

    if (reason === "subscription_cancelled") {
      updates.membershipStatus = "cancelled";
      updates.plan = null;
      updates.expiresAt = Date.now();
    } else {
      updates.membershipStatus = "pastDue";
    }

    await userRef.update(updates);
    logger.info("Membership status downgraded", { uid, reason, updates });
  }
}

/**
 * Find the member for a subscription: uid from the subscription metadata
 * first, then a users doc that stored this subscription ID.
 */
async function resolveSubscriptionMember(
  uid: string | undefined,
  subscriptionId: string,
): Promise<string> {
  if (uid) return uid;
  const users = getDb().collection("users");
  for (const field of ["features.stripeSubscriptionId", "stripeSubscriptionId"]) {
    const snap = await users.where(field, "==", subscriptionId).limit(1).get();
    if (!snap.empty) return snap.docs[0].id;
  }
  return "";
}

/**
 * Renewal (invoice.payment_succeeded) and failed payment (invoice.payment_failed)
 * for a membership subscription. Idempotent per event (webhookEvents) and per
 * invoice (lastPaidInvoiceId / lastFailedInvoiceId on the user doc).
 */
async function handleSubscriptionInvoice(result: WebhookResult): Promise<void> {
  const meta = result.metadata || {};
  const subscriptionId = meta.subscriptionId || "";
  const invoiceId = meta.invoiceId || "";
  const paid = result.action === "subscription_invoice_paid";

  // The first invoice is paid inside Checkout, and checkout.session.completed
  // provisions the membership. Ignoring it here avoids racing that event.
  if (isFirstSubscriptionInvoice(meta.billingReason)) {
    logger.info("First subscription invoice handled by checkout, skipping", {
      subscriptionId,
      invoiceId,
      paid,
    });
    return;
  }

  const uid = await resolveSubscriptionMember(meta.uid, subscriptionId);
  if (!uid) {
    logger.warn("No member found for subscription invoice", { subscriptionId, invoiceId, paid });
    return;
  }

  const userRef = getDb().collection("users").doc(uid);
  const applied = await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) return null;
    const user = (snap.data() || {}) as MemberBillingState;
    const now = Date.now();
    const updates = paid
      ? renewalUpdates(user, {
        invoiceId,
        subscriptionId,
        plan: meta.plan || "",
        periodEndMs: Number(meta.periodEndMs) || 0,
      }, now)
      : failedPaymentUpdates(user, { invoiceId, periodEndMs: Number(meta.periodEndMs) || 0 }, now);
    if (!updates) return null;
    tx.update(userRef, updates);
    return updates;
  });

  logger.info(paid ? "Membership renewed from invoice" : "Membership flagged past due from invoice (access kept during Stripe retries)", {
    uid,
    subscriptionId,
    invoiceId,
    applied: Boolean(applied),
    expiresAt: applied?.expiresAt,
  });
}

/**
 * Set membership entitlements on the user doc after a successful subscription.
 * Once per Stripe event: a retried delivery of the same checkout event (after
 * a later step failed) does not re-activate a membership that changed since.
 */
async function provisionMembership(
  uid: string,
  plan: string,
  subscriptionId: string | undefined,
  eventId: string,
): Promise<void> {
  const userRef = getDb().collection("users").doc(uid);
  const applied = await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (alreadyProvisionedByEvent(snap.data(), eventId)) return null;

    const now = Date.now();
    const updates: Record<string, unknown> = {
      membershipStatus: "active",
      // A paid Checkout replaces any complimentary membership.
      membershipSource: STRIPE_MEMBERSHIP_SOURCE,
      compEndsAt: null,
      plan,
      expiresAt: now + 35 * 24 * 60 * 60 * 1000,
      membershipProvisionEventId: eventId,
      updatedAt: now,
    };
    if (subscriptionId) {
      updates["features.stripeSubscriptionId"] = subscriptionId;
    }
    // update() (not set) keeps the old behaviour: a missing users doc fails
    // the event, which is now retried instead of silently dropped.
    tx.update(userRef, updates);
    return updates;
  });

  if (!applied) {
    logger.info("Membership already provisioned by this event, skipping", { uid, eventId });
    return;
  }
  logger.info("Membership provisioned", { uid, plan, expiresAt: applied.expiresAt });
}

/** True when users/{uid} was already provisioned by this Stripe event. */
export function alreadyProvisionedByEvent(
  user: Record<string, unknown> | undefined,
  eventId: string,
): boolean {
  return Boolean(eventId) && user?.membershipProvisionEventId === eventId;
}

/**
 * customer.subscription.updated, e.g. a plan change or cancellation made in
 * the Stripe Customer Portal. Keeps plan, the scheduled end date, and the
 * Stripe customer ID in step with the subscription. Idempotent per event
 * (webhookEvents) and ordered per member (lastSubscriptionEventAt), and never
 * changes membershipStatus: see subscriptionUpdatedUpdates.
 */
async function handleSubscriptionUpdated(result: WebhookResult, resendApiKey?: string): Promise<void> {
  const meta = result.metadata || {};
  const subscriptionId = meta.subscriptionId || "";
  if (!subscriptionId) return;

  const uid = await resolveSubscriptionMember(meta.uid, subscriptionId);
  if (!uid) {
    logger.warn("No member found for subscription update", { subscriptionId });
    return;
  }

  const info = {
    subscriptionId,
    customerId: meta.customerId || "",
    uid,
    status: meta.status || "",
    priceId: meta.priceId || "",
    cancelAtPeriodEnd: meta.cancelAtPeriodEnd === "true",
    cancelAtMs: Number(meta.cancelAtMs) || 0,
    eventCreatedMs: Number(meta.eventCreatedMs) || 0,
  };

  const userRef = getDb().collection("users").doc(uid);
  const decision = await getDb().runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) return { apply: false as const, reason: "no_user_doc" };
    const user = (snap.data() || {}) as MemberSubscriptionState;
    const next = subscriptionUpdatedUpdates(user, info, Date.now());
    if (next.apply) tx.update(userRef, next.updates);
    return next;
  });

  if (decision.unknownPrice) {
    logger.warn("Subscription price is not a known membership tier; plan left unchanged", {
      uid,
      subscriptionId,
      priceId: info.priceId,
    });
  }
  logger.info("Subscription update processed", {
    uid,
    subscriptionId,
    applied: decision.apply,
    reason: decision.apply ? undefined : decision.reason,
    plan: decision.apply ? decision.updates.plan : undefined,
    cancelAtPeriodEnd: info.cancelAtPeriodEnd,
  });

  // The member scheduled a cancellation (or its date moved): confirm it once
  // per subscription and end date. Not sent when the update was skipped
  // (comp membership, other subscription, stale). Never throws.
  const scheduledEnd = decision.apply ? decision.updates.cancelAt : undefined;
  if (typeof scheduledEnd === "number" && scheduledEnd > 0) {
    await notifyCancellationScheduled({ uid, subscriptionId, activeUntilMs: scheduledEnd });
    await sendCancellationScheduledEmail({
      uid,
      subscriptionId,
      activeUntilMs: scheduledEnd,
      eventId: result.eventId,
    }, { apiKey: resendApiKey });
  }
}
