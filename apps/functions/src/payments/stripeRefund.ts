/**
 * Stripe refunds (pure, no Firebase imports so it can be unit tested).
 *
 * charge.refunded, refund.updated and refund.failed all carry a charge. The
 * webhook reads the charge's current refund state from Stripe (a
 * StripeRefundSnapshot) and derives the ledger update from that state rather
 * than from the single event, so retries and out-of-order events converge on
 * the same result.
 *
 * Membership on a refund: a refund only moves money. It does not end or
 * change a membership. Cancelling the subscription (in the Stripe Dashboard,
 * or the member in the billing portal) sends customer.subscription.deleted or
 * customer.subscription.updated, and those handlers own membershipStatus,
 * plan and expiresAt.
 */

import type { PaymentStatus, StripeRefundLine, StripeRefundSnapshot } from "./types";

type IdOrObject = string | { id?: string | null } | null | undefined;

export function idOf(value: IdOrObject): string {
  if (!value) return "";
  return typeof value === "string" ? value : value.id || "";
}

/** Refunds that count as issued: money is on its way back to the member. */
const ISSUED_REFUND_STATUSES = new Set(["succeeded", "pending", "requires_action"]);

export function isIssuedRefund(refund: Pick<StripeRefundLine, "status">): boolean {
  return ISSUED_REFUND_STATUSES.has(refund.status);
}

/** Refunds that confirm money back to the member and earn a notice. */
export function isNotifiableRefund(refund: Pick<StripeRefundLine, "status">): boolean {
  return refund.status === "succeeded" || refund.status === "pending";
}

export interface RefundLike {
  id?: string;
  amount?: number | null;
  status?: string | null;
  created?: number | null;
}

export function refundLine(refund: RefundLike): StripeRefundLine {
  return {
    id: refund.id || "",
    amountCents: Math.max(0, Math.round(Number(refund.amount) || 0)),
    status: refund.status || "",
    createdMs: (Number(refund.created) || 0) * 1000,
  };
}

export interface ChargeLike {
  id?: string;
  amount?: number | null;
  amount_captured?: number | null;
  amount_refunded?: number | null;
  currency?: string | null;
  customer?: IdOrObject;
  payment_intent?: IdOrObject;
  metadata?: Record<string, string> | null;
  payment_method_details?: {
    card?: { last4?: string | null; brand?: string | null } | null;
  } | null;
}

/** Last four digits and brand, only when the charge was paid by card. */
export function cardOf(charge: ChargeLike): { last4?: string; brand?: string } {
  const card = charge.payment_method_details?.card;
  const last4 = typeof card?.last4 === "string" && /^\d{4}$/.test(card.last4) ? card.last4 : undefined;
  const brand = typeof card?.brand === "string" && card.brand ? card.brand : undefined;
  return { ...(last4 ? { last4 } : {}), ...(brand ? { brand } : {}) };
}

/** Build the snapshot from a charge, its refunds and the invoice it paid. */
export function buildRefundSnapshot(input: {
  refundId?: string;
  charge: ChargeLike;
  refunds: RefundLike[];
  paymentMetadata?: Record<string, string> | null;
  invoice?: {
    invoiceId: string;
    billingReason: string;
    subscriptionId: string;
    uid: string;
    plan: string;
  } | null;
}): StripeRefundSnapshot {
  const { charge } = input;
  const refunds = input.refunds.map(refundLine).filter((r) => r.id);
  refunds.sort((a, b) => a.createdMs - b.createdMs);
  const latest = refunds[refunds.length - 1];
  const chargeMetadata = charge.metadata || {};
  const paymentMetadata = input.paymentMetadata || {};
  const card = cardOf(charge);
  const captured = Number(charge.amount_captured ?? charge.amount) || 0;
  const optional: Partial<StripeRefundSnapshot> = {};
  const paymentId = chargeMetadata.paymentId || paymentMetadata.paymentId || "";
  if (paymentId) optional.paymentId = paymentId;
  const uid = input.invoice?.uid || chargeMetadata.uid || paymentMetadata.uid || "";
  if (uid) optional.uid = uid;
  if (card.last4) optional.cardLast4 = card.last4;
  if (card.brand) optional.cardBrand = card.brand;
  if (input.invoice?.invoiceId) {
    optional.invoiceId = input.invoice.invoiceId;
    if (input.invoice.billingReason) optional.billingReason = input.invoice.billingReason;
    if (input.invoice.subscriptionId) optional.subscriptionId = input.invoice.subscriptionId;
    if (input.invoice.plan) optional.plan = input.invoice.plan;
  }
  return {
    refundId: input.refundId || latest?.id || "",
    chargeId: charge.id || "",
    paymentIntentId: idOf(charge.payment_intent),
    customerId: idOf(charge.customer),
    currency: (charge.currency || "usd").toLowerCase(),
    amountCents: Math.max(0, Math.round(captured)),
    amountRefundedCents: Math.max(0, Math.round(Number(charge.amount_refunded) || 0)),
    refunds,
    ...optional,
  };
}

