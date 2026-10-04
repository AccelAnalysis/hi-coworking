import { randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { adminEventCallableOptions } from "./adminEventCors";
import {
  asMoney,
  confirmedQuantity,
  db,
  positiveInt,
  requireAdmin,
  sanitizeTicketTypes,
  slugify,
  validateEventForSave,
} from "./core";
import { DEFAULT_REFUND_CUTOFF_HOURS, type EventDocV2 } from "./types";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");

async function uniqueSlug(title: string, eventId?: string) {
  const base = slugify(title);
  let candidate = base;
  for (let suffix = 1; suffix <= 50; suffix += 1) {
    const snap = await db().collection("events").where("slug", "==", candidate).limit(2).get();
    if (!snap.docs.some((doc) => doc.id !== eventId)) return candidate;
    candidate = `${base}-${suffix + 1}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export const events_v2AdminSaveEvent = onCall(adminEventCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  requireAdmin(request.auth);
  const input = (request.data || {}) as Record<string, unknown>;
  validateEventForSave(input);
  const id = String(input.id || `evt_${Date.now()}_${randomBytes(3).toString("hex")}`);
  const ref = db().collection("events").doc(id);
  const existingSnap = await ref.get();
  const existing = existingSnap.exists ? existingSnap.data() as EventDocV2 : null;
  const confirmed = existing ? confirmedQuantity(existing) : 0;
  const seatCap = input.seatCap == null || input.seatCap === "" ? undefined : positiveInt(input.seatCap);
  if (seatCap != null && seatCap < confirmed) {
    throw new HttpsError("failed-precondition", "Capacity cannot be lower than the number of confirmed attendees.");
  }
  const title = String(input.title).trim();
  const slug = await uniqueSlug(title, id);
  const now = Date.now();
  const ticketTypes = sanitizeTicketTypes(input.ticketTypes, existing?.ticketTypes || []);
  const event: EventDocV2 = {
    id,
    slug,
    title,
    description: String(input.description).trim(),
    format: String(input.format || "in-person") as EventDocV2["format"],
    location: String(input.location || "").trim() || undefined,
    virtualUrl: String(input.virtualUrl || "").trim() || undefined,
    startTime: Number(input.startTime),
    endTime: Number(input.endTime),
    timezone: String(input.timezone || existing?.timezone || "America/New_York"),
    seatCap,
    registrationCount: confirmed,
    confirmedQuantity: confirmed,
    heldQuantity: existing?.heldQuantity || 0,
    price: asMoney(input.price),
    memberPriceCents: input.memberPriceCents == null || input.memberPriceCents === "" ? undefined : asMoney(input.memberPriceCents),
    currency: String(input.currency || existing?.currency || "usd").toLowerCase(),
    ticketTypes,
    imageUrl: existing?.imageUrl,
    heroImage: input.heroImage && typeof input.heroImage === "object" ? input.heroImage as Record<string, unknown> : existing?.heroImage,
    gallery: Array.isArray(input.gallery) ? input.gallery as Array<Record<string, unknown>> : existing?.gallery || [],
    recordingUrl: String(input.recordingUrl || "").trim() || undefined,
    status: existing?.status || "draft",
    registrationOpenAt: input.registrationOpenAt ? Number(input.registrationOpenAt) : undefined,
    registrationCloseAt: input.registrationCloseAt ? Number(input.registrationCloseAt) : undefined,
    refundCutoffHours: input.refundCutoffHours == null || input.refundCutoffHours === ""
      ? DEFAULT_REFUND_CUTOFF_HOURS
      : Math.max(0, Number(input.refundCutoffHours)),
    reminders: {
      confirmation: input.confirmation !== false,
      reminder24h: input.reminder24h !== false,
      reminder1h: input.reminder1h !== false,
      followUp: input.followUp === true,
    },
    createdBy: existing?.createdBy || request.auth.uid,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    publishedAt: existing?.publishedAt,
  };
  await ref.set(event, { merge: true });
  return { success: true, eventId: id, slug, status: event.status };
});

export const events_v2AdminPublishEvent = onCall(
  { ...adminEventCallableOptions, secrets: [stripeSecretKey] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    requireAdmin(request.auth);
    const { eventId } = request.data as { eventId?: string };
    if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
    const ref = db().collection("events").doc(eventId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Event not found.");
    const event = snap.data() as EventDocV2;
    if (event.status !== "draft") {
      throw new HttpsError("failed-precondition", "Only draft events can be published.");
    }
    validateEventForSave(event as unknown as Record<string, unknown>);
    if (event.startTime <= Date.now()) throw new HttpsError("failed-precondition", "A past event cannot be published.");
    const paid = (event.price || 0) > 0 || (event.ticketTypes || []).some((ticket) => ticket.priceCents > 0);
    if (paid && !stripeSecretKey.value()) {
      throw new HttpsError("failed-precondition", "Stripe is not configured for paid event registration.");
    }
    await ref.update({ status: "published", publishedAt: Date.now(), updatedAt: Date.now() });
    return { success: true, eventId };
  },
);
