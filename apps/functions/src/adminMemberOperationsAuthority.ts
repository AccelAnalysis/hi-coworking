import { createHash, timingSafeEqual } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";
import { updatePaymentStatus } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";
import {
  MEMBERSHIP_TIERS,
  getTierByPriceId,
} from "./payments/stripeConfig";
import { createAccessGrant, seamApiKey } from "./access";

if (admin.apps.length === 0) admin.initializeApp();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const ACTIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
]);
const MAX_CREDIT_ADJUSTMENT_CENTS = 1_000_000;

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
  id?: string;
  uid?: string;
  amount?: number;
  currency?: string;
  purpose?: string;
  purposeRefId?: string;
  status?: string;
  providerRefs?: Record<string, string>;
  createdAt?: unknown;
  updatedAt?: unknown;
  paidAt?: unknown;
};

type BusyRecord = {
  resourceId: string;
  start: number;
  end: number;
  status?: string;
  expiresAt?: number;
};

function db() {
  return admin.firestore();
}

function requireAdmin(
  request: {
    auth?: {
      uid: string;
      token: Record<string, unknown>;
    } | null;
  },
) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be logged in.");
  }
  const role = request.auth.token.role;
  if (role !== "admin" && role !== "master") {
    throw new HttpsError("permission-denied", "Admin access is required.");
  }
  return request.auth.uid;
}

async function requireMember(uid: string) {
  if (!uid) {
    throw new HttpsError("invalid-argument", "Member is required.");
  }
  const ref = db().collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "Member account not found.");
  }
  return {
    ref,
    data: snap.data() || {},
  };
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

function stripeClient() {
  return new Stripe(stripeSecretKey.value(), {
    apiVersion: "2026-01-28.clover",
  });
}

function subscriptionPeriodEnd(subscription: Stripe.Subscription) {
  const direct = Number(
    (subscription as unknown as Record<string, unknown>).current_period_end || 0,
  );
  if (direct > 0) return direct;

  const firstItem = subscription.items.data[0] as
    | (Stripe.SubscriptionItem & Record<string, unknown>)
    | undefined;
  return Number(firstItem?.current_period_end || 0);
}

function subscriptionRank(subscription: Stripe.Subscription) {
  if (ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) return 0;
  if (subscription.status === "unpaid") return 1;
  if (subscription.status === "incomplete") return 2;
  if (subscription.status === "canceled") return 4;
  return 3;
}

async function subscriptionsForCustomer(
  stripe: Stripe,
  customerId: string,
  uid: string,
) {
  const result = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 100,
  });
  return result.data
    .filter((subscription) => (
      subscription.metadata?.uid === uid
      || !subscription.metadata?.uid
    ))
    .sort((a, b) => (
      subscriptionRank(a) - subscriptionRank(b)
      || b.created - a.created
    ));
}

async function membershipSubscription(uid: string, stripe: Stripe) {
  const { data: user } = await requireMember(uid);
  const subscriptionIds = new Set<string>();
  const customerIds = new Set<string>();

  const features = user.features as Record<string, unknown> | undefined;
  if (typeof features?.stripeSubscriptionId === "string") {
    subscriptionIds.add(features.stripeSubscriptionId);
  }
  if (typeof user.stripeSubscriptionId === "string") {
    subscriptionIds.add(user.stripeSubscriptionId);
  }
  if (typeof user.stripeCustomerId === "string") {
    customerIds.add(user.stripeCustomerId);
  }

  const paymentSnap = await db()
    .collection("payments")
    .where("uid", "==", uid)
    .get();

  for (const paymentDoc of paymentSnap.docs) {
    const payment = paymentDoc.data();
    if (payment.purpose !== "membership") continue;

    const refs = payment.providerRefs as Record<string, unknown> | undefined;
    if (
      typeof refs?.stripeSubscriptionId === "string"
      && refs.stripeSubscriptionId
    ) {
      subscriptionIds.add(refs.stripeSubscriptionId);
    }
    if (
      typeof refs?.stripeCustomerId === "string"
      && refs.stripeCustomerId
    ) {
      customerIds.add(refs.stripeCustomerId);
    }
  }

  const retrieved: Stripe.Subscription[] = [];
  for (const subscriptionId of subscriptionIds) {
    try {
      retrieved.push(
        await stripe.subscriptions.retrieve(subscriptionId),
      );
    } catch (error) {
      logger.warn("Could not retrieve candidate membership subscription", {
        uid,
        subscriptionId,
        error,
      });
    }
  }

  let preferred = retrieved
    .sort((a, b) => (
      subscriptionRank(a) - subscriptionRank(b)
      || b.created - a.created
    ))[0];

  if (!preferred) {
    for (const customerId of customerIds) {
      try {
        preferred = (await subscriptionsForCustomer(
          stripe,
          customerId,
          uid,
        ))[0];
        if (preferred) break;
      } catch (error) {
        logger.warn("Could not list customer subscriptions", {
          uid,
          customerId,
          error,
        });
      }
    }
  }

  if (!preferred && typeof user.email === "string" && user.email.trim()) {
    try {
      const customers = await stripe.customers.list({
        email: user.email.trim().toLowerCase(),
        limit: 20,
      });
      for (const customer of customers.data) {
        preferred = (await subscriptionsForCustomer(
          stripe,
          customer.id,
          uid,
        ))[0];
        if (preferred) break;
      }
    } catch (error) {
      logger.warn("Could not resolve membership subscription by email", {
        uid,
        error,
      });
    }
  }

  return {
    user,
    subscription: preferred || null,
  };
}

