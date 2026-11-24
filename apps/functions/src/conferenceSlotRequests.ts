import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  AFTER_HOURS_CONFERENCE_SLOT_PRICE_CENTS,
  afterHoursSlotsForDate,
  afterHoursSlotsOverlap,
  validateAfterHoursConferenceWindow,
  type AfterHoursConferenceSlot,
} from "./payments/deskPricing";
import { CONFERENCE_ROOM_MAX_CAPACITY } from "./payments/stripeConfig";
import {
  RESOURCE_CONFIG,
  db,
  facilityWallTimeToTimestamp,
  getBusy,
  localDayKey,
  resourceConflicts,
} from "./bookingFlexShared";

if (admin.apps.length === 0) admin.initializeApp();

export const CONFERENCE_SLOT_REQUESTS_COLLECTION = "conferenceSlotRequests";
const CONFERENCE_RESOURCE_ID = "mode-conference";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 120;
const MAX_EMAIL = 160;
const MAX_PHONE = 40;
const MAX_NOTES = 2000;
const HORIZON_DAYS = 180;

export type ConferenceSlotRequestStatus = "pending" | "approved" | "declined";

export type ConferenceSlotRequest = {
  id: string;
  date: string;
  start: string;
  end: string;
  startMinutes: number;
  endMinutes: number;
  startMs: number;
  endMs: number;
  kind: AfterHoursConferenceSlot["kind"];
  slotId: string;
  timeLabel: string;
  priceCents: number;
  capacity: number;
  name: string;
  email: string;
  phone: string;
  notes: string;
  status: ConferenceSlotRequestStatus;
  uid: string | null;
  createdAt: number;
  updatedAt: number;
  reviewedAt?: number;
  reviewedBy?: string;
  reviewNote?: string;
  bookingId?: string;
};

function requireStaff(request: { auth?: { uid: string; token: Record<string, unknown> } | null }) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Must be logged in.");
  const role = request.auth.token.role;
  if (role !== "staff" && role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Staff access is required.");
  }
  return request.auth.uid;
}

function cleanText(value: unknown, max: number) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

function parseRequestInput(data: {
  date?: string;
  start?: string;
  end?: string;
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
}) {
  const date = String(data.date || "").trim();
  const start = String(data.start || "").trim();
  const end = String(data.end || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpsError("invalid-argument", "Choose a valid date.");
  }
  const validated = validateAfterHoursConferenceWindow(date, start, end);
  if (!validated.ok) throw new HttpsError("invalid-argument", validated.message);
  const name = cleanText(data.name, MAX_NAME);
  const email = cleanText(data.email, MAX_EMAIL).toLowerCase();
  const phone = cleanText(data.phone, MAX_PHONE);
  const notes = String(data.notes ?? "").trim().slice(0, MAX_NOTES);
  if (name.length < 2) throw new HttpsError("invalid-argument", "Name is required.");
  if (!EMAIL_RE.test(email)) throw new HttpsError("invalid-argument", "A valid email is required.");
  const startMs = facilityWallTimeToTimestamp(date, validated.slot.start);
  const endMs = facilityWallTimeToTimestamp(date, validated.slot.end);
  if (startMs < Date.now() - 60_000) {
    throw new HttpsError("failed-precondition", "That time has already passed.");
  }
  const horizon = Date.now() + HORIZON_DAYS * 24 * 60 * 60 * 1000;
  if (startMs > horizon) {
    throw new HttpsError("failed-precondition", "That date is outside the request window.");
  }
  return {
    date,
    start: validated.slot.start,
    end: validated.slot.end,
    slot: validated.slot,
    startMs,
    endMs,
    name,
    email,
    phone,
    notes,
  };
}

type RequestRecord = {
  id: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
  startMs: number;
  endMs: number;
  status: string;
};

function asRequestRecord(doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot): RequestRecord {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    date: String(data.date || ""),
    startMinutes: Number(data.startMinutes),
    endMinutes: Number(data.endMinutes),
    startMs: Number(data.startMs),
    endMs: Number(data.endMs),
    status: String(data.status || ""),
  };
}

