/**
 * Self-serve billing: members_createBillingPortalSession.
 *
 * Creates a Stripe Customer Portal session for the signed-in member's own
 * Stripe customer and returns its short-lived URL. The portal lets members
 * update their payment method, view invoices, switch plans, and cancel at
 * the end of the paid period. The returned URL is never stored or emailed:
 * emails and the site link to https://hi-coworking.com/my-hi, and the
 * "Manage membership & billing" button there calls this function.
 *
 * Portal configuration: Stripe uses the account's default configuration
 * unless one is passed. A configuration created through the API is not the
 * default, so this function passes one, in this order:
 *   1. STRIPE_BILLING_PORTAL_CONFIGURATION_ID (env, a bpc_ ID; not a secret)
 *   2. the active configuration whose metadata has hi_coworking_portal=member
 *   3. none, so Stripe falls back to the dashboard default
 * See docs/HI-COWORKING-BILLING-PORTAL.md.
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";

if (admin.apps.length === 0) admin.initializeApp();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");

export const BILLING_PORTAL_RETURN_URL = "https://hi-coworking.com/my-hi";
export const BILLING_PORTAL_METADATA_KEY = "hi_coworking_portal";
export const BILLING_PORTAL_METADATA_VALUE = "member";
export const BILLING_HELP_EMAIL = "hicoworking@accelanalysis.com";
export const NO_BILLING_ACCOUNT_MESSAGE =
  `We couldn't find billing details for your account. Email ${BILLING_HELP_EMAIL} and we'll help.`;
export const BILLING_UNAVAILABLE_MESSAGE =
  "Billing is unavailable right now. Please try again in a moment.";

export interface BillingLookupDeps {
  getUser(uid: string): Promise<Record<string, unknown> | null>;
  /** Membership payments for this uid, newest first. */
  listMembershipPaymentRefs(uid: string): Promise<Array<Record<string, unknown>>>;
  retrieveSubscription(id: string): Promise<{ customer: unknown; metadata?: Record<string, string> | null }>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function customerIdOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return "";
}

/**
 * Find the member's own Stripe customer. Only server-written fields are
 * read: users may not write stripeCustomerId, features, or payments (see
 * firestore.rules), and a subscription is used only when its metadata uid is
 * empty or this member. Never looks customers up by email.
 */
export async function resolveBillingCustomerId(uid: string, deps: BillingLookupDeps): Promise<string> {
  const user = await deps.getUser(uid);
  if (!user) return "";
  const features = (user.features || {}) as Record<string, unknown>;

  // 1. The customer on the member's current subscription. A returning member
  //    can get a new Stripe customer at Checkout (customer_email only), so the
  //    subscription on file is the source of truth, ahead of any cached ID.
  const subscriptionIds = [str(features.stripeSubscriptionId), str(user.stripeSubscriptionId)]
    .filter((id, i, all) => id.startsWith("sub_") && all.indexOf(id) === i);
  for (const subscriptionId of subscriptionIds) {
    try {
      const subscription = await deps.retrieveSubscription(subscriptionId);
      const ownerUid = subscription.metadata?.uid || "";
      if (ownerUid && ownerUid !== uid) {
        logger.warn("Stored subscription belongs to another member; skipping", { uid, subscriptionId });
        continue;
      }
      const customerId = customerIdOf(subscription.customer);
      if (customerId.startsWith("cus_")) return customerId;
    } catch (error) {
      logger.warn("Could not retrieve stored subscription for billing portal", { uid, subscriptionId, error });
    }
  }

  // 2. The newest membership payment (written at Checkout).
  for (const refs of await deps.listMembershipPaymentRefs(uid)) {
    const customerId = str(refs.stripeCustomerId);
    if (customerId.startsWith("cus_")) return customerId;
  }

  // 3. Cached customer IDs on the user doc (webhook or admin tools).
  for (const cached of [str(user.stripeCustomerId), str(features.stripeCustomerId)]) {
    if (cached.startsWith("cus_")) return cached;
  }
  return "";
}

/** The portal configuration to pass, or undefined to use the account default. */
export async function resolvePortalConfigurationId(
  envId: string | undefined,
  listActive: () => Promise<Array<{ id: string; metadata?: Record<string, string> | null }>>,
): Promise<string | undefined> {
  const fromEnv = (envId || "").trim();
  if (fromEnv.startsWith("bpc_")) return fromEnv;
  try {
    const configs = await listActive();
    const marked = configs.find((c) => c.metadata?.[BILLING_PORTAL_METADATA_KEY] === BILLING_PORTAL_METADATA_VALUE);
    return marked?.id;
  } catch (error) {
    logger.warn("Could not list billing portal configurations; using the account default", { error });
    return undefined;
  }
}

export const members_createBillingPortalSession = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be logged in");
    }
    const uid = request.auth.uid;
    const stripe = new Stripe(stripeSecretKey.value(), { apiVersion: "2026-01-28.clover" });
    const db = admin.firestore();

    const customerId = await resolveBillingCustomerId(uid, {
      getUser: async (id) => {
        const snap = await db.collection("users").doc(id).get();
        return snap.exists ? (snap.data() || {}) : null;
      },
      listMembershipPaymentRefs: async (id) => {
        const snap = await db.collection("payments").where("uid", "==", id).get();
        return snap.docs
          .map((doc) => doc.data())
          .filter((payment) => payment.purpose === "membership" && payment.provider === "stripe")
          .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
          .map((payment) => (payment.providerRefs || {}) as Record<string, unknown>);
      },
      retrieveSubscription: async (id) => stripe.subscriptions.retrieve(id),
    });

    if (!customerId) {
      logger.info("Billing portal requested without a Stripe customer", { uid });
      throw new HttpsError("failed-precondition", NO_BILLING_ACCOUNT_MESSAGE);
    }

    const configuration = await resolvePortalConfigurationId(
      process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID,
      async () => (await stripe.billingPortal.configurations.list({ active: true, limit: 100 })).data,
    );

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: BILLING_PORTAL_RETURN_URL,
        ...(configuration ? { configuration } : {}),
      });
      logger.info("Billing portal session created", { uid, configured: Boolean(configuration) });
      return { url: session.url };
    } catch (error) {
      const stripeError = error as { type?: string; code?: string; message?: string };
      logger.error("Billing portal session failed", {
        uid,
        type: stripeError.type,
        code: stripeError.code,
        message: stripeError.message,
      });
      throw new HttpsError("unavailable", BILLING_UNAVAILABLE_MESSAGE);
    }
  },
);
