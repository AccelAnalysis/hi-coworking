import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { seamApiKey } from "./access";
import { assertWindowWithinOperatingCalendar } from "./bookingOperatingCalendar";
import {
  adminCancellationAmounts,
  cancelBookingCore,
  rescheduleBookingCore,
  type AdminCancellationChoice,
} from "./bookingManagement";

/**
 * Admin cancel and move for an existing member booking (audit P0-2).
 *
 * These callables reuse the member booking-management lifecycle so refunds,
 * account credit, included-hour restoration, holds and door access behave
 * exactly as they do for members. Admins choose the outcome:
 * - "policy": the member asked to cancel; apply the approved customer policy.
 * - "refund" / "credit": Hi Coworking is cancelling; 100% refund to the
 *   original payment method or 100% account credit, all hours restored.
 * Every action is written to memberOperationAudit.
 */

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

export const ADMIN_CANCELLATION_CHOICES: readonly AdminCancellationChoice[] = [
  "policy",
  "refund",
  "credit",
];
const MAX_NOTE_LENGTH = 500;

type AuthRequest = {
  auth?: { uid: string; token: Record<string, unknown> } | null;
};

function db() {
  return admin.firestore();
}

export function requireBookingAdmin(request: AuthRequest) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }
  const role = request.auth.token.role;
  if (role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
  return request.auth.uid;
}

export function parseCancellationChoice(value: unknown): AdminCancellationChoice {
  if (
    typeof value === "string"
    && (ADMIN_CANCELLATION_CHOICES as readonly string[]).includes(value)
  ) {
    return value as AdminCancellationChoice;
  }
  throw new HttpsError(
    "invalid-argument",
    "Choose how to cancel: member policy, full refund or full account credit.",
  );
}

export function cleanNote(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", "The note must be text.");
  }
  return value.trim().slice(0, MAX_NOTE_LENGTH);
}

function requireBookingId(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.includes("/")) {
    throw new HttpsError("invalid-argument", "Booking is required.");
  }
  return value.trim();
}

async function loadBooking(bookingId: string) {
  const snap = await db().collection("bookings").doc(bookingId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Booking not found.");
  const data = snap.data() || {};
  return {
    id: snap.id,
    userId: String(data.userId || ""),
    resourceId: String(data.resourceId || ""),
    start: Number(data.start || 0),
    end: Number(data.end || 0),
    status: String(data.status || ""),
    totalCents: Number(data.totalCents || 0),
    accountCreditAppliedCents: Number(data.accountCreditAppliedCents || 0),
    includedHoursApplied: Number(data.includedHoursApplied || 0),
    paymentId: typeof data.paymentId === "string" ? data.paymentId : null,
  };
}

async function writeAudit(input: {
  action: string;
  memberUid: string;
  adminUid: string;
  details: Record<string, unknown>;
}) {
  const ref = db().collection("memberOperationAudit").doc();
  await ref.set({ id: ref.id, ...input, createdAt: Date.now() });
}

/** What each cancellation choice would return to the member, right now. */
export const admin_bookingCancelPreview = onCall(async (request) => {
  requireBookingAdmin(request);
  const bookingId = requireBookingId(request.data?.bookingId);
  const booking = await loadBooking(bookingId);
  if (booking.status !== "CONFIRMED") {
    throw new HttpsError(
      "failed-precondition",
      "Only confirmed bookings can be cancelled.",
    );
  }
  const now = Date.now();
  const options = ADMIN_CANCELLATION_CHOICES.map((choice) => {
    const amounts = adminCancellationAmounts(booking, choice, now);
    return {
      choice,
      outcome: amounts.decision.outcome,
      reason: amounts.decision.reason,
      refundCents: amounts.refundCents,
      accountCreditCents: amounts.accountCreditCents,
      includedHoursToRestore:
        booking.includedHoursApplied
        * amounts.decision.restoreIncludedHoursPercent
        / 100,
    };
  });
  return {
    bookingId,
    hasCardPayment: Boolean(booking.paymentId) && booking.totalCents > 0,
    options,
  };
});

export const admin_bookingCancel = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret, seamApiKey] },
  async (request) => {
    const adminUid = requireBookingAdmin(request);
    const bookingId = requireBookingId(request.data?.bookingId);
    const choice = parseCancellationChoice(request.data?.choice);
    const note = cleanNote(request.data?.note);
    const booking = await loadBooking(bookingId);
    if (booking.status === "CONFIRMED" && booking.end <= Date.now()) {
      throw new HttpsError(
        "failed-precondition",
        "This booking has already ended. Use an account-credit adjustment to make good a past visit.",
      );
    }

    const result = await cancelBookingCore({
      bookingId,
      ownerUid: null,
      actorUid: adminUid,
      actorRole: "admin",
      decide: (current, now) => adminCancellationAmounts(current, choice, now),
      refundReason: choice === "policy"
        ? "admin_customer_requested_cancellation"
        : "operator_cancellation",
      creditReason: choice === "policy"
        ? "late_booking_cancellation"
        : "operator_cancellation",
    });

    if (!("alreadyCancelled" in result && result.alreadyCancelled)) {
      await writeAudit({
        action: "booking_cancelled_by_admin",
        memberUid: booking.userId,
        adminUid,
        details: {
          bookingId,
          choice,
          outcome: result.decision?.outcome ?? null,
          refundCents: result.refundCents,
          accountCreditCents: result.accountCreditCents,
          restoredIncludedHours: result.restoredIncludedHours,
          note,
        },
      });
    }
    return result;
  },
);

export const admin_bookingReschedule = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    const adminUid = requireBookingAdmin(request);
    const bookingId = requireBookingId(request.data?.bookingId);
    const start = Number(request.data?.start);
    const end = Number(request.data?.end);
    const note = cleanNote(request.data?.note);
    // Never onto a closed day, holiday or special-hours gap.
    await assertWindowWithinOperatingCalendar(start, end);
    const before = await loadBooking(bookingId);

    const result = await rescheduleBookingCore({
      bookingId,
      start,
      end,
      ownerUid: null,
      actorUid: adminUid,
      actorRole: "admin",
    });

    if (!("alreadyRescheduled" in result && result.alreadyRescheduled)) {
      await writeAudit({
        action: "booking_moved_by_admin",
        memberUid: before.userId,
        adminUid,
        details: {
          bookingId,
          previousStart: before.start,
          previousEnd: before.end,
          start,
          end,
          accessCleanupPending: Boolean(
            "accessCleanupPending" in result && result.accessCleanupPending,
          ),
          note,
        },
      });
    }
    return result;
  },
);