export function requestOverlapsSlot(
  record: { status?: string; startMinutes?: number; endMinutes?: number },
  slot: { startMinutes: number; endMinutes: number },
) {
  if (record.status !== "pending" && record.status !== "approved") return false;
  if (record.startMinutes == null || record.endMinutes == null) return false;
  return afterHoursSlotsOverlap(
    { startMinutes: record.startMinutes, endMinutes: record.endMinutes },
    slot,
  );
}

async function overlappingRequests(date: string, slot: AfterHoursConferenceSlot, excludeId?: string) {
  const snap = await db().collection(CONFERENCE_SLOT_REQUESTS_COLLECTION).where("date", "==", date).get();
  return snap.docs
    .map((doc) => asRequestRecord(doc))
    .filter((record) => record.id !== excludeId && requestOverlapsSlot(record, slot));
}

async function conferenceBookingConflict(startMs: number, endMs: number, excludeBookingId?: string) {
  const busy = (await getBusy(startMs, endMs)).filter((record) => record.resourceId && record.resourceId !== excludeBookingId);
  // After-hours conference must not overlap another conference booking or hold.
  return resourceConflicts(CONFERENCE_RESOURCE_ID, startMs, endMs, busy.map((record) => ({
    ...record,
    // Treat existing after-hours records as the same resource; weekday
    // conference never overlaps these evening/weekend windows anyway.
  })));
}

export const booking_listAfterHoursConferenceSlots = onCall(async (request) => {
  const date = String((request.data as { date?: string })?.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpsError("invalid-argument", "Choose a valid date.");
  }
  const slots = afterHoursSlotsForDate(date);
  const snap = await db().collection(CONFERENCE_SLOT_REQUESTS_COLLECTION).where("date", "==", date).get();
  const records = snap.docs.map((doc) => asRequestRecord(doc));
  return {
    date,
    priceCents: AFTER_HOURS_CONFERENCE_SLOT_PRICE_CENTS,
    capacity: CONFERENCE_ROOM_MAX_CAPACITY,
    slots: slots.map((slot) => {
      const taken = records.some((record) => requestOverlapsSlot(record, slot));
      const startMs = facilityWallTimeToTimestamp(date, slot.start);
      const endMs = facilityWallTimeToTimestamp(date, slot.end);
      return {
        ...slot,
        available: !taken && startMs >= Date.now() - 60_000,
        startMs,
        endMs,
      };
    }),
  };
});

export const booking_requestAfterHoursConference = onCall(async (request) => {
  const input = parseRequestInput(request.data as Parameters<typeof parseRequestInput>[0]);
  const conflicts = await overlappingRequests(input.date, input.slot);
  if (conflicts.length > 0) {
    throw new HttpsError("failed-precondition", "That 4-hour slot is already requested or reserved.");
  }
  if (await conferenceBookingConflict(input.startMs, input.endMs)) {
    throw new HttpsError("failed-precondition", "That 4-hour slot is no longer available.");
  }

  const ref = db().collection(CONFERENCE_SLOT_REQUESTS_COLLECTION).doc();
  const now = Date.now();
  const record: ConferenceSlotRequest = {
    id: ref.id,
    date: input.date,
    start: input.start,
    end: input.end,
    startMinutes: input.slot.startMinutes,
    endMinutes: input.slot.endMinutes,
    startMs: input.startMs,
    endMs: input.endMs,
    kind: input.slot.kind,
    slotId: input.slot.id,
    timeLabel: input.slot.timeLabel,
    priceCents: AFTER_HOURS_CONFERENCE_SLOT_PRICE_CENTS,
    capacity: CONFERENCE_ROOM_MAX_CAPACITY,
    name: input.name,
    email: input.email,
    phone: input.phone,
    notes: input.notes,
    status: "pending",
    uid: request.auth?.uid || null,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(record);
  logger.info("After-hours conference request created", { id: ref.id, date: input.date, slotId: input.slot.id });
  return { success: true, id: ref.id, status: "pending" as const, priceCents: record.priceCents };
});

export const admin_listConferenceSlotRequests = onCall(async (request) => {
  requireStaff(request);
  const status = String((request.data as { status?: string })?.status || "").trim();
  let query: FirebaseFirestore.Query = db().collection(CONFERENCE_SLOT_REQUESTS_COLLECTION);
  if (status === "pending" || status === "approved" || status === "declined") {
    query = query.where("status", "==", status);
  }
  const snap = await query.limit(200).get();
  const requests = snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => Number((a as { startMs?: number }).startMs || 0) - Number((b as { startMs?: number }).startMs || 0));
  return { requests };
});

