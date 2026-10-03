/**
 * Stripe Product & Price Configuration
 *
 * MIRROR of @hi/shared pricing — kept inline because @hi/shared is ESM-only.
 * Keep in sync with: packages/shared/src/index.ts → MEMBERSHIP_TIERS / GUEST_PRICING
 *
 * Setup instructions:
 * 1. Create products in Stripe Dashboard (https://dashboard.stripe.com/products)
 * 2. Create recurring prices for each product
 * 3. Copy the price IDs (e.g. price_xxx) into the arrays below
 * 4. Set the STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET via:
 *    firebase functions:secrets:set STRIPE_SECRET_KEY
 *    firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
 */

// --- Membership Tiers ---

export type MembershipTierId = "virtual" | "coworking" | "coworking_plus";

export type BillingInterval = "month" | "year";

/** Annual checkout charges 10 months (2 months included). Keep in sync with @hi/shared. */
export const ANNUAL_MONTHS_BILLED = 10;

export interface MembershipTier {
  id: MembershipTierId;
  name: string;
  stripePriceId: string;
  /**
   * Optional Stripe Price for annual billing. Leave empty until the Price
   * exists in the Stripe dashboard. Checkout then uses a recurring price_data
   * line on the existing Stripe secret instead of inventing a charge.
   */
  stripeAnnualPriceId?: string;
  interval: "month";
  /** Amount in cents */
  amountCents: number;
  currency: string;
  features: string[];
  /** Included desk hours per month */
  includedHoursPerMonth: number;
  /** Extra desk-hour rate in cents (beyond included hours) */
  extraHourlyRateCents: number;
  /** Booking window: max days ahead */
  bookingWindowDays: number;
}

export const MEMBERSHIP_TIERS: MembershipTier[] = [
  {
    id: "virtual",
    name: "Virtual Office",
    stripePriceId: "price_1U9J0xAHu8lEXCs8UHv7AAiz",
    interval: "month",
    amountCents: 4900,
    currency: "usd",
    includedHoursPerMonth: 0,
    extraHourlyRateCents: 1750,
    bookingWindowDays: 14,
    features: [
      "Virtual Office membership",
      "Coworking desk access at the public rate",
      "Desk use: $17.50/hr",
    ],
  },
  {
    id: "coworking",
    name: "Coworking Member",
    stripePriceId: "price_1U9J1CAHu8lEXCs8X1o0O5hG",
    interval: "month",
    amountCents: 12900,
    currency: "usd",
    includedHoursPerMonth: 10,
    extraHourlyRateCents: 1400,
    bookingWindowDays: 90,
    features: [
      "10 desk hours/month included",
      "20% off additional desk hours ($14/hr)",
      "Book up to 90 days ahead",
      "Wi-Fi, coffee, and shared amenities",
    ],
  },
  {
    id: "coworking_plus",
    name: "Coworking Plus",
    stripePriceId: "price_1U9J1KAHu8lEXCs8xZETzk7F",
    interval: "month",
    amountCents: 19900,
    currency: "usd",
    includedHoursPerMonth: 15,
    extraHourlyRateCents: 1225,
    bookingWindowDays: 90,
    features: [
      "15 desk hours/month included",
      "30% off additional desk hours ($12.25/hr)",
      "Book up to 90 days ahead",
      "Wi-Fi, coffee, and shared amenities",
    ],
  },
];

// --- Guest (Walk-In) Rates ---

export const GUEST_HOURLY_RATE_CENTS = 1750;
export const GUEST_DAILY_CAP_CENTS = 11500;
export const GUEST_BOOKING_WINDOW_DAYS = 14;

// --- Conference Room ---

export const CONFERENCE_ROOM_HOURLY_RATE_CENTS = 9900;
export const CONFERENCE_ROOM_MAX_CAPACITY = 10;

// --- Lookup Helpers ---

export function getTierByPriceId(priceId: string): MembershipTier | undefined {
  return MEMBERSHIP_TIERS.find((t) => t.stripePriceId === priceId || t.stripeAnnualPriceId === priceId);
}

export function membershipAmountCents(tier: MembershipTier, interval: BillingInterval) {
  if (interval === "year") return tier.amountCents * ANNUAL_MONTHS_BILLED;
  return tier.amountCents;
}

export function resolveMembershipCheckout(tier: MembershipTier, interval: BillingInterval) {
  const amountCents = membershipAmountCents(tier, interval);
  if (interval === "year") {
    const annualPriceId = tier.stripeAnnualPriceId?.trim() || "";
    if (annualPriceId) {
      return {
        interval,
        amountCents,
        pricingMode: "price" as const,
        stripePriceId: annualPriceId,
      };
    }
    return {
      interval,
      amountCents,
      pricingMode: "price_data" as const,
      stripePriceId: "",
    };
  }
  return {
    interval: "month" as const,
    amountCents,
    pricingMode: "price" as const,
    stripePriceId: tier.stripePriceId,
  };
}

export function getTierById(tierId: string): MembershipTier | undefined {
  return MEMBERSHIP_TIERS.find((t) => t.id === tierId);
}

/** Only physical coworking plans receive included desk time/member overage pricing. */
export function getDeskMembershipTierById(tierId: string): MembershipTier | undefined {
  const tier = getTierById(tierId);
  return tier && (tier.id === "coworking" || tier.id === "coworking_plus")
    ? tier
    : undefined;
}
