import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { defineSecret, defineString } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createPayment, updatePaymentStatus } from "../payments/ledger";
import { StripeProvider } from "../payments/stripeProvider";
import { grantFoundingInvoiceCredits, getUsableOrganizationCreditBalance } from "./credits";
import {
  CHECKOUT_RESERVATION_MS,
  FOUNDING_MEMBER_LIMIT,
  FOUNDING_PRICE_CENTS,
  allocateFounderNumber,
  mapStripeSubscriptionStatus,
  resolveCapabilities,
} from "./model";
import type { WebhookResult } from "../payments/types";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const foundingPriceId = defineString("STRIPE_FOUNDING_PRICE_ID");
const appUrl = defineString("APP_URL", { default: "http://localhost:3000" });

function getDb() { return admin.firestore(); }

function isPlatformAdmin(token: Record<string, unknown>): boolean {
  return token.role === "admin" || token.role === "master";
}

async function requireOrganizationCheckoutAuthority(
  uid: string,
  token: Record<string, unknown>,
  organizationId: string
): Promise<{ organization: admin.firestore.DocumentData; memberRole: string }> {
  const [orgSnap, memberSnap] = await Promise.all([
    getDb().collection("orgs").doc(organizationId).get(),
    getDb().collection("orgMembers").doc(`${organizationId}_${uid}`).get(),
  ]);
  if (!orgSnap.exists) throw new HttpsError("not-found", "Organization not found.");
  const memberRole = String(memberSnap.data()?.role || "");
  if (!isPlatformAdmin(token) && !["owner", "admin"].includes(memberRole)) {
    throw new HttpsError("permission-denied", "Only an organization owner or administrator can start checkout.");
  }
  return { organization: orgSnap.data() || {}, memberRole };
}

async function cleanupExpiredReservations(now: number): Promise<void> {
  const snap = await getDb().collection("founderReservations").where("expiresAt", "<=", now).limit(100).get();
  if (snap.empty) return;
  const counterRef = getDb().collection("founderAllocation").doc("state");
  await getDb().runTransaction(async (tx) => {
    const current = await tx.get(counterRef);
    let released = 0;
    for (const doc of snap.docs) {
      const fresh = await tx.get(doc.ref);
      if (fresh.exists && Number(fresh.data()?.expiresAt || 0) <= now) {
        tx.delete(doc.ref);
        released += 1;
      }
    }
    if (released) {
      tx.set(counterRef, {
        activeCount: Number(current.data()?.activeCount || 0),
        reservationCount: Math.max(0, Number(current.data()?.reservationCount || 0) - released),
        nextFounderNumber: Number(current.data()?.nextFounderNumber || 1),
        updatedAt: now,
      }, { merge: true });
    }
  });
}

async function reserveFounderSlot(organizationId: string, uid: string): Promise<number> {
  const now = Date.now();
  await cleanupExpiredReservations(now);
  const counterRef = getDb().collection("founderAllocation").doc("state");
  const reservationRef = getDb().collection("founderReservations").doc(organizationId);
  const membershipRef = getDb().collection("organizationMemberships").doc(organizationId);
  return getDb().runTransaction(async (tx) => {
    const [counterSnap, reservationSnap, membershipSnap] = await Promise.all([
      tx.get(counterRef), tx.get(reservationRef), tx.get(membershipRef),
    ]);
    const membership = membershipSnap.data() || {};
    if (["active", "trialing"].includes(String(membership.status))) {
      throw new HttpsError("already-exists", "This organization already has an active Founding Membership.");
    }
    if (reservationSnap.exists && Number(reservationSnap.data()?.expiresAt || 0) > now) {
      throw new HttpsError("already-exists", "A Founding Membership checkout is already pending for this organization.");
    }
    const activeCount = Number(counterSnap.data()?.activeCount || 0);
    const reservationCount = Number(counterSnap.data()?.reservationCount || 0);
    if (activeCount + reservationCount >= FOUNDING_MEMBER_LIMIT) {
      throw new HttpsError("resource-exhausted", "All 250 Founding Memberships are currently claimed or reserved.");
    }
    const expiresAt = now + CHECKOUT_RESERVATION_MS;
    tx.set(reservationRef, { organizationId, uid, createdAt: now, expiresAt, status: "pending" });
    tx.set(counterRef, {
      activeCount,
      reservationCount: reservationCount + 1,
      nextFounderNumber: Number(counterSnap.data()?.nextFounderNumber || 1),
      updatedAt: now,
    }, { merge: true });
    tx.set(membershipRef, {
      organizationId,
      plan: "founding",
      status: "checkout_pending",
      cancelAtPeriodEnd: false,
      protectedRateEligible: false,
      createdAt: Number(membership.createdAt || now),
      updatedAt: now,
      audit: { checkoutRequestedBy: uid },
    }, { merge: true });
    return expiresAt;
  });
}

