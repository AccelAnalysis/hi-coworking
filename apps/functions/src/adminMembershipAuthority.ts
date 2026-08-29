import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import { createPayment, updatePaymentStatus } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";
import {
  MEMBERSHIP_TIERS,
  getTierById,
  getTierByPriceId,
} from "./payments/stripeConfig";

if (admin.apps.length === 0) admin.initializeApp();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const ACTIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
]);

function db() {
  return admin.firestore();
}

function requireAdmin(
  request: {
    auth?: {
      uid: string;
      token: Record<string, unknown>;
    } | null;
  },
) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }
  const role = request.auth.token.role;
  if (role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
  return request.auth.uid;
}

async function requireMember(uid: string) {
  if (!uid) {
    throw new HttpsError("invalid-argument", "Member is required.");
  }
  const ref = db().collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Member account not found.");
  }
  return {
    ref,
    data: snap.data() || {},
  };
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

function safeReturnOrigin(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpsError(
      "invalid-argument",
      "A valid Hi Coworking return origin is required.",
    );
  }

  const productionOrigins = new Set([
    "https://hi-coworking-plat.web.app",
    "https://hi-coworking-plat.firebaseapp.com",
    "https://hi-coworking.com",
    "https://www.hi-coworking.com",
  ]);
  const previewOrigin = (
    url.protocol === "https:"
    && url.hostname.startsWith("hi-coworking-plat--pr-")
    && url.hostname.endsWith(".web.app")
  );
  const emulatorOrigin = (
    process.env.FUNCTIONS_EMULATOR === "true"
    && url.protocol === "http:"
    && ["localhost", "127.0.0.1"].includes(url.hostname)
  );

  if (
    !productionOrigins.has(url.origin)
    && !previewOrigin
    && !emulatorOrigin
  ) {
    throw new HttpsError(
      "permission-denied",
      "Checkout return URLs must use an approved Hi Coworking origin.",
    );
  }

  return url.origin;
}

function stripeClient() {
  return new Stripe(stripeSecretKey.value(), {
    apiVersion: "2026-01-28.clover",
  });
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription) {
  const direct = Number(
    (subscription as unknown as Record<string, unknown>).current_period_end || 0,
  );
  if (direct > 0) return direct;

  const firstItem = subscription.items.data[0] as
    | (Stripe.SubscriptionItem & Record<string, unknown>)
    | undefined;
  return Number(firstItem?.current_period_end || 0);
}

function subscriptionRank(subscription: Stripe.Subscription) {
  if (ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) return 0;
  if (subscription.status === "unpaid") return 1;
  if (subscription.status === "incomplete") return 2;
  if (subscription.status === "canceled") return 4;
  return 3;
}

async function subscriptionsForCustomer(
  stripe: Stripe,
  customerId: string,
  uid: string,
) {
  const result = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  return result.data
    .filter((subscription) => (
      subscription.metadata?.uid === uid
      || !subscription.metadata?.uid
    ))
    .sort((a, b) => (
      subscriptionRank(a) - subscriptionRank(b)
      || b.created - a.created
    ));
}

async function membershipSubscription(uid: string, stripe: Stripe) {
  const { data: user } = await requireMember(uid);
  const subscriptionIds = new Set<string>();
  const customerIds = new Set<string>();

  const features = user.features as Record<string, unknown> | undefined;
  if (typeof features?.stripeSubscriptionId === "string") {
    subscriptionIds.add(features.stripeSubscriptionId);
  }
  if (typeof user.stripeSubscriptionId === "string") {
    subscriptionIds.add(user.stripeSubscriptionId);
  }
  if (typeof user.stripeCustomerId === "string") {
    customerIds.add(user.stripeCustomerId);
  }

  const paymentSnap = await db()
    .collection("payments")
    .where("uid", "==", uid)
    .get();

  for (const paymentDoc of paymentSnap.docs) {
    const payment = paymentDoc.data();
    if (payment.purpose !== "membership") continue;

    const refs = payment.providerRefs as Record<string, unknown> | undefined;
    if (
      typeof refs?.stripeSubscriptionId === "string"
      && refs.stripeSubscriptionId
    ) {
      subscriptionIds.add(refs.stripeSubscriptionId);
    }
    if (
      typeof refs?.stripeCustomerId === "string"
      && refs.stripeCustomerId
    ) {
      customerIds.add(refs.stripeCustomerId);
    }
  }

  const candidates: Stripe.Subscription[] = [];
  for (const subscriptionId of subscriptionIds) {
    try {
      candidates.push(
        await stripe.subscriptions.retrieve(subscriptionId),
      );
    } catch (error) {
      logger.warn("Could not retrieve candidate membership subscription", {
        uid,
        subscriptionId,
        error,
      });
    }
  }

  let preferred = candidates
    .sort((a, b) => (
      subscriptionRank(a) - subscriptionRank(b)
      || b.created - a.created
    ))[0];

  if (!preferred) {
    for (const customerId of customerIds) {
      try {
        preferred = (await subscriptionsForCustomer(
          stripe,
          customerId,
          uid,
        ))[0];
        if (preferred) break;
      } catch (error) {
        logger.warn("Could not list customer subscriptions", {
          uid,
          customerId,
          error,
        });
      }
    }
  }

  if (!preferred && typeof user.email === "string" && user.email.trim()) {
    try {
      const customers = await stripe.customers.list({
        email: user.email.trim().toLowerCase(),
        limit: 20,
      });
      for (const customer of customers.data) {
        preferred = (await subscriptionsForCustomer(
          stripe,
          customer.id,
          uid,
        ))[0];
        if (preferred) break;
      }
    } catch (error) {
      logger.warn("Could not resolve membership subscription by email", {
        uid,
        error,
      });
    }
  }

  return {
    user,
    subscription: preferred || null,
  };
}

