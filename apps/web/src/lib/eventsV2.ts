import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";
import type { EventDoc, EventMediaImage, EventTicketType } from "@hi/shared";

export type EventPublic = EventDoc & {
  slug?: string;
  timezone?: string;
  confirmedQuantity?: number;
  heldQuantity?: number;
  memberPriceCents?: number;
  registrationOpenAt?: number;
  registrationCloseAt?: number;
  refundCutoffHours?: number;
  reminders?: {
    confirmation?: boolean;
    reminder24h?: boolean;
    reminder1h?: boolean;
    followUp?: boolean;
  };
};

export type EventRegistrationV2 = {
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
  status: "CONFIRMED" | "CANCELLED" | "REFUND_PENDING" | "REFUNDED";
  attendanceStatus: "NOT_CHECKED_IN" | "PARTIAL" | "CHECKED_IN" | "NO_SHOW";
  checkedInQuantity: number;
  checkedInAt?: number;
  source: "web" | "member" | "staff_walkin" | "waitlist";
  registeredAt: number;
  cancelledAt?: number;
  refundedAt?: number;
};

export type EventWaitlistV2 = {
  id: string;
  eventId: string;
  uid?: string;
  displayName: string;
  email: string;
  ticketTypeId?: string;
  quantity: number;
  joinedAt: number;
  status: "WAITING" | "OFFERED" | "CLAIMED" | "EXPIRED" | "REMOVED";
  offerExpiresAt?: number;
};

export type EventCancellationQuote = {
  canCancel: boolean;
  refundEligible: boolean;
  refundCents: number;
  cutoffHours: number;
};

export async function listPublishedEvents(options?: { includePast?: boolean }) {
  const q = query(
    collection(db, "events"),
    where("status", "==", "published"),
    orderBy("startTime", "asc"),
    limit(100),
  );
  const snap = await getDocs(q);
  const rows = snap.docs.map((item) => item.data() as EventPublic);
  if (options?.includePast) return rows;
  const now = Date.now();
  return rows.filter((event) => event.endTime >= now);
}

export async function listPastEvents() {
  const q = query(
    collection(db, "events"),
    where("status", "in", ["published", "completed"]),
    orderBy("startTime", "desc"),
    limit(100),
  );
  const snap = await getDocs(q);
  const now = Date.now();
  return snap.docs
    .map((item) => item.data() as EventPublic)
    .filter((event) => event.endTime < now);
}

export async function getPublicEvent(identifier: string): Promise<EventPublic | null> {
  const direct = await getDoc(doc(db, "events", identifier));
  if (direct.exists()) {
    const event = direct.data() as EventPublic;
    return event.status === "published" || event.status === "completed" ? event : null;
  }
  const bySlug = await getDocs(query(
    collection(db, "events"),
    where("slug", "==", identifier),
    limit(1),
  ));
  if (bySlug.empty) return null;
  const event = bySlug.docs[0].data() as EventPublic;
  return event.status === "published" || event.status === "completed" ? event : null;
}

export function eventAvailableSeats(event: EventPublic) {
  if (typeof event.seatCap !== "number") return null;
  const confirmed = event.confirmedQuantity ?? event.registrationCount ?? 0;
  const held = event.heldQuantity ?? 0;
  return Math.max(0, event.seatCap - confirmed - held);
}

export function eventPublicPrice(event: EventPublic, ticket?: EventTicketType) {
  return ticket?.priceCents ?? event.price ?? 0;
}

export function eventPrimaryImage(event: EventPublic): EventMediaImage | null {
  if (event.heroImage) return event.heroImage;
  if (event.imageUrl) {
    return { storagePath: "", downloadUrl: event.imageUrl, alt: event.title };
  }
  return null;
}

export const beginEventRegistration = httpsCallable<{
  eventId: string;
  ticketTypeId?: string;
  quantity?: number;
  guest?: { name: string; email: string };
  successUrl?: string;
  cancelUrl?: string;
},
  | { kind: "confirmed"; registrationId: string }
  | { kind: "checkout"; holdId: string; holdSecret: string; expiresAt: number; paymentId: string; checkoutUrl: string }
  | { kind: "full"; waitlistAvailable: boolean }
>(functions, "events_v2BeginRegistration");

