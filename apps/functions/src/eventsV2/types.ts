export const EVENT_FLOW_VERSION = "2";
export const HOLD_MS = 15 * 60 * 1000;
export const WAITLIST_CLAIM_MS = 30 * 60 * 1000;
export const DEFAULT_REFUND_CUTOFF_HOURS = 24;
export const DEFAULT_MAX_TICKETS = 8;
export const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || "https://hi-coworking.com";
export const FROM_EMAIL = "events@hi-coworking.com";

export type EventStatusV2 = "draft" | "published" | "cancelled" | "completed";
export type RegistrationStatusV2 = "CONFIRMED" | "CANCELLED" | "REFUND_PENDING" | "REFUNDED";
export type AttendanceStatusV2 = "NOT_CHECKED_IN" | "PARTIAL" | "CHECKED_IN" | "NO_SHOW";

export interface EventTicketTypeV2 {
  id: string;
  name: string;
  priceCents: number;
  quantity?: number;
  soldCount?: number;
  heldCount?: number;
  description?: string;
  targetAudience?: "public" | "member" | "vip";
}

export interface EventDocV2 {
  id: string;
  slug?: string;
  title: string;
  description: string;
  format: "in-person" | "virtual" | "hybrid";
  location?: string;
  virtualUrl?: string;
  startTime: number;
  endTime: number;
  timezone?: string;
  seatCap?: number;
  registrationCount?: number;
  confirmedQuantity?: number;
  heldQuantity?: number;
  price?: number;
  memberPriceCents?: number;
  currency?: string;
  ticketTypes?: EventTicketTypeV2[];
  imageUrl?: string;
  heroImage?: Record<string, unknown>;
  gallery?: Array<Record<string, unknown>>;
  recordingUrl?: string;
  status: EventStatusV2;
  registrationOpenAt?: number;
  registrationCloseAt?: number;
  refundCutoffHours?: number;
  reminders?: {
    confirmation?: boolean;
    reminder24h?: boolean;
    reminder1h?: boolean;
    followUp?: boolean;
  };
  createdBy?: string;
  createdAt?: number;
  updatedAt?: number;
  publishedAt?: number;
}

export interface RegistrationDocV2 {
  id: string;
  eventId: string;
  uid?: string;
  displayName: string;
  email: string;
  ticketTypeId?: string;
  ticketTypeName?: string;
  quantity: number;
  publicUnitPriceCents: number;
  discountCents: number;
  finalUnitPriceCents: number;
  amountPaidCents: number;
  currency: string;
  paymentId?: string;
  status: RegistrationStatusV2;
  attendanceStatus: AttendanceStatusV2;
  checkedInQuantity: number;
  checkedInAt?: number;
  source: "web" | "member" | "staff_walkin" | "waitlist";
  manageSecretHash: string;
  registeredAt: number;
  cancelledAt?: number;
  refundedAt?: number;
  stripeRefundId?: string;
}

export interface EventHoldV2 {
  id: string;
  eventId: string;
  uid?: string;
  guestName: string;
  guestEmail: string;
  ticketTypeId?: string;
  ticketTypeName?: string;
  quantity: number;
  publicUnitPriceCents: number;
  discountCents: number;
  finalUnitPriceCents: number;
  totalCents: number;
  currency: string;
  status: "HELD" | "CONSUMED" | "EXPIRED" | "CANCELLED";
  source: "web" | "member" | "waitlist";
  secretHash: string;
  manageSecret: string;
  createdAt: number;
  expiresAt: number;
  paymentId?: string;
  stripeCheckoutSessionId?: string;
  checkoutUrl?: string;
  registrationId?: string;
  waitlistEntryId?: string;
}

export interface WaitlistEntryV2 {
  id: string;
  eventId: string;
  uid?: string;
  displayName: string;
  email: string;
  ticketTypeId?: string;
  quantity: number;
  joinedAt: number;
  status: "WAITING" | "OFFERED" | "CLAIMED" | "EXPIRED" | "REMOVED";
  manageSecretHash: string;
  offerHoldId?: string;
  offerExpiresAt?: number;
  updatedAt?: number;
}

export interface EventIdentityV2 {
  uid?: string;
  displayName: string;
  email: string;
  member: boolean;
}

export interface EventPricingV2 {
  ticketTypeId?: string;
  ticketTypeName?: string;
  publicUnitPriceCents: number;
  discountCents: number;
  finalUnitPriceCents: number;
  totalCents: number;
  currency: string;
}

export interface CancellationDecisionV2 {
  canCancel: boolean;
  refundEligible: boolean;
  refundCents: number;
  cutoffHours: number;
}
