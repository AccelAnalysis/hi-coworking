import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { adminEventCallableOptions } from "./adminEventCors";
import { notifyEventSubmission } from "./eventSubmissionNotify";
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
  await notifyEventSubmission({
    eventName: registration.event.title || registration.event.id,
    action: "attend",
    name: registration.registration.displayName,
    email: registration.registration.email,
  });
  return { kind: "confirmed" as const, registrationId: registration.registration.id };
});

export const SMS_CONSENT_TEXT = "I agree to receive SMS text messages from Hi Coworking at the phone number I provided about this event. Message frequency varies. Message and data rates may apply. Reply STOP to opt out and HELP for help.";

export const ADVERTISING_CONSENT_TEXT = "I agree that Hi Coworking may share my contact information with participating businesses so they can contact me about their products, services, or offerings.";

function requiredText(value: unknown, label: string, max = 500) {
  const text = String(value || "").trim();
  if (!text) throw new HttpsError("invalid-argument", `${label} is required.`);
  if (text.length > max) throw new HttpsError("invalid-argument", `${label} is too long.`);
  return text;
}

function requiredPhone(value: unknown) {
  const phone = String(value || "").trim();
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new HttpsError("invalid-argument", "A valid phone number is required.");
  }
  return phone;
}

function requiredWebsite(value: unknown) {
  const website = String(value || "").trim();
  const withProtocol = /^https?:\/\/\S+$/i.test(website);
  const bareDomain = /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/\S*)?$/.test(website);
  if (!withProtocol && !bareDomain) throw new HttpsError("invalid-argument", "A website is required.");
  return website;
}

export const events_v2SubmitEventInterest = onCall(adminEventCallableOptions, async (request) => {
  const input = (request.data || {}) as {
    eventId?: string;
    kind?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    email?: string;
    phone?: string;
    businessName?: string;
    businessDescription?: string;
    website?: string;
    offer?: string;
    smsConsent?: boolean;
    advertisingConsent?: boolean;
  };
  const eventId = String(input.eventId || "").trim();
  const kind = String(input.kind || "").trim();
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  if (kind !== "pitch" && kind !== "prize") {
    throw new HttpsError("invalid-argument", "Choose pitch or prize.");
  }
  if (input.smsConsent !== true || input.advertisingConsent !== true) {
    throw new HttpsError("invalid-argument", "SMS consent and third-party advertising consent are required.");
  }
  const email = normalizeEmail(input.email);
  if (!email.includes("@")) throw new HttpsError("invalid-argument", "A valid email is required.");
  const phone = requiredPhone(input.phone);
  const businessName = requiredText(input.businessName, "Business name");
  const website = requiredWebsite(input.website);

  let name = "";
  let record: Record<string, unknown>;
  if (kind === "pitch") {
    const firstName = requiredText(input.firstName, "First name");
    const lastName = requiredText(input.lastName, "Last name");
    const businessDescription = requiredText(input.businessDescription, "Business description", 2000);
    name = `${firstName} ${lastName}`;
    record = { firstName, lastName, businessDescription };
  } else {
    name = requiredText(input.name, "Name");
    record = { offer: requiredText(input.offer, "Offer", 2000) };
  }

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
    phone,
    businessName,
    website,
    smsConsent: true,
    smsConsentText: SMS_CONSENT_TEXT,
    advertisingConsent: true,
    advertisingConsentText: ADVERTISING_CONSENT_TEXT,
    ...record,
    createdAt: Date.now(),
  });
  await notifyEventSubmission({
    eventName: event.title || event.id,
    action: kind === "pitch" ? "apply_to_pitch" : "offer_prize",
    name,
    email,
  });
  return { success: true, interestId: ref.id, kind };
});