export interface RefundablePayment {
  status?: string;
  amountRefunded?: number;
}

/**
 * The payments/{id} update for a charge's refund state.
 *
 * - Some money refunded: "refunded" when the whole charge is refunded,
 *   otherwise "partially_refunded". A status of "refunded" set by an app
 *   refund flow (booking cancel, event refund) is kept even for a partial
 *   charge refund, because those flows read "refunded" to avoid refunding
 *   twice.
 * - Nothing refunded any more (every refund failed or was canceled): a
 *   refunded or partially_refunded payment goes back to "paid".
 */
export function refundLedgerUpdates(
  current: RefundablePayment,
  snapshot: StripeRefundSnapshot,
  now: number,
): { status: PaymentStatus | string; updates: Record<string, unknown> } {
  const refundedCents = snapshot.amountRefundedCents;
  const full = snapshot.amountCents > 0 && refundedCents >= snapshot.amountCents;
  const issued = snapshot.refunds.filter(isIssuedRefund);
  let status = current.status || "paid";
  if (refundedCents > 0) {
    status = full ? "refunded" : current.status === "refunded" ? "refunded" : "partially_refunded";
  } else if (current.status === "refunded" || current.status === "partially_refunded") {
    status = "paid";
  }
  const refundedAt = issued.length ? Math.max(...issued.map((r) => r.createdMs)) : null;
  const updates: Record<string, unknown> = {
    status,
    amountRefunded: refundedCents,
    refundedAt,
    stripeRefundIds: snapshot.refunds.map((r) => r.id),
    "providerRefs.stripeChargeId": snapshot.chargeId,
    updatedAt: now,
  };
  if (snapshot.paymentIntentId) updates["providerRefs.stripePaymentIntentId"] = snapshot.paymentIntentId;
  return { status, updates };
}

export interface MemberRefundSummary {
  refundId: string;
  chargeId: string;
  amountCents: number;
  totalRefundedCents: number;
  currency: string;
  refundedAt: number;
  /** True when the whole charge has been refunded. */
  full: boolean;
  /** "issued" or, when every refund on the charge failed, "failed". */
  status: "issued" | "failed";
}

/**
 * users/{uid}.lastRefund for My Hi: the newest issued refund on the charge.
 * Returns null when nothing should change: an older charge than the one on
 * file, or a failure for a charge that was never shown.
 */
export function memberRefundSummary(
  existing: Partial<MemberRefundSummary> | null | undefined,
  snapshot: StripeRefundSnapshot,
): MemberRefundSummary | null {
  const issued = snapshot.refunds.filter(isIssuedRefund);
  const latest = issued[issued.length - 1];
  const sameCharge = existing?.chargeId === snapshot.chargeId;
  if (!latest) {
    if (!sameCharge || !existing) return null;
    return { ...(existing as MemberRefundSummary), totalRefundedCents: 0, status: "failed" };
  }
  if (existing && !sameCharge && Number(existing.refundedAt || 0) > latest.createdMs) return null;
  return {
    refundId: latest.id,
    chargeId: snapshot.chargeId,
    amountCents: latest.amountCents,
    totalRefundedCents: snapshot.amountRefundedCents,
    currency: snapshot.currency,
    refundedAt: latest.createdMs,
    full: snapshot.amountCents > 0 && snapshot.amountRefundedCents >= snapshot.amountCents,
    status: "issued",
  };
}

export function formatMoney(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

const BRAND_NAMES: Record<string, string> = {
  amex: "American Express",
  diners: "Diners Club",
  discover: "Discover",
  eftpos_au: "eftpos",
  jcb: "JCB",
  mastercard: "Mastercard",
  unionpay: "UnionPay",
  visa: "Visa",
};

/** "your Visa card ending in 4242", or "your original payment method". */
export function refundDestination(snapshot: Pick<StripeRefundSnapshot, "cardLast4" | "cardBrand">): string {
  if (!snapshot.cardLast4) return "your original payment method";
  const brand = snapshot.cardBrand ? BRAND_NAMES[snapshot.cardBrand] : undefined;
  return brand
    ? `your ${brand} card ending in ${snapshot.cardLast4}`
    : `your card ending in ${snapshot.cardLast4}`;
}
