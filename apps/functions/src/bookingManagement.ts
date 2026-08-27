import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import {
  evaluateCustomerCancellation,
  type CancellationPolicyDecision,
} from "./bookingPolicy";
import { getPayment, updatePaymentStatus } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";
import { GUEST_BOOKING_WINDOW_DAYS, getTierById } from "./payments/stripeConfig";
import { createAccessGrant, revokeAccessGrant, seamApiKey } from "./access";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const LOCATION_TIME_ZONE = "America/New_York";
const INCREMENT_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOLD_MS = 15 * 60 * 1000;
const OPEN_HOUR = 8;
const CLOSE_HOUR = 20;

type ResourceType = "SEAT" | "MODE";
type BookingData = {
  id: string;
  resourceId: string;
  resourceName?: string;
  userId: string;
  start: number;
  end: number;
  status: string;
  totalCents?: number;
  subtotalCents?: number;
  paymentId?: string;
  paymentMethod?: string;
  includedHoursApplied?: number;
  cancellationState?: string;
  cancellationDecision?: CancellationPolicyDecision;
  cancellationRefundCents?: number;
  cancellationAccountCreditCents?: number;
  cancellationRestoreIncludedHoursPercent?: number;
  restoredIncludedHours?: number;
  stripeRefundId?: string | null;
  rescheduleState?: string;
  rescheduleTargetStart?: number;
  rescheduleTargetEnd?: number;
  rescheduleOldGrantIds?: string[];
  rescheduleNewGrantIds?: string[];
};

type HoldData = {
  resourceId: string;
  start: number;
  end: number;
  status?: string;
  expiresAt?: number;
};

function db() {
  return admin.firestore();
}

function resourceType(resourceId: string): ResourceType {
  return resourceId.startsWith("mode-") ? "MODE" : "SEAT";
}

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
) {
  return aStart < bEnd && aEnd > bStart;
}

function conflictsWithResource(
  targetResourceId: string,
  targetStart: number,
  targetEnd: number,
  other: HoldData,
) {
  if (!overlaps(targetStart, targetEnd, other.start, other.end)) return false;
  if (other.resourceId === targetResourceId) return true;
  return resourceType(targetResourceId) === "MODE"
    || resourceType(other.resourceId) === "MODE";
}

