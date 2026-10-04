import { createHash, randomBytes } from "node:crypto";
import { HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  DEFAULT_REFUND_CUTOFF_HOURS,
  type CancellationDecisionV2,
  type EventDocV2,
  type EventHoldV2,
  type EventIdentityV2,
  type EventPricingV2,
  type EventTicketTypeV2,
  type RegistrationDocV2,
} from "./types";

let firestore: FirebaseFirestore.Firestore | undefined;

export function db() {
  if (!firestore) {
    firestore = admin.firestore();
    firestore.settings({ ignoreUndefinedProperties: true });
  }
  return firestore;
}

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function randomSecret() {
  return randomBytes(24).toString("hex");
}

export function normalizeEmail(value?: string) {
  return (value || "").trim().toLowerCase();
}

export function positiveInt(value: unknown, fallback = 1) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function asMoney(value: unknown, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.round(parsed);
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `event-${Date.now()}`;
}

export function confirmedQuantity(event: Pick<EventDocV2, "confirmedQuantity" | "registrationCount">) {
  return Math.max(0, event.confirmedQuantity ?? event.registrationCount ?? 0);
}

export function availableSeats(event: EventDocV2) {
  if (typeof event.seatCap !== "number") return Number.POSITIVE_INFINITY;
  return Math.max(0, event.seatCap - confirmedQuantity(event) - Math.max(0, event.heldQuantity || 0));
}

export function requirePublished(event: EventDocV2) {
  if (event.status !== "published") {
    throw new HttpsError("failed-precondition", "This event is not open for registration.");
  }
  const now = Date.now();
  if (event.startTime <= now) {
    throw new HttpsError("failed-precondition", "This event has already started.");
  }
  if (event.registrationOpenAt && now < event.registrationOpenAt) {
    throw new HttpsError("failed-precondition", "Registration has not opened yet.");
  }
  if (event.registrationCloseAt && now > event.registrationCloseAt) {
    throw new HttpsError("failed-precondition", "Registration has closed.");
  }
}