function subscriptionState(
  subscription: Stripe.Subscription | null,
  userPlan?: string,
) {
  if (!subscription) {
    return {
      hasSubscription: false,
      hasStripeSubscriptionRecord: false,
      subscriptionId: null,
      stripeStatus: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      planId: userPlan || null,
      canRestart: true,
    };
  }

  const priceId = subscription.items.data[0]?.price?.id;
  const mapped = priceId ? getTierByPriceId(priceId) : undefined;
  const periodEnd = subscriptionPeriodEnd(subscription);
  const hasSubscription = ACTIVE_SUBSCRIPTION_STATUSES.has(
    subscription.status,
  );

  return {
    hasSubscription,
    hasStripeSubscriptionRecord: true,
    subscriptionId: subscription.id,
    stripeStatus: subscription.status,
    cancelAtPeriodEnd: (
      hasSubscription
      && Boolean(subscription.cancel_at_period_end)
    ),
    currentPeriodEnd: periodEnd > 0 ? periodEnd * 1000 : null,
    planId: (
      mapped?.id
      || subscription.metadata?.plan
      || userPlan
      || null
    ),
    canRestart: !hasSubscription,
  };
}

function entitlementUpdate(
  user: FirebaseFirestore.DocumentData,
  subscription: Stripe.Subscription,
  planId?: string,
) {
  const periodEnd = subscriptionPeriodEnd(subscription);
  const customerId = typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;
  const existingFeatures = (
    user.features
    && typeof user.features === "object"
  )
    ? user.features as Record<string, unknown>
    : {};

  return {
    membershipStatus: subscription.status === "past_due"
      ? "pastDue"
      : "active",
    ...(planId ? { plan: planId } : {}),
    ...(periodEnd > 0 ? { expiresAt: periodEnd * 1000 } : {}),
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    features: {
      ...existingFeatures,
      stripeSubscriptionId: subscription.id,
    },
    updatedAt: Date.now(),
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
      ...subscriptionState(
        subscription,
        typeof user.plan === "string" ? user.plan : undefined,
      ),
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
    const { uid, tierId } = request.data as {
      uid: string;
      tierId: string;
    };
    const tier = getTierById(tierId);
    if (!tier) {
      throw new HttpsError(
        "invalid-argument",
        "Choose a valid membership plan.",
      );
    }

    const stripe = stripeClient();
    const { user, subscription } = await membershipSubscription(uid, stripe);
    if (
      !subscription
      || !ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This member does not have an active Stripe subscription to change.",
      );
    }
    if (subscription.cancel_at_period_end) {
      throw new HttpsError(
        "failed-precondition",
        "Reactivate the pending cancellation before changing plans.",
      );
    }

    const item = subscription.items.data[0];
    if (!item) {
      throw new HttpsError(
        "failed-precondition",
        "The Stripe subscription has no billable item.",
      );
    }

    const currentTier = getTierByPriceId(item.price.id);
    if (currentTier?.id === tier.id) {
      return {
        success: true,
        unchanged: true,
        planId: tier.id,
        state: subscriptionState(subscription, tier.id),
      };
    }

    let updated: Stripe.Subscription;
    try {
      updated = await stripe.subscriptions.update(
        subscription.id,
        {
          items: [{ id: item.id, price: tier.stripePriceId }],
          proration_behavior: "always_invoice",
          payment_behavior: "error_if_incomplete",
          metadata: {
            ...subscription.metadata,
            uid,
            plan: tier.id,
          },
          expand: ["latest_invoice"],
        },
      );
    } catch (error) {
      logger.error("Admin membership plan change failed in Stripe", {
        uid,
        tierId,
        subscriptionId: subscription.id,
        error,
      });
      throw new HttpsError(
        "failed-precondition",
        "Stripe could not complete the plan change. No Hi Coworking entitlement was changed.",
      );
    }

    await db().collection("users").doc(uid).set(
      {
        ...entitlementUpdate(user, updated, tier.id),
        membershipCancellationPending: false,
        membershipCancellationEffectiveAt: null,
      },
      { merge: true },
    );

    const latestInvoice = (
      typeof updated.latest_invoice === "object"
      && updated.latest_invoice
    )
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
          ...(typeof updated.customer === "string"
            ? { stripeCustomerId: updated.customer }
            : { stripeCustomerId: updated.customer.id }),
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

    return {
      success: true,
      auditId,
      paymentId,
      planId: tier.id,
      state: subscriptionState(updated, tier.id),
    };
  },
);

