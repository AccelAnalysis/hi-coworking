/**
 * Stripe Product & Price Configuration
 *
 * MIRROR of @hi/shared pricing — kept inline because @hi/shared is ESM-only.
 * Keep in sync with: packages/shared/src/index.ts → MEMBERSHIP_TIERS /
 * GUEST_PRICING / CONFERENCE_ROOM_CONFIG and packages/shared/src/seatCatalog.ts
 * → SEAT_TIERS.
 *
 * Secrets are never stored here. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET via:
 *    firebase functions:secrets:set STRIPE_SECRET_KEY
 *    firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
 */

// --- Membership Tiers ---
//
// Live Stripe prices created 24 Nov 2026 (Hi Coworking live account). The
// legacy $49 / $129 / $199 prices stay recognized so webhooks, history and any
// grandfathered subscription still resolve to the right plan.

export type MembershipTierId = "virtual" | "coworking" | "coworking_plus";

/** Desk tiers a membership's included hours can be used on. */
export type DeskSeatTierId = "basic" | "window" | "equipped";

export interface MembershipTier {
  id: MembershipTierId;
  name: string;
  stripePriceId: string;
  /** Earlier live Stripe prices that still map to this plan. */
  legacyStripePriceIds: string[];
  /** Stripe lookup key for the current price. */
  stripeLookupKey: string;
  interval: "month";
  /** Amount in cents */
  amountCents: number;
  currency: string;
  features: string[];
  /** Included desk hours per month */
  includedHoursPerMonth: number;
  /** Seat tiers that included hours cover. Empty for SayHi Connect. */
  includedSeatTiers: DeskSeatTierId[];
  /** Discount off the guest hourly rate on overage hours (0 for SayHi Connect). */
  overageDiscountPercent: number;
  /**
   * Lowest overage rate in cents per hour (Basic seats). Per-seat-tier rates
   * live in DESK_SEAT_TIERS; this is kept for summaries and older callers.
   */
  extraHourlyRateCents: number;
  /** Booking window: max days ahead */
  bookingWindowDays: number;
}

export const MEMBERSHIP_TIERS: MembershipTier[] = [
  {
    id: "virtual",
    name: "SayHi Connect",
    stripePriceId: "price_1UfCfpAHu8lEXCs8Xw0ruygi",
    legacyStripePriceIds: ["price_1U9J0xAHu8lEXCs8UHv7AAiz"],
    stripeLookupKey: "hic_sayhi_connect_monthly",
    interval: "month",
    amountCents: 6900,
    currency: "usd",
    includedHoursPerMonth: 0,
    includedSeatTiers: [],
    overageDiscountPercent: 0,
    extraHourlyRateCents: 1750,
    bookingWindowDays: 14,
    features: [
      "Book any open desk at guest rates, from $17.50/hr",
      "Half-day and full-day desk caps apply automatically",
      "Accel Procurement Founders access included",
      "Book up to 14 days ahead",
      "No mail service (mail plan coming soon)",
    ],
  },
  {
    id: "coworking",
    name: "Coworking Member",
    stripePriceId: "price_1UfCfvAHu8lEXCs85BgcHiJy",
    legacyStripePriceIds: ["price_1U9J1CAHu8lEXCs8X1o0O5hG"],
    stripeLookupKey: "hic_coworking_member_monthly",
    interval: "month",
    amountCents: 15900,
    currency: "usd",
    includedHoursPerMonth: 36,
    includedSeatTiers: ["basic", "window"],
    overageDiscountPercent: 20,
    extraHourlyRateCents: 1400,
    bookingWindowDays: 90,
    features: [
      "36 desk hours/month on Basic and Window seats (D1–D4)",
      "20% off extra hours and Equipped seats (D5–D6)",
      "Extra time capped at the half-day and day price",
      "Book up to 90 days ahead",
    ],
  },
  {
    id: "coworking_plus",
    name: "Coworking Plus",
    stripePriceId: "price_1UfCfxAHu8lEXCs8ueNs9jAk",
    legacyStripePriceIds: ["price_1U9J1KAHu8lEXCs8xZETzk7F"],
    stripeLookupKey: "hic_coworking_plus_monthly",
    interval: "month",
    amountCents: 28900,
    currency: "usd",
    includedHoursPerMonth: 54,
    includedSeatTiers: ["basic", "window", "equipped"],
    overageDiscountPercent: 30,
    extraHourlyRateCents: 1225,
    bookingWindowDays: 90,
    features: [
      "54 desk hours/month on Basic, Window, and Equipped seats (D1–D6)",
      "30% off extra hours",
      "Extra time capped at the half-day and day price",
      "Book up to 90 days ahead",
    ],
  },
];

// --- Desk seat tiers (D1–D6; D7 is staff-only) ---
// MIRROR of packages/shared/src/seatCatalog.ts → SEAT_TIERS.