export function requireAdmin(auth: { token?: Record<string, unknown> } | null | undefined) {
  const role = auth?.token?.role as string | undefined;
  if (role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
}

export function requireStaff(auth: { token?: Record<string, unknown> } | null | undefined) {
  const role = auth?.token?.role as string | undefined;
  if (!["staff", "admin", "master"].includes(role || "")) {
    throw new HttpsError("permission-denied", "Staff access is required.");
  }
}

export async function resolveIdentity(
  request: { auth?: { uid: string; token: Record<string, unknown> } | null },
  guest?: { name?: string; email?: string },
): Promise<EventIdentityV2> {
  if (request.auth?.uid) {
    const snap = await db().collection("users").doc(request.auth.uid).get();
    const user = snap.data() || {};
    const email = normalizeEmail((user.email as string | undefined) || (request.auth.token.email as string | undefined));
    if (!email) throw new HttpsError("failed-precondition", "Your account is missing an email address.");
    return {
      uid: request.auth.uid,
      displayName: String(user.displayName || request.auth.token.name || email),
      email,
      member: user.membershipStatus === "active" && Boolean(user.plan),
    };
  }
  const displayName = String(guest?.name || "").trim();
  const email = normalizeEmail(guest?.email);
  if (!displayName || !email || !email.includes("@")) {
    throw new HttpsError("invalid-argument", "Name and a valid email are required.");
  }
  return { displayName, email, member: false };
}

function matchingTicket(event: EventDocV2, ticketTypeId?: string) {
  const tickets = event.ticketTypes || [];
  if (!tickets.length) return undefined;
  const ticket = ticketTypeId ? tickets.find((item) => item.id === ticketTypeId) : tickets[0];
  if (!ticket) throw new HttpsError("not-found", "Ticket type not found.");
  return ticket;
}

export function resolvePricing(
  event: EventDocV2,
  ticketTypeId: string | undefined,
  member: boolean,
  quantity: number,
): EventPricingV2 {
  const ticket = matchingTicket(event, ticketTypeId);
  if (ticket?.targetAudience === "member" && !member) {
    throw new HttpsError("permission-denied", "This ticket is available to active members only.");
  }
  if (ticket?.targetAudience === "vip") {
    throw new HttpsError("permission-denied", "This ticket requires staff approval.");
  }
  if (ticket && typeof ticket.quantity === "number") {
    const committed = Math.max(0, ticket.soldCount || 0) + Math.max(0, ticket.heldCount || 0);
    if (committed + quantity > ticket.quantity) {
      throw new HttpsError("resource-exhausted", "That ticket type is sold out.");
    }
  }

  const publicUnitPriceCents = asMoney(ticket?.priceCents ?? event.price ?? 0);
  const memberUnitPriceCents = member && !ticket && typeof event.memberPriceCents === "number"
    ? asMoney(event.memberPriceCents)
    : publicUnitPriceCents;
  const finalUnitPriceCents = Math.min(publicUnitPriceCents, memberUnitPriceCents);
  return {
    ticketTypeId: ticket?.id,
    ticketTypeName: ticket?.name,
    publicUnitPriceCents,
    discountCents: Math.max(0, publicUnitPriceCents - finalUnitPriceCents),
    finalUnitPriceCents,
    totalCents: finalUnitPriceCents * quantity,
    currency: String(event.currency || "usd").toLowerCase(),
  };
}

export function reserveTicketInventory(event: EventDocV2, ticketTypeId: string | undefined, quantity: number) {
  if (!ticketTypeId || !event.ticketTypes?.length) return event.ticketTypes || [];
  const ticket = event.ticketTypes.find((item) => item.id === ticketTypeId);
  if (!ticket) throw new HttpsError("not-found", "Ticket type not found.");
  if (typeof ticket.quantity === "number") {
    const committed = Math.max(0, ticket.soldCount || 0) + Math.max(0, ticket.heldCount || 0);
    if (committed + quantity > ticket.quantity) {
      throw new HttpsError("resource-exhausted", "That ticket type is sold out.");
    }
  }
  return event.ticketTypes.map((item) => item.id === ticketTypeId
    ? { ...item, heldCount: Math.max(0, item.heldCount || 0) + quantity }
    : item);
}

export function releaseTicketHold(event: EventDocV2, ticketTypeId: string | undefined, quantity: number) {
  if (!ticketTypeId || !event.ticketTypes?.length) return event.ticketTypes || [];
  return event.ticketTypes.map((item) => item.id === ticketTypeId
    ? { ...item, heldCount: Math.max(0, (item.heldCount || 0) - quantity) }
    : item);
}

export function sellTicketInventory(
  event: EventDocV2,
  ticketTypeId: string | undefined,
  quantity: number,
  fromHold: boolean,
) {
  if (!ticketTypeId || !event.ticketTypes?.length) return event.ticketTypes || [];
  const ticket = event.ticketTypes.find((item) => item.id === ticketTypeId);
  if (!ticket) throw new HttpsError("not-found", "Ticket type not found.");
  if (!fromHold && typeof ticket.quantity === "number") {
    const committed = Math.max(0, ticket.soldCount || 0) + Math.max(0, ticket.heldCount || 0);
    if (committed + quantity > ticket.quantity) {
      throw new HttpsError("resource-exhausted", "That ticket type is sold out.");
    }
  }
  return event.ticketTypes.map((item) => item.id === ticketTypeId
    ? {
        ...item,
        heldCount: fromHold ? Math.max(0, (item.heldCount || 0) - quantity) : Math.max(0, item.heldCount || 0),
        soldCount: Math.max(0, item.soldCount || 0) + quantity,
      }
    : item);
}

export function unsellTicketInventory(event: EventDocV2, ticketTypeId: string | undefined, quantity: number) {
  if (!ticketTypeId || !event.ticketTypes?.length) return event.ticketTypes || [];
  return event.ticketTypes.map((item) => item.id === ticketTypeId
    ? { ...item, soldCount: Math.max(0, (item.soldCount || 0) - quantity) }
    : item);
}

export function registrationFromHold(
  hold: EventHoldV2,
  registrationId: string,
  paymentId?: string,
): RegistrationDocV2 {
  return {
    id: registrationId,
    eventId: hold.eventId,
    uid: hold.uid,
    displayName: hold.guestName,
    email: hold.guestEmail,
    ticketTypeId: hold.ticketTypeId,
    ticketTypeName: hold.ticketTypeName,
    quantity: hold.quantity,
    publicUnitPriceCents: hold.publicUnitPriceCents,
    discountCents: hold.discountCents,
    finalUnitPriceCents: hold.finalUnitPriceCents,
    amountPaidCents: hold.totalCents,
    currency: hold.currency,
    paymentId,
    status: "CONFIRMED",
    attendanceStatus: "NOT_CHECKED_IN",
    checkedInQuantity: 0,
    source: hold.source === "waitlist" ? "waitlist" : hold.uid ? "member" : "web",
    manageSecretHash: hashSecret(hold.manageSecret),
    registeredAt: Date.now(),
  };
}

export function cancellationDecision(registration: RegistrationDocV2, event: EventDocV2): CancellationDecisionV2 {
  const cutoffHours = Number.isFinite(event.refundCutoffHours)
    ? Math.max(0, Number(event.refundCutoffHours))
    : DEFAULT_REFUND_CUTOFF_HOURS;
  const refundEligible = registration.amountPaidCents > 0
    && Date.now() <= event.startTime - cutoffHours * 60 * 60 * 1000;
  return {
    canCancel: registration.status === "CONFIRMED" && event.status !== "completed",
    refundEligible,
    refundCents: refundEligible ? registration.amountPaidCents : 0,
    cutoffHours,
  };
}

export function sanitizeTicketTypes(input: unknown, existing: EventTicketTypeV2[] = []) {
  if (!Array.isArray(input)) return [] as EventTicketTypeV2[];
  return input.map((raw, index) => {
    const item = (raw || {}) as Record<string, unknown>;
    const id = String(item.id || `ticket_${index + 1}`).trim();
    const previous = existing.find((ticket) => ticket.id === id);
    const targetAudience = ["public", "member", "vip"].includes(String(item.targetAudience || "public"))
      ? String(item.targetAudience || "public") as EventTicketTypeV2["targetAudience"]
      : "public";
    return {
      id,
      name: String(item.name || "Ticket").trim(),
      priceCents: asMoney(item.priceCents),
      quantity: item.quantity == null || item.quantity === "" ? undefined : Math.max(1, positiveInt(item.quantity)),
      soldCount: previous?.soldCount || 0,
      heldCount: previous?.heldCount || 0,
      description: String(item.description || "").trim() || undefined,
      targetAudience,
    };
  });
}

export function validateEventForSave(input: Record<string, unknown>) {
  const title = String(input.title || "").trim();
  const description = String(input.description || "").trim();
  const startTime = Number(input.startTime);
  const endTime = Number(input.endTime);
  if (!title) throw new HttpsError("invalid-argument", "Event title is required.");
  if (!description) throw new HttpsError("invalid-argument", "Event description is required.");
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
    throw new HttpsError("invalid-argument", "Choose a valid event start and end time.");
  }
  if (!["in-person", "virtual", "hybrid"].includes(String(input.format || "in-person"))) {
    throw new HttpsError("invalid-argument", "Choose a valid event format.");
  }
  const seatCap = input.seatCap == null || input.seatCap === "" ? undefined : Number(input.seatCap);
  if (seatCap != null && (!Number.isInteger(seatCap) || seatCap < 1)) {
    throw new HttpsError("invalid-argument", "Capacity must be at least one seat.");
  }
}