export const finalizeEventRegistration = httpsCallable<
  { holdId: string; holdSecret?: string },
  { status: "pending" | "confirmed" | "failed"; registrationId?: string }
>(functions, "events_v2FinalizeRegistration");

export const getEventRegistration = httpsCallable<
  { registrationId: string; manageToken?: string },
  { registration: EventRegistrationV2; event: EventPublic; cancellation: EventCancellationQuote }
>(functions, "events_v2GetRegistration");

export const getEventCancellationQuote = httpsCallable<
  { registrationId: string; manageToken?: string },
  EventCancellationQuote
>(functions, "events_v2GetCancellationQuote");

export const cancelEventRegistrationV2 = httpsCallable<
  { registrationId: string; manageToken?: string },
  { success: boolean; refundCents: number; refundPending: boolean }
>(functions, "events_v2CancelRegistration");

export const joinEventWaitlistV2 = httpsCallable<{
  eventId: string;
  ticketTypeId?: string;
  quantity?: number;
  guest?: { name: string; email: string };
}, { success: boolean; entryId: string; alreadyJoined: boolean }>(functions, "events_v2JoinWaitlist");

export const claimEventWaitlistOffer = httpsCallable<{
  entryId: string;
  token: string;
  successUrl?: string;
  cancelUrl?: string;
},
  | { kind: "confirmed"; registrationId: string }
  | { kind: "checkout"; holdId: string; holdSecret: string; expiresAt: number; paymentId: string; checkoutUrl: string }
>(functions, "events_v2ClaimWaitlistOffer");

export const leaveEventWaitlist = httpsCallable<
  { entryId: string; manageToken?: string },
  { success: boolean }
>(functions, "events_v2LeaveWaitlist");

export type AdminEventInput = {
  id?: string;
  title: string;
  description: string;
  format: "in-person" | "virtual" | "hybrid";
  location?: string;
  virtualUrl?: string;
  startTime: number;
  endTime: number;
  timezone?: string;
  seatCap?: number;
  price?: number;
  memberPriceCents?: number;
  currency?: string;
  ticketTypes?: EventTicketType[];
  heroImage?: EventMediaImage;
  gallery?: EventMediaImage[];
  recordingUrl?: string;
  registrationOpenAt?: number;
  registrationCloseAt?: number;
  refundCutoffHours?: number;
  confirmation?: boolean;
  reminder24h?: boolean;
  reminder1h?: boolean;
  followUp?: boolean;
};

export const adminSaveEventV2 = httpsCallable<AdminEventInput, {
  success: boolean;
  eventId: string;
  slug: string;
  status: string;
}>(functions, "events_v2AdminSaveEvent");

export const adminPublishEventV2 = httpsCallable<{ eventId: string }, { success: boolean; eventId: string }>(
  functions,
  "events_v2AdminPublishEvent",
);

export const adminCancelEventV2 = httpsCallable<{ eventId: string }, {
  success: boolean;
  eventId: string;
  affectedRegistrations: number;
}>(functions, "events_v2AdminCancelEvent");

export const adminCompleteEventV2 = httpsCallable<{ eventId: string }, { success: boolean; eventId: string }>(
  functions,
  "events_v2AdminCompleteEvent",
);

export const staffGetEventRoster = httpsCallable<{ eventId: string }, {
  event: EventPublic;
  registrations: EventRegistrationV2[];
  waitlist: EventWaitlistV2[];
}>(functions, "events_v2StaffGetRoster");

export const staffCheckInEventRegistration = httpsCallable<{
  registrationId: string;
  quantity?: number;
}, {
  success: boolean;
  registrationId: string;
  checkedInQuantity: number;
  attendanceStatus: string;
}>(functions, "events_v2StaffCheckIn");

export const staffAddEventWalkIn = httpsCallable<{
  eventId: string;
  name: string;
  email?: string;
  ticketTypeId?: string;
  quantity?: number;
}, { success: boolean; registrationId: string }>(functions, "events_v2StaffWalkIn");

export const listMyEventRegistrations = httpsCallable<Record<string, never>, {
  registrations: EventRegistrationV2[];
  events: EventPublic[];
}>(functions, "events_v2ListMyRegistrations");