function monthKey(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function clock(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    dayKey: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function validateWindow(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new HttpsError("invalid-argument", "Choose a valid time.");
  }
  if (start % INCREMENT_MS !== 0 || end % INCREMENT_MS !== 0) {
    throw new HttpsError("invalid-argument", "Bookings use 30-minute increments.");
  }
  const startClock = clock(start);
  const endDayClock = clock(end - 1);
  if (startClock.dayKey !== endDayClock.dayKey) {
    throw new HttpsError("invalid-argument", "Bookings must remain within one day.");
  }
  const endClock = clock(end);
  if (
    startClock.minutes < OPEN_HOUR * 60
    || endClock.minutes > CLOSE_HOUR * 60
  ) {
    throw new HttpsError("failed-precondition", "That time is outside operating hours.");
  }
  if (start < Date.now()) {
    throw new HttpsError("failed-precondition", "The new start time must be in the future.");
  }
}

async function getOwnedBooking(uid: string, bookingId: string) {
  const ref = db().collection("bookings").doc(bookingId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Booking not found.");
  const booking = snap.data() as BookingData;
  if (booking.userId !== uid) {
    throw new HttpsError("permission-denied", "This booking does not belong to you.");
  }
  return { ref, booking };
}

async function requireConfirmedBooking(uid: string, bookingId: string) {
  const owned = await getOwnedBooking(uid, bookingId);
  if (owned.booking.status !== "CONFIRMED") {
    throw new HttpsError("failed-precondition", "Only confirmed bookings can be changed.");
  }
  return owned;
}

async function bookingWindowDays(uid: string) {
  const user = (await db().collection("users").doc(uid).get()).data();
  if (user?.membershipStatus !== "active" || !user?.plan) {
    return GUEST_BOOKING_WINDOW_DAYS;
  }
  return getTierById(user.plan)?.bookingWindowDays ?? GUEST_BOOKING_WINDOW_DAYS;
}

async function bookingGrantDocs(bookingId: string) {
  const grants = await db()
    .collection("accessGrants")
    .where("bookingId", "==", bookingId)
    .get();
  return grants.docs;
}

async function revokeGrantIds(
  grantIds: string[],
  reason: "cancellation" | "admin",
  actor: string,
) {
  for (const grantId of grantIds) {
    await revokeAccessGrant(grantId, reason, actor);
  }
}

async function revokeBookingAccess(bookingId: string) {
  const grants = await bookingGrantDocs(bookingId);
  const activeIds = grants
    .filter((grant) => {
      const status = grant.data().status;
      return status === "pending" || status === "active";
    })
    .map((grant) => grant.id);
  await revokeGrantIds(activeIds, "cancellation", "booking-management");
}

async function restoreIncludedHours(
  booking: BookingData,
  percent: number,
) {
  const applied = Math.max(0, Number(booking.includedHoursApplied || 0));
  if (!applied || percent <= 0) return 0;
  const restored = applied * percent / 100;
  const usageRef = db()
    .collection("membershipUsage")
    .doc(`${booking.userId}_${monthKey(booking.start)}`);
  const adjustmentRef = db()
    .collection("membershipHourAdjustments")
    .doc(`booking_cancel_${booking.id}`);

  await db().runTransaction(async (tx) => {
    const [usageSnap, adjustmentSnap] = await Promise.all([
      tx.get(usageRef),
      tx.get(adjustmentRef),
    ]);
    if (adjustmentSnap.exists) return;
    tx.set(adjustmentRef, {
      id: adjustmentRef.id,
      userId: booking.userId,
      bookingId: booking.id,
      hours: restored,
      reason: "booking_cancellation",
      createdAt: Date.now(),
    });
    if (usageSnap.exists) {
      const usedHours = Math.max(0, Number(usageSnap.data()?.usedHours || 0));
      tx.update(usageRef, {
        usedHours: Math.max(0, usedHours - restored),
        updatedAt: Date.now(),
      });
    }
  });

  return restored;
}

async function issueAccountCredit(
  booking: BookingData,
  amountCents: number,
) {
  if (amountCents <= 0) return 0;
  const roundedAmount = Math.max(0, Math.round(amountCents));
  const creditRef = db()
    .collection("accountCredits")
    .doc(`booking_cancel_${booking.id}`);
  const userRef = db().collection("users").doc(booking.userId);

  await db().runTransaction(async (tx) => {
    const existing = await tx.get(creditRef);
    if (existing.exists) return;
    tx.set(creditRef, {
      id: creditRef.id,
      userId: booking.userId,
      bookingId: booking.id,
      amountCents: roundedAmount,
      remainingCents: roundedAmount,
      currency: "usd",
      reason: "late_booking_cancellation",
      status: "available",
      createdAt: Date.now(),
    });
    tx.set(userRef, {
      accountCreditCents: admin.firestore.FieldValue.increment(roundedAmount),
      updatedAt: Date.now(),
    }, { merge: true });
  });

  return roundedAmount;
}

function storedCancellationResult(booking: BookingData) {
  return {
    success: true,
    bookingId: booking.id,
    decision: booking.cancellationDecision,
    refundCents: Math.max(
      0,
      Number(booking.cancellationRefundCents ?? 0),
    ),
    accountCreditCents: Math.max(
      0,
      Number(booking.cancellationAccountCreditCents ?? 0),
    ),
    restoredIncludedHours: Math.max(
      0,
      Number(booking.restoredIncludedHours || 0),
    ),
    alreadyCancelled: true,
  };
}

async function snapshotCancellation(
  uid: string,
  bookingId: string,
) {
  const ref = db().collection("bookings").doc(bookingId);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Booking not found.");
    const booking = snap.data() as BookingData;
    if (booking.userId !== uid) {
      throw new HttpsError("permission-denied", "This booking does not belong to you.");
    }
    if (booking.status === "CANCELLED" && booking.cancellationState === "COMPLETE") {
      return;
    }
    if (booking.status !== "CONFIRMED" && booking.status !== "CANCELLED") {
      throw new HttpsError("failed-precondition", "Only confirmed bookings can be cancelled.");
    }
    if (booking.cancellationDecision) return;

    const decision = evaluateCustomerCancellation(
      resourceType(booking.resourceId),
      booking.start,
      Date.now(),
    );
    const paidCents = Math.max(0, Number(booking.totalCents || 0));
    tx.update(ref, {
      cancellationState: "REQUESTED",
      cancellationRequestedAt: Date.now(),
      cancellationDecision: decision,
      cancellationRefundCents: Math.round(
        paidCents * decision.refundPercent / 100,
      ),
      cancellationAccountCreditCents: Math.round(
        paidCents * decision.accountCreditPercent / 100,
      ),
      cancellationRestoreIncludedHoursPercent:
        decision.restoreIncludedHoursPercent,
      updatedAt: Date.now(),
    });
  });

  return getOwnedBooking(uid, bookingId);
}

