/**
 * My Hi copy for the member's latest membership refund.
 *
 * stripe_webhook writes users/{uid}.lastRefund on charge.refunded,
 * refund.updated and refund.failed (see apps/functions/src/payments/
 * stripeRefund.ts memberRefundSummary). IDs and amounts only.
 */

const FACILITY_TIME_ZONE = "America/New_York";
/** How long My Hi shows a refund after it was issued. */
export const REFUND_NOTICE_DAYS = 60;

export interface LastRefund {
  amountCents?: unknown;
  currency?: unknown;
  refundedAt?: unknown;
  full?: unknown;
  status?: unknown;
}

export type RefundNoticeCopy = { title: string; body: string; tone: "info" | "warning" };

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

export function refundNoticeCopy(
  refund: LastRefund | null | undefined,
  now: number,
): RefundNoticeCopy | null {
  if (!refund || typeof refund !== "object" || !(now > 0)) return null;
  const amountCents = Number(refund.amountCents);
  const refundedAt = Number(refund.refundedAt);
  if (!Number.isFinite(amountCents) || amountCents <= 0) return null;
  if (!Number.isFinite(refundedAt) || refundedAt <= 0) return null;
  if (now - refundedAt > REFUND_NOTICE_DAYS * 24 * 60 * 60 * 1000) return null;
  const currency = typeof refund.currency === "string" && /^[a-z]{3}$/i.test(refund.currency)
    ? refund.currency
    : "usd";
  const amount = money(amountCents, currency);
  if (refund.status === "failed") {
    return {
      title: "Refund didn't go through",
      body: `Your refund of ${amount} couldn't be completed. Contact us and we'll sort it out.`,
      tone: "warning",
    };
  }
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: FACILITY_TIME_ZONE,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(refundedAt));
  const what = refund.full === false ? `a partial refund of ${amount}` : `a refund of ${amount}`;
  return {
    title: "Refund issued",
    body: `We issued ${what} on ${date}. It usually takes 5–10 business days to appear on your statement.`,
    tone: "info",
  };
}