async function releaseFounderReservation(organizationId: string, nextStatus: "free" | "incomplete" = "free"): Promise<void> {
  const reservationRef = getDb().collection("founderReservations").doc(organizationId);
  const counterRef = getDb().collection("founderAllocation").doc("state");
  const membershipRef = getDb().collection("organizationMemberships").doc(organizationId);
  await getDb().runTransaction(async (tx) => {
    const [reservation, counter, membership] = await Promise.all([
      tx.get(reservationRef), tx.get(counterRef), tx.get(membershipRef),
    ]);
    if (reservation.exists) {
      tx.delete(reservationRef);
      tx.set(counterRef, {
        activeCount: Number(counter.data()?.activeCount || 0),
        reservationCount: Math.max(0, Number(counter.data()?.reservationCount || 0) - 1),
        nextFounderNumber: Number(counter.data()?.nextFounderNumber || 1),
        updatedAt: Date.now(),
      }, { merge: true });
    }
    if (!membership.data()?.founderNumber) {
      tx.set(membershipRef, { plan: nextStatus === "free" ? "free" : "founding", status: nextStatus, updatedAt: Date.now() }, { merge: true });
    }
  });
}

export const exchange_createFoundingCheckout = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to start checkout.");
    const organizationId = typeof request.data?.organizationId === "string" ? request.data.organizationId.trim() : "";
    if (!organizationId) throw new HttpsError("invalid-argument", "organizationId is required.");
    const { organization } = await requireOrganizationCheckoutAuthority(request.auth.uid, request.auth.token, organizationId);
    const priceId = foundingPriceId.value().trim();
    if (!priceId) throw new HttpsError("failed-precondition", "Founding Membership checkout is not configured.");

    await reserveFounderSlot(organizationId, request.auth.uid);
    const membershipRef = getDb().collection("organizationMemberships").doc(organizationId);
    try {
      const membershipSnap = await membershipRef.get();
      const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
      let customerId = String(membershipSnap.data()?.stripeCustomerId || "");
      if (!customerId) {
        customerId = await provider.createCustomer({
          email: String(request.auth.token.email || organization.billingEmail || ""),
          name: String(organization.name || ""),
          metadata: { organizationId },
        });
        await membershipRef.set({ stripeCustomerId: customerId, updatedAt: Date.now() }, { merge: true });
      }
      const payment = await createPayment({
        uid: request.auth.uid,
        orgId: organizationId,
        provider: "stripe",
        amount: FOUNDING_PRICE_CENTS,
        currency: "usd",
        purpose: "membership",
        purposeRefId: "exchange_founding",
        status: "pending",
      });
      const baseUrl = appUrl.value().replace(/\/$/, "");
      const session = await provider.createCheckoutSession({
        uid: request.auth.uid,
        customerId,
        amount: FOUNDING_PRICE_CENTS,
        currency: "usd",
        purpose: "membership",
        purposeRefId: "exchange_founding",
        mode: "subscription",
        successUrl: `${baseUrl}/exchange/membership/success?organizationId=${encodeURIComponent(organizationId)}`,
        cancelUrl: `${baseUrl}/exchange/membership/canceled?organizationId=${encodeURIComponent(organizationId)}`,
        metadata: {
          stripePriceId: priceId,
          paymentId: payment.id,
          plan: "exchange_founding",
          membershipKind: "exchange_founding",
          organizationId,
          requestedByUid: request.auth.uid,
        },
      });
      await membershipRef.set({ stripePriceId: priceId, checkoutSessionId: session.sessionId, updatedAt: Date.now() }, { merge: true });
      return { url: session.url };
    } catch (error) {
      await releaseFounderReservation(organizationId, "free");
      logger.error("Founding checkout creation failed", { organizationId, error });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Unable to start Founding Membership checkout.");
    }
  }
);

