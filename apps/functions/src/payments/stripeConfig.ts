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
    name: "Virtual Member",
    stripePriceId: "price_virtual_monthly",
    interval: "month",
    amountCents: 4900,
    currency: "usd",
    includedHoursPerMonth: 2,
    extraHourlyRateCents: 1200,
    bookingWindowDays: 14,
    features: [
      "Member Directory access",
      "AccelProcure / RFx feed access",
      "Business profile + Procurement-Ready badge",
      "Virtual community events",
      "2 desk hours/month included",
      "Extra hours: $12/hr",
    ],
  },
  {
    id: "coworking",
    name: "Coworking Member",
    stripePriceId: "price_coworking_monthly",
    interval: "month",
    amountCents: 12900,
    currency: "usd",
    includedHoursPerMonth: 15,
    extraHourlyRateCents: 1050,
    bookingWindowDays: 90,
    features: [
      "Everything in Virtual Member",
      "15 desk hours/month included",
      "Extra hours: $10.50/hr",
      "Book up to 90 days ahead",
    ],
  },
  {
    id: "coworking_plus",
    name: "Coworking Plus",
    stripePriceId: "price_coworking_plus_monthly",
    interval: "month",
    amountCents: 19900,
    currency: "usd",
    includedHoursPerMonth: 30,
    extraHourlyRateCents: 900,
    bookingWindowDays: 90,
    features: [
      "Everything in Coworking Member",
      "30 desk hours/month included",
      "Extra hours: $9/hr",
      "Highest booking priority",
    ],
  },
];

// --- Guest (Walk-In) Rates ---

export const GUEST_HOURLY_RATE_CENTS = 1750;
export const GUEST_DAILY_CAP_CENTS = 11500;
export const GUEST_BOOKING_WINDOW_DAYS = 14;

// --- Conference Room ---

export const CONFERENCE_ROOM_HOURLY_RATE_CENTS = 7500;
export const CONFERENCE_ROOM_MAX_CAPACITY = 10;

// --- Lookup Helpers ---

export function getTierByPriceId(priceId: string): MembershipTier | undefined {
  return MEMBERSHIP_TIERS.find((t) => t.stripePriceId === priceId);
}

export function getTierById(tierId: string): MembershipTier | undefined {
  return MEMBERSHIP_TIERS.find((t) => t.id === tierId);
}
