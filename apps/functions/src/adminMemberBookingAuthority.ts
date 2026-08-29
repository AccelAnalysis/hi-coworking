import { createHash, timingSafeEqual } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import { updatePaymentStatus } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";
import { createAccessGrant, seamApiKey } from "./access";

if (admin.apps.length === 0) admin.initializeApp();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

type UsageReservation = {
  hours: number;
  expiresAt: number;
};

type CreditReservation = {
  amountCents: number;
  expiresAt: number;
};

type MembershipUsage = {
  uid: string;
  monthKey: string;
  usedHours: number;
  reservations?: Record<string, UsageReservation>;
  updatedAt: number;
};

type BookingQuote = {
  resourceId: string;
  resourceName: string;
  resourceType: "SEAT" | "MODE";
  start: number;
  end: number;
  durationHours: number;
  membershipName: string | null;
  includedHoursRemaining: number;
  includedHoursApplied: number;
  billableHours: number;
  hourlyRateCents: number;
  subtotalCents: number;
  accountCreditAvailableCents: number;
  accountCreditAppliedCents: number;
  totalCents: number;
  dailyCapApplied: boolean;
  currency: string;
};

type AdminHold = {
  id: string;
  kind: "ADMIN_MEMBER";
  bookedForUid: string;
  adminActorUid: string;
  resourceId: string;
  resourceName: string;
  start: number;
  end: number;
  userId: string;
  quote: BookingQuote;
  status: string;
  secretHash: string;
  createdAt: number;
  expiresAt: number;
  membershipUsageId?: string | null;
  accountCreditReservationCents?: number;
  paymentId?: string;
  bookingId?: string;
};

type PaymentRecord = {
  id: string;
  uid?: string;
  provider?: string;
  amount?: number;
  currency?: string;
  purpose?: string;
  purposeRefId?: string;
  status?: string;
  providerRefs?: Record<string, string>;
};

type BusyRecord = {
  resourceId: string;
  start: number;
  end: number;
  status?: string;
  expiresAt?: number;
};

type VerifiedStripePayment = {
  checkoutSessionId: string;
  paymentIntentId: string;
  chargeId: string;
  completedAt: number;
  amountCents: number;
  currency: string;
};

function db() {
  return admin.firestore();
}

function stripeClient() {
  return new Stripe(stripeSecretKey.value(), {
    apiVersion: "2026-01-28.clover",
  });
}

function hashMatches(storedHash: string, suppliedSecret: string) {
  const suppliedHash = createHash("sha256")
    .update(suppliedSecret)
    .digest();
  const stored = Buffer.from(storedHash || "", "hex");

  return (
    stored.length === suppliedHash.length
    && timingSafeEqual(stored, suppliedHash)
  );
}

function rawUsageReservations(usage: MembershipUsage) {
  return { ...(usage.reservations || {}) };
}

function rawCreditReservations(
  user: FirebaseFirestore.DocumentData,
) {
  return {
    ...(
      user.accountCreditReservations as
        | Record<string, CreditReservation>
        | undefined
      || {}
    ),
  };
}

function resourceType(resourceId: string): "SEAT" | "MODE" {
  return resourceId.startsWith("mode-") ? "MODE" : "SEAT";
}

function conflictsWithResource(
  targetResourceId: string,
  start: number,
  end: number,
  other: BusyRecord,
) {
  if (!(start < other.end && end > other.start)) return false;
  if (other.resourceId === targetResourceId) return true;

  return (
    resourceType(targetResourceId) === "MODE"
    || resourceType(other.resourceId) === "MODE"
  );
}

async function writeAudit(input: {
  action: string;
  memberUid: string;
  adminUid: string;
  details?: Record<string, unknown>;
}) {
  const ref = db().collection("memberOperationAudit").doc();
  await ref.set({
    id: ref.id,
    ...input,
    createdAt: Date.now(),
  });
  return ref.id;
}

async function resolvePaymentIntent(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
) {
  if (typeof session.payment_intent === "string") {
    return stripe.paymentIntents.retrieve(
      session.payment_intent,
      { expand: ["latest_charge"] },
    );
  }
  if (session.payment_intent) {
    return session.payment_intent as Stripe.PaymentIntent;
  }
  throw new HttpsError(
    "failed-precondition",
    "Stripe has not attached a payment intent to this checkout.",
  );
}

