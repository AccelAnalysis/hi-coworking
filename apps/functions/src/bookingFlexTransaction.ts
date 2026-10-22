import { loadBookingCatalog } from "./bookingCatalog";
import { createHash, randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { hasActiveMembership } from "./payments/membership";
import { createPayment, updatePaymentStatus } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";
import {
  GUEST_HOURLY_RATE_CENTS,
  getDeskMembershipTierById,
} from "./payments/stripeConfig";
import { createAccessGrant, seamApiKey } from "./access";
import {
  FLEX_RESOURCE_ID,
  HOLD_MS,
  RESCHEDULE_LOCK_END,
  RESOURCE_CONFIG,
  type BookingChoice,
  type BookingQuote,
  type CreditReservation,
  type DeskSegment,
  type MembershipUsage,
  type UsageReservation,
  activeCreditReservations,
  activeUsageReservations,
  busyFromSnapshots,
  db,
  enforceBookingHorizon,
  guestSeatSubtotal,
  getBusy,
  hoursFromBookingDocs,
  localMonthKey,
  quoteForChoice,
  reservedCreditCents,
  reservedHours,
  resolveChoice,
  resourceConflicts,
  validateWindow,
} from "./bookingFlexShared";

if (admin.apps.length === 0) admin.initializeApp();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

type GuestDetails = { name?: string; email?: string; phone?: string };

type HoldData = {
  id: string;
  resourceId: string;
  resourceName: string;
  bookingKind: "single" | "desk_change";
  deskChangePlanId?: string;
  segments?: [DeskSegment, DeskSegment];
  start: number;
  end: number;
  userId: string;
  guest?: GuestDetails | null;
  quote: BookingQuote;
  status: string;
  secretHash: string;
  createdAt: number;
  expiresAt: number;
  membershipUsageId?: string | null;
  accountCreditReservationCents?: number;
  occupancyHoldIds?: string[];
  rescheduleLockHoldId?: string | null;
  paymentId?: string;
  bookingId?: string;
  guestAccountCreated?: boolean;
  recoveryId?: string;
};

function occupancyHoldId(parentHoldId: string, index: number) {
  return `${parentHoldId}_segment_${index + 1}`;
}

function rescheduleLockHoldId(parentHoldId: string) {
  return `${parentHoldId}_reschedule_lock`;
}

function consumeMembershipReservation(
  tx: FirebaseFirestore.Transaction,
  usageRef: FirebaseFirestore.DocumentReference,
  usageSnap: FirebaseFirestore.DocumentSnapshot,
  holdId: string,
) {
  if (!usageSnap.exists) return;
  const usage = usageSnap.data() as MembershipUsage;
  const reservations = activeUsageReservations(usage.reservations);
  const reservation = reservations[holdId];
  if (!reservation) return;
  delete reservations[holdId];
  tx.set(usageRef, {
    ...usage,
    usedHours: Math.max(0, usage.usedHours || 0) + Math.max(0, reservation.hours),
    reservations,
    updatedAt: Date.now(),
  }, { merge: true });
}

function consumeAccountCreditReservation(
  tx: FirebaseFirestore.Transaction,
  userRef: FirebaseFirestore.DocumentReference,
  userSnap: FirebaseFirestore.DocumentSnapshot,
  holdId: string,
  expectedAmountCents: number,
) {
  if (!userSnap.exists || expectedAmountCents <= 0) return;
  const user = userSnap.data() || {};
  const reservations = activeCreditReservations(
    user.accountCreditReservations as Record<string, CreditReservation> | undefined,
  );
  const reserved = Math.max(
    0,
    Math.round(Number(reservations[holdId]?.amountCents ?? expectedAmountCents)),
  );
  delete reservations[holdId];
  const current = Math.max(0, Math.round(Number(user.accountCreditCents || 0)));
  const amountCents = Math.min(current, reserved);
  tx.set(userRef, {
    accountCreditCents: current - amountCents,
    accountCreditReservations: reservations,
    updatedAt: Date.now(),
  }, { merge: true });
  tx.set(db().collection("accountCreditRedemptions").doc(`booking_hold_${holdId}`), {
    id: `booking_hold_${holdId}`,
    userId: userRef.id,
    holdId,
    amountCents,
    reason: "booking_checkout",
    createdAt: Date.now(),
  }, { merge: true });
}

// The deterministic UID makes a crash between Auth creation and profile creation
// recoverable without ever treating an arbitrary existing email account as new.
async function ensureGuestAccount(holdId: string, guest?: GuestDetails) {
  const email = guest?.email?.trim().toLowerCase();
  if (!email) throw new HttpsError("failed-precondition", "Guest email is missing.");
  const checkoutUid = `booking_guest_${createHash("sha256").update(holdId).digest("hex")}`;
  let userRecord: admin.auth.UserRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    try {
      userRecord = await admin.auth().createUser({
        uid: checkoutUid, email, displayName: guest?.name?.trim() || undefined,
        emailVerified: false,
      });
    } catch (createError: unknown) {
      if (!["auth/email-already-exists", "auth/uid-already-exists"].includes(
        (createError as { code?: string }).code || "",
      )) throw createError;
      userRecord = await admin.auth().getUserByEmail(email);
    }
  }
  const created = userRecord.uid === checkoutUid;
  if (!created) return { uid: userRecord.uid, created: false };
  const userRef = db().collection("users").doc(userRecord.uid);
  const ownsProfile = await db().runTransaction(async (tx) => {
    const existing = await tx.get(userRef);
    if (existing.exists) return existing.data()?.guestCheckoutHoldId === holdId;
    const now = Date.now();
    tx.create(userRef, {
      uid: userRecord.uid, email, displayName: guest?.name?.trim() || "",
      phone: guest?.phone?.trim() || "", role: "member", membershipStatus: "none",
      createdAt: now, updatedAt: now, guestCheckoutHoldId: holdId,
    });
    return true;
  });
  return { uid: userRecord.uid, created: ownsProfile };
}

