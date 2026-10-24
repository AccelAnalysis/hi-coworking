/**
 * Stripe subscription invoice helpers (pure, no Firebase imports).
 *
 * Since API version 2025-03-31.basil, `invoice.subscription` no longer exists.
 * The subscription lives at `invoice.parent.subscription_details.subscription`
 * and on each subscription line item at
 * `lines.data[].parent.subscription_item_details.subscription`. These helpers
 * read the current shape first (clover / dahlia), then fall back to the
 * legacy field so older payloads keep working.
 */

/** Days of access kept after the paid period ends (30-day period + 5 = the existing 35-day rule). */
export const RENEWAL_GRACE_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Fallback when an invoice carries no line period: the existing 35-day rule. */
export const FALLBACK_ACCESS_DAYS = 35;

type IdOrObject = string | { id?: string | null } | null | undefined;

export interface InvoiceLike {
  id?: string | null;
  billing_reason?: string | null;
  customer?: IdOrObject;
  subscription?: IdOrObject;
  period_end?: number | null;
  parent?: {
    type?: string | null;
    subscription_details?: {
      subscription?: IdOrObject;
      metadata?: Record<string, string> | null;
    } | null;
  } | null;
  lines?: {
    data?: Array<{
      metadata?: Record<string, string> | null;
      period?: { start?: number | null; end?: number | null } | null;
      parent?: {
        type?: string | null;
        subscription_item_details?: {
          subscription?: IdOrObject;
        } | null;
      } | null;
    }> | null;
  } | null;
}

export interface SubscriptionInvoiceInfo {
  invoiceId: string;
  subscriptionId: string;
  customerId: string;
  billingReason: string;
  /** uid from the subscription metadata snapshot on the invoice, if present. */
  uid: string;
  plan: string;
  /** End of the paid service period in ms, or 0 when the invoice has no line period. */
  periodEndMs: number;
}

function idOf(value: IdOrObject): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.id || "";
}

export function subscriptionIdFromInvoice(invoice: InvoiceLike): string {
  const fromParent = idOf(invoice.parent?.subscription_details?.subscription);
  if (fromParent) return fromParent;

  for (const line of invoice.lines?.data || []) {
    const fromLine = idOf(line.parent?.subscription_item_details?.subscription);
    if (fromLine) return fromLine;
  }

  return idOf(invoice.subscription);
}

/** Latest period end across the invoice's subscription line items, in ms. */
export function paidPeriodEndMs(invoice: InvoiceLike): number {
  let maxEnd = 0;
  const lines = invoice.lines?.data || [];
  const subscriptionLines = lines.filter((line) => line.parent?.subscription_item_details);
  for (const line of subscriptionLines.length ? subscriptionLines : lines) {
    const end = line.period?.end || 0;
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd * 1000;
}

export function parseSubscriptionInvoice(invoice: InvoiceLike): SubscriptionInvoiceInfo {
  const parentMetadata = invoice.parent?.subscription_details?.metadata || {};
  const lineMetadata = invoice.lines?.data?.find((line) => line.metadata?.uid)?.metadata || {};
  return {
    invoiceId: invoice.id || "",
    subscriptionId: subscriptionIdFromInvoice(invoice),
    customerId: idOf(invoice.customer),
    billingReason: invoice.billing_reason || "",
    uid: parentMetadata.uid || lineMetadata.uid || "",
    plan: parentMetadata.plan || lineMetadata.plan || "",
    periodEndMs: paidPeriodEndMs(invoice),
  };
}

/** The first invoice is paid through Checkout; checkout.session.completed provisions it. */
export function isFirstSubscriptionInvoice(billingReason?: string): boolean {
  return billingReason === "subscription_create";
}

export interface MemberBillingState {
  membershipStatus?: string;
  plan?: string | null;
  expiresAt?: number;
  pastDue?: boolean;
  pastDueAt?: number | null;
  lastPaidInvoiceId?: string;
  lastFailedInvoiceId?: string;
}

/**
 * Updates for a paid renewal invoice, or null when it was already applied.
 * expiresAt is absolute (period end + grace) and never moves backwards, so a
 * replayed or out-of-order event cannot extend access twice.
 */
export function renewalUpdates(
  user: MemberBillingState,
  info: Pick<SubscriptionInvoiceInfo, "invoiceId" | "periodEndMs" | "plan" | "subscriptionId">,
  now: number,
): Record<string, unknown> | null {
  if (info.invoiceId && user.lastPaidInvoiceId === info.invoiceId) return null;

  const paidThrough = info.periodEndMs > 0
    ? info.periodEndMs + RENEWAL_GRACE_DAYS * DAY_MS
    : now + FALLBACK_ACCESS_DAYS * DAY_MS;
  const expiresAt = Math.max(user.expiresAt || 0, paidThrough);

  const updates: Record<string, unknown> = {
    membershipStatus: "active",
    expiresAt,
    pastDue: false,
    pastDueAt: null,
    updatedAt: now,
  };
  if (info.invoiceId) updates.lastPaidInvoiceId = info.invoiceId;
  if (info.subscriptionId) updates["features.stripeSubscriptionId"] = info.subscriptionId;
  if (!user.plan && info.plan) updates.plan = info.plan;
  return updates;
}

/**
 * Updates for a failed renewal invoice, or null when there is nothing to do:
 * the same failure was already recorded, or that invoice has since been paid.
 * Keeps the first pastDueAt so the timestamp marks when payment first failed.
 */
export function failedPaymentUpdates(
  user: MemberBillingState,
  info: Pick<SubscriptionInvoiceInfo, "invoiceId">,
  now: number,
): Record<string, unknown> | null {
  if (info.invoiceId && user.lastPaidInvoiceId === info.invoiceId) return null;
  if (info.invoiceId && user.lastFailedInvoiceId === info.invoiceId && user.pastDue) return null;

  const updates: Record<string, unknown> = {
    membershipStatus: "pastDue",
    pastDue: true,
    pastDueAt: user.pastDue && user.pastDueAt ? user.pastDueAt : now,
    updatedAt: now,
  };
  if (info.invoiceId) updates.lastFailedInvoiceId = info.invoiceId;
  return updates;
}
