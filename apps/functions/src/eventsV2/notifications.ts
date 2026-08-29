import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { SendGridProvider } from "../providers/emailProvider";
import { db } from "./core";
import {
  FROM_EMAIL,
  PUBLIC_SITE_URL,
  type EventDocV2,
  type RegistrationDocV2,
} from "./types";

const sendgridApiKey = defineSecret("SENDGRID_API_KEY");

export async function enqueueNotification(input: {
  id: string;
  type: string;
  eventId: string;
  registrationId?: string;
  waitlistEntryId?: string;
  email: string;
  displayName: string;
  scheduledFor?: number;
  manageToken?: string;
  actionUrl?: string;
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

export async function enqueueRegistrationNotifications(
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
  if (event.reminders?.followUp) {
    await enqueueNotification({
      id: `event_followup_${registration.id}`,
      type: "EVENT_FOLLOW_UP",
      eventId: event.id,
      registrationId: registration.id,
      email: registration.email,
      displayName: registration.displayName,
      scheduledFor: event.endTime + 2 * 60 * 60 * 1000,
      manageToken,
    });
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char] || char);
}

function eventDateLabel(event: EventDocV2) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: event.timezone || "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(event.startTime));
}

function notificationCopy(type: string, event: EventDocV2, job: Record<string, unknown>) {
  const name = escapeHtml(String(job.displayName || "there"));
  const title = escapeHtml(event.title);
  const date = escapeHtml(eventDateLabel(event));
  const location = escapeHtml(event.location || (event.format === "virtual" ? "Online" : "Hi Coworking"));
  const registrationId = String(job.registrationId || "");
  const manageToken = String(job.manageToken || "");
  const manageUrl = registrationId && manageToken
    ? `${PUBLIC_SITE_URL}/events/manage?registration=${encodeURIComponent(registrationId)}#token=${manageToken}`
    : `${PUBLIC_SITE_URL}/events/detail?event=${encodeURIComponent(event.slug || event.id)}`;
  const actionUrl = String(job.actionUrl || manageUrl);

  switch (type) {
    case "WAITLIST_OFFER":
      return {
        subject: `A spot opened for ${event.title}`,
        html: `<p>Hi ${name},</p><p>A spot opened for <strong>${title}</strong>.</p><p>Your spot is temporarily reserved. Claim it before the offer expires.</p><p><a href="${escapeHtml(actionUrl)}">Claim your spot</a></p>`,
      };
    case "WAITLIST_JOINED":
      return {
        subject: `You're on the waitlist for ${event.title}`,
        html: `<p>Hi ${name},</p><p>You're on the waitlist for <strong>${title}</strong>. We'll email you if a spot opens.</p>`,
      };
    case "REGISTRATION_CANCELLED":
      return {
        subject: `Registration cancelled: ${event.title}`,
        html: `<p>Hi ${name},</p><p>Your registration for <strong>${title}</strong> has been cancelled.</p>`,
      };
    case "REFUND_CONFIRMED":
      return {
        subject: `Refund issued: ${event.title}`,
        html: `<p>Hi ${name},</p><p>Your refund for <strong>${title}</strong> has been issued to the original payment method.</p>`,
      };
    case "EVENT_CANCELLED":
      return {
        subject: `Event cancelled: ${event.title}`,
        html: `<p>Hi ${name},</p><p><strong>${title}</strong> has been cancelled. Any eligible paid registration is being refunded automatically.</p>`,
      };
    case "EVENT_FOLLOW_UP":
      return {
        subject: `Thanks for joining us at ${event.title}`,
        html: `<p>Hi ${name},</p><p>Thanks for joining us for <strong>${title}</strong>. We hope to see you again at Hi Coworking.</p><p><a href="${PUBLIC_SITE_URL}/events">See upcoming events</a></p>`,
      };
    case "EVENT_REMINDER_24H":
    case "EVENT_REMINDER_1H":
      return {
        subject: `Reminder: ${event.title}`,
        html: `<p>Hi ${name},</p><p>A reminder that you're registered for <strong>${title}</strong>.</p><p>${date}<br>${location}</p><p><a href="${escapeHtml(manageUrl)}">View registration</a></p>`,
      };
    default:
      return {
        subject: `You're registered: ${event.title}`,
        html: `<p>Hi ${name},</p><p>You're registered for <strong>${title}</strong>.</p><p>${date}<br>${location}</p><p><a href="${escapeHtml(manageUrl)}">Manage registration</a></p>`,
      };
  }
}

export const events_v2ProcessNotificationJobs = onSchedule(
  {
    schedule: "*/5 * * * *",
    timeZone: "America/New_York",
    secrets: [sendgridApiKey],
  },
  async () => {
    const snap = await db().collection("eventNotificationJobs")
      .where("status", "==", "pending")
      .where("scheduledFor", "<=", Date.now())
      .orderBy("scheduledFor", "asc")
      .limit(50)
      .get();
    const apiKey = sendgridApiKey.value();
    if (!apiKey) {
      logger.error("Event notifications are pending but SENDGRID_API_KEY is unavailable", { count: snap.size });
      return;
    }
    const provider = new SendGridProvider(apiKey);
    for (const doc of snap.docs) {
      const job = doc.data() as Record<string, unknown>;
      try {
        const eventSnap = await db().collection("events").doc(String(job.eventId || "")).get();
        if (!eventSnap.exists) throw new Error("event-not-found");
        const event = eventSnap.data() as EventDocV2;
        const type = String(job.type || "");
        if ((type.startsWith("EVENT_REMINDER") || type === "EVENT_FOLLOW_UP") && event.status === "cancelled") {
          await doc.ref.set({ status: "cancelled", processedAt: Date.now() }, { merge: true });
          continue;
        }
        if (job.registrationId && (type.startsWith("EVENT_REMINDER") || type === "EVENT_FOLLOW_UP")) {
          const registration = (await db().collection("eventRegistrations").doc(String(job.registrationId)).get()).data() as RegistrationDocV2 | undefined;
          if (!registration || registration.status !== "CONFIRMED") {
            await doc.ref.set({ status: "cancelled", processedAt: Date.now() }, { merge: true });
            continue;
          }
        }
        const copy = notificationCopy(type, event, job);
        await provider.send({
          to: String(job.email || ""),
          from: FROM_EMAIL,
          subject: copy.subject,
          html: copy.html,
          categories: ["event-transactional"],
        });
        await doc.ref.set({ status: "sent", processedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
      } catch (error) {
        const attempts = Number(job.attempts || 0) + 1;
        await doc.ref.set({
          status: attempts >= 3 ? "failed" : "pending",
          attempts,
          error: error instanceof Error ? error.message : String(error),
          scheduledFor: attempts >= 3 ? Number(job.scheduledFor || Date.now()) : Date.now() + attempts * 5 * 60 * 1000,
          updatedAt: Date.now(),
        }, { merge: true });
      }
    }
  },
);
