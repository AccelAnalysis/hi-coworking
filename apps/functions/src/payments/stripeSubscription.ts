/**
 * customer.subscription.updated helpers (pure, no Firebase imports).
 *
 * The Stripe Customer Portal changes a member's subscription in place: a plan
 * switch swaps the subscription item's price, and "cancel" sets
 * cancel_at_period_end (and, on current API versions, cancel_at). Stripe then
 * sends customer.subscription.updated. These helpers turn that event into a
 * small, idempotent users/{uid} update:
 *
 * - plan follows the subscription's price (unknown prices leave plan alone)
 * - cancelAtPeriodEnd / cancelAt drive the "Ends on {date}" line on /my-hi
 * - stripeCustomerId is recorded so the billing portal can find the customer
 *
 * membershipStatus is never changed here. Access ends only through
 * customer.subscription.deleted, and a cancelled membership is never revived
 * by a late or replayed update.
 */

import { getTierByPriceId } from "./stripeConfig";

type IdOrObject = string | { id?: string | null } | null | undefined;

export interface SubscriptionLike {
  id?: string | null;
  customer?: IdOrObject;
  status?: string | null;
  metadata?: Record<string, string> | null;
  cancel_at_period_end?: boolean | null;
  cancel_at?: number | null;
  items?: {
    data?: Array<{
      price?: { id?: string | null } | null;
      current_period_end?: number | null;
    }> | null;
  } | null;
}

export interface SubscriptionUpdateInfo {
  subscriptionId: string;
  customerId: string;
  uid: string;
  status: string;
  priceId: string;
  cancelAtPeriodEnd: boolean;
  /** When the membership is scheduled to end, in ms, or 0 when it is not. */
  cancelAtMs: number;
  /** Stripe event.created, in ms. Orders events for the same subscription. */
  eventCreatedMs: number;
}

function idOf(value: IdOrObject): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.id || "";
}

export function parseSubscriptionUpdate(
  subscription: SubscriptionLike,
  eventCreatedSeconds: number,
): SubscriptionUpdateInfo {
  const item = subscription.items?.data?.[0];
  const cancelAtPeriodEnd = subscription.cancel_at_period_end === true;
  // cancel_at is set for both "cancel at period end" (current API versions)
  // and a scheduled cancel date. Older payloads only set the flag, so fall
  // back to the item's period end.
  const cancelAtSeconds = subscription.cancel_at
    || (cancelAtPeriodEnd ? item?.current_period_end || 0 : 0);
  return {
    subscriptionId: subscription.id || "",
    customerId: idOf(subscription.customer),
    uid: subscription.metadata?.uid || "",
    status: subscription.status || "",
    priceId: item?.price?.id || "",
    cancelAtPeriodEnd,
    cancelAtMs: cancelAtSeconds > 0 ? cancelAtSeconds * 1000 : 0,
    eventCreatedMs: (eventCreatedSeconds || 0) * 1000,
  };
}

/** Statuses customer.subscription.deleted (or Checkout) owns, not this handler. */
const IGNORED_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete", "incomplete_expired"]);
/** Members whose plan and billing details can follow the subscription. */
const CURRENT_MEMBER_STATUSES = new Set(["active", "trial", "pastDue"]);

export interface MemberSubscriptionState {
  membershipStatus?: string;
  plan?: string | null;
  features?: Record<string, unknown> | null;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
  cancelAtPeriodEnd?: boolean;
  cancelAt?: number | null;
  lastSubscriptionEventAt?: number;
}

export type SubscriptionUpdateDecision =
  | { apply: true; updates: Record<string, unknown>; unknownPrice: boolean }
  | { apply: false; reason: string; unknownPrice?: boolean };

export function storedSubscriptionId(user: MemberSubscriptionState): string {
  const fromFeatures = user.features?.stripeSubscriptionId;
  if (typeof fromFeatures === "string" && fromFeatures) return fromFeatures;
  return typeof user.stripeSubscriptionId === "string" ? user.stripeSubscriptionId : "";
}

/**
 * Decide the users/{uid} update for a customer.subscription.updated event.
 * Returns apply:false (with a reason for the log) when the event must not
 * change anything: the member isn't current (cancelled, expired, none), the
 * event is for a different subscription than the one on file, the
 * subscription is already ending/ended (deleted handles that), the event is
 * older than one already applied, or nothing changed.
 */
export function subscriptionUpdatedUpdates(
  user: MemberSubscriptionState,
  info: SubscriptionUpdateInfo,
  now: number,
): SubscriptionUpdateDecision {
  if (!CURRENT_MEMBER_STATUSES.has(user.membershipStatus || "")) {
    return { apply: false, reason: "member_not_current" };
  }
  if (IGNORED_SUBSCRIPTION_STATUSES.has(info.status)) {
    return { apply: false, reason: `subscription_${info.status}` };
  }
  const stored = storedSubscriptionId(user);
  if (stored && info.subscriptionId && stored !== info.subscriptionId) {
    return { apply: false, reason: "different_subscription" };
  }
  if (user.lastSubscriptionEventAt && info.eventCreatedMs && info.eventCreatedMs < user.lastSubscriptionEventAt) {
    return { apply: false, reason: "stale_event" };
  }

  const tier = info.priceId ? getTierByPriceId(info.priceId) : undefined;
  const unknownPrice = Boolean(info.priceId) && !tier;
  const cancelAt = info.cancelAtMs > 0 ? info.cancelAtMs : null;

  const updates: Record<string, unknown> = {};
  if (tier && user.plan !== tier.id) updates.plan = tier.id;
  if ((user.cancelAtPeriodEnd === true) !== info.cancelAtPeriodEnd) {
    updates.cancelAtPeriodEnd = info.cancelAtPeriodEnd;
  }
  if ((user.cancelAt || null) !== cancelAt) updates.cancelAt = cancelAt;
  if (info.customerId && user.stripeCustomerId !== info.customerId) {
    updates.stripeCustomerId = info.customerId;
  }
  if (!stored && info.subscriptionId) {
    updates["features.stripeSubscriptionId"] = info.subscriptionId;
  }

  if (Object.keys(updates).length === 0) {
    return { apply: false, reason: "no_change", unknownPrice };
  }
  if (info.eventCreatedMs) updates.lastSubscriptionEventAt = info.eventCreatedMs;
  updates.updatedAt = now;
  return { apply: true, updates, unknownPrice };
}