async function createRescheduleHold(
  booking: BookingData,
  uid: string,
  start: number,
  end: number,
) {
  const holdRef = db().collection("bookingHolds").doc(`reschedule_${booking.id}`);
  await db().runTransaction(async (tx) => {
    const bookingRef = db().collection("bookings").doc(booking.id);
    const [latestBookingSnap, existingHoldSnap, bookingRange, holdRange] =
      await Promise.all([
        tx.get(bookingRef),
        tx.get(holdRef),
        tx.get(db().collection("bookings").where("end", ">", start)),
        tx.get(db().collection("bookingHolds").where("end", ">", start)),
      ]);

    if (!latestBookingSnap.exists) {
      throw new HttpsError("not-found", "Booking not found.");
    }
    const latest = latestBookingSnap.data() as BookingData;
    if (latest.userId !== uid || latest.status !== "CONFIRMED") {
      throw new HttpsError(
        "failed-precondition",
        "This booking is no longer available to reschedule.",
      );
    }

    const bookingConflict = bookingRange.docs.some((doc) => {
      if (doc.id === booking.id) return false;
      const other = doc.data() as BookingData;
      if (other.status !== "CONFIRMED") return false;
      return conflictsWithResource(
        booking.resourceId,
        start,
        end,
        {
          resourceId: other.resourceId,
          start: other.start,
          end: other.end,
        },
      );
    });

    const holdConflict = holdRange.docs.some((doc) => {
      if (doc.id === holdRef.id) return false;
      const hold = doc.data() as HoldData;
      if (
        hold.status === "EXPIRED"
        || hold.status === "CONSUMED"
        || Number(hold.expiresAt || 0) <= Date.now()
      ) {
        return false;
      }
      return conflictsWithResource(
        booking.resourceId,
        start,
        end,
        hold,
      );
    });

    if (bookingConflict || holdConflict) {
      throw new HttpsError(
        "failed-precondition",
        "That new time is no longer available.",
      );
    }

    if (existingHoldSnap.exists) {
      const existing = existingHoldSnap.data() as HoldData;
      const reusable = (
        existing.start === start
        && existing.end === end
        && existing.status === "HELD"
        && Number(existing.expiresAt || 0) > Date.now()
      );
      if (!reusable) {
        tx.set(holdRef, {
          resourceId: booking.resourceId,
          resourceName: booking.resourceName || booking.resourceId,
          start,
          end,
          userId: uid,
          kind: "RESCHEDULE",
          status: "HELD",
          createdAt: Date.now(),
          expiresAt: Date.now() + HOLD_MS,
        });
      }
    } else {
      tx.set(holdRef, {
        resourceId: booking.resourceId,
        resourceName: booking.resourceName || booking.resourceId,
        start,
        end,
        userId: uid,
        kind: "RESCHEDULE",
        status: "HELD",
        createdAt: Date.now(),
        expiresAt: Date.now() + HOLD_MS,
      });
    }

    tx.update(bookingRef, {
      rescheduleState: "HELD",
      rescheduleTargetStart: start,
      rescheduleTargetEnd: end,
      rescheduleRequestedAt: Date.now(),
      updatedAt: Date.now(),
    });
  });

  return holdRef;
}

async function doorConfigured(resourceId: string) {
  const doors = await db()
    .collection("doors")
    .where("resourceIds", "array-contains", resourceId)
    .get();
  return doors.docs.some((door) => door.data().status !== "archived");
}