export const admin_membershipCancel = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const adminUid = requireAdmin(request);
    const { uid } = request.data as { uid: string };
    const stripe = stripeClient();
    const { user, subscription } = await membershipSubscription(uid, stripe);

    if (
      !subscription
      || !ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "This member does not have an active Stripe subscription to cancel.",
      );
    }

    const updated = subscription.cancel_at_period_end
      ? subscription
      : await stripe.subscriptions.update(
        subscription.id,
        { cancel_at_period_end: true },
      );
    const periodEnd = subscriptionPeriodEnd(updated);

    await db().collection("users").doc(uid).set(
      {
        ...entitlementUpdate(
          user,
          updated,
          getTierByPriceId(updated.items.data[0]?.price?.id || "")?.id
            || (typeof user.plan === "string" ? user.plan : undefined),
        ),
        membershipCancellationPending: true,
        membershipCancellationRequestedAt: Date.now(),
        membershipCancellationEffectiveAt:
          periodEnd > 0 ? periodEnd * 1000 : null,
      },
      { merge: true },
    );

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

    return {
      success: true,
      auditId,
      state: subscriptionState(
        updated,
        typeof user.plan === "string" ? user.plan : undefined,
      ),
    };
  },
);

export const admin_membershipReactivate = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (request) => {
    const adminUid = requireAdmin(request);
    const {
      uid,
      tierId,
      returnOrigin,
    } = request.data as {
      uid: string;
      tierId?: string;
      returnOrigin?: string;
    };

    const stripe = stripeClient();
    const { user, subscription } = await membershipSubscription(uid, stripe);

    if (
      subscription
      && ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)
    ) {
      const updated = subscription.cancel_at_period_end
        ? await stripe.subscriptions.update(
          subscription.id,
          { cancel_at_period_end: false },
        )
        : subscription;
      const currentPriceId = updated.items.data[0]?.price?.id;
      const plan = currentPriceId
        ? getTierByPriceId(currentPriceId)
        : getTierById(String(user.plan || ""));

      await db().collection("users").doc(uid).set(
        {
          ...entitlementUpdate(user, updated, plan?.id),
          membershipCancellationPending: false,
          membershipCancellationEffectiveAt: null,
        },
        { merge: true },
      );

      const auditId = await writeAudit({
        action: "membership_reactivated",
        memberUid: uid,
        adminUid,
        details: {
          stripeSubscriptionId: updated.id,
          plan: plan?.id || user.plan || null,
        },
      });

      return {
        success: true,
        kind: "reactivated",
        auditId,
        state: subscriptionState(
          updated,
          plan?.id || String(user.plan || ""),
        ),
      };
    }

    const subscriptionPriceId = subscription?.items.data[0]?.price?.id;
    const priorTier = subscriptionPriceId
      ? getTierByPriceId(subscriptionPriceId)
      : undefined;
    const tier = getTierById(
      tierId
      || priorTier?.id
      || String(user.plan || ""),
    );

    if (!tier) {
      throw new HttpsError(
        "invalid-argument",
        "Choose the plan the member should restart.",
      );
    }
    if (!returnOrigin) {
      throw new HttpsError(
        "invalid-argument",
        "returnOrigin is required to create reactivation checkout.",
      );
    }

    const origin = safeReturnOrigin(returnOrigin);
    const payment = await createPayment({
      uid,
      provider: "stripe",
      amount: tier.amountCents,
      currency: tier.currency,
      purpose: "membership",
      purposeRefId: tier.id,
      status: "pending",
    });

    const provider = new StripeProvider(
      stripeSecretKey.value(),
      stripeWebhookSecret.value(),
    );
    const email = typeof user.email === "string"
      ? user.email.trim().toLowerCase()
      : "";
    const session = await provider.createCheckoutSession({
      uid,
      amount: tier.amountCents,
      currency: tier.currency,
      purpose: "membership",
      purposeRefId: tier.id,
      successUrl: `${origin}/pricing?membership=reactivated`,
      cancelUrl: `${origin}/pricing?membership=cancelled`,
      metadata: {
        ...(email ? { email } : {}),
        stripePriceId: tier.stripePriceId,
        paymentId: payment.id,
        plan: tier.id,
      },
    });

    await updatePaymentStatus(
      payment.id,
      "pending",
      {
        providerRefs: {
          stripeCheckoutSessionId: session.sessionId,
        },
      },
    );

    const auditId = await writeAudit({
      action: "membership_reactivation_checkout_created",
      memberUid: uid,
      adminUid,
      details: {
        plan: tier.id,
        paymentId: payment.id,
        stripeCheckoutSessionId: session.sessionId,
      },
    });

    return {
      success: true,
      kind: "checkout",
      auditId,
      paymentId: payment.id,
      checkoutUrl: session.url,
      planId: tier.id,
    };
  },
);