async function issueAccessSafely(
  bookingId: string,
  resourceId: string,
  userId: string,
  start: number,
  end: number,
) {
  try {
    await createAccessGrant(bookingId, resourceId, userId, start, end);
  } catch (error) {
    logger.error("Access grant failed after booking confirmation", {
      bookingId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function checkChoiceAgainstBusy(choice: BookingChoice, start: number, end: number, busy: ReturnType<typeof busyFromSnapshots>) {
  if (choice.kind === "single") {
    return resourceConflicts(choice.resourceId, start, end, busy);
  }
  return choice.segments.some((segment) => (
    resourceConflicts(segment.resourceId, segment.start, segment.end, busy)
  ));
}

async function createHoldAtomically(
  holdRef: FirebaseFirestore.DocumentReference,
  holdSecret: string,
  choice: BookingChoice,
  baseQuote: BookingQuote,
  start: number,
  end: number,
  guest: GuestDetails | undefined,
  authenticatedUid?: string,
  expectedTotalCents?: number,
) {
  return db().runTransaction(async (tx) => {
    const bookingQuery = db().collection("bookings").where("end", ">", start);
    const holdQuery = db().collection("bookingHolds").where("end", ">", start);
    const userRef = authenticatedUid ? db().collection("users").doc(authenticatedUid) : null;
    const reads: Array<Promise<FirebaseFirestore.DocumentSnapshot | FirebaseFirestore.QuerySnapshot>> = [
      tx.get(bookingQuery),
      tx.get(holdQuery),
    ];
    if (userRef) reads.push(tx.get(userRef));
    const initialReads = await Promise.all(reads);
    const bookingSnap = initialReads[0] as FirebaseFirestore.QuerySnapshot;
    const holdSnap = initialReads[1] as FirebaseFirestore.QuerySnapshot;
    const userSnap = userRef ? initialReads[2] as FirebaseFirestore.DocumentSnapshot : null;
    const busy = busyFromSnapshots(bookingSnap, holdSnap, end);

    if (checkChoiceAgainstBusy(choice, start, end, busy)) {
      throw new HttpsError(
        "failed-precondition",
        choice.kind === "desk_change"
          ? "That desk-change option was just booked. Check availability again."
          : "That option was just booked. Choose another available space.",
      );
    }

    const now = Date.now();
    const expiresAt = now + HOLD_MS;
    const durationHours = baseQuote.durationHours;
    const user = userSnap?.data();
    const catalog = await loadBookingCatalog(choice, {
      setupId: baseQuote.setup?.id,
      addOnIds: baseQuote.addOns?.map((addon) => addon.id),
      attendeeCount: baseQuote.attendeeCount,
    }, (ref) => tx.get(ref), { start, end }, (query) => tx.get(query));
    let adjustedQuote: BookingQuote = { ...baseQuote, ...catalog,
      subtotalCents: baseQuote.spaceSubtotalCents ?? baseQuote.subtotalCents };
    let usageRef: FirebaseFirestore.DocumentReference | null = null;
    let usageData: MembershipUsage | null = null;

    if (authenticatedUid && choice.resourceType === "SEAT") {
      const tier = hasActiveMembership(user) && user?.plan
        ? getDeskMembershipTierById(user.plan)
        : undefined;
      if (tier) {
        const monthKey = localMonthKey(start);
        usageRef = db().collection("membershipUsage").doc(`${authenticatedUid}_${monthKey}`);
        const usageSnap = await tx.get(usageRef);
        let usedHours = 0;
        let reservations: Record<string, UsageReservation> = {};
        if (usageSnap.exists) {
          const existing = usageSnap.data() as MembershipUsage;
          usedHours = Math.max(0, existing.usedHours || 0);
          reservations = activeUsageReservations(existing.reservations);
        } else {
          const memberBookings = await tx.get(
            db().collection("bookings").where("userId", "==", authenticatedUid),
          );
          usedHours = hoursFromBookingDocs(memberBookings.docs, monthKey);
        }
        const remaining = Math.max(
          0,
          tier.includedHoursPerMonth - usedHours - reservedHours(reservations),
        );
        const includedHoursApplied = Math.min(durationHours, remaining);
        const billableHours = Math.max(0, durationHours - includedHoursApplied);
        adjustedQuote = {
          ...adjustedQuote,
          membershipName: tier.name,
          includedHoursRemaining: remaining,
          includedHoursApplied,
          billableHours,
          hourlyRateCents: tier.extraHourlyRateCents,
          subtotalCents: Math.round(billableHours * tier.extraHourlyRateCents),
          dailyCapApplied: false,
        };
        if (includedHoursApplied > 0) {
          reservations[holdRef.id] = { hours: includedHoursApplied, expiresAt };
        }
        usageData = {
          uid: authenticatedUid,
          monthKey,
          usedHours,
          reservations,
          updatedAt: now,
        };
      } else {
        const subtotalCents = guestSeatSubtotal(durationHours);
        adjustedQuote = {
          ...adjustedQuote,
          membershipName: null,
          includedHoursRemaining: 0,
          includedHoursApplied: 0,
          billableHours: durationHours,
          hourlyRateCents: GUEST_HOURLY_RATE_CENTS,
          subtotalCents,
          dailyCapApplied: Math.round(durationHours * GUEST_HOURLY_RATE_CENTS) >= subtotalCents,
        };
      }
    }

    adjustedQuote = { ...adjustedQuote, spaceSubtotalCents: adjustedQuote.subtotalCents,
      subtotalCents: adjustedQuote.subtotalCents + catalog.addOnTotalCents };

    let creditReservations: Record<string, CreditReservation> = {};
    if (userRef && userSnap) {
      creditReservations = activeCreditReservations(
        user?.accountCreditReservations as Record<string, CreditReservation> | undefined,
      );
      const availableCredit = Math.max(
        0,
        Math.round(Number(user?.accountCreditCents || 0)) - reservedCreditCents(creditReservations),
      );
      const accountCreditAppliedCents = Math.min(adjustedQuote.subtotalCents, availableCredit);
      if (accountCreditAppliedCents > 0) {
        creditReservations[holdRef.id] = { amountCents: accountCreditAppliedCents, expiresAt };
      }
      adjustedQuote = {
        ...adjustedQuote,
        accountCreditAvailableCents: availableCredit,
        accountCreditAppliedCents,
        totalCents: Math.max(0, adjustedQuote.subtotalCents - accountCreditAppliedCents),
      };
    } else {
      adjustedQuote = {
        ...adjustedQuote,
        accountCreditAvailableCents: 0,
        accountCreditAppliedCents: 0,
        totalCents: adjustedQuote.subtotalCents,
      };
    }

    if (expectedTotalCents !== undefined && adjustedQuote.totalCents !== expectedTotalCents) {
      throw new HttpsError("failed-precondition", "Your booking price changed. Refresh the quote and review the new total before paying.");
    }

    const occupancyHoldIds = choice.kind === "desk_change"
      ? choice.segments.map((_, index) => occupancyHoldId(holdRef.id, index))
      : [];
    const lockHoldId = choice.kind === "desk_change" ? rescheduleLockHoldId(holdRef.id) : null;
    const primaryHold: HoldData = {
      id: holdRef.id,
      resourceId: choice.resourceId,
      resourceName: choice.resourceName,
      bookingKind: choice.kind,
      ...(choice.kind === "desk_change" ? {
        deskChangePlanId: choice.planId,
        segments: choice.segments,
      } : {}),
      start,
      end,
      userId: authenticatedUid || `guest:${holdRef.id}`,
      guest: authenticatedUid ? null : {
        name: guest?.name?.trim(),
        email: guest?.email?.trim().toLowerCase(),
        phone: guest?.phone?.trim() || "",
      },
      quote: adjustedQuote,
      status: "HELD",
      secretHash: createHash("sha256").update(holdSecret).digest("hex"),
      createdAt: now,
      expiresAt,
      membershipUsageId: usageRef?.id || null,
      accountCreditReservationCents: adjustedQuote.accountCreditAppliedCents,
      occupancyHoldIds,
      rescheduleLockHoldId: lockHoldId,
    };

    if (usageRef && usageData) tx.set(usageRef, usageData, { merge: true });
    if (userRef && userSnap) {
      tx.set(userRef, { accountCreditReservations: creditReservations, updatedAt: now }, { merge: true });
    }
    tx.set(holdRef, primaryHold);

    if (choice.kind === "desk_change") {
      choice.segments.forEach((segment, index) => {
        tx.set(db().collection("bookingHolds").doc(occupancyHoldIds[index]), {
          id: occupancyHoldIds[index],
          kind: "DESK_CHANGE_OCCUPANCY",
          parentHoldId: holdRef.id,
          resourceId: segment.resourceId,
          resourceName: segment.resourceName,
          start: segment.start,
          end: segment.end,
          userId: `occupancy:${holdRef.id}`,
          status: "HELD",
          createdAt: now,
          expiresAt,
        });
      });
      tx.set(db().collection("bookingHolds").doc(lockHoldId!), {
        id: lockHoldId,
        kind: "DESK_CHANGE_RESCHEDULE_LOCK",
        parentHoldId: holdRef.id,
        resourceId: FLEX_RESOURCE_ID,
        resourceName: "Desk-change reschedule lock",
        start: 0,
        end: RESCHEDULE_LOCK_END,
        userId: `occupancy:${holdRef.id}`,
        status: "HELD",
        createdAt: now,
        expiresAt,
      });
    }

    return { quote: adjustedQuote, expiresAt };
  });
}

async function finalizeHeldBooking(
  holdId: string,
  finalUserId: string,
  userName: string,
  guestAccountCreated: boolean,
  paymentMethod: "STRIPE" | "ACCOUNT_CREDIT" | "MEMBERSHIP_HOURS",
  allowExpiredPaidHold = false,
  expectedPaymentId?: string,
) {
  const holdRef = db().collection("bookingHolds").doc(holdId);
  const initialSnap = await holdRef.get();
  if (!initialSnap.exists) throw new HttpsError("not-found", "Booking hold not found.");
  const initial = initialSnap.data() as HoldData;
  if (initial.status === "CONSUMED" && initial.bookingId) {
    return { bookingId: initial.bookingId, createdNow: false };
  }

  const bookingRef = db().collection("bookings").doc();
  const result = await db().runTransaction(async (tx) => {
    const latestSnap = await tx.get(holdRef);
    if (!latestSnap.exists) throw new HttpsError("not-found", "Booking hold not found.");
    const hold = latestSnap.data() as HoldData;
    if (expectedPaymentId) {
      const payment = (await tx.get(db().collection("payments").doc(expectedPaymentId))).data();
      if (!payment || payment.status !== "paid" || hold.paymentId !== expectedPaymentId) {
        throw new HttpsError("failed-precondition", "Payment is no longer eligible for booking fulfillment.");
      }
    }
    if (hold.status === "CONSUMED" && hold.bookingId) {
      return { bookingId: hold.bookingId, createdNow: false };
    }
    if (Number(hold.expiresAt || 0) <= Date.now() && !allowExpiredPaidHold) {
      throw new HttpsError("deadline-exceeded", "Your hold expired. Please choose the space again.");
    }

    const bookingQuery = db().collection("bookings").where("end", ">", hold.start);
    const holdQuery = db().collection("bookingHolds").where("end", ">", hold.start);
    const userRef = db().collection("users").doc(finalUserId);
    const usageRef = hold.membershipUsageId
      ? db().collection("membershipUsage").doc(hold.membershipUsageId)
      : null;
    const reads: Array<Promise<FirebaseFirestore.DocumentSnapshot | FirebaseFirestore.QuerySnapshot>> = [
      tx.get(bookingQuery),
      tx.get(holdQuery),
      tx.get(userRef),
    ];
    if (usageRef) reads.push(tx.get(usageRef));
    const results = await Promise.all(reads);
    const bookingSnap = results[0] as FirebaseFirestore.QuerySnapshot;
    const holdRangeSnap = results[1] as FirebaseFirestore.QuerySnapshot;
    const userSnap = results[2] as FirebaseFirestore.DocumentSnapshot;
    const usageSnap = usageRef ? results[3] as FirebaseFirestore.DocumentSnapshot : null;

    const excluded = new Set<string>([
      holdId,
      ...(hold.occupancyHoldIds || []),
      ...(hold.rescheduleLockHoldId ? [hold.rescheduleLockHoldId] : []),
    ]);
    const busy = busyFromSnapshots(bookingSnap, holdRangeSnap, hold.end, excluded);
    const choice: BookingChoice = hold.bookingKind === "desk_change" && hold.segments && hold.deskChangePlanId
      ? {
          kind: "desk_change",
          resourceId: FLEX_RESOURCE_ID,
          resourceName: hold.resourceName,
          resourceType: "SEAT",
          planId: hold.deskChangePlanId,
          segments: hold.segments,
        }
      : {
          kind: "single",
          resourceId: hold.resourceId,
          resourceName: hold.resourceName,
          resourceType: RESOURCE_CONFIG[hold.resourceId]?.type || "SEAT",
        };

    if (checkChoiceAgainstBusy(choice, hold.start, hold.end, busy)) {
      logger.error("Held booking encountered a conflict during finalization", {
        holdId,
        paymentId: hold.paymentId,
      });
      throw new HttpsError(
        "aborted",
        "We received payment but the held space cannot be finalized automatically. Staff has been alerted.",
      );
    }

    const quote = hold.quote;
    const guest = hold.guest;
    tx.set(bookingRef, {
      id: bookingRef.id,
      resourceId: hold.resourceId,
      resourceName: hold.resourceName,
      userId: finalUserId,
      userName: guest?.name || userName || "Guest",
      guestEmail: guest?.email || null,
      guestPhone: guest?.phone || null,
      start: hold.start,
      end: hold.end,
      status: "CONFIRMED",
      accessProvisioningStatus: "pending",
      totalPrice: (quote.totalCents || 0) / 100,
      totalCents: quote.totalCents || 0,
      subtotalCents: quote.subtotalCents || quote.totalCents || 0,
      spaceSubtotalCents: quote.spaceSubtotalCents ?? quote.subtotalCents,
      setup: quote.setup || null,
      addOns: quote.addOns || [],
      addOnTotalCents: quote.addOnTotalCents || 0,
      attendeeCount: quote.attendeeCount || 1,
      accountCreditAppliedCents: quote.accountCreditAppliedCents || 0,
      paymentMethod,
      paymentId: hold.paymentId || null,
      includedHoursApplied: quote.includedHoursApplied || 0,
      bookingKind: hold.bookingKind,
      deskChange: hold.bookingKind === "desk_change",
      ...(hold.bookingKind === "desk_change" ? {
        deskChangePlanId: hold.deskChangePlanId,
        segments: hold.segments,
        rescheduleEligible: false,
      } : {}),
      createdAt: Date.now(),
    });
    tx.update(holdRef, {
      status: "CONSUMED",
      consumedAt: Date.now(),
      bookingId: bookingRef.id,
      userId: finalUserId,
      guestAccountCreated,
    });

    if (hold.bookingKind === "desk_change" && hold.segments) {
      (hold.occupancyHoldIds || []).forEach((childId, index) => {
        const segment = hold.segments![index];
        if (!segment) return;
        tx.set(db().collection("bookingHolds").doc(childId), {
          status: "CONFIRMED_OCCUPANCY",
          bookingId: bookingRef.id,
          userId: `occupancy:${bookingRef.id}`,
          confirmedAt: Date.now(),
          expiresAt: segment.end + 60_000,
        }, { merge: true });
      });
      if (hold.rescheduleLockHoldId) {
        tx.set(db().collection("bookingHolds").doc(hold.rescheduleLockHoldId), {
          status: "RESCHEDULE_LOCK",
          bookingId: bookingRef.id,
          userId: `occupancy:${bookingRef.id}`,
          confirmedAt: Date.now(),
          expiresAt: RESCHEDULE_LOCK_END,
        }, { merge: true });
      }
    }

    if (usageRef && usageSnap) {
      consumeMembershipReservation(tx, usageRef, usageSnap, holdId);
    }
    consumeAccountCreditReservation(
      tx,
      userRef,
      userSnap,
      holdId,
      quote.accountCreditAppliedCents || 0,
    );

    return { bookingId: bookingRef.id, createdNow: true };
  });

  {
    const accessResourceId = initial.bookingKind === "desk_change" && initial.segments
      ? initial.segments[0].resourceId
      : initial.resourceId;
    await issueAccessSafely(
      result.bookingId,
      accessResourceId,
      finalUserId,
      initial.start,
      initial.end,
    );
  }
  return result;
}

export const booking_beginCheckout = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret, seamApiKey] },
  async (request) => {
    const { resourceId, deskChangePlanId, start, end, successUrl, cancelUrl, guest, setupId, addOnIds, attendeeCount, expectedTotalCents } = request.data as {
      expectedTotalCents?: number;
      setupId?: string;
      addOnIds?: string[];
      attendeeCount?: number;
      resourceId?: string;
      deskChangePlanId?: string;
      start: number;
      end: number;
      successUrl: string;
      cancelUrl: string;
      guest?: GuestDetails;
    };
    if ((expectedTotalCents !== undefined && (!Number.isSafeInteger(expectedTotalCents) || expectedTotalCents < 0))
      || (setupId && expectedTotalCents === undefined)) {
      throw new HttpsError("invalid-argument", "Review a current booking quote before checkout.");
    }
    if ((!resourceId && !deskChangePlanId) || !successUrl || !cancelUrl) {
      throw new HttpsError("invalid-argument", "Space and return URLs are required.");
    }
    if (!request.auth && (!guest?.name?.trim() || !guest?.email?.trim())) {
      throw new HttpsError("invalid-argument", "Name and email are required for guest checkout.");
    }

    validateWindow(start, end);
    await enforceBookingHorizon(start, request.auth?.uid);
    const busy = await getBusy(start, end);
    const choice = resolveChoice({ resourceId, deskChangePlanId }, start, end, busy);
    const baseQuote = await quoteForChoice(choice, start, end, request.auth?.uid, { setupId, addOnIds, attendeeCount });
    const holdRef = db().collection("bookingHolds").doc();
    const holdSecret = randomBytes(24).toString("hex");
    const held = await createHoldAtomically(
      holdRef,
      holdSecret,
      choice,
      baseQuote,
      start,
      end,
      guest,
      request.auth?.uid,
      expectedTotalCents,
    );
    const quote = held.quote;

    if (quote.totalCents === 0 && request.auth) {
      const paymentMethod = quote.accountCreditAppliedCents > 0
        ? "ACCOUNT_CREDIT"
        : "MEMBERSHIP_HOURS";
      const result = await finalizeHeldBooking(
        holdRef.id,
        request.auth.uid,
        String(request.auth.token.name || request.auth.token.email || "Member"),
        false,
        paymentMethod,
      );
      return { kind: "confirmed", bookingId: result.bookingId, quote };
    }

    const userId = request.auth?.uid || `guest:${holdRef.id}`;
    const payment = await createPayment({
      uid: userId,
      provider: "stripe",
      amount: quote.totalCents,
      currency: quote.currency,
      purpose: "booking",
      purposeRefId: holdRef.id,
      status: "pending",
      providerRefs: { holdId: holdRef.id },
    });
    await holdRef.update({ paymentId: payment.id });

    const provider = new StripeProvider(stripeSecretKey.value(), stripeWebhookSecret.value());
    const session = await provider.createCheckoutSession({
      uid: userId,
      amount: quote.totalCents,
      currency: quote.currency,
      purpose: "booking",
      purposeRefId: holdRef.id,
      successUrl: (() => { const url = new URL(successUrl); url.searchParams.set("holdId", holdRef.id); return url.toString(); })(),
      cancelUrl,
      mode: "payment",
      lineItemLabel: `${quote.resourceName} · ${quote.durationHours} hour${quote.durationHours === 1 ? "" : "s"}`,
      metadata: {
        paymentId: payment.id,
        holdId: holdRef.id,
        purpose: "booking",
        purposeRefId: holdRef.id,
        uid: userId,
        bookingKind: quote.bookingKind,
        ...(guest?.email ? { email: guest.email.trim().toLowerCase() } : {}),
      },
    });
    await Promise.all([
      updatePaymentStatus(payment.id, "pending", {
        providerRefs: {
          holdId: holdRef.id,
          stripeCheckoutSessionId: session.sessionId,
        },
      }),
      holdRef.update({ stripeCheckoutSessionId: session.sessionId }),
    ]);

    return {
      kind: "checkout",
      holdId: holdRef.id,
      holdSecret,
      expiresAt: held.expiresAt,
      paymentId: payment.id,
      checkoutUrl: session.url,
      quote,
    };
  },
);

export type PaidBookingResult =
  | { success: true; bookingId: string; alreadyFinalized: boolean }
  | { success: false; status: "recovery_required"; recoveryId: string; message: string }
  | { success: false; status: "cancelled"; message: string };

// Called only after Stripe verification/ledger confirmation, or by an authorized
// purchaser through the callable below. No browser state is needed by the webhook.
export async function finalizePaidBooking(holdId: string, paymentId: string): Promise<PaidBookingResult> {
  const holdRef = db().collection("bookingHolds").doc(holdId);
  const paymentRef = db().collection("payments").doc(paymentId);
  const [holdSnap, paymentSnap] = await Promise.all([holdRef.get(), paymentRef.get()]);
  const hold = holdSnap.data() as HoldData | undefined;
  const payment = paymentSnap.data();
  if (payment && ["refunded", "cancelled"].includes(payment.status)) {
    return { success: false, status: "cancelled", message: "This booking payment was cancelled or refunded. Check your account or contact staff." };
  }
  if (!payment || payment.status !== "paid" || payment.provider !== "stripe"
    || payment.purpose !== "booking" || payment.purposeRefId !== holdId) {
    throw new HttpsError("failed-precondition", "Payment has not been confirmed for this booking.");
  }
  const recover = async (reason: string): Promise<PaidBookingResult> => {
    const recoveryId = `booking_${paymentId}`;
    const confirmed = await db().runTransaction(async (tx) => {
      const ref = db().collection("bookingPaymentRecovery").doc(recoveryId);
      const [existing, latestHold, latestPayment] = await Promise.all([
        tx.get(ref), tx.get(holdRef), tx.get(paymentRef),
      ]);
      const latest = latestHold.data();
      if (latest?.status === "CONSUMED" && latest.bookingId) return { bookingId: String(latest.bookingId), replacement: false };
      const resolution = existing.data();
      if (resolution?.status === "RESOLVED" && typeof resolution.replacementBookingId === "string") {
        const replacement = await tx.get(db().collection("bookings").doc(resolution.replacementBookingId));
        if (replacement.data()?.status === "CONFIRMED" && replacement.data()?.paymentId === paymentId) {
          return { bookingId: replacement.id, replacement: true };
        }
      }
      if (existing.exists && resolution?.status !== "OPEN") return null;
      if (latestPayment.data()?.status !== "paid") return null;
      // Never reset a staff resolution when Stripe replays a successful event.
      if (!existing.exists) tx.create(ref, {
        id: recoveryId, holdId, paymentId, userId: hold?.userId || payment.uid,
        amountCents: payment.amount, currency: payment.currency,
        providerRefs: payment.providerRefs || {}, reason,
        status: "OPEN", requiredAction: "ALTERNATE_RESERVATION_OR_REFUND",
        createdAt: Date.now(), dueAt: Date.now(),
      });
      tx.set(paymentRef, { fulfillmentStatus: "recovery_required", recoveryId }, { merge: true });
      if (latestHold.exists) tx.set(holdRef, { recoveryId, fulfillmentStatus: "recovery_required" }, { merge: true });
      return null;
    });
    if (confirmed) return confirmed.replacement
      ? { success: true, bookingId: confirmed.bookingId, alreadyFinalized: true }
      : finalizePaidBooking(holdId, paymentId);
    logger.error("Paid booking requires staff recovery", { holdId, paymentId, recoveryId, reason });
    return { success: false, status: "recovery_required", recoveryId,
      message: "Payment received. Your booking needs staff assistance to arrange a space or refund. Do not pay again." };
  };
  if (!hold) return recover("hold_missing");
  if (hold.paymentId !== paymentId || Number(payment.amount) !== Number(hold.quote.totalCents)
    || String(payment.currency).toLowerCase() !== String(hold.quote.currency || "usd").toLowerCase()) {
    return recover("payment_hold_mismatch");
  }
  if (hold.status === "CONSUMED" && hold.bookingId) {
    const booking = await db().collection("bookings").doc(hold.bookingId).get();
    if (!booking.exists || booking.data()?.status !== "CONFIRMED") {
      // A later cancellation is authoritative. Never recreate physical access
      // or rewrite fulfillment just because Stripe delivers an older event.
      return { success: false, status: "cancelled", message: "This booking was cancelled. Check your account or contact staff." };
    }
    await issueAccessSafely(hold.bookingId,
      hold.bookingKind === "desk_change" && hold.segments ? hold.segments[0].resourceId : hold.resourceId,
      hold.userId, hold.start, hold.end);
    await paymentRef.set({ fulfillmentStatus: "confirmed", bookingId: hold.bookingId }, { merge: true });
    return { success: true, bookingId: hold.bookingId, alreadyFinalized: true };
  }
  if (hold.recoveryId) return recover("previous_recovery_required");
  const expired = Number(hold.expiresAt || 0) <= Date.now();
  if (hold.start <= Date.now()) return recover("booking_start_passed");
  // Released credits/hours may already have been spent elsewhere. Never silently
  // debit them a second time or grant a discounted booking without an entitlement.
  if (expired && (hold.quote.accountCreditAppliedCents > 0 || hold.quote.includedHoursApplied > 0)) {
    return recover("expired_benefit_reservation");
  }
  const account = hold.userId.startsWith("guest:")
    ? await ensureGuestAccount(holdId, hold.guest || undefined)
    : { uid: hold.userId, created: false };
  const owner = await admin.auth().getUser(account.uid);
  try {
    // An expired cash-only hold may be recovered only after the transaction
    // rechecks both bookings and all active competing holds.
    const result = await finalizeHeldBooking(holdId, account.uid,
      owner.displayName || owner.email || "Guest", account.created, "STRIPE", expired, paymentId);
    await paymentRef.set({ fulfillmentStatus: "confirmed", bookingId: result.bookingId }, { merge: true });
    return { success: true, bookingId: result.bookingId, alreadyFinalized: !result.createdNow };
  } catch (error) {
    if (["aborted", "deadline-exceeded"].includes((error as { code?: string }).code || "")) {
      return recover("space_unavailable");
    }
    // Transient errors must reach Stripe so its retry can finish processing.
    throw error;
  }
}

export const booking_finalizeCheckout = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    const { holdId, holdSecret } = request.data as { holdId: string; holdSecret?: string };
    if (!holdId) throw new HttpsError("invalid-argument", "holdId is required.");
    const holdRef = db().collection("bookingHolds").doc(holdId);
    const snap = await holdRef.get();
    if (!snap.exists) throw new HttpsError("not-found", "Booking hold not found.");
    const hold = snap.data() as HoldData;
    const secretMatches = Boolean(holdSecret
      && hold.secretHash === createHash("sha256").update(holdSecret).digest("hex"));
    if (!(request.auth && hold.userId === request.auth.uid) && !secretMatches) {
      throw new HttpsError("permission-denied", "This booking hold does not belong to you.");
    }
    if (!hold.paymentId) throw new HttpsError("failed-precondition", "No payment is associated with this hold.");
    const result = await finalizePaidBooking(holdId, hold.paymentId);
    if (!result.success) return result;
    const completed = (await holdRef.get()).data() as HoldData;
    // Only this checkout's genuinely new account can be signed in using its
    // high-entropy hold secret. Existing account recovery requires verified login.
    let customToken: string | undefined;
    if (secretMatches && completed.guestAccountCreated === true
      && Date.now() < completed.createdAt + 30 * 60_000) {
      const account = await admin.auth().getUser(completed.userId);
      if (!account.emailVerified && account.providerData.length === 0
        && Object.keys(account.customClaims || {}).length === 0) {
        const candidate = await admin.auth().createCustomToken(completed.userId, { bookingCheckout: true });
        const claimed = await db().runTransaction(async (tx) => {
          const [latest, profile] = await Promise.all([
            tx.get(holdRef), tx.get(db().collection("users").doc(completed.userId)),
          ]);
          const data = profile.data();
          if (latest.data()?.guestSignInClaimedAt || data?.guestCheckoutHoldId !== holdId
            || data?.role !== "member" || data?.membershipStatus !== "none") return false;
          tx.update(holdRef, { guestSignInClaimedAt: Date.now() });
          return true;
        });
        if (claimed) customToken = candidate;
      }
    }
    const booking = (await db().collection("bookings").doc(result.bookingId).get()).data();
    const bookingDetails = booking ? {
      setup: booking.setup || null, addOns: booking.addOns || [], attendeeCount: booking.attendeeCount || 1,
    } : undefined;
    return { ...result, customToken, bookingDetails };
  },
);