async function activateFounderMembership(metadata: Record<string, string>): Promise<void> {
  const organizationId = metadata.organizationId;
  if (!organizationId) return;
  const status = mapStripeSubscriptionStatus(metadata.subscriptionStatus || "active");
  const membershipRef = getDb().collection("organizationMemberships").doc(organizationId);
  const reservationRef = getDb().collection("founderReservations").doc(organizationId);
  const counterRef = getDb().collection("founderAllocation").doc("state");
  const subscriptionId = metadata.subscriptionId || "";
  const subscriptionRef = subscriptionId
    ? getDb().collection("stripeSubscriptions").doc(subscriptionId)
    : null;
  await getDb().runTransaction(async (tx) => {
    const [membershipSnap, reservationSnap, counterSnap, subscriptionSnap] = await Promise.all([
      tx.get(membershipRef), tx.get(reservationRef), tx.get(counterRef),
      subscriptionRef ? tx.get(subscriptionRef) : Promise.resolve(null),
    ]);
    const current = membershipSnap.data() || {};
    if (subscriptionSnap?.exists && subscriptionSnap.data()?.organizationId !== organizationId) {
      throw new Error("Stripe subscription is already attached to another organization");
    }
    if (
      current.stripeSubscriptionId
      && subscriptionId
      && current.stripeSubscriptionId !== subscriptionId
      && ["active", "trialing", "checkout_pending"].includes(String(current.status))
    ) {
      throw new Error("Organization already has a different active or pending subscription");
    }
    const isActive = status === "active" || status === "trialing";
    let founderNumber = Number(current.founderNumber || 0);
    let activeCount = Number(counterSnap.data()?.activeCount || 0);
    let reservationCount = Number(counterSnap.data()?.reservationCount || 0);
    let nextFounderNumber = Number(counterSnap.data()?.nextFounderNumber || 1);
    if (isActive && !founderNumber) {
      const allocation = allocateFounderNumber({ activeCount, nextFounderNumber });
      founderNumber = allocation.founderNumber;
      nextFounderNumber = allocation.nextFounderNumber;
      activeCount = allocation.activeCount;
    }
    if (reservationSnap.exists) {
      tx.delete(reservationRef);
      reservationCount = Math.max(0, reservationCount - 1);
    }
    tx.set(counterRef, { activeCount, reservationCount, nextFounderNumber, updatedAt: Date.now() }, { merge: true });
    if (subscriptionRef) {
      tx.set(subscriptionRef, { subscriptionId, organizationId, updatedAt: Date.now(), createdAt: subscriptionSnap?.data()?.createdAt || Date.now() }, { merge: true });
    }
    tx.set(membershipRef, {
      organizationId,
      plan: "founding",
      status,
      stripeCustomerId: metadata.customerId || current.stripeCustomerId || "",
      stripeSubscriptionId: metadata.subscriptionId || current.stripeSubscriptionId || "",
      currentPeriodStart: Number(metadata.billingPeriodStart || current.currentPeriodStart || 0) || null,
      currentPeriodEnd: Number(metadata.billingPeriodEnd || current.currentPeriodEnd || 0) || null,
      cancelAtPeriodEnd: metadata.cancelAtPeriodEnd === "true",
      founderNumber: founderNumber || current.founderNumber || null,
      foundingActivatedAt: founderNumber && !current.foundingActivatedAt ? Date.now() : current.foundingActivatedAt || null,
      protectedRateEligible: isActive,
      createdAt: Number(current.createdAt || Date.now()),
      updatedAt: Date.now(),
    }, { merge: true });
  });
}