async function resolveSuccessfulCharge(
  stripe: Stripe,
  intent: Stripe.PaymentIntent,
) {
  const latest = intent.latest_charge;
  if (typeof latest === "string") {
    const charge = await stripe.charges.retrieve(latest);
    if (charge.status === "succeeded" && charge.paid) return charge;
  } else if (latest && latest.status === "succeeded" && latest.paid) {
    return latest;
  }

  const charges = await stripe.charges.list({
    payment_intent: intent.id,
    limit: 10,
  });
  const charge = charges.data.find(
    (candidate) => candidate.status === "succeeded" && candidate.paid,
  );
  if (!charge) {
    throw new HttpsError(
      "failed-precondition",
      "Stripe has not confirmed a successful charge for this checkout.",
    );
  }
  return charge;
}

async function verifyStripePayment(
  payment: PaymentRecord,
  hold: AdminHold,
): Promise<VerifiedStripePayment> {
  if (payment.provider !== "stripe") {
    throw new HttpsError(
      "failed-precondition",
      "Admin-created member bookings require a verified Stripe payment.",
    );
  }

  const checkoutSessionId =
    payment.providerRefs?.stripeCheckoutSessionId;
  if (!checkoutSessionId) {
    throw new HttpsError(
      "failed-precondition",
      "The Stripe checkout session is not linked to this payment.",
    );
  }

  let session: Stripe.Checkout.Session;
  let intent: Stripe.PaymentIntent;
  let charge: Stripe.Charge;
  try {
    const stripe = stripeClient();
    session = await stripe.checkout.sessions.retrieve(
      checkoutSessionId,
      { expand: ["payment_intent.latest_charge"] },
    );

    if (session.payment_status !== "paid") {
      throw new HttpsError(
        "failed-precondition",
        "Stripe has not confirmed payment for this booking.",
      );
    }

    const metadata = session.metadata || {};
    const linkedHold = metadata.holdId || metadata.purposeRefId;
    if (
      metadata.paymentId !== payment.id
      || linkedHold !== hold.id
      || metadata.uid !== hold.bookedForUid
    ) {
      throw new HttpsError(
        "data-loss",
        "Stripe checkout metadata does not match the held member booking.",
      );
    }

    const amountCents = Number(session.amount_total);
    const currency = String(session.currency || "").toLowerCase();
    if (
      !Number.isFinite(amountCents)
      || amountCents !== Math.round(hold.quote.totalCents)
      || currency !== String(hold.quote.currency || "usd").toLowerCase()
      || Math.round(Number(payment.amount || 0)) !== Math.round(hold.quote.totalCents)
    ) {
      throw new HttpsError(
        "data-loss",
        "Stripe payment amount or currency does not match the held booking quote.",
      );
    }

    intent = await resolvePaymentIntent(stripe, session);
    if (intent.status !== "succeeded") {
      throw new HttpsError(
        "failed-precondition",
        "Stripe has not completed the payment intent for this booking.",
      );
    }
    charge = await resolveSuccessfulCharge(stripe, intent);

    return {
      checkoutSessionId: session.id,
      paymentIntentId: intent.id,
      chargeId: charge.id,
      completedAt: Number(charge.created) * 1000,
      amountCents,
      currency,
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    logger.error("Stripe payment verification failed", {
      paymentId: payment.id,
      holdId: hold.id,
      checkoutSessionId,
      error,
    });
    throw new HttpsError(
      "unavailable",
      "Stripe payment verification is temporarily unavailable. Retry before charging or booking again.",
    );
  }
}

function consumeUsageReservation(
  tx: FirebaseFirestore.Transaction,
  usageRef: FirebaseFirestore.DocumentReference,
  usageSnap: FirebaseFirestore.DocumentSnapshot,
  holdId: string,
  expectedHours: number,
) {
  if (expectedHours <= 0) return;
  if (!usageSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "The member-hour reservation is no longer available for this paid booking.",
    );
  }

  const usage = usageSnap.data() as MembershipUsage;
  const reservations = rawUsageReservations(usage);
  const reservation = reservations[holdId];
  const reservedHours = Number(reservation?.hours || 0);
  if (
    !reservation
    || !Number.isFinite(reservedHours)
    || Math.abs(reservedHours - expectedHours) > 0.0001
  ) {
    throw new HttpsError(
      "failed-precondition",
      "The member-hour reservation no longer matches the paid booking quote.",
    );
  }

  delete reservations[holdId];
  tx.set(
    usageRef,
    {
      ...usage,
      usedHours: Math.max(0, Number(usage.usedHours || 0)) + expectedHours,
      reservations,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
}

function consumeCreditReservation(
  tx: FirebaseFirestore.Transaction,
  userRef: FirebaseFirestore.DocumentReference,
  userSnap: FirebaseFirestore.DocumentSnapshot,
  holdId: string,
  expectedCents: number,
) {
  if (expectedCents <= 0) return;
  if (!userSnap.exists) {
    throw new HttpsError("not-found", "Member account no longer exists.");
  }

  const user = userSnap.data() || {};
  const reservations = rawCreditReservations(user);
  const reservation = reservations[holdId];
  const reservedCents = Math.max(
    0,
    Math.round(Number(reservation?.amountCents || 0)),
  );
  const currentCents = Math.max(
    0,
    Math.round(Number(user.accountCreditCents || 0)),
  );

  if (!reservation || reservedCents !== expectedCents) {
    throw new HttpsError(
      "failed-precondition",
      "The account-credit reservation no longer matches the paid booking quote.",
    );
  }
  if (currentCents < expectedCents) {
    throw new HttpsError(
      "failed-precondition",
      "The member's account-credit balance no longer covers the paid booking quote.",
    );
  }

  delete reservations[holdId];
  tx.set(
    userRef,
    {
      accountCreditCents: currentCents - expectedCents,
      accountCreditReservations: reservations,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
  tx.set(
    db().collection("accountCreditRedemptions")
      .doc(`admin_booking_hold_${holdId}`),
    {
      id: `admin_booking_hold_${holdId}`,
      userId: userRef.id,
      holdId,
      amountCents: expectedCents,
      reason: "admin_booking_for_member",
      createdAt: Date.now(),
    },
    { merge: true },
  );
}

async function releaseHoldReservations(hold: AdminHold) {
  const userRef = db().collection("users").doc(hold.bookedForUid);
  const usageRef = hold.membershipUsageId
    ? db().collection("membershipUsage").doc(hold.membershipUsageId)
    : null;

  await db().runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const usageSnap = usageRef ? await tx.get(usageRef) : null;

    if (userSnap.exists) {
      const user = userSnap.data() || {};
      const reservations = rawCreditReservations(user);
      delete reservations[hold.id];
      tx.set(
        userRef,
        {
          accountCreditReservations: reservations,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    }

    if (usageRef && usageSnap?.exists) {
      const usage = usageSnap.data() as MembershipUsage;
      const reservations = rawUsageReservations(usage);
      delete reservations[hold.id];
      tx.set(
        usageRef,
        {
          ...usage,
          reservations,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    }
  });
}

async function refundPaidHold(input: {
  hold: AdminHold;
  payment: PaymentRecord;
  verified: VerifiedStripePayment;
  finalStatus: "EXPIRED_PAYMENT_REFUNDED" | "FULFILLMENT_FAILED_REFUNDED";
  reason: string;
  error?: unknown;
}) {
  const { hold, payment, verified, finalStatus, reason, error } = input;
  const latestPaymentSnap = await db().collection("payments")
    .doc(payment.id).get();
  const latestPayment = latestPaymentSnap.data() as PaymentRecord | undefined;

  if (latestPayment?.status === "refunded") {
    await releaseHoldReservations(hold);
    await db().collection("bookingHolds").doc(hold.id).set(
      {
        status: finalStatus,
        refundCompletedAt: Date.now(),
        fulfillmentFailureReason: reason,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    return;
  }

  try {
    const provider = new StripeProvider(
      stripeSecretKey.value(),
      stripeWebhookSecret.value(),
    );
    const refund = await provider.refundCheckoutPayment({
      paymentIntentId: verified.paymentIntentId,
      checkoutSessionId: verified.checkoutSessionId,
      ledgerPaymentId: payment.id,
      holdId: hold.id,
      amountCents: verified.amountCents,
      idempotencyKey: `admin-member-unfulfilled-${hold.id}`,
      metadata: {
        holdId: hold.id,
        bookedForUid: hold.bookedForUid,
        reason,
      },
    });

    await updatePaymentStatus(
      payment.id,
      "refunded",
      {
        providerRefs: {
          stripeRefundId: refund.refundId,
          stripePaymentIntentId: refund.paymentIntentId,
          stripeCheckoutSessionId: refund.checkoutSessionId || verified.checkoutSessionId,
          stripeChargeId: verified.chargeId,
        },
      },
    );
    await releaseHoldReservations(hold);
    await db().collection("bookingHolds").doc(hold.id).set(
      {
        status: finalStatus,
        refundCompletedAt: Date.now(),
        stripeRefundId: refund.refundId,
        fulfillmentFailureReason: reason,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    await writeAudit({
      action: "booking_payment_refunded_without_fulfillment",
      memberUid: hold.bookedForUid,
      adminUid: hold.adminActorUid,
      details: {
        holdId: hold.id,
        paymentId: payment.id,
        refundId: refund.refundId,
        amountCents: verified.amountCents,
        reason,
        ...(error
          ? { error: error instanceof Error ? error.message : String(error) }
          : {}),
      },
    });
  } catch (refundError) {
    logger.error("Paid Admin-created member booking requires reconciliation", {
      holdId: hold.id,
      paymentId: payment.id,
      reason,
      error,
      refundError,
    });
    await db().collection("bookingHolds").doc(hold.id).set(
      {
        status: "PAYMENT_RECONCILIATION_REQUIRED",
        reconciliationReason: reason,
        reconciliationRequestedAt: Date.now(),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    await writeAudit({
      action: "booking_payment_reconciliation_required",
      memberUid: hold.bookedForUid,
      adminUid: hold.adminActorUid,
      details: {
        holdId: hold.id,
        paymentId: payment.id,
        amountCents: verified.amountCents,
        reason,
        error: refundError instanceof Error
          ? refundError.message
          : String(refundError),
      },
    });
    throw new HttpsError(
      "internal",
      "Payment was verified but the booking could not be fulfilled or refunded automatically. Do not charge the member again.",
    );
  }
}

async function issueAccess(
  bookingId: string,
  resourceId: string,
  uid: string,
  start: number,
  end: number,
) {
  try {
    await createAccessGrant(bookingId, resourceId, uid, start, end);
  } catch (error) {
    logger.error("Access grant failed for Admin-created member booking", {
      bookingId,
      uid,
      error,
    });
  }
}

async function finalizeAdminMemberHold(holdId: string) {
  const holdRef = db().collection("bookingHolds").doc(holdId);
  const firstSnap = await holdRef.get();
  if (!firstSnap.exists) {
    throw new HttpsError("not-found", "Booking hold not found.");
  }

  const initial = firstSnap.data() as AdminHold;
  if (initial.kind !== "ADMIN_MEMBER") {
    throw new HttpsError(
      "failed-precondition",
      "This is not an Admin member-booking hold.",
    );
  }
  if (initial.status === "CONSUMED" && initial.bookingId) {
    return { bookingId: initial.bookingId, createdNow: false };
  }
  if ([
    "EXPIRED_PAYMENT_REFUNDED",
    "FULFILLMENT_FAILED_REFUNDED",
    "PAYMENT_RECONCILIATION_REQUIRED",
  ].includes(initial.status)) {
    throw new HttpsError(
      "failed-precondition",
      "This paid booking hold has already entered refund or reconciliation handling.",
    );
  }
  if (!initial.paymentId) {
    throw new HttpsError(
      "failed-precondition",
      "No payment is associated with this hold.",
    );
  }

  const paymentRef = db().collection("payments").doc(initial.paymentId);
  const paymentSnap = await paymentRef.get();
  if (!paymentSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "The payment ledger record is unavailable.",
    );
  }
  const payment = {
    id: paymentSnap.id,
    ...(paymentSnap.data() as Omit<PaymentRecord, "id">),
  };
  if (payment.status !== "paid") {
    throw new HttpsError(
      "failed-precondition",
      "Payment has not been confirmed in the ledger yet.",
    );
  }

  const verified = await verifyStripePayment(payment, initial);
  await updatePaymentStatus(
    payment.id,
    "paid",
    {
      providerRefs: {
        stripeCheckoutSessionId: verified.checkoutSessionId,
        stripePaymentIntentId: verified.paymentIntentId,
        stripeChargeId: verified.chargeId,
      },
    },
  );

  if (verified.completedAt > Number(initial.expiresAt || 0)) {
    await refundPaidHold({
      hold: initial,
      payment,
      verified,
      finalStatus: "EXPIRED_PAYMENT_REFUNDED",
      reason: "paid_after_hold_expiry",
    });
    throw new HttpsError(
      "deadline-exceeded",
      "The payment completed after the booking hold expired, so it was refunded and no booking was created.",
    );
  }

  const bookingRef = db().collection("bookings").doc();
  let result: { bookingId: string; createdNow: boolean };
  try {
    result = await db().runTransaction(async (tx) => {
      const latestSnap = await tx.get(holdRef);
      const latestPaymentSnap = await tx.get(paymentRef);
      if (!latestSnap.exists) {
        throw new HttpsError("not-found", "Booking hold not found.");
      }
      const hold = latestSnap.data() as AdminHold;
      if (hold.status === "CONSUMED" && hold.bookingId) {
        return { bookingId: hold.bookingId, createdNow: false };
      }
      if (hold.status !== "HELD") {
        throw new HttpsError(
          "failed-precondition",
          "This booking hold is no longer available to finalize.",
        );
      }
      if (
        !latestPaymentSnap.exists
        || latestPaymentSnap.data()?.status !== "paid"
      ) {
        throw new HttpsError(
          "failed-precondition",
          "The payment ledger is no longer in a paid state.",
        );
      }

      const bookingRange = await tx.get(
        db().collection("bookings").where("end", ">", hold.start),
      );
      const holdRange = await tx.get(
        db().collection("bookingHolds").where("end", ">", hold.start),
      );
      const userRef = db().collection("users").doc(hold.bookedForUid);
      const userSnap = await tx.get(userRef);
      const usageRef = hold.membershipUsageId
        ? db().collection("membershipUsage").doc(hold.membershipUsageId)
        : null;
      const usageSnap = usageRef ? await tx.get(usageRef) : null;
      if (!userSnap.exists) {
        throw new HttpsError("not-found", "Member account no longer exists.");
      }

      const now = Date.now();
      const busy: BusyRecord[] = [
        ...bookingRange.docs
          .map((candidate) => candidate.data() as BusyRecord)
          .filter((candidate) => (
            candidate.start < hold.end
            && candidate.status !== "CANCELLED"
          )),
        ...holdRange.docs
          .filter((candidate) => candidate.id !== holdId)
          .map((candidate) => candidate.data() as BusyRecord)
          .filter((candidate) => (
            candidate.start < hold.end
            && Number(candidate.expiresAt || 0) > now
            && !["EXPIRED", "CONSUMED"].includes(
              String(candidate.status || ""),
            )
          )),
      ];
      if (busy.some((candidate) => conflictsWithResource(
        hold.resourceId,
        hold.start,
        hold.end,
        candidate,
      ))) {
        throw new HttpsError(
          "aborted",
          "The held space can no longer be fulfilled.",
        );
      }

      if (hold.quote.includedHoursApplied > 0) {
        if (!usageRef || !usageSnap) {
          throw new HttpsError(
            "failed-precondition",
            "The member-hour reservation is unavailable.",
          );
        }
        consumeUsageReservation(
          tx,
          usageRef,
          usageSnap,
          holdId,
          hold.quote.includedHoursApplied,
        );
      }
      consumeCreditReservation(
        tx,
        userRef,
        userSnap,
        holdId,
        hold.quote.accountCreditAppliedCents,
      );

      const user = userSnap.data() || {};
      tx.set(bookingRef, {
        id: bookingRef.id,
        resourceId: hold.resourceId,
        resourceName: hold.resourceName,
        userId: hold.bookedForUid,
        userName: user.displayName || user.email || "Member",
        start: hold.start,
        end: hold.end,
        status: "CONFIRMED",
        totalPrice: hold.quote.totalCents / 100,
        totalCents: hold.quote.totalCents,
        subtotalCents: hold.quote.subtotalCents,
        accountCreditAppliedCents: hold.quote.accountCreditAppliedCents,
        paymentMethod: "STRIPE",
        paymentId: hold.paymentId,
        includedHoursApplied: hold.quote.includedHoursApplied,
        createdByAdminUid: hold.adminActorUid,
        createdAt: Date.now(),
      });
      tx.update(holdRef, {
        status: "CONSUMED",
        consumedAt: Date.now(),
        bookingId: bookingRef.id,
        paymentCompletedAt: verified.completedAt,
      });
      return { bookingId: bookingRef.id, createdNow: true };
    });
  } catch (error) {
    const code = error instanceof HttpsError ? error.code : null;
    if (["aborted", "failed-precondition", "not-found"].includes(code || "")) {
      await refundPaidHold({
        hold: initial,
        payment,
        verified,
        finalStatus: "FULFILLMENT_FAILED_REFUNDED",
        reason: `fulfillment_${code}`,
        error,
      });
      throw new HttpsError(
        "failed-precondition",
        "The paid booking could not be fulfilled, so the Stripe payment was refunded and no booking was created.",
      );
    }
    throw error;
  }

  if (result.createdNow) {
    await issueAccess(
      result.bookingId,
      initial.resourceId,
      initial.bookedForUid,
      initial.start,
      initial.end,
    );
    await writeAudit({
      action: "booking_created_for_member",
      memberUid: initial.bookedForUid,
      adminUid: initial.adminActorUid,
      details: {
        bookingId: result.bookingId,
        holdId,
        paymentId: initial.paymentId,
        totalCents: initial.quote.totalCents,
        stripeChargeId: verified.chargeId,
        paymentCompletedAt: verified.completedAt,
      },
    });
  }
  return result;
}

export const admin_bookingForMemberFinalize = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret, seamApiKey] },
  async (request) => {
    const { holdId, holdSecret } = request.data as {
      holdId: string;
      holdSecret: string;
    };
    if (!holdId || !holdSecret) {
      throw new HttpsError(
        "invalid-argument",
        "Booking hold credentials are required.",
      );
    }

    const holdSnap = await db().collection("bookingHolds").doc(holdId).get();
    if (!holdSnap.exists) {
      throw new HttpsError("not-found", "Booking hold not found.");
    }
    const hold = holdSnap.data() as AdminHold;
    if (!hashMatches(hold.secretHash, holdSecret)) {
      throw new HttpsError(
        "permission-denied",
        "Booking hold credentials are invalid.",
      );
    }
    if (hold.status === "CONSUMED" && hold.bookingId) {
      return {
        success: true,
        bookingId: hold.bookingId,
        alreadyFinalized: true,
      };
    }

    const result = await finalizeAdminMemberHold(holdId);
    return {
      success: true,
      bookingId: result.bookingId,
      alreadyFinalized: !result.createdNow,
    };
  },
);

export const admin_onMemberBookingPaymentUpdated = onDocumentUpdated(
  {
    document: "payments/{paymentId}",
    secrets: [stripeSecretKey, stripeWebhookSecret, seamApiKey],
  },
  async (event) => {
    const after = event.data?.after.data();
    if (
      !after
      || after.status !== "paid"
      || after.purpose !== "booking"
      || !after.purposeRefId
    ) {
      return;
    }

    const holdSnap = await db().collection("bookingHolds")
      .doc(String(after.purposeRefId)).get();
    if (!holdSnap.exists || holdSnap.data()?.kind !== "ADMIN_MEMBER") {
      return;
    }

    try {
      await finalizeAdminMemberHold(holdSnap.id);
    } catch (error) {
      const code = error instanceof HttpsError ? error.code : "unknown";
      if (["failed-precondition", "deadline-exceeded"].includes(code)) {
        logger.warn("Admin-created member booking remains unconfirmed", {
          holdId: holdSnap.id,
          paymentId: event.params.paymentId,
          code,
          error,
        });
        return;
      }
      logger.error("Automatic Admin-created member booking finalization failed", {
        holdId: holdSnap.id,
        paymentId: event.params.paymentId,
        error,
      });
    }
  },
);