export const booking_onDeskChangeBookingUpdated = onDocumentUpdated(
  "bookings/{bookingId}",
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!after || after.deskChange !== true) return;
    if (before?.status === "CANCELLED" || after.status !== "CANCELLED") return;

    const bookingId = event.params.bookingId;
    const occupancySnap = await db()
      .collection("bookingHolds")
      .where("bookingId", "==", bookingId)
      .get();
    const batch = db().batch();
    let changed = 0;
    occupancySnap.docs.forEach((doc) => {
      const kind = String(doc.data().kind || "");
      if (kind !== "DESK_CHANGE_OCCUPANCY" && kind !== "DESK_CHANGE_RESCHEDULE_LOCK") return;
      batch.set(doc.ref, {
        status: "CANCELLED",
        cancelledAt: Date.now(),
        expiresAt: Date.now(),
      }, { merge: true });
      changed += 1;
    });
    if (changed > 0) await batch.commit();
  },
);

// Recovery is not a successful booking or a refund. Give payment administrators
// a bounded, explicit work queue; resolution follows verified provider evidence.
export const booking_adminListPaymentRecovery = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  if (!["admin", "master"].includes(String(request.auth.token.role))) {
    throw new HttpsError("permission-denied", "Only payment administrators can view recovery cases.");
  }
  const snapshot = await db().collection("bookingPaymentRecovery").where("status", "==", "OPEN").limit(100).get();
  const cases = snapshot.docs.map((doc) => {
    const value = doc.data();
    return { id: doc.id, holdId: value.holdId, paymentId: value.paymentId, userId: value.userId,
      amountCents: value.amountCents, currency: value.currency, reason: value.reason,
      status: value.status, requiredAction: value.requiredAction, createdAt: value.createdAt };
  }).sort((a, b) => a.createdAt - b.createdAt);
  return { cases };
});