async function prepareRescheduledAccess(
  booking: BookingData,
  start: number,
  end: number,
) {
  const before = await bookingGrantDocs(booking.id);
  const oldGrantIds = before
    .filter((grant) => {
      const status = grant.data().status;
      return status === "pending" || status === "active";
    })
    .map((grant) => grant.id);
  const oldGrantSet = new Set(before.map((grant) => grant.id));
  const accessRequired = await doorConfigured(booking.resourceId);

  try {
    await createAccessGrant(
      booking.id,
      booking.resourceId,
      booking.userId,
      start,
      end,
    );
  } catch (error) {
    logger.error("Access preparation failed before reschedule", {
      bookingId: booking.id,
      error,
    });
    throw new HttpsError(
      "internal",
      "The new time is available, but access could not be prepared. Your original booking is unchanged.",
    );
  }

  const after = await bookingGrantDocs(booking.id);
  const newGrantDocs = after.filter((grant) => !oldGrantSet.has(grant.id));
  const newGrantIds = newGrantDocs.map((grant) => grant.id);
  const activeNewGrant = newGrantDocs.some(
    (grant) => grant.data().status === "active",
  );

  if (accessRequired && !activeNewGrant) {
    await revokeGrantIds(
      newGrantIds.filter((grantId) => grantId),
      "admin",
      "booking-reschedule-rollback",
    ).catch((error) => {
      logger.error("Could not clean up failed reschedule access", {
        bookingId: booking.id,
        error,
      });
    });
    throw new HttpsError(
      "internal",
      "The new time is available, but access could not be issued. Your original booking is unchanged.",
    );
  }

  return { oldGrantIds, newGrantIds };
}

export const booking_getCancellationPreview = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in to manage this booking.");
  }
  const { bookingId } = request.data as { bookingId: string };
  const { booking } = await requireConfirmedBooking(request.auth.uid, bookingId);
  const decision = evaluateCustomerCancellation(
    resourceType(booking.resourceId),
    booking.start,
    Date.now(),
  );
  const paidCents = Math.max(0, Number(booking.totalCents || 0));
  return {
    bookingId,
    decision,
    refundCents: Math.round(
      paidCents * decision.refundPercent / 100,
    ),
    accountCreditCents: Math.round(
      paidCents * decision.accountCreditPercent / 100,
    ),
    includedHoursToRestore:
      Number(booking.includedHoursApplied || 0)
      * decision.restoreIncludedHoursPercent
      / 100,
    canReschedule: decision.outcome === "FULL_REFUND",
  };
});