function subscriptionState(
  subscription: Stripe.Subscription | null,
  userPlan?: string,
) {
  if (!subscription) {
    return {
      hasSubscription: false,
      hasStripeSubscriptionRecord: false,
      subscriptionId: null,
      stripeStatus: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      planId: userPlan || null,
      canRestart: true,
    };
  }

  const priceId = subscription.items.data[0]?.price?.id;
  const mapped = priceId ? getTierByPriceId(priceId) : undefined;
  const periodEnd = subscriptionPeriodEnd(subscription);
  const hasSubscription = ACTIVE_SUBSCRIPTION_STATUSES.has(
    subscription.status,
  );

  return {
    hasSubscription,
    hasStripeSubscriptionRecord: true,
    subscriptionId: subscription.id,
    stripeStatus: subscription.status,
    cancelAtPeriodEnd: (
      hasSubscription
      && Boolean(subscription.cancel_at_period_end)
    ),
    currentPeriodEnd: periodEnd > 0 ? periodEnd * 1000 : null,
    planId: (
      mapped?.id
      || subscription.metadata?.plan
      || userPlan
      || null
    ),
    canRestart: !hasSubscription,
  };
}

export const admin_membershipGetState = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    requireAdmin(request);

    const { uid } = request.data as {
      uid: string;
    };

    const stripe = stripeClient();
    const { user, subscription } = await membershipSubscription(uid, stripe);

    return {
      ...subscriptionState(
        subscription,
        typeof user.plan === "string" ? user.plan : undefined,
      ),
      membershipStatus: user.membershipStatus || "none",
      plans: MEMBERSHIP_TIERS.map((tier) => ({
        id: tier.id,
        name: tier.name,
        amountCents: tier.amountCents,
        includedHoursPerMonth: tier.includedHoursPerMonth,
        extraHourlyRateCents: tier.extraHourlyRateCents,
      })),
    };
  },
);

function activeCreditReservations(
  reservations: Record<string, CreditReservation> | undefined,
  now = Date.now(),
) {
  return Object.fromEntries(
    Object.entries(reservations || {}).filter(
      ([, reservation]) => Number(reservation.expiresAt || 0) > now,
    ),
  );
}

function reservedCreditCents(
  reservations: Record<string, CreditReservation>,
) {
  return Object.values(reservations).reduce(
    (sum, reservation) => (
      sum + Math.max(
        0,
        Math.round(Number(reservation.amountCents || 0)),
      )
    ),
    0,
  );
}

