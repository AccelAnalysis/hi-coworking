import type Stripe from "stripe";
import { getTierByPriceId, type StripeMode } from "./stripeConfig";

/** Missing/expired entitlement dates fail closed, including legacy active flags. */
export function hasActiveMembership(user: Record<string, any> | undefined, now = Date.now()): boolean {
  return user?.membershipStatus === "active" && Boolean(user.plan)
    && Number.isFinite(user.expiresAt) && user.expiresAt > now;
}

export function subscriptionMembership(subscription: Stripe.Subscription, mode: StripeMode = "live") {
  const item = subscription.items.data.find((entry) => getTierByPriceId(entry.price.id, mode));
  const tier = item && getTierByPriceId(item.price.id, mode);
  const active = Boolean(tier) && ["active", "trialing"].includes(subscription.status);
  return {
    membershipStatus: active ? "active" : ["canceled", "incomplete_expired"].includes(subscription.status) ? "cancelled" : "pastDue",
    plan: tier?.id || null,
    expiresAt: active && item ? item.current_period_end * 1000 : 0,
    "features.stripeSubscriptionId": subscription.id,
    "features.stripeCustomerId": typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    "features.stripeSubscriptionStatus": subscription.status,
    "features.stripeCancelAtPeriodEnd": subscription.cancel_at_period_end,
  };
}

export function invoiceSubscriptionId(invoice: Stripe.Invoice): string {
  // Current Stripe API nests the subscription under parent; retain old webhook compatibility.
  const value = invoice.parent?.subscription_details?.subscription
    || (invoice as unknown as { subscription?: string | { id: string } }).subscription;
  return typeof value === "string" ? value : value?.id || "";
}