export const admin_reviewConferenceSlotRequest = onCall(async (request) => {
  const actorUid = requireStaff(request);
  const { requestId, decision, note } = request.data as {
    requestId?: string;
    decision?: string;
    note?: string;
  };
  if (!requestId) throw new HttpsError("invalid-argument", "Request is required.");
  if (decision !== "approved" && decision !== "declined") {
    throw new HttpsError("invalid-argument", "Choose approve or decline.");
  }
  const reviewNote = String(note ?? "").trim().slice(0, 500);
  const ref = db().collection(CONFERENCE_SLOT_REQUESTS_COLLECTION).doc(requestId);

  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Request not found.");
    const current = snap.data() as ConferenceSlotRequest;
    if (current.status !== "pending") {
      throw new HttpsError("failed-precondition", "That request has already been reviewed.");
    }
    const now = Date.now();
    if (decision === "declined") {
      tx.update(ref, {
        status: "declined",
        reviewedAt: now,
        reviewedBy: actorUid,
        reviewNote,
        updatedAt: now,
      });
      return { status: "declined" as const, bookingId: null as string | null };
    }

    const others = await tx.get(
      db().collection(CONFERENCE_SLOT_REQUESTS_COLLECTION).where("date", "==", current.date),
    );
    const overlap = others.docs.some((doc) => {
      if (doc.id === requestId) return false;
      return requestOverlapsSlot(asRequestRecord(doc), current);
    });
    if (overlap) {
      throw new HttpsError("failed-precondition", "Another pending or approved request already covers that time.");
    }

    const bookingQuery = db().collection("bookings").where("end", ">", current.startMs);
    const holdQuery = db().collection("bookingHolds").where("end", ">", current.startMs);
    const [bookingSnap, holdSnap] = await Promise.all([tx.get(bookingQuery), tx.get(holdQuery)]);
    const busy = [
      ...bookingSnap.docs.map((doc) => doc.data() as { resourceId: string; start: number; end: number; status?: string }),
      ...holdSnap.docs.map((doc) => doc.data() as { resourceId: string; start: number; end: number; status?: string; expiresAt?: number }),
    ].filter((item) => item.start < current.endMs);
    if (resourceConflicts(CONFERENCE_RESOURCE_ID, current.startMs, current.endMs, busy)) {
      throw new HttpsError("failed-precondition", "That 4-hour slot is no longer available.");
    }

    const bookingRef = db().collection("bookings").doc();
    tx.set(bookingRef, {
      id: bookingRef.id,
      resourceId: CONFERENCE_RESOURCE_ID,
      resourceName: RESOURCE_CONFIG[CONFERENCE_RESOURCE_ID].name,
      resourceType: "MODE",
      userId: current.uid || `request:${current.id}`,
      userName: current.name,
      guestEmail: current.email,
      guestPhone: current.phone || null,
      start: current.startMs,
      end: current.endMs,
      status: "CONFIRMED",
      afterHours: true,
      conferenceSlotKind: current.kind,
      conferenceRequestId: current.id,
      totalPrice: current.priceCents / 100,
      totalCents: current.priceCents,
      subtotalCents: current.priceCents,
      paymentMethod: "APPOINTMENT",
      paymentId: null,
      includedHoursApplied: 0,
      createdAt: now,
    });
    tx.update(ref, {
      status: "approved",
      reviewedAt: now,
      reviewedBy: actorUid,
      reviewNote,
      bookingId: bookingRef.id,
      updatedAt: now,
    });
    return { status: "approved" as const, bookingId: bookingRef.id };
  });

  logger.info("After-hours conference request reviewed", {
    requestId,
    decision: result.status,
    bookingId: result.bookingId,
  });
  return { success: true, ...result };
});

export function afterHoursDateKey(startMs: number) {
  return localDayKey(startMs);
}