export const admin_accountCreditAdjust = onCall(async (request) => {
  const adminUid = requireAdmin(request);
  const {
    uid,
    deltaCents,
    reason,
    note,
    requestId,
  } = request.data as {
    uid: string;
    deltaCents: number;
    reason: string;
    note?: string;
    requestId: string;
  };

  const normalizedReason = reason?.trim() || "";
  const normalizedNote = note?.trim() || "";

  if (
    !Number.isInteger(deltaCents)
    || deltaCents === 0
    || Math.abs(deltaCents) > MAX_CREDIT_ADJUSTMENT_CENTS
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Credit adjustment must be a non-zero whole-cent amount no greater than $10,000.",
    );
  }
  if (normalizedReason.length < 3) {
    throw new HttpsError(
      "invalid-argument",
      "A reason is required for every credit adjustment.",
    );
  }
  if (!requestId || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    throw new HttpsError(
      "invalid-argument",
      "A valid idempotency request ID is required.",
    );
  }

  const userRef = db().collection("users").doc(uid);
  const adjustmentRef = db()
    .collection("accountCreditAdjustments")
    .doc(requestId);

  const result = await db().runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const existingSnap = await tx.get(adjustmentRef);

    if (existingSnap.exists) {
      const existing = existingSnap.data() || {};
      const exactReplay = (
        existing.userId === uid
        && Number(existing.deltaCents) === deltaCents
        && existing.reason === normalizedReason
        && (existing.note || "") === normalizedNote
        && existing.performedBy === adminUid
      );

      if (!exactReplay) {
        throw new HttpsError(
          "already-exists",
          "This request ID was already used for a different credit adjustment.",
        );
      }

      return existing;
    }

    if (!userSnap.exists) {
      throw new HttpsError("not-found", "Member account not found.");
    }

    const user = userSnap.data() || {};
    const beforeCents = Math.max(
      0,
      Math.round(Number(user.accountCreditCents || 0)),
    );
    const reservations = activeCreditReservations(
      user.accountCreditReservations as
        | Record<string, CreditReservation>
        | undefined,
    );
    const reservedCents = reservedCreditCents(reservations);
    const afterCents = beforeCents + deltaCents;

    if (afterCents < 0) {
      throw new HttpsError(
        "failed-precondition",
        "Account credit cannot become negative.",
      );
    }
    if (afterCents < reservedCents) {
      throw new HttpsError(
        "failed-precondition",
        "This adjustment would reduce the balance below credit already reserved for an active booking checkout.",
      );
    }

    const record = {
      id: requestId,
      userId: uid,
      deltaCents,
      beforeCents,
      afterCents,
      reservedCents,
      reason: normalizedReason,
      note: normalizedNote,
      performedBy: adminUid,
      createdAt: Date.now(),
    };

    tx.set(adjustmentRef, record);
    tx.set(
      userRef,
      {
        accountCreditCents: afterCents,
        updatedAt: Date.now(),
      },
      { merge: true },
    );

    return record;
  });

  return {
    success: true,
    adjustment: result,
  };
});