export const booking_cancel = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret, seamApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to cancel this booking.");
    }
    const { bookingId } = request.data as { bookingId: string };
    const initial = await getOwnedBooking(request.auth.uid, bookingId);
    if (
      initial.booking.status === "CANCELLED"
      && initial.booking.cancellationState === "COMPLETE"
    ) {
      return storedCancellationResult(initial.booking);
    }

    const { ref, booking } = await snapshotCancellation(
      request.auth.uid,
      bookingId,
    );
    if (
      booking.status === "CANCELLED"
      && booking.cancellationState === "COMPLETE"
    ) {
      return storedCancellationResult(booking);
    }

    const decision = booking.cancellationDecision;
    if (!decision) {
      throw new HttpsError(
        "internal",
        "The cancellation policy could not be recorded.",
      );
    }
    const refundCents = Math.max(
      0,
      Number(booking.cancellationRefundCents || 0),
    );
    const accountCreditCents = Math.max(
      0,
      Number(booking.cancellationAccountCreditCents || 0),
    );

    let refundId = booking.stripeRefundId || null;
    if (refundCents > 0 && booking.paymentId && !refundId) {
      const payment = await getPayment(booking.paymentId);
      if (!payment || payment.provider !== "stripe") {
        throw new HttpsError(
          "failed-precondition",
          "The payment must be reconciled before this refund can be issued.",
        );
      }

      if (
        payment.status === "refunded"
        && payment.providerRefs?.stripeRefundId
      ) {
        refundId = payment.providerRefs.stripeRefundId;
      } else if (payment.status === "refunded") {
        refundId = null;
      } else if (payment.status === "paid") {
        const provider = new StripeProvider(
          stripeSecretKey.value(),
          stripeWebhookSecret.value(),
        );
        try {
          const refund = await provider.refundCheckoutPayment({
            paymentIntentId:
              payment.providerRefs?.stripePaymentIntentId,
            checkoutSessionId:
              payment.providerRefs?.stripeCheckoutSessionId,
            ledgerPaymentId: payment.id,
            holdId:
              payment.providerRefs?.holdId
              || payment.purposeRefId,
            amountCents: refundCents,
            idempotencyKey: `booking-cancel-${bookingId}`,
            metadata: {
              bookingId,
              paymentId: payment.id,
              reason: "customer_cancellation",
            },
          });
          refundId = refund.refundId;
          await updatePaymentStatus(payment.id, "refunded", {
            providerRefs: {
              stripeRefundId: refund.refundId,
              stripePaymentIntentId: refund.paymentIntentId,
              ...(refund.checkoutSessionId
                ? { stripeCheckoutSessionId: refund.checkoutSessionId }
                : {}),
            },
          });
        } catch (error) {
          logger.error("Booking refund failed", {
            bookingId,
            paymentId: payment.id,
            error,
          });
          throw new HttpsError(
            "internal",
            "We could not complete the refund. The booking was not cancelled; please try again or contact Hi Coworking.",
          );
        }
      } else {
        throw new HttpsError(
          "failed-precondition",
          "The payment must be reconciled before this refund can be issued.",
        );
      }

      await ref.update({
        cancellationState: "REFUNDED",
        stripeRefundId: refundId,
        updatedAt: Date.now(),
      });
    }

    const issuedCredit = await issueAccountCredit(
      booking,
      accountCreditCents,
    );
    const restoredHours = await restoreIncludedHours(
      booking,
      Number(booking.cancellationRestoreIncludedHoursPercent || 0),
    );

    await ref.update({
      status: "CANCELLED",
      cancellationState: "BOOKING_CANCELLED",
      cancelledAt: Date.now(),
      cancelledBy: request.auth.uid,
      cancellationOutcome: decision.outcome,
      refundCents,
      accountCreditCents: issuedCredit,
      restoredIncludedHours: restoredHours,
      stripeRefundId: refundId,
      updatedAt: Date.now(),
    });

    await revokeBookingAccess(bookingId);

    await ref.update({
      cancellationState: "COMPLETE",
      cancellationCompletedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      success: true,
      bookingId,
      decision,
      refundCents,
      accountCreditCents: issuedCredit,
      restoredIncludedHours: restoredHours,
    };
  },
);