export function publicDescription(value: string) {
  const withoutRegistrationLine = value
    .split("\n")
    .filter((line) => !/^\s*register:\s*https?:\/\/\S+\s*$/i.test(line))
    .join("\n")
    .replace(/https?:\/\/[\w.-]*bookings\.cloud\.microsoft\S*/gi, "");
  return withoutRegistrationLine.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function publicEvent(event: EventDocV2) {
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    description: publicDescription(event.description || ""),
    format: event.format,
    location: event.format === "virtual" ? undefined : event.location,
    startTime: event.startTime,
    endTime: event.endTime,
    timezone: event.timezone || "America/New_York",
    seatCap: event.seatCap,
    registrationCount: event.registrationCount ?? confirmedQuantity(event),
    confirmedQuantity: confirmedQuantity(event),
    heldQuantity: Math.max(0, event.heldQuantity || 0),
    price: event.price || 0,
    memberPriceCents: event.memberPriceCents,
    currency: String(event.currency || "usd").toLowerCase(),
    ticketTypes: (event.ticketTypes || []).map(({ heldCount: _held, ...ticket }) => ticket),
    imageUrl: event.imageUrl,
    heroImage: event.heroImage,
    gallery: event.gallery || [],
    recordingUrl: event.recordingUrl,
    status: event.status,
    registrationOpenAt: event.registrationOpenAt,
    registrationCloseAt: event.registrationCloseAt,
    refundCutoffHours: event.refundCutoffHours ?? DEFAULT_REFUND_CUTOFF_HOURS,
    reminders: event.reminders,
  };
}