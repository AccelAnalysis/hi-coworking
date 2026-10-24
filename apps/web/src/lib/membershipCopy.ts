import type { MembershipTierDef } from "@hi/shared";

type TierFacts = Pick<
  MembershipTierDef,
  "id" | "name" | "includedHoursPerMonth" | "extraHourlyRateCents" | "bookingWindowDays"
>;

export function hourlyRate(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}/hr` : `$${dollars.toFixed(2)}/hr`;
}

/** One-line summary of what a plan includes, built only from the plan definition. */
export function membershipSummary(tier: TierFacts): string {
  const window = `Book up to ${tier.bookingWindowDays} days ahead.`;
  if (tier.includedHoursPerMonth > 0) {
    return `${tier.includedHoursPerMonth} coworking desk hours included each month, then ${hourlyRate(tier.extraHourlyRateCents)}. ${window}`;
  }
  return `Book a coworking desk whenever you need one, at ${hourlyRate(tier.extraHourlyRateCents)}. ${window}`;
}

export type WelcomeBannerCopy = {
  state: "active" | "activating";
  title: string;
  body: string;
};

/**
 * Copy for the banner shown after Stripe Checkout returns with
 * ?payment=success. The plan comes from the live user doc once the webhook
 * has activated it, otherwise from the ?plan= hint in the return URL.
 */
export function welcomeBannerCopy(input: {
  membershipActive: boolean;
  activeTier?: TierFacts;
  returnedTier?: TierFacts;
}): WelcomeBannerCopy {
  const { membershipActive, activeTier, returnedTier } = input;
  if (membershipActive && activeTier) {
    return {
      state: "active",
      title: `Welcome to Hi Coworking. Your ${activeTier.name} plan is active.`,
      body: membershipSummary(activeTier),
    };
  }
  const plan = returnedTier ? `${returnedTier.name} plan` : "membership";
  return {
    state: "activating",
    title: "Payment received. Welcome to Hi Coworking.",
    body: `We're activating your ${plan} now. This page updates on its own as soon as it's ready. If it isn't active within a few minutes, contact us and we'll sort it out.`,
  };
}

export type NextStep = { href: string; label: string; detail: string };

/** Next steps after joining. Every link points to a page that exists today. */
export const WELCOME_NEXT_STEPS: NextStep[] = [
  {
    href: "/book",
    label: "Book a desk or the meeting room",
    detail: "Pick a date to see open hours and live availability.",
  },
  {
    href: "/spaces",
    label: "See the space",
    detail: "Look around before your first visit.",
  },
  {
    href: "/contact",
    label: "Ask us anything",
    detail: "We're happy to help you get set up.",
  },
];

export const BILLING_HELP_EMAIL = "hicoworking@accelanalysis.com";

/** Shown when the billing portal can't be opened. Never echoes server detail. */
export const BILLING_PORTAL_ERROR = `We couldn't open billing right now. Please try again in a moment, or email ${BILLING_HELP_EMAIL} and we'll help.`;

/**
 * "Ends on {date}" for a membership set to cancel at the end of the period.
 * The webhook records cancelAtPeriodEnd and cancelAt (ms) from Stripe's
 * customer.subscription.updated event. Returns null when nothing is scheduled.
 */
export function membershipEndsLabel(
  input: { cancelAtPeriodEnd?: unknown; cancelAt?: unknown },
  timeZone = "America/New_York",
): string | null {
  const cancelAt = typeof input.cancelAt === "number" && Number.isFinite(input.cancelAt) && input.cancelAt > 0
    ? input.cancelAt
    : null;
  if (!cancelAt) return null;
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(cancelAt));
  return `Ends on ${date}`;
}