export async function processExchangeMembershipWebhook(result: WebhookResult): Promise<boolean> {
  const metadata = result.metadata || {};
  const isExchange = metadata.membershipKind === "exchange_founding" || metadata.plan === "exchange_founding";
  if (!isExchange) return false;
  const organizationId = metadata.organizationId;
  if (!organizationId) throw new Error("Exchange membership webhook missing organizationId");

  await getDb().collection("organizationSubscriptionEvents").doc(result.eventId).set({
    eventId: result.eventId,
    organizationId,
    action: result.action,
    subscriptionId: metadata.subscriptionId || "",
    invoiceId: metadata.invoiceId || "",
    status: metadata.subscriptionStatus || result.status || "",
    createdAt: Date.now(),
  }, { merge: false });

  if (result.paymentId && result.action === "payment_succeeded") {
    await updatePaymentStatus(result.paymentId, "paid", {
      providerRefs: {
        stripeSubscriptionId: metadata.subscriptionId || "",
        stripeCustomerId: metadata.customerId || "",
        stripeInvoiceId: metadata.invoiceId || "",
      },
    });
  }

  if (result.action === "subscription_updated") {
    await activateFounderMembership(metadata);
  } else if (result.action === "payment_succeeded") {
    await getDb().collection("organizationMemberships").doc(organizationId).set({
      stripeCustomerId: metadata.customerId || "",
      stripeSubscriptionId: metadata.subscriptionId || "",
      updatedAt: Date.now(),
    }, { merge: true });
    if (metadata.invoiceId) {
      await grantFoundingInvoiceCredits({ organizationId, invoiceId: metadata.invoiceId, eventId: result.eventId });
    }
  } else if (result.action === "payment_failed") {
    const nextStatus = metadata.reason === "subscription_cancelled" ? "canceled" : "past_due";
    await getDb().collection("organizationMemberships").doc(organizationId).set({ status: nextStatus, protectedRateEligible: false, updatedAt: Date.now() }, { merge: true });
  } else if (result.action === "checkout_expired") {
    await releaseFounderReservation(organizationId, "free");
  }
  return true;
}

export const exchange_getFounderAvailability = onCall(async () => {
  await cleanupExpiredReservations(Date.now());
  const snap = await getDb().collection("founderAllocation").doc("state").get();
  const claimed = Math.min(FOUNDING_MEMBER_LIMIT, Number(snap.data()?.activeCount || 0));
  return { claimed, remaining: Math.max(0, FOUNDING_MEMBER_LIMIT - claimed), limit: FOUNDING_MEMBER_LIMIT };
});

export const exchange_getOrganizationMembership = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to view organization membership.");
  const organizationId = typeof request.data?.organizationId === "string" ? request.data.organizationId.trim() : "";
  if (!organizationId) throw new HttpsError("invalid-argument", "organizationId is required.");
  await requireOrganizationCheckoutAuthority(request.auth.uid, request.auth.token, organizationId);
  const membership = await getDb().collection("organizationMemberships").doc(organizationId).get();
  const data = membership.data() || { organizationId, plan: "free", status: "free" };
  const creditBalance = await getUsableOrganizationCreditBalance(organizationId);
  return { membership: data, capabilities: resolveCapabilities(data.plan === "founding" ? "founding" : "free", data.status || "free"), creditBalance };
});