export const booking_reschedule = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to reschedule this booking.");
    }
    const { bookingId, start, end } = request.data as {
      bookingId: string;
      start: number;
      end: number;
    };
    validateWindow(start, end);
    const { ref, booking } = await requireConfirmedBooking(
      request.auth.uid,
      bookingId,
    );

    if (
      booking.start === start
      && booking.end === end
      && (
        booking.rescheduleState === "COMPLETE"
        || booking.rescheduleState === "BOOKING_MOVED"
        || booking.rescheduleState === "BOOKING_MOVED_ACCESS_CLEANUP_PENDING"
      )
    ) {
      const oldGrantIds = booking.rescheduleOldGrantIds || [];
      const newGrantIds = booking.rescheduleNewGrantIds || [];
      try {
        await revokeGrantIds(
          oldGrantIds.filter((grantId) => !newGrantIds.includes(grantId)),
          "admin",
          "booking-reschedule",
        );
        await ref.update({
          rescheduleState: "COMPLETE",
          rescheduleCompletedAt: Date.now(),
          updatedAt: Date.now(),
        });
        return {
          success: true,
          bookingId,
          start,
          end,
          accessReady: true,
          alreadyRescheduled: true,
        };
      } catch (error) {
        logger.error("Reschedule access cleanup retry failed", {
          bookingId,
          error,
        });
        return {
          success: true,
          bookingId,
          start,
          end,
          accessReady: true,
          accessCleanupPending: true,
          alreadyRescheduled: true,
        };
      }
    }

    const decision = evaluateCustomerCancellation(
      resourceType(booking.resourceId),
      booking.start,
      Date.now(),
    );
    if (decision.outcome !== "FULL_REFUND") {
      throw new HttpsError(
        "failed-precondition",
        "This booking is inside the late-cancellation window. Cancel under the displayed policy and make a new booking instead.",
      );
    }
    if (end - start !== booking.end - booking.start) {
      throw new HttpsError(
        "invalid-argument",
        "Self-service rescheduling keeps the same duration. Cancel and rebook to change duration.",
      );
    }
    if (
      (booking.includedHoursApplied || 0) > 0
      && monthKey(start) !== monthKey(booking.start)
    ) {
      throw new HttpsError(
        "failed-precondition",
        "A membership-hours booking cannot be moved into a different membership month. Cancel and rebook instead.",
      );
    }
    const horizonDays = await bookingWindowDays(request.auth.uid);
    if (start > Date.now() + horizonDays * DAY_MS) {
      throw new HttpsError(
        "failed-precondition",
        `That date is outside your ${horizonDays}-day booking window.`,
      );
    }

    const holdRef = await createRescheduleHold(
      booking,
      request.auth.uid,
      start,
      end,
    );

    let access: { oldGrantIds: string[]; newGrantIds: string[] };
    try {
      access = await prepareRescheduledAccess(booking, start, end);
    } catch (error) {
      await holdRef.set({
        status: "EXPIRED",
        expiredAt: Date.now(),
      }, { merge: true });
      await ref.update({
        rescheduleState: "FAILED_ACCESS",
        updatedAt: Date.now(),
      });
      throw error;
    }

    try {
      await db().runTransaction(async (tx) => {
        const [latestBookingSnap, latestHoldSnap] = await Promise.all([
          tx.get(ref),
          tx.get(holdRef),
        ]);
        if (!latestBookingSnap.exists || !latestHoldSnap.exists) {
          throw new HttpsError(
            "aborted",
            "The reschedule hold could not be finalized. Your original booking is unchanged.",
          );
        }
        const latestBooking = latestBookingSnap.data() as BookingData;
        const latestHold = latestHoldSnap.data() as HoldData;
        if (
          latestBooking.status !== "CONFIRMED"
          || latestBooking.start !== booking.start
          || latestBooking.end !== booking.end
          || latestHold.status !== "HELD"
          || Number(latestHold.expiresAt || 0) <= Date.now()
        ) {
          throw new HttpsError(
            "aborted",
            "The booking changed before rescheduling could finish. Your original booking is unchanged.",
          );
        }

        tx.update(ref, {
          start,
          end,
          rescheduledAt: Date.now(),
          previousStart: booking.start,
          previousEnd: booking.end,
          rescheduleState: "BOOKING_MOVED",
          rescheduleOldGrantIds: access.oldGrantIds,
          rescheduleNewGrantIds: access.newGrantIds,
          updatedAt: Date.now(),
        });
        tx.update(holdRef, {
          status: "CONSUMED",
          consumedAt: Date.now(),
        });
      });
    } catch (error) {
      await Promise.all([
        holdRef.set({
          status: "EXPIRED",
          expiredAt: Date.now(),
        }, { merge: true }),
        revokeGrantIds(
          access.newGrantIds,
          "admin",
          "booking-reschedule-rollback",
        ).catch((cleanupError) => {
          logger.error("New access cleanup failed after reschedule abort", {
            bookingId,
            cleanupError,
          });
        }),
      ]);
      await ref.update({
        rescheduleState: "FAILED_FINALIZATION",
        updatedAt: Date.now(),
      });
      throw error;
    }

    try {
      await revokeGrantIds(
        access.oldGrantIds.filter(
          (grantId) => !access.newGrantIds.includes(grantId),
        ),
        "admin",
        "booking-reschedule",
      );
    } catch (error) {
      logger.error("Old access cleanup failed after successful reschedule", {
        bookingId,
        oldGrantIds: access.oldGrantIds,
        error,
      });
      await ref.update({
        rescheduleState: "BOOKING_MOVED_ACCESS_CLEANUP_PENDING",
        updatedAt: Date.now(),
      });
      return {
        success: true,
        bookingId,
        start,
        end,
        accessReady: true,
        accessCleanupPending: true,
      };
    }

    await ref.update({
      rescheduleState: "COMPLETE",
      rescheduleCompletedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return {
      success: true,
      bookingId,
      start,
      end,
      accessReady: true,
    };
  },
);
