import { createHash, randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { createPayment, updatePaymentStatus } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";
import { createAccessGrant, seamApiKey } from "./access";
import { getDeskMembershipTierById } from "./payments/stripeConfig";
import {
  alreadyPaidCents,
  deskPricingPlanFor,
  priceUpgradeToFullDay,
} from "./payments/deskPricing";
import {
  DESK_RESOURCE_IDS,
  HOLD_MS,
  RESOURCE_CONFIG,
  db,
  facilityWallTimeToTimestamp,
  fullDayWindowForDate,
  getMembershipUsageState,
  localDayKey,
  localMonthKey,
  reservedHours,
  resourceConflicts,
  type MembershipUsage,
} from "./bookingFlexShared";

if (admin.apps.length === 0) admin.initializeApp();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

export const BOOKING_UPGRADES_COLLECTION = "bookingUpgrades";
const FULL_DAY_HOURS = 9;
const HALF_DAY_HOURS = 4;

type UpgradeStatus = "pending" | "applied" | "expired" | "cancelled";

type UpgradeRecord = {
  id: string;
  bookingId: string;
  resourceId: string;
  userId: string;
  fromStart: number;
  fromEnd: number;
  toStart: number;
  toEnd: number;
  paidCents: number;
  targetCents: number;
  deltaCents: number;
  incrementalIncludedHours: number;
  includedHoursApplied: number;
  membershipUsageId?: string | null;
  status: UpgradeStatus;
  secretHash: string;
  paymentId?: string;
  stripeCheckoutSessionId?: string;
  createdAt: number;
  expiresAt: number;
  appliedAt?: number;
};

function isUpgradeableResource(resourceId: string) {
  return DESK_RESOURCE_IDS.includes(resourceId) || resourceId === "private-office";
}

function requireUid(request: { auth?: { uid: string } | null }) {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Must be logged in.");
  return request.auth.uid;
}

export function isSameDayUpgradeEligible(booking: {
  status?: string;
  resourceId?: string;
  bookingKind?: string;
  deskChange?: boolean;
  start: number;
  end: number;
}, now = Date.now()) {
  if (String(booking.status || "") !== "CONFIRMED") {
    return { ok: false as const, message: "Only a confirmed booking can be upgraded." };
  }
  if (booking.bookingKind === "desk_change" || booking.deskChange === true) {
    return { ok: false as const, message: "Desk-change bookings cannot be upgraded to a full day." };
  }
  const resourceId = String(booking.resourceId || "");
  if (!isUpgradeableResource(resourceId)) {
    return { ok: false as const, message: "Only a desk or the private office can be upgraded to a full day." };
  }
  if (localDayKey(booking.start) !== localDayKey(now) || localDayKey(booking.end - 1) !== localDayKey(now)) {
    return { ok: false as const, message: "Full-day upgrades are only available for today's booking." };
  }
  if (booking.end <= now) {
    return { ok: false as const, message: "This booking has already ended." };
  }
  const hours = (booking.end - booking.start) / 3_600_000;
  if (hours > HALF_DAY_HOURS + 1e-6) {
    return { ok: false as const, message: "Only a half-day or shorter booking can be upgraded to a full day." };
  }
  const window = fullDayWindowForDate(localDayKey(booking.start));
  if (booking.start === window.start && booking.end === window.end) {
    return { ok: false as const, message: "This booking is already a full day." };
  }
  return { ok: true as const, resourceId, window, hours };
}

async function quoteUpgradeForBooking(
  bookingId: string,
  booking: FirebaseFirestore.DocumentData,
  uid: string,
) {
  const eligible = isSameDayUpgradeEligible({
    status: booking.status,
    resourceId: booking.resourceId,
    bookingKind: booking.bookingKind,
    deskChange: booking.deskChange,
    start: booking.start,
    end: booking.end,
  });
  if (!eligible.ok) throw new HttpsError("failed-precondition", eligible.message);

  const paidCents = alreadyPaidCents(booking);
  const priorIncluded = Math.max(0, Number(booking.includedHoursApplied) || 0);
  let plan = deskPricingPlanFor(null);
  let includedHoursRemaining = 0;
  let membershipUsageId: string | null = null;
  const isDesk = DESK_RESOURCE_IDS.includes(eligible.resourceId);
  if (isDesk) {
    const user = (await db().collection("users").doc(uid).get()).data();
    if (user?.membershipStatus === "active" && user?.plan) {
      const tier = getDeskMembershipTierById(user.plan);
      if (tier) {
        plan = deskPricingPlanFor(tier.id);
        const monthKey = localMonthKey(eligible.window.start);
        membershipUsageId = `${uid}_${monthKey}`;
        const usage = await getMembershipUsageState(uid, monthKey);
        includedHoursRemaining = Math.max(
          0,
          tier.includedHoursPerMonth - usage.usedHours - reservedHours(usage.reservations),
        );
      }
    }
  }

  const priced = priceUpgradeToFullDay({
    resourceId: eligible.resourceId,
    plan,
    includedHoursRemaining,
    includedHoursApplied: priorIncluded,
    paidCents,
  });

  return {
    bookingId,
    resourceId: eligible.resourceId,
    resourceName: String(booking.resourceName || RESOURCE_CONFIG[eligible.resourceId]?.name || eligible.resourceId),
    fromStart: booking.start as number,
    fromEnd: booking.end as number,
    toStart: eligible.window.start,
    toEnd: eligible.window.end,
    targetHours: FULL_DAY_HOURS,
    paidCents: priced.paidCents,
    targetCents: priced.targetCents,
    deltaCents: priced.deltaCents,
    includedHoursRemaining,
    includedHoursApplied: priced.includedHoursApplied,
    incrementalIncludedHours: priced.incrementalIncludedHours,
    capApplied: priced.capApplied,
    membershipUsageId,
    plan,
  };
}

async function assertUpgradeWindowClear(
  bookingId: string,
  resourceId: string,
  start: number,
  end: number,
  tx?: FirebaseFirestore.Transaction,
) {
  const bookingQuery = db().collection("bookings").where("end", ">", start);
  const holdQuery = db().collection("bookingHolds").where("end", ">", start);
  const [bookingSnap, holdSnap] = tx
    ? await Promise.all([tx.get(bookingQuery), tx.get(holdQuery)])
    : await Promise.all([bookingQuery.get(), holdQuery.get()]);
  const now = Date.now();
  const bookings = bookingSnap.docs
    .filter((doc) => doc.id !== bookingId)
    .map((doc) => doc.data() as { resourceId: string; start: number; end: number; status?: string })
    .filter((item) => item.start < end && item.status !== "CANCELLED");
  const holds = holdSnap.docs
    .map((doc) => doc.data() as { resourceId: string; start: number; end: number; status?: string; expiresAt?: number })
    .filter((item) => (
      item.start < end
      && Number(item.expiresAt || 0) > now
      && item.status !== "EXPIRED"
      && item.status !== "CONSUMED"
      && item.status !== "CANCELLED"
    ));
  if (resourceConflicts(resourceId, start, end, [...bookings, ...holds])) {
    throw new HttpsError(
      "failed-precondition",
      "The rest of today is no longer available on this space.",
    );
  }
}

async function applyUpgradeInTransaction(upgrade: UpgradeRecord, paymentMethod: "STRIPE" | "MEMBERSHIP_HOURS") {
  const bookingRef = db().collection("bookings").doc(upgrade.bookingId);
  const upgradeRef = db().collection(BOOKING_UPGRADES_COLLECTION).doc(upgrade.id);
  await db().runTransaction(async (tx) => {
    const latestUpgrade = await tx.get(upgradeRef);
    if (!latestUpgrade.exists) throw new HttpsError("not-found", "Upgrade request not found.");
    const currentUpgrade = latestUpgrade.data() as UpgradeRecord;
    if (currentUpgrade.status === "applied") return;
    if (currentUpgrade.status !== "pending") {
      throw new HttpsError("failed-precondition", "This upgrade is no longer available.");
    }
    if (Number(currentUpgrade.expiresAt || 0) <= Date.now() && currentUpgrade.deltaCents > 0) {
      throw new HttpsError("deadline-exceeded", "This upgrade request expired.");
    }

    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists) throw new HttpsError("not-found", "Booking not found.");
    const booking = bookingSnap.data() || {};
    const eligible = isSameDayUpgradeEligible({
      status: booking.status,
      resourceId: booking.resourceId,
      bookingKind: booking.bookingKind,
      deskChange: booking.deskChange,
      start: booking.start,
      end: booking.end,
    });
    if (!eligible.ok) throw new HttpsError("failed-precondition", eligible.message);
    await assertUpgradeWindowClear(upgrade.bookingId, upgrade.resourceId, upgrade.toStart, upgrade.toEnd, tx);

    const usageRef = currentUpgrade.membershipUsageId && currentUpgrade.incrementalIncludedHours > 0
      ? db().collection("membershipUsage").doc(currentUpgrade.membershipUsageId)
      : null;
    const usageSnap = usageRef ? await tx.get(usageRef) : null;

    const priorIncluded = Math.max(0, Number(booking.includedHoursApplied) || 0);
    const nextIncluded = priorIncluded + Math.max(0, currentUpgrade.incrementalIncludedHours || 0);
    const addedCents = Math.max(0, currentUpgrade.deltaCents || 0);
    tx.update(bookingRef, {
      start: currentUpgrade.toStart,
      end: currentUpgrade.toEnd,
      includedHoursApplied: nextIncluded,
      subtotalCents: Math.max(0, Math.round(Number(booking.subtotalCents || alreadyPaidCents(booking)))) + addedCents,
      totalCents: Math.max(0, Math.round(Number(booking.totalCents || alreadyPaidCents(booking)))) + addedCents,
      totalPrice: (Math.max(0, Math.round(Number(booking.totalCents || alreadyPaidCents(booking)))) + addedCents) / 100,
      upgradedToFullDay: true,
      upgradeId: currentUpgrade.id,
      upgradePaymentId: currentUpgrade.paymentId || null,
      upgradePaymentMethod: paymentMethod,
      updatedAt: Date.now(),
    });
    tx.update(upgradeRef, {
      status: "applied",
      appliedAt: Date.now(),
    });

    if (usageRef && usageSnap) {
      const existing = (usageSnap.data() || {}) as MembershipUsage;
      tx.set(usageRef, {
        uid: currentUpgrade.userId,
        monthKey: currentUpgrade.membershipUsageId!.replace(`${currentUpgrade.userId}_`, ""),
        usedHours: Math.max(0, Number(existing.usedHours) || 0) + currentUpgrade.incrementalIncludedHours,
        reservations: existing.reservations || {},
        updatedAt: Date.now(),
      }, { merge: true });
    }
  });
}

