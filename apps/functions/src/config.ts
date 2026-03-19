
export const MEMBERSHIP_TIERS = [
  {
    id: "virtual",
    name: "Virtual Member",
    amountCents: 4900,
    interval: "month",
    currency: "usd",
    stripePriceId: "price_virtual_monthly",
    includedHoursPerMonth: 2,
    extraHourlyRateCents: 1200,
    bookingWindowDays: 14,
    includedCreditsPerMonth: 3,
    limits: {
      rfxActivePosts: 0,
      rfxInvitePushes: 0, 
      referralsSentPerMonth: 1,
      referralsReceivedPerMonth: 2,
      referralPolicyUnlocksPerMonth: 3,
      referralActiveOpen: 3
    },
  },
  {
    id: "coworking",
    name: "Coworking Member",
    amountCents: 12900,
    interval: "month",
    currency: "usd",
    stripePriceId: "price_coworking_monthly",
    includedHoursPerMonth: 15,
    extraHourlyRateCents: 1050,
    bookingWindowDays: 90,
    includedCreditsPerMonth: 10,
    limits: {
      rfxActivePosts: 2,
      rfxInvitePushes: 25,
      referralsSentPerMonth: 5,
      referralsReceivedPerMonth: 5,
      referralPolicyUnlocksPerMonth: 15,
      referralActiveOpen: 15
    },
  },
  {
    id: "coworking_plus",
    name: "Coworking Plus",
    amountCents: 19900,
    interval: "month",
    currency: "usd",
    stripePriceId: "price_coworking_plus_monthly",
    includedHoursPerMonth: 30,
    extraHourlyRateCents: 900,
    bookingWindowDays: 90,
    includedCreditsPerMonth: 25,
    limits: {
      rfxActivePosts: 5,
      rfxInvitePushes: 100,
      referralsSentPerMonth: 15,
      referralsReceivedPerMonth: 15,
      referralPolicyUnlocksPerMonth: 50,
      referralActiveOpen: 50
    },
  },
];

export const CREDIT_PACKS = [
  { id: "pack_10", credits: 10, priceCents: 2500 },
  { id: "pack_25", credits: 25, priceCents: 5500 },
  { id: "pack_60", credits: 60, priceCents: 12000 },
] as const;

export const CREDIT_COSTS = {
  // RFx
  RFX_PUBLISH: 3,
  RFX_PUSH_INVITES_10: 1, // Per 10 invites
  RFX_PRIORITY_INTRO: 2,
  RFX_BID_BOOK_EXPORT: 4, 
  RFX_PREMIUM_CONTACT: 2,
  RFX_BOOST_BID: 3,
  RFX_PORTFOLIO_SPOTLIGHT: 5,
  
  // Referrals
  REFERRAL_SEND_EXTRA: 2,
  REFERRAL_ACCEPT_EXTRA: 1,
  REFERRAL_UNLOCK_POLICY: 1,
  REFERRAL_PRIORITY_INTRO: 2,
  REFERRAL_VERIFICATION_PACKET: 2,
  REFERRAL_OPEN_DISPUTE: 4,
  REFERRAL_BOOST_PROFILE: 5,
  REFERRAL_FEATURED_SLOT: 10,
  
  // Events & Other
  VERIFIED_BUSINESS_MONTHLY: 5,
} as const;

export const RESOURCE_CONFIG: Record<string, {
  name: string;
  type: "SEAT" | "MODE";
  guestRateHourly: number;
  exclusiveGroupId: string;
  capacity: number;
}> = {
  "seat-1": { name: "Seat 1", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
  "seat-2": { name: "Seat 2", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
  "seat-3": { name: "Seat 3", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
  "seat-4": { name: "Seat 4", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
  "seat-5": { name: "Seat 5", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
  "seat-6": { name: "Seat 6", type: "SEAT", guestRateHourly: 17.5, exclusiveGroupId: "main_space", capacity: 1 },
  "mode-conference": { name: "Conference Room", type: "MODE", guestRateHourly: 75, exclusiveGroupId: "main_space", capacity: 10 },
};
