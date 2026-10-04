import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { adminEventCallableOptions } from "./adminEventCors";
import {
  availableSeats,
  db,
  hashSecret,
  normalizeEmail,
  positiveInt,
  randomSecret,
  requirePublished,
  resolveIdentity,
  resolvePricing,
  sellTicketInventory,
} from "./core";
import {
  DEFAULT_MAX_TICKETS,
  type EventDocV2,
  type RegistrationDocV2,
} from "./types";

async function enqueueNotification(input: {
  id: string;
  type: string;
  eventId: string;
  registrationId?: string;
  email: string;
  displayName: string;
  scheduledFor?: number;
  manageToken?: string;
}) {
  if (!input.email || input.email.endsWith("@invalid.local")) return;
  const ref = db().collection("eventNotificationJobs").doc(input.id);
  const existing = await ref.get();
  if (existing.exists) return;
  await ref.set({
    ...input,
    scheduledFor: input.scheduledFor || Date.now(),
    status: "pending",
    attempts: 0,
    createdAt: Date.now(),
  });
}

async function enqueueRegistrationNotifications(
  registration: RegistrationDocV2,
  event: EventDocV2,
  manageToken?: string,
) {
  if (event.reminders?.confirmation !== false) {
    await enqueueNotification({
      id: `event_confirm_${registration.id}`,
      type: "REGISTRATION_CONFIRMED",
      eventId: event.id,
      registrationId: registration.id,
      email: registration.email,
      displayName: registration.displayName,
      manageToken,
    });
  }
  const now = Date.now();
  if (event.reminders?.reminder24h !== false) {
    const scheduledFor = event.startTime - 24 * 60 * 60 * 1000;
    if (scheduledFor > now) {
      await enqueueNotification({
        id: `event_reminder24_${registration.id}`,
        type: "EVENT_REMINDER_24H",
        eventId: event.id,
        registrationId: registration.id,
        email: registration.email,
        displayName: registration.displayName,
        scheduledFor,
        manageToken,
      });
    }
  }
  if (event.reminders?.reminder1h !== false) {
    const scheduledFor = event.startTime - 60 * 60 * 1000;
    if (scheduledFor > now) {
      await enqueueNotification({
        id: `event_reminder1_${registration.id}`,
        type: "EVENT_REMINDER_1H",
        eventId: event.id,
        registrationId: registration.id,
        email: registration.email,
        displayName: registration.displayName,
        scheduledFor,
        manageToken,
      });
    }
  }
}

export const events_v2BeginRegistration = onCall(adminEventCallableOptions, async (request) => {
  const { eventId, ticketTypeId, quantity: rawQuantity, guest } = request.data as {
    eventId?: string;
    ticketTypeId?: string;
    quantity?: number;
    guest?: { name?: string; email?: string };
  };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  const quantity = positiveInt(rawQuantity, 1);
  if (quantity > DEFAULT_MAX_TICKETS) {
    throw new HttpsError("invalid-argument", `A single registration is limited to ${DEFAULT_MAX_TICKETS} tickets.`);
  }
  const identity = await resolveIdentity(request, guest);
  const eventRef = db().collection("events").doc(eventId);
  const registrationRef = db().collection("eventRegistrations").doc();
  const manageSecret = randomSecret();

  const registration = await db().runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef);
    if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
    const event = eventSnap.data() as EventDocV2;
    requirePublished(event);
    if (availableSeats(event) < quantity) {
      return null;
    }
    const pricing = resolvePricing(event, ticketTypeId, identity.member, quantity);
    if (pricing.totalCents > 0) {
      throw new HttpsError("failed-precondition", "This event requires payment before a seat can be reserved.");
    }
    const nextConfirmed = Math.max(0, event.confirmedQuantity ?? event.registrationCount ?? 0) + quantity;
    const nextRegistration: RegistrationDocV2 = {
      id: registrationRef.id,
      eventId: event.id,
      uid: identity.uid,
      displayName: identity.displayName,
      email: identity.email,
      ticketTypeId: pricing.ticketTypeId,
      ticketTypeName: pricing.ticketTypeName,
      quantity,
      publicUnitPriceCents: pricing.publicUnitPriceCents,
      discountCents: pricing.discountCents,
      finalUnitPriceCents: pricing.finalUnitPriceCents,
      amountPaidCents: 0,
      currency: pricing.currency,
      status: "CONFIRMED",
      attendanceStatus: "NOT_CHECKED_IN",
      checkedInQuantity: 0,
      source: identity.uid ? "member" : "web",
      manageSecretHash: hashSecret(manageSecret),
      registeredAt: Date.now(),
    };
    tx.set(registrationRef, nextRegistration);
    tx.update(eventRef, {
      confirmedQuantity: nextConfirmed,
      registrationCount: nextConfirmed,
      ticketTypes: sellTicketInventory(event, pricing.ticketTypeId, quantity, false),
      updatedAt: Date.now(),
    });
    return { registration: nextRegistration, event: { ...event, confirmedQuantity: nextConfirmed, registrationCount: nextConfirmed } };
  });

  if (!registration) return { kind: "full" as const, waitlistAvailable: true };
  try {
    await enqueueRegistrationNotifications(registration.registration, registration.event, manageSecret);
  } catch (error) {
    logger.error("Event registration succeeded but confirmation could not be queued", {
      eventId,
      registrationId: registration.registration.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return { kind: "confirmed" as const, registrationId: registration.registration.id };
});

export const events_v2SubmitEventInterest = onCall(adminEventCallableOptions, async (request) => {
  const input = (request.data || {}) as {
    eventId?: string;
    kind?: string;
    name?: string;
    email?: string;
    businessName?: string;
    note?: string;
  };
  const eventId = String(input.eventId || "").trim();
  const kind = String(input.kind || "").trim();
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  if (kind !== "pitch" && kind !== "prize") {
    throw new HttpsError("invalid-argument", "Choose pitch or prize.");
  }
  const name = String(input.name || "").trim();
  const email = normalizeEmail(input.email);
  const businessName = String(input.businessName || "").trim();
  const note = String(input.note || "").trim();
  if (!name || !email || !email.includes("@")) {
    throw new HttpsError("invalid-argument", "Name and a valid email are required.");
  }
  if (!businessName) throw new HttpsError("invalid-argument", "Business name is required.");
  if (note.length > 2000) throw new HttpsError("invalid-argument", "Please keep the note under 2000 characters.");

  const eventSnap = await db().collection("events").doc(eventId).get();
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const event = eventSnap.data() as EventDocV2;
  requirePublished(event);

  const ref = db().collection("eventInterests").doc();
  await ref.set({
    id: ref.id,
    eventId: event.id,
    eventSlug: event.slug || event.id,
    kind,
    name,
    email,
    businessName,
    note: note || undefined,
    createdAt: Date.now(),
  });
  return { success: true, interestId: ref.id, kind };
});