export interface DeskSeatTierRates {
  id: DeskSeatTierId;
  name: string;
  guestHourlyCents: number;
  /** 4-hour half-day price and the cap for bookings up to 4 billable hours. */
  guestHalfDayCents: number;
  /** 9-hour day price and the cap for longer bookings. */
  guestDayCents: number;
  /** Coworking Member overage (20% off guest hourly). */
  memberOverageHourlyCents: number;
  /** Coworking Plus overage (30% off guest hourly). */
  plusOverageHourlyCents: number;
}

export const DESK_SEAT_TIERS: Record<DeskSeatTierId, DeskSeatTierRates> = {
  basic: {
    id: "basic",
    name: "Basic",
    guestHourlyCents: 1750,
    guestHalfDayCents: 2900,
    guestDayCents: 4900,
    memberOverageHourlyCents: 1400,
    plusOverageHourlyCents: 1225,
  },
  window: {
    id: "window",
    name: "Window sit-stand",
    guestHourlyCents: 1900,
    guestHalfDayCents: 3900,
    guestDayCents: 6500,
    memberOverageHourlyCents: 1520,
    plusOverageHourlyCents: 1330,
  },
  equipped: {
    id: "equipped",
    name: "Equipped",
    guestHourlyCents: 2200,
    guestHalfDayCents: 4900,
    guestDayCents: 7900,
    memberOverageHourlyCents: 1760,
    plusOverageHourlyCents: 1540,
  },
};

/** Bookable desk resource → seat tier. seat-7 (D7) is staff-only and absent. */
export const DESK_SEAT_TIER_BY_RESOURCE: Record<string, DeskSeatTierId> = {
  "seat-1": "basic",
  "seat-2": "basic",
  "seat-3": "window",
  "seat-4": "window",
  "seat-5": "equipped",
  "seat-6": "equipped",
};

export function deskSeatTierForResource(resourceId: string): DeskSeatTierRates | undefined {
  const tierId = DESK_SEAT_TIER_BY_RESOURCE[resourceId];
  return tierId ? DESK_SEAT_TIERS[tierId] : undefined;
}

// --- Guest (Walk-In) Rates ---

/** Lowest guest desk rate (Basic seats). Per-tier rates live in DESK_SEAT_TIERS. */
export const GUEST_HOURLY_RATE_CENTS = DESK_SEAT_TIERS.basic.guestHourlyCents;
export const GUEST_BOOKING_WINDOW_DAYS = 14;
export const HALF_DAY_HOURS = 4;
export const FULL_DAY_HOURS = 9;

// --- Conference Room ---

/** Weekday 4-hour slot, flat price. Blocks D1–D6 (exclusive main_space). */
export const CONFERENCE_ROOM_SLOT_PRICE_CENTS = 24900;
/** Evening / weekend 4-hour slot by appointment. */
export const CONFERENCE_ROOM_AFTER_HOURS_SLOT_PRICE_CENTS = 29900;
export const CONFERENCE_ROOM_SLOT_HOURS = 4;
/** Marketed as 6 seats (permit cap). Was 10 in earlier code. */
export const CONFERENCE_ROOM_MAX_CAPACITY = 6;

export type ConferenceSlotId = "morning" | "afternoon";
export const CONFERENCE_ROOM_WEEKDAY_SLOTS: ReadonlyArray<{
  id: ConferenceSlotId;
  label: string;
  /** Facility-local minutes after midnight. */
  startMinutes: number;
  endMinutes: number;
}> = [
  { id: "morning", label: "Morning 8:00 AM–12:00 PM", startMinutes: 8 * 60, endMinutes: 12 * 60 },
  { id: "afternoon", label: "Afternoon 1:00 PM–5:00 PM", startMinutes: 13 * 60, endMinutes: 17 * 60 },
];

export const CONFERENCE_SLOT_MESSAGE =
  "The conference room books in weekday 4-hour slots only: Morning 8:00 AM–12:00 PM or Afternoon 1:00 PM–5:00 PM ($249).";

// --- Private Office ---
// MIRROR of packages/shared/src/seatCatalog.ts → PRIVATE_OFFICE_*.

export const PRIVATE_OFFICE_RESOURCE_ID = "private-office";
export const PRIVATE_OFFICE_RATES = {
  name: "Private Office",
  shortLabel: "Right-hand room",
  guestHourlyCents: 3900,
  guestHalfDayCents: 9900,
  guestDayCents: 14900,
} as const;
export const PRIVATE_OFFICE_BLOCKED_SEAT_ID = "seat-1";

export function isPrivateOfficeResource(resourceId: string): boolean {
  return resourceId === PRIVATE_OFFICE_RESOURCE_ID;
}

// --- Lookup Helpers ---

/** Current or legacy live Stripe price → plan. */
export function getTierByPriceId(priceId: string): MembershipTier | undefined {
  if (!priceId) return undefined;
  return MEMBERSHIP_TIERS.find(
    (t) => t.stripePriceId === priceId || t.legacyStripePriceIds.includes(priceId),
  );
}

export function isLegacyStripePriceId(priceId: string): boolean {
  return MEMBERSHIP_TIERS.some((t) => t.legacyStripePriceIds.includes(priceId));
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