async function issueAccessSafely(bookingId: string, resourceId: string, userId: string, start: number, end: number) {
  try {
    await createAccessGrant(bookingId, resourceId, userId, start, end);
  } catch (error) {
    logger.error("Access grant failed after full-day upgrade", {
      bookingId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const booking_previewUpgrade = onCall(async (request) => {
  const uid = requireUid(request);
  const bookingId = String((request.data as { bookingId?: string })?.bookingId || "").trim();
  if (!bookingId) throw new HttpsError("invalid-argument", "Booking is required.");
  const snap = await db().collection("bookings").doc(bookingId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Booking not found.");
  const booking = snap.data() || {};
  if (booking.userId !== uid) throw new HttpsError("permission-denied", "This booking does not belong to you.");
  const quote = await quoteUpgradeForBooking(bookingId, booking, uid);
  await assertUpgradeWindowClear(bookingId, quote.resourceId, quote.toStart, quote.toEnd);
  return quote;
});

export const booking_beginUpgrade = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret, seamApiKey] },
  async (request) => {
    const uid = requireUid(request);
    const { bookingId, successUrl, cancelUrl } = request.data as {
      bookingId?: string;
      successUrl?: string;
      cancelUrl?: string;
    };
    if (!bookingId) throw new HttpsError("invalid-argument", "Booking is required.");
    const snap = await db().collection("bookings").doc(bookingId).get();
    if (!snap.exists) throw new HttpsError("not-found", "Booking not found.");
    const booking = snap.data() || {};
    if (booking.userId !== uid) throw new HttpsError("permission-denied", "This booking does not belong to you.");
    const quote = await quoteUpgradeForBooking(bookingId, booking, uid);
    await assertUpgradeWindowClear(bookingId, quote.resourceId, quote.toStart, quote.toEnd);

    if (quote.deltaCents === 0) {
      const upgradeRef = db().collection(BOOKING_UPGRADES_COLLECTION).doc();
      const now = Date.now();
      const record: UpgradeRecord = {
        id: upgradeRef.id,
        bookingId,
        resourceId: quote.resourceId,
        userId: uid,
        fromStart: quote.fromStart,
        fromEnd: quote.fromEnd,
        toStart: quote.toStart,
        toEnd: quote.toEnd,
        paidCents: quote.paidCents,
        targetCents: quote.targetCents,
        deltaCents: 0,
        incrementalIncludedHours: quote.incrementalIncludedHours,
        includedHoursApplied: quote.includedHoursApplied,
        membershipUsageId: quote.membershipUsageId,
        status: "pending",
        secretHash: createHash("sha256").update(randomBytes(24).toString("hex")).digest("hex"),
        createdAt: now,
        expiresAt: now + HOLD_MS,
      };
      await upgradeRef.set(record);
      await applyUpgradeInTransaction(record, "MEMBERSHIP_HOURS");
      await issueAccessSafely(bookingId, quote.resourceId, uid, quote.toStart, quote.toEnd);
      return { kind: "applied" as const, bookingId, upgradeId: upgradeRef.id, quote };
    }

    if (!successUrl || !cancelUrl) {
      throw new HttpsError("invalid-argument", "Return URLs are required.");
    }

    const upgradeRef = db().collection(BOOKING_UPGRADES_COLLECTION).doc();
    const holdSecret = randomBytes(24).toString("hex");
    const now = Date.now();
    const record: UpgradeRecord = {
      id: upgradeRef.id,
      bookingId,
      resourceId: quote.resourceId,
      userId: uid,
      fromStart: quote.fromStart,
      fromEnd: quote.fromEnd,
      toStart: quote.toStart,
      toEnd: quote.toEnd,
      paidCents: quote.paidCents,
      targetCents: quote.targetCents,
      deltaCents: quote.deltaCents,
      incrementalIncludedHours: quote.incrementalIncludedHours,
      includedHoursApplied: quote.includedHoursApplied,
      membershipUsageId: quote.membershipUsageId,
      status: "pending",
      secretHash: createHash("sha256").update(holdSecret).digest("hex"),
      createdAt: now,
      expiresAt: now + HOLD_MS,
    };
    await upgradeRef.set(record);

    const payment = await createPayment({
      uid,
      provider: "stripe",
      amount: quote.deltaCents,
      currency: "usd",
      purpose: "booking",
      purposeRefId: upgradeRef.id,
      status: "pending",
      providerRefs: {
        upgradeId: upgradeRef.id,
        bookingId,
        kind: "booking_upgrade",
      },
    });
    await upgradeRef.update({ paymentId: payment.id });

    const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    const separator = successUrl.includes("?") ? "&" : "?";
    const sessionSuccessUrl = `${successUrl}${separator}upgradeId=${encodeURIComponent(upgradeRef.id)}`;
    const session = await provider.createCheckoutSession({
      uid,
      amount: quote.deltaCents,
      currency: "usd",
      purpose: "booking",
      purposeRefId: upgradeRef.id,
      successUrl: sessionSuccessUrl,
      cancelUrl,
      mode: "payment",
      collectBillingAddress: true,
      lineItemLabel: `Upgrade to Full Day · ${quote.resourceName} · 8:00 AM–5:00 PM`,
      metadata: {
        paymentId: payment.id,
        purpose: "booking",
        purposeRefId: upgradeRef.id,
        uid,
        kind: "booking_upgrade",
        upgradeId: upgradeRef.id,
        bookingId,
      },
    });
    await Promise.all([
      updatePaymentStatus(payment.id, "pending", {
        providerRefs: {
          upgradeId: upgradeRef.id,
          bookingId,
          kind: "booking_upgrade",
          stripeCheckoutSessionId: session.sessionId,
        },
      }),
      upgradeRef.update({ stripeCheckoutSessionId: session.sessionId }),
    ]);

    return {
      kind: "checkout" as const,
      upgradeId: upgradeRef.id,
      upgradeSecret: holdSecret,
      expiresAt: record.expiresAt,
      paymentId: payment.id,
      checkoutUrl: session.url,
      quote,
    };
  },
);

async function finalizePaidUpgrade(upgradeId: string) {
  const upgradeRef = db().collection(BOOKING_UPGRADES_COLLECTION).doc(upgradeId);
  const snap = await upgradeRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Upgrade request not found.");
  const upgrade = snap.data() as UpgradeRecord;
  if (upgrade.status === "applied") {
    return { bookingId: upgrade.bookingId, alreadyApplied: true };
  }
  if (!upgrade.paymentId) {
    throw new HttpsError("failed-precondition", "No payment is associated with this upgrade.");
  }
  const paymentSnap = await db().collection("payments").doc(upgrade.paymentId).get();
  if (!paymentSnap.exists || paymentSnap.data()?.status !== "paid") {
    throw new HttpsError("failed-precondition", "Payment has not been confirmed yet.");
  }
  await applyUpgradeInTransaction(upgrade, "STRIPE");
  await issueAccessSafely(upgrade.bookingId, upgrade.resourceId, upgrade.userId, upgrade.toStart, upgrade.toEnd);
  return { bookingId: upgrade.bookingId, alreadyApplied: false };
}

export const booking_finalizeUpgrade = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    const { upgradeId, upgradeSecret } = request.data as { upgradeId?: string; upgradeSecret?: string };
    if (!upgradeId) throw new HttpsError("invalid-argument", "Upgrade is required.");
    const snap = await db().collection(BOOKING_UPGRADES_COLLECTION).doc(upgradeId).get();
    if (!snap.exists) throw new HttpsError("not-found", "Upgrade request not found.");
    const upgrade = snap.data() as UpgradeRecord;
    const authOwns = Boolean(request.auth && upgrade.userId === request.auth.uid);
    const secretMatches = Boolean(
      upgradeSecret && upgrade.secretHash === createHash("sha256").update(upgradeSecret).digest("hex"),
    );
    if (!authOwns && !secretMatches) {
      throw new HttpsError("permission-denied", "This upgrade does not belong to you.");
    }
    const result = await finalizePaidUpgrade(upgradeId);
    return { success: true, ...result };
  },
);

export const booking_onUpgradePaymentUpdated = onDocumentUpdated(
  "payments/{paymentId}",
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || after.status !== "paid" || before?.status === "paid") return;
    const refs = (after.providerRefs || {}) as Record<string, string>;
    if (refs.kind !== "booking_upgrade" || !refs.upgradeId) return;
    try {
      await finalizePaidUpgrade(refs.upgradeId);
    } catch (error) {
      logger.error("Paid booking upgrade could not be applied automatically", {
        paymentId: event.params.paymentId,
        upgradeId: refs.upgradeId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

export function upgradeWindowStart(dateValue: string) {
  return facilityWallTimeToTimestamp(dateValue, "08:00");
}