function valueToMillis(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 100_000_000_000
      ? value * 1000
      : value;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (value && typeof value === "object") {
    const timestamp = value as {
      toMillis?: () => number;
      seconds?: number;
      _seconds?: number;
    };

    if (typeof timestamp.toMillis === "function") {
      const result = timestamp.toMillis();
      return Number.isFinite(result) ? result : 0;
    }

    const seconds = Number(timestamp.seconds ?? timestamp._seconds ?? 0);
    return Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : 0;
  }

  return 0;
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

function rawUsageReservations(
  usage: MembershipUsage,
) {
  return {
    ...(usage.reservations || {}),
  };
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
      usedHours: (
        Math.max(0, Number(usage.usedHours || 0))
        + expectedHours
      ),
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
    throw new HttpsError(
      "not-found",
      "Member account no longer exists.",
    );
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
    db()
      .collection("accountCreditRedemptions")
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

async function stripePaymentCompletedAt(
  payment: PaymentRecord,
  stripe: Stripe,
) {
  const refs = payment.providerRefs || {};
  const checkoutSessionId = refs.stripeCheckoutSessionId;

  if (checkoutSessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(
        checkoutSessionId,
        {
          expand: ["payment_intent.latest_charge"],
        },
      );

      if (session.payment_status === "paid") {
        let intent: Stripe.PaymentIntent | null = null;

        if (typeof session.payment_intent === "string") {
          intent = await stripe.paymentIntents.retrieve(
            session.payment_intent,
            {
              expand: ["latest_charge"],
            },
          );
        } else if (session.payment_intent) {
          intent = session.payment_intent as Stripe.PaymentIntent;
        }

        if (intent) {
          const latestCharge = intent.latest_charge;

          if (
            latestCharge
            && typeof latestCharge !== "string"
            && Number(latestCharge.created) > 0
          ) {
            return Number(latestCharge.created) * 1000;
          }

          if (typeof latestCharge === "string") {
            const charge = await stripe.charges.retrieve(latestCharge);
            if (Number(charge.created) > 0) {
              return Number(charge.created) * 1000;
            }
          }

          if (Number(intent.created) > 0) {
            return Number(intent.created) * 1000;
          }
        }
      }
    } catch (error) {
      logger.warn(
        "Could not retrieve the Stripe completion time for an Admin member booking",
        {
          paymentId: payment.id,
          checkoutSessionId,
          error,
        },
      );
    }
  }

  return (
    valueToMillis(payment.paidAt)
    || valueToMillis(payment.updatedAt)
    || 0
  );
}

async function releaseHoldReservations(
  hold: AdminHold,
) {
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

async function refundExpiredPaidHold(
  hold: AdminHold,
  payment: PaymentRecord,
) {
  if (!hold.paymentId) {
    throw new HttpsError(
      "failed-precondition",
      "No payment is associated with this booking hold.",
    );
  }

  if (payment.status === "refunded") {
    await releaseHoldReservations(hold);
    await db().collection("bookingHolds").doc(hold.id).set(
      {
        status: "EXPIRED_PAYMENT_REFUNDED",
        expiredAt: Date.now(),
        refundCompletedAt: Date.now(),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    return;
  }

  try {
    const refs = payment.providerRefs || {};
    const provider = new StripeProvider(
      stripeSecretKey.value(),
      stripeWebhookSecret.value(),
    );

    const refund = await provider.refundCheckoutPayment({
      paymentIntentId: refs.stripePaymentIntentId,
      checkoutSessionId: refs.stripeCheckoutSessionId,
      ledgerPaymentId: hold.paymentId,
      holdId: hold.id,
      amountCents: Math.max(0, Math.round(hold.quote.totalCents)),
      idempotencyKey: `admin-member-expired-hold-${hold.id}`,
      metadata: {
        holdId: hold.id,
        bookedForUid: hold.bookedForUid,
        reason: "booking_hold_expired",
      },
    });

    await updatePaymentStatus(
      hold.paymentId,
      "refunded",
      {
        providerRefs: {
          stripeRefundId: refund.refundId,
          stripePaymentIntentId: refund.paymentIntentId,
          ...(refund.checkoutSessionId
            ? {
                stripeCheckoutSessionId: refund.checkoutSessionId,
              }
            : {}),
        },
      },
    );

    await releaseHoldReservations(hold);

    await db().collection("bookingHolds").doc(hold.id).set(
      {
        status: "EXPIRED_PAYMENT_REFUNDED",
        expiredAt: Date.now(),
        refundCompletedAt: Date.now(),
        stripeRefundId: refund.refundId,
        updatedAt: Date.now(),
      },
      { merge: true },
    );

    await writeAudit({
      action: "booking_payment_refunded_after_hold_expiry",
      memberUid: hold.bookedForUid,
      adminUid: hold.adminActorUid,
      details: {
        holdId: hold.id,
        paymentId: hold.paymentId,
        refundId: refund.refundId,
        amountCents: hold.quote.totalCents,
      },
    });
  } catch (error) {
    logger.error(
      "Expired Admin member booking could not be refunded automatically",
      {
        holdId: hold.id,
        paymentId: hold.paymentId,
        error,
      },
    );

    await db().collection("bookingHolds").doc(hold.id).set(
      {
        status: "PAYMENT_RECONCILIATION_REQUIRED",
        reconciliationReason: "paid_after_hold_expiry",
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
        paymentId: hold.paymentId,
        amountCents: hold.quote.totalCents,
        reason: "paid_after_hold_expiry",
        error: error instanceof Error ? error.message : String(error),
      },
    });

    throw new HttpsError(
      "internal",
      "Payment was received after the booking hold expired and requires staff reconciliation. Do not charge the member again.",
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
    await createAccessGrant(
      bookingId,
      resourceId,
      uid,
      start,
      end,
    );
  } catch (error) {
    logger.error(
      "Access grant failed for Admin-created member booking",
      {
        bookingId,
        uid,
        error,
      },
    );
  }
}

async function finalizeAdminMemberHold(
  holdId: string,
) {
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
    return {
      bookingId: initial.bookingId,
      createdNow: false,
    };
  }

  if (
    initial.status === "EXPIRED_PAYMENT_REFUNDED"
    || initial.status === "PAYMENT_RECONCILIATION_REQUIRED"
  ) {
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

  const paymentSnap = await db()
    .collection("payments")
    .doc(initial.paymentId)
    .get();

  if (!paymentSnap.exists) {
    throw new HttpsError(
      "failed-precondition",
      "The payment ledger record is unavailable.",
    );
  }

  const payment = {
    id: paymentSnap.id,
    ...(paymentSnap.data() as PaymentRecord),
  };

  if (payment.status !== "paid") {
    throw new HttpsError(
      "failed-precondition",
      "Payment has not been confirmed yet.",
    );
  }

  const stripe = stripeClient();
  const completedAt = await stripePaymentCompletedAt(
    payment,
    stripe,
  );
  const holdExpired = Date.now() > Number(initial.expiresAt || 0);
  const paymentWasWithinHold = (
    completedAt > 0
    && completedAt <= Number(initial.expiresAt || 0)
  );

  if (holdExpired && !paymentWasWithinHold) {
    await refundExpiredPaidHold(initial, payment);
    throw new HttpsError(
      "deadline-exceeded",
      "The booking payment completed after the hold expired, so the payment was refunded and no booking was created.",
    );
  }

  const bookingRef = db().collection("bookings").doc();

  const result = await db().runTransaction(async (tx) => {
    const latestSnap = await tx.get(holdRef);

    if (!latestSnap.exists) {
      throw new HttpsError("not-found", "Booking hold not found.");
    }

    const hold = latestSnap.data() as AdminHold;

    if (hold.status === "CONSUMED" && hold.bookingId) {
      return {
        bookingId: hold.bookingId,
        createdNow: false,
      };
    }

    if (hold.status !== "HELD") {
      throw new HttpsError(
        "failed-precondition",
        "This booking hold is no longer available to finalize.",
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
    const usageSnap = usageRef
      ? await tx.get(usageRef)
      : null;

    if (!userSnap.exists) {
      throw new HttpsError(
        "not-found",
        "Member account no longer exists.",
      );
    }

    const now = Date.now();
    const busy: BusyRecord[] = [
      ...bookingRange.docs
        .map((doc) => doc.data() as BusyRecord)
        .filter((item) => (
          item.start < hold.end
          && item.status !== "CANCELLED"
        )),
      ...holdRange.docs
        .filter((doc) => doc.id !== holdId)
        .map((doc) => doc.data() as BusyRecord)
        .filter((item) => (
          item.start < hold.end
          && Number(item.expiresAt || 0) > now
          && !["EXPIRED", "CONSUMED"].includes(
            String(item.status || ""),
          )
        )),
    ];

    if (
      busy.some((record) => conflictsWithResource(
        hold.resourceId,
        hold.start,
        hold.end,
        record,
      ))
    ) {
      throw new HttpsError(
        "aborted",
        "Payment was received but the held space can no longer be finalized automatically. Staff must reconcile this booking.",
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
      accountCreditAppliedCents:
        hold.quote.accountCreditAppliedCents,
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
      paymentCompletedAt: completedAt || null,
    });

    return {
      bookingId: bookingRef.id,
      createdNow: true,
    };
  });

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
        paymentCompletedAt: completedAt || null,
      },
    });
  }

  return result;
}

export const admin_bookingForMemberFinalize = onCall(
  {
    secrets: [
      stripeSecretKey,
      stripeWebhookSecret,
      seamApiKey,
    ],
  },
  async (request) => {
    const {
      holdId,
      holdSecret,
    } = request.data as {
      holdId: string;
      holdSecret: string;
    };

    if (!holdId || !holdSecret) {
      throw new HttpsError(
        "invalid-argument",
        "Booking hold credentials are required.",
      );
    }

    const holdSnap = await db()
      .collection("bookingHolds")
      .doc(holdId)
      .get();

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
    secrets: [
      stripeSecretKey,
      stripeWebhookSecret,
      seamApiKey,
    ],
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (
      !after
      || before?.status === "paid"
      || after.status !== "paid"
      || after.purpose !== "booking"
      || !after.purposeRefId
    ) {
      return;
    }

    const holdSnap = await db()
      .collection("bookingHolds")
      .doc(String(after.purposeRefId))
      .get();

    if (
      !holdSnap.exists
      || holdSnap.data()?.kind !== "ADMIN_MEMBER"
    ) {
      return;
    }

    try {
      await finalizeAdminMemberHold(holdSnap.id);
    } catch (error) {
      const code = error instanceof HttpsError
        ? error.code
        : "unknown";

      if (code === "deadline-exceeded") {
        logger.warn(
          "Late Admin-created member booking payment was refunded",
          {
            holdId: holdSnap.id,
            paymentId: event.params.paymentId,
          },
        );
        return;
      }

      logger.error(
        "Automatic finalization of Admin-created member booking failed",
        {
          holdId: holdSnap.id,
          paymentId: event.params.paymentId,
          error,
        },
      );
    }
  },
);
