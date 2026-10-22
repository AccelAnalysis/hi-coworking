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

export interface MembershipTier {
  id: MembershipTierId;
  name: string;
  stripePriceId: string;
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

export function getTierByPriceId(priceId: string, mode: StripeMode = "live"): MembershipTier | undefined {
  return MEMBERSHIP_TIERS.find((t) => getCheckoutTier(t.id, mode).stripePriceId === priceId);
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

/** Mode-specific catalog IDs verified against HiCoworking Stripe on 2026-10-22.
 * These are public identifiers, never credentials. Live IDs above stay unchanged.
 */
export type StripeMode = "test" | "live";
export const TEST_STRIPE_PRICE_IDS: Record<MembershipTierId, string> = {
  virtual: "price_1UTSpMAHu8lEXCs8ckhUivNq",
  coworking: "price_1UTSpJAHu8lEXCs8kWSFrW6V",
  coworking_plus: "price_1UTSpFAHu8lEXCs8LLnGZSDp",
};
export function resolveStripeMode(secretKey: string, configuredMode = process.env.STRIPE_MODE,
  projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT): StripeMode {
  if (configuredMode !== "test" && configuredMode !== "live") throw new Error("Explicit STRIPE_MODE=test or live is required");
  const keyMode = /^(?:sk|rk)_(test|live)_/.exec(secretKey)?.[1];
  if (keyMode !== configuredMode) throw new Error("Stripe key mode does not match STRIPE_MODE");
  if (!projectId) throw new Error("Firebase project identity is required for Stripe mode isolation");
  if ((configuredMode === "live") !== (projectId === "hi-coworking-plat")) {
    throw new Error("Stripe mode is not permitted in this Firebase project");
  }
  return configuredMode;
}
export function getCheckoutTier(tierId: string, mode: StripeMode): MembershipTier {
  const tier = getTierById(tierId);
  if (!tier || (mode !== "test" && mode !== "live")) throw new Error("Membership price mapping is missing");
  const stripePriceId = mode === "live" ? tier.stripePriceId : TEST_STRIPE_PRICE_IDS[tier.id];
  if (!stripePriceId || !stripePriceId.startsWith("price_")) throw new Error("Membership price mapping is missing");
  return { ...tier, stripePriceId };
}
