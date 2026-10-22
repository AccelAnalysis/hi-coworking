import { randomUUID } from "node:crypto";
import { subscriptionMembership } from "./membership";
/**
 * Stripe Webhook Handler + Entitlement Updater (PR-10)
 *
 * Receives Stripe webhook events, de-duplicates via ensureIdempotent(),
 * updates the unified payment ledger, and provisions/revokes membership
 * entitlements on the users/{uid} doc.
 */

import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { StripeProvider } from "./stripeProvider";
import { ensureIdempotent, markWebhookResult } from "./idempotency";
import { updatePaymentStatus } from "./ledger";
import { syncPaymentToQBO } from "./qboAccountingSync";
import type { WebhookResult } from "./types";
import { maybeFinalizeEventV2Checkout } from "../eventWebhookBridge";

function getDb() { return admin.firestore(); }

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
  intuitClientSecret?: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const provider = new StripeProvider(stripeSecretKey, stripeWebhookSecret);

  let result: WebhookResult;
  try {
    result = await provider.handleWebhook(rawBody, headers);
  } catch (err) {
    logger.error("Stripe webhook parse error", { err });
    return { status: 400, body: { error: "Invalid webhook" } };
  }

  // Idempotency check
  let isNew: string | false;
  try {
    isNew = await ensureIdempotent(result.eventId, "stripe");
  } catch (err) {
    logger.warn("Stripe webhook claim unavailable; retry required", { eventId: result.eventId, err });
    return { status: 500, body: { error: "Retry required" } };
  }
  if (!isNew) {
    return { status: 200, body: { received: true, skipped: true } };
  }

  try {
    await syncMembership(result, provider);
    await processWebhookResult(result, intuitClientId, intuitClientSecret);
    await markWebhookResult(result.eventId, "success", isNew);
  } catch (err) {
    logger.error("Stripe webhook processing error", { eventId: result.eventId, err });
    await markWebhookResult(result.eventId, `error: ${err}`, isNew);
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
  intuitClientSecret?: string
): Promise<void> {
  switch (result.action) {
    case "payment_succeeded":
      await handlePaymentSucceeded(result, intuitClientId, intuitClientSecret);
      break;
    case "payment_failed":
      await handlePaymentFailed(result);
      break;
    case "refund":
      if (result.paymentId) {
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
  intuitClientSecret?: string
): Promise<void> {
  const uid = result.metadata?.uid;
  const subscriptionId = result.metadata?.subscriptionId;

  // Update existing payment doc if we have a paymentId
  if (result.paymentId) {
    const paymentRef = getDb().collection("payments").doc(result.paymentId);
    const fulfill = await getDb().runTransaction(async (tx) => {
      const payment = (await tx.get(paymentRef)).data();
      if (!payment || payment.provider !== "stripe"
        || Number(result.metadata?.amountTotal) !== payment.amount
        || result.metadata?.currency?.toLowerCase() !== payment.currency?.toLowerCase()
        || result.metadata?.uid !== payment.uid
        || result.metadata?.purpose !== payment.purpose
        || (payment.purposeRefId || "") !== (result.metadata?.purposeRefId || "")
        || result.metadata?.checkoutMode !== (payment.purpose === "membership" ? "subscription" : "payment")
        || (payment.providerRefs?.stripeCheckoutSessionId
          && payment.providerRefs.stripeCheckoutSessionId !== result.metadata?.checkoutSessionId)) {
        throw new Error(`Stripe checkout does not match payment ledger: ${result.paymentId}`);
      }
      // Refund/cancellation is terminal even when a distinct success event arrives late.
      if (["refunded", "cancelled", "canceled"].includes(payment.status)) return false;
      const refs: Record<string, string> = {
        stripeSubscriptionId: subscriptionId || "",
        stripeCustomerId: result.metadata?.customerId || "",
        ...(result.metadata?.checkoutSessionId ? { stripeCheckoutSessionId: result.metadata.checkoutSessionId } : {}),
        ...(result.metadata?.paymentIntentId ? { stripePaymentIntentId: result.metadata.paymentIntentId } : {}),
      };
      tx.update(paymentRef, {
        status: "paid", updatedAt: Date.now(),
        ...Object.fromEntries(Object.entries(refs).map(([key, value]) => [`providerRefs.${key}`, value])),
      });
      return true;
    });
    if (!fulfill) return;
  }

  if (result.metadata?.purpose === "booking" && result.metadata?.holdId && result.paymentId) {
    const { finalizePaidBooking } = await import("../bookingFlexTransaction.js");
    await finalizePaidBooking(result.metadata.holdId, result.paymentId);
  }

  // Events v2 finalization consumes the authoritative capacity hold. Do this
  // before the legacy event commerce branch and return from that branch once
  // handled so a v2 payment cannot create a duplicate legacy registration.
  const handledByEventV2 = await maybeFinalizeEventV2Checkout({
    checkoutType: result.metadata?.checkoutType,
    holdId: result.metadata?.holdId,
    paymentId: result.paymentId,
  });

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
    const purchaseId = `purchase_${result.paymentId || result.metadata?.checkoutSessionId || result.eventId}_${bookId}`;
    await getDb().collection("bookPurchases").doc(purchaseId).set({
      id: purchaseId,
      bookId: bookId,
      userId: uid || null,
      email: result.metadata.email || null,
      stripeSessionId: result.metadata?.checkoutSessionId || result.eventId,
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

  const ticketTypeId = result.metadata?.ticketTypeId || undefined;
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

    const registration = {
      uid,
      eventId,
      displayName: result.metadata?.displayName || undefined,
      email: result.metadata?.email || undefined,
      registeredAt: Date.now(),
      paymentId: result.paymentId || undefined,
      ticketTypeId,
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
  const vendorTableSnap = await vendorTableRef.get();
  if (vendorTableSnap.exists) return;

  await vendorTableRef.set({
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
    const paymentRef = getDb().collection("payments").doc(result.paymentId);
    await getDb().runTransaction(async (tx) => {
      const payment = (await tx.get(paymentRef)).data();
      if (payment && payment.provider === "stripe" && !["paid", "refunded", "cancelled", "canceled"].includes(payment.status)) {
        tx.update(paymentRef, { status: "failed", updatedAt: Date.now() });
      }
    });
  }

  // Membership state is reconciled from Stripe, never inferred from a failed
  // one-time booking payment or a stale invoice event.
}

/** Fetch latest state so delayed renewal/cancellation events cannot regress it. */
export async function syncMembership(result: WebhookResult, provider: StripeProvider): Promise<void> {
  const subscriptionId = result.metadata?.subscriptionId;
  if (!subscriptionId) return;
  const mappingRef = getDb().collection("stripeSubscriptions").doc(subscriptionId);
  const syncToken = randomUUID();
  await getDb().runTransaction(async (tx) => {
    const mapping = (await tx.get(mappingRef)).data();
    if (mapping?.syncToken && mapping.syncLeaseExpiresAt > Date.now()) {
      throw new Error(`Subscription reconciliation is in progress: ${subscriptionId}`);
    }
    tx.set(mappingRef, { ...mapping, syncToken, syncLeaseExpiresAt: Date.now() + 5 * 60_000 }, { merge: true });
  });
  try {
    // Fetch only after claiming the subscription lease. A worker that outlives its
    // lease is fenced below, so its older API response cannot overwrite newer state.
    const subscription = await provider.retrieveSubscription(subscriptionId);
    const mapping = (await mappingRef.get()).data();
    const owners = [subscription.metadata?.uid, mapping?.uid, result.metadata?.uid].filter(Boolean);
    if (new Set(owners).size > 1) throw new Error(`Conflicting subscription ownership: ${subscriptionId}`);
    let uid = owners[0];
    if (!uid) {
      const users = await getDb().collection("users")
        .where("features.stripeSubscriptionId", "==", subscriptionId).limit(2).get();
      if (users.size === 1) uid = users.docs[0].id;
    }
    if (!uid) throw new Error(`Subscription owner is unresolved: ${subscriptionId}`);
    const userRef = getDb().collection("users").doc(uid);
    const priorId = (await userRef.get()).data()?.features?.stripeSubscriptionId;
    let priorIsTerminal = false;
    if (priorId && priorId !== subscriptionId && !["canceled", "incomplete_expired"].includes(subscription.status)) {
      const prior = await provider.retrieveSubscription(priorId);
      priorIsTerminal = ["canceled", "incomplete_expired"].includes(prior.status);
    }
    await getDb().runTransaction(async (tx) => {
      const [userSnap, mappingSnap] = await Promise.all([tx.get(userRef), tx.get(mappingRef)]);
      const latestMapping = mappingSnap.data();
      if (latestMapping?.syncToken !== syncToken) throw new Error(`Subscription claim lost: ${subscriptionId}`);
      if (latestMapping.uid && latestMapping.uid !== uid) throw new Error(`Conflicting subscription ownership: ${subscriptionId}`);
      const user = userSnap.data();
      if (!user) throw new Error(`Subscription user does not exist: ${uid}`);
      const existingId = user.features?.stripeSubscriptionId;
      // An old subscription's cancellation must not revoke a replacement.
      if (existingId && existingId !== subscriptionId) {
        if (["canceled", "incomplete_expired"].includes(subscription.status)) {
          tx.set(mappingRef, { uid, subscriptionId, syncToken: null, syncLeaseExpiresAt: 0 }, { merge: true });
          return;
        }
        if (existingId !== priorId || !priorIsTerminal) {
          throw new Error(`Conflicting membership subscriptions for ${uid}`);
        }
      }
      tx.set(mappingRef, { uid, subscriptionId, syncToken: null, syncLeaseExpiresAt: 0, updatedAt: Date.now() }, { merge: true });
      tx.update(userRef, { ...subscriptionMembership(subscription, provider.mode), updatedAt: Date.now() });
    });
  } catch (error) {
    await getDb().runTransaction(async (tx) => {
      if ((await tx.get(mappingRef)).data()?.syncToken === syncToken) {
        tx.update(mappingRef, { syncToken: null, syncLeaseExpiresAt: 0 });
      }
    });
    throw error;
  }
}
