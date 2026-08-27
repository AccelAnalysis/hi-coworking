import { createHash, randomBytes } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { createPayment, updatePaymentStatus } from "./payments/ledger";
import { StripeProvider } from "./payments/stripeProvider";
import {
  CONFERENCE_ROOM_HOURLY_RATE_CENTS,
  GUEST_BOOKING_WINDOW_DAYS,
  GUEST_DAILY_CAP_CENTS,
  GUEST_HOURLY_RATE_CENTS,
  getTierById,
} from "./payments/stripeConfig";
import { createAccessGrant, seamApiKey } from "./access";

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

const HOLD_MS = 15 * 60 * 1000;
const OPEN_HOUR = 8;
const CLOSE_HOUR = 20;
const INCREMENT_MS = 30 * 60 * 1000;
const LOCATION_TIME_ZONE = "America/New_York";
const DAY_MS = 24 * 60 * 60 * 1000;

const RESOURCE_CONFIG: Record<string, {
  name: string;
  type: "SEAT" | "MODE";
  guestRateHourlyCents: number;
  exclusiveGroupId: string;
}> = {
  "seat-1": { name: "Desk 1", type: "SEAT", guestRateHourlyCents: GUEST_HOURLY_RATE_CENTS, exclusiveGroupId: "main_space" },
  "seat-2": { name: "Desk 2", type: "SEAT", guestRateHourlyCents: GUEST_HOURLY_RATE_CENTS, exclusiveGroupId: "main_space" },
  "seat-3": { name: "Desk 3", type: "SEAT", guestRateHourlyCents: GUEST_HOURLY_RATE_CENTS, exclusiveGroupId: "main_space" },
  "seat-4": { name: "Desk 4", type: "SEAT", guestRateHourlyCents: GUEST_HOURLY_RATE_CENTS, exclusiveGroupId: "main_space" },
  "seat-5": { name: "Desk 5", type: "SEAT", guestRateHourlyCents: GUEST_HOURLY_RATE_CENTS, exclusiveGroupId: "main_space" },
  "seat-6": { name: "Desk 6", type: "SEAT", guestRateHourlyCents: GUEST_HOURLY_RATE_CENTS, exclusiveGroupId: "main_space" },
  "mode-conference": { name: "Meeting setup", type: "MODE", guestRateHourlyCents: CONFERENCE_ROOM_HOURLY_RATE_CENTS, exclusiveGroupId: "main_space" },
};

type BusyRecord = {
  resourceId: string;
  start: number;
  end: number;
  status?: string;
  expiresAt?: number;
};

type GuestDetails = { name?: string; email?: string; phone?: string };

type LocalClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

type UsageReservation = {
  hours: number;
  expiresAt: number;
};

type MembershipUsage = {
  uid: string;
  monthKey: string;
  usedHours: number;
  reservations: Record<string, UsageReservation>;
  updatedAt: number;
};

type CreditReservation = {
  amountCents: number;
  expiresAt: number;
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

function db() {
  return admin.firestore();
}

function localClock(timestamp: number): LocalClock {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function localDayKey(timestamp: number) {
  const value = localClock(timestamp);
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

function localMonthKey(timestamp: number) {
  const value = localClock(timestamp);
  return `${value.year}-${String(value.month).padStart(2, "0")}`;
}

function usageDocumentId(uid: string, monthKey: string) {
  return `${uid}_${monthKey}`;
}

function activeUsageReservations(
  reservations: Record<string, UsageReservation> | undefined,
  now = Date.now(),
) {
  return Object.fromEntries(
    Object.entries(reservations || {}).filter(([, reservation]) => reservation.expiresAt > now),
  ) as Record<string, UsageReservation>;
}

function activeCreditReservations(
  reservations: Record<string, CreditReservation> | undefined,
  now = Date.now(),
) {
  return Object.fromEntries(
    Object.entries(reservations || {}).filter(([, reservation]) => reservation.expiresAt > now),
  ) as Record<string, CreditReservation>;
}

function reservedHours(reservations: Record<string, UsageReservation>) {
  return Object.values(reservations).reduce(
    (sum, reservation) => sum + Math.max(0, reservation.hours),
    0,
  );
}

function reservedCreditCents(reservations: Record<string, CreditReservation>) {
  return Object.values(reservations).reduce(
    (sum, reservation) => sum + Math.max(0, Math.round(reservation.amountCents)),
    0,
  );
}

function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

function validateWindow(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new HttpsError("invalid-argument", "Choose a valid start and end time.");
  }
  if (start % INCREMENT_MS !== 0 || end % INCREMENT_MS !== 0) {
    throw new HttpsError("invalid-argument", "Bookings must use 30-minute increments.");
  }
  if (localDayKey(start) !== localDayKey(end - 1)) {
    throw new HttpsError("invalid-argument", "Bookings must start and end on the same day.");
  }
  const startClock = localClock(start);
  const endClock = localClock(end);
  const startMinutes = startClock.hour * 60 + startClock.minute;
  const endMinutes = endClock.hour * 60 + endClock.minute;
  if (startMinutes < OPEN_HOUR * 60 || endMinutes > CLOSE_HOUR * 60) {
    throw new HttpsError("failed-precondition", "That time is outside current operating hours.");
  }
  if (start < Date.now() - 60_000) {
    throw new HttpsError("failed-precondition", "That time has already passed.");
  }
}

async function bookingWindowDaysFor(uid?: string) {
  if (!uid) return GUEST_BOOKING_WINDOW_DAYS;
  const userSnap = await db().collection("users").doc(uid).get();
  const user = userSnap.data();
  if (user?.membershipStatus !== "active" || !user?.plan) return GUEST_BOOKING_WINDOW_DAYS;
  return getTierById(user.plan)?.bookingWindowDays ?? GUEST_BOOKING_WINDOW_DAYS;
}

async function enforceBookingHorizon(start: number, uid?: string) {
  const days = await bookingWindowDaysFor(uid);
  if (start > Date.now() + days * DAY_MS) {
    throw new HttpsError(
      "failed-precondition",
      `That date is outside your current ${days}-day booking window.`,
    );
  }
}

function resourceConflicts(resourceId: string, start: number, end: number, busy: BusyRecord[]) {
  const target = RESOURCE_CONFIG[resourceId];
  if (!target) return true;
  return busy.some((record) => {
    if (!overlaps(start, end, record.start, record.end)) return false;
    if (record.status === "CANCELLED" || record.status === "EXPIRED" || record.status === "CONSUMED") {
      return false;
    }
    if (record.resourceId === resourceId) return true;
    const other = RESOURCE_CONFIG[record.resourceId];
    if (!other || other.exclusiveGroupId !== target.exclusiveGroupId) return false;
    return target.type === "MODE" || other.type === "MODE";
  });
}

function busyFromSnapshots(
  bookingSnap: FirebaseFirestore.QuerySnapshot,
  holdSnap: FirebaseFirestore.QuerySnapshot,
  end: number,
  excludeHoldId?: string,
) {
  const now = Date.now();
  const bookings = bookingSnap.docs
    .map((doc) => doc.data() as BusyRecord)
    .filter((item) => item.start < end && item.status !== "CANCELLED");
  const holds = holdSnap.docs
    .filter((doc) => doc.id !== excludeHoldId)
    .map((doc) => doc.data() as BusyRecord)
    .filter((item) => (
      item.start < end
      && (item.expiresAt || 0) > now
      && item.status !== "EXPIRED"
      && item.status !== "CONSUMED"
    ));
  return [...bookings, ...holds];
}

async function getBusy(start: number, end: number, excludeHoldId?: string) {
  const [bookingSnap, holdSnap] = await Promise.all([
    db().collection("bookings").where("end", ">", start).get(),
    db().collection("bookingHolds").where("end", ">", start).get(),
  ]);
  return busyFromSnapshots(bookingSnap, holdSnap, end, excludeHoldId);
}

function hoursFromBookingDocs(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  monthKey: string,
) {
  return docs.reduce((sum, doc) => {
    const booking = doc.data();
    if (booking.status === "CANCELLED" || localMonthKey(booking.start) !== monthKey) return sum;
    if (RESOURCE_CONFIG[booking.resourceId]?.type !== "SEAT") return sum;
    const explicitlyApplied = Number(booking.includedHoursApplied);
    if (Number.isFinite(explicitlyApplied)) return sum + Math.max(0, explicitlyApplied);
    return sum + Math.max(0, (booking.end - booking.start) / 3_600_000);
  }, 0);
}

async function getMembershipUsageState(uid: string, monthKey: string) {
  const usageRef = db().collection("membershipUsage").doc(usageDocumentId(uid, monthKey));
  const usageSnap = await usageRef.get();
  if (usageSnap.exists) {
    const usage = usageSnap.data() as MembershipUsage;
    return {
      usedHours: Math.max(0, usage.usedHours || 0),
      reservations: activeUsageReservations(usage.reservations),
    };
  }

  const bookingSnap = await db().collection("bookings").where("userId", "==", uid).get();
  return {
    usedHours: hoursFromBookingDocs(bookingSnap.docs, monthKey),
    reservations: {} as Record<string, UsageReservation>,
  };
}

function guestSeatSubtotal(durationHours: number) {
  return Math.min(
    Math.round(durationHours * GUEST_HOURLY_RATE_CENTS),
    GUEST_DAILY_CAP_CENTS,
  );
}

async function quoteFor(resourceId: string, start: number, end: number, uid?: string): Promise<BookingQuote> {
  const resource = RESOURCE_CONFIG[resourceId];
  if (!resource) throw new HttpsError("not-found", "Space not found.");
  validateWindow(start, end);
  await enforceBookingHorizon(start, uid);

  const durationHours = (end - start) / 3_600_000;
  let includedHoursRemaining = 0;
  let includedHoursApplied = 0;
  let billableHours = durationHours;
  let hourlyRateCents = resource.guestRateHourlyCents;
  let membershipName: string | null = null;
  let user: FirebaseFirestore.DocumentData | undefined;

  if (uid) {
    user = (await db().collection("users").doc(uid).get()).data();
  }

  if (uid && user && resource.type === "SEAT" && user.membershipStatus === "active" && user.plan) {
    const tier = getTierById(user.plan);
    if (tier) {
      membershipName = tier.name;
      hourlyRateCents = tier.extraHourlyRateCents;
      const monthKey = localMonthKey(start);
      const usage = await getMembershipUsageState(uid, monthKey);
      const remaining = Math.max(
        0,
        tier.includedHoursPerMonth - usage.usedHours - reservedHours(usage.reservations),
      );
      includedHoursRemaining = remaining;
      includedHoursApplied = Math.min(durationHours, remaining);
      billableHours = Math.max(0, durationHours - includedHoursApplied);
    }
  }

  let subtotalCents = Math.round(billableHours * hourlyRateCents);
  let dailyCapApplied = false;
  if (resource.type === "SEAT" && !membershipName) {
    const uncapped = Math.round(durationHours * GUEST_HOURLY_RATE_CENTS);
    subtotalCents = Math.min(uncapped, GUEST_DAILY_CAP_CENTS);
    hourlyRateCents = GUEST_HOURLY_RATE_CENTS;
    billableHours = durationHours;
    dailyCapApplied = uncapped >= GUEST_DAILY_CAP_CENTS;
  }

  const creditReservations = activeCreditReservations(user?.accountCreditReservations);
  const accountCreditAvailableCents = uid
    ? Math.max(
        0,
        Math.round(Number(user?.accountCreditCents || 0)) - reservedCreditCents(creditReservations),
      )
    : 0;
  const accountCreditAppliedCents = Math.min(subtotalCents, accountCreditAvailableCents);
  const totalCents = Math.max(0, subtotalCents - accountCreditAppliedCents);

  return {
    resourceId,
    resourceName: resource.name,
    resourceType: resource.type,
    start,
    end,
    durationHours,
    membershipName,
    includedHoursRemaining,
    includedHoursApplied,
    billableHours,
    hourlyRateCents,
    subtotalCents,
    accountCreditAvailableCents,
    accountCreditAppliedCents,
    totalCents,
    dailyCapApplied,
    currency: "usd",
  };
}

async function createHoldAtomically(
  holdRef: FirebaseFirestore.DocumentReference,
  hold: Record<string, unknown>,
  resourceId: string,
  start: number,
  end: number,
  authenticatedUid?: string,
) {
  return db().runTransaction(async (tx) => {
    const bookingQuery = db().collection("bookings").where("end", ">", start);
    const holdQuery = db().collection("bookingHolds").where("end", ">", start);
    const resource = RESOURCE_CONFIG[resourceId];
    if (!resource) throw new HttpsError("not-found", "Space not found.");

    const reads: Array<Promise<FirebaseFirestore.DocumentSnapshot | FirebaseFirestore.QuerySnapshot>> = [
      tx.get(bookingQuery),
      tx.get(holdQuery),
    ];
    const userRef = authenticatedUid ? db().collection("users").doc(authenticatedUid) : null;
    if (userRef) reads.push(tx.get(userRef));

    const initialReads = await Promise.all(reads);
    const bookingSnap = initialReads[0] as FirebaseFirestore.QuerySnapshot;
    const holdSnap = initialReads[1] as FirebaseFirestore.QuerySnapshot;
    const userSnap = userRef ? initialReads[2] as FirebaseFirestore.DocumentSnapshot : null;

    const busy = busyFromSnapshots(bookingSnap, holdSnap, end);
    if (resourceConflicts(resourceId, start, end, busy)) {
      throw new HttpsError(
        "failed-precondition",
        "That option was just booked. Choose another available space.",
      );
    }

    const baseQuote = hold.quote as BookingQuote;
    const durationHours = baseQuote.durationHours;
    const user = userSnap?.data();
    let adjustedQuote: BookingQuote = { ...baseQuote };
    let usageRef: FirebaseFirestore.DocumentReference | null = null;
    let usageData: MembershipUsage | null = null;

    if (authenticatedUid && resource.type === "SEAT") {
      const tier = user?.membershipStatus === "active" && user?.plan
        ? getTierById(user.plan)
        : undefined;

      if (tier) {
        const monthKey = localMonthKey(start);
        usageRef = db().collection("membershipUsage").doc(usageDocumentId(authenticatedUid, monthKey));
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
        const subtotalCents = Math.round(billableHours * tier.extraHourlyRateCents);

        adjustedQuote = {
          ...adjustedQuote,
          membershipName: tier.name,
          includedHoursRemaining: remaining,
          includedHoursApplied,
          billableHours,
          hourlyRateCents: tier.extraHourlyRateCents,
          subtotalCents,
          dailyCapApplied: false,
        };

        if (includedHoursApplied > 0) {
          reservations[holdRef.id] = {
            hours: includedHoursApplied,
            expiresAt: Number(hold.expiresAt),
          };
        }
        usageData = {
          uid: authenticatedUid,
          monthKey,
          usedHours,
          reservations,
          updatedAt: Date.now(),
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
          dailyCapApplied: Math.round(durationHours * GUEST_HOURLY_RATE_CENTS) >= GUEST_DAILY_CAP_CENTS,
        };
      }
    }

    let creditReservations: Record<string, CreditReservation> = {};
    if (userRef && userSnap) {
      creditReservations = activeCreditReservations(user?.accountCreditReservations);
      const availableCredit = Math.max(
        0,
        Math.round(Number(user?.accountCreditCents || 0)) - reservedCreditCents(creditReservations),
      );
      const accountCreditAppliedCents = Math.min(adjustedQuote.subtotalCents, availableCredit);
      if (accountCreditAppliedCents > 0) {
        creditReservations[holdRef.id] = {
          amountCents: accountCreditAppliedCents,
          expiresAt: Number(hold.expiresAt),
        };
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

    if (usageRef && usageData) tx.set(usageRef, usageData, { merge: true });
    if (userRef && userSnap) {
      tx.set(userRef, {
        accountCreditReservations: creditReservations,
        updatedAt: Date.now(),
      }, { merge: true });
    }
    tx.set(holdRef, {
      ...hold,
      quote: adjustedQuote,
      membershipUsageId: usageRef?.id || null,
      accountCreditReservationCents: adjustedQuote.accountCreditAppliedCents,
    });
    return adjustedQuote;
  });
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
  const reservations = activeCreditReservations(user.accountCreditReservations);
  const reserved = Math.max(
    0,
    Math.round(Number(reservations[holdId]?.amountCents ?? expectedAmountCents)),
  );
  delete reservations[holdId];
  const amountCents = Math.min(
    Math.max(0, Math.round(Number(user.accountCreditCents || 0))),
    reserved,
  );
  tx.set(userRef, {
    accountCreditCents: Math.max(0, Math.round(Number(user.accountCreditCents || 0)) - amountCents),
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

async function ensureGuestAccount(guest?: GuestDetails) {
  const email = guest?.email?.trim().toLowerCase();
  if (!email) throw new HttpsError("failed-precondition", "Guest email is missing.");

  let userRecord: admin.auth.UserRecord;
  let created = false;
  try {
    userRecord = await admin.auth().getUserByEmail(email);
  } catch (error: unknown) {
    const coded = error as { code?: string };
    if (coded.code !== "auth/user-not-found") throw error;
    userRecord = await admin.auth().createUser({
      email,
      displayName: guest?.name?.trim() || undefined,
      emailVerified: false,
    });
    created = true;
  }

  const userRef = db().collection("users").doc(userRecord.uid);
  await userRef.set({
    uid: userRecord.uid,
    email,
    displayName: guest?.name?.trim() || userRecord.displayName || "",
    phone: guest?.phone?.trim() || "",
    role: "member",
    membershipStatus: "none",
    ...(created ? { createdAt: Date.now() } : {}),
    updatedAt: Date.now(),
  }, { merge: true });

  return { uid: userRecord.uid, created };
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

export const booking_getAvailability = onCall(async (request) => {
  const { start, end } = request.data as { start: number; end: number };
  validateWindow(start, end);
  await enforceBookingHorizon(start, request.auth?.uid);
  const busy = await getBusy(start, end);
  return {
    start,
    end,
    operatingHours: {
      openHour: OPEN_HOUR,
      closeHour: CLOSE_HOUR,
      timeZone: LOCATION_TIME_ZONE,
    },
    options: Object.entries(RESOURCE_CONFIG).map(([resourceId, resource]) => ({
      resourceId,
      name: resource.name,
      type: resource.type,
      available: !resourceConflicts(resourceId, start, end, busy),
    })),
  };
});

export const booking_createQuote = onCall(async (request) => {
  const { resourceId, start, end } = request.data as {
    resourceId: string;
    start: number;
    end: number;
  };
  const busy = await getBusy(start, end);
  if (resourceConflicts(resourceId, start, end, busy)) {
    throw new HttpsError("failed-precondition", "That option is no longer available.");
  }
  return quoteFor(resourceId, start, end, request.auth?.uid);
});

export const booking_beginCheckout = onCall(
  { secrets: [stripeSecretKey, stripeWebhookSecret, seamApiKey] },
  async (request) => {
    const { resourceId, start, end, successUrl, cancelUrl, guest } = request.data as {
      resourceId: string;
      start: number;
      end: number;
      successUrl: string;
      cancelUrl: string;
      guest?: GuestDetails;
    };
    if (!resourceId || !successUrl || !cancelUrl) {
      throw new HttpsError("invalid-argument", "Space and return URLs are required.");
    }
    if (!request.auth && (!guest?.name?.trim() || !guest?.email?.trim())) {
      throw new HttpsError("invalid-argument", "Name and email are required for guest checkout.");
    }

    validateWindow(start, end);
    await enforceBookingHorizon(start, request.auth?.uid);
    let quote = await quoteFor(resourceId, start, end, request.auth?.uid);
    const holdRef = db().collection("bookingHolds").doc();
    const holdSecret = randomBytes(24).toString("hex");
    const now = Date.now();
    const userId = request.auth?.uid || `guest:${holdRef.id}`;
    const hold = {
      id: holdRef.id,
      resourceId,
      resourceName: quote.resourceName,
      start,
      end,
      userId,
      guest: request.auth ? null : {
        name: guest?.name?.trim(),
        email: guest?.email?.trim().toLowerCase(),
        phone: guest?.phone?.trim() || "",
      },
      quote,
      status: "HELD",
      secretHash: createHash("sha256").update(holdSecret).digest("hex"),
      createdAt: now,
      expiresAt: now + HOLD_MS,
    };

    quote = await createHoldAtomically(
      holdRef,
      hold,
      resourceId,
      start,
      end,
      request.auth?.uid,
    );

    if (quote.totalCents === 0 && request.auth) {
      const bookingRef = db().collection("bookings").doc();
      await db().runTransaction(async (tx) => {
        const latest = await tx.get(holdRef);
        if (!latest.exists || Number(latest.data()?.expiresAt || 0) <= Date.now()) {
          throw new HttpsError("deadline-exceeded", "Your hold expired. Please choose the space again.");
        }
        const latestHold = latest.data() as Record<string, unknown>;
        const usageRef = latestHold.membershipUsageId
          ? db().collection("membershipUsage").doc(String(latestHold.membershipUsageId))
          : null;
        const userRef = db().collection("users").doc(request.auth!.uid);
        const reads: Array<Promise<FirebaseFirestore.DocumentSnapshot>> = [tx.get(userRef)];
        if (usageRef) reads.push(tx.get(usageRef));
        const results = await Promise.all(reads);
        const userSnap = results[0];
        const usageSnap = usageRef ? results[1] : null;

        tx.set(bookingRef, {
          id: bookingRef.id,
          resourceId,
          resourceName: quote.resourceName,
          userId: request.auth!.uid,
          userName: request.auth!.token.name || request.auth!.token.email || "Member",
          start,
          end,
          status: "CONFIRMED",
          totalPrice: 0,
          totalCents: 0,
          subtotalCents: quote.subtotalCents,
          accountCreditAppliedCents: quote.accountCreditAppliedCents,
          paymentMethod: quote.accountCreditAppliedCents > 0
            ? "ACCOUNT_CREDIT"
            : "MEMBERSHIP_HOURS",
          includedHoursApplied: quote.includedHoursApplied,
          createdAt: Date.now(),
        });
        tx.update(holdRef, {
          status: "CONSUMED",
          consumedAt: Date.now(),
          bookingId: bookingRef.id,
        });
        if (usageRef && usageSnap) {
          consumeMembershipReservation(tx, usageRef, usageSnap, holdRef.id);
        }
        consumeAccountCreditReservation(
          tx,
          userRef,
          userSnap,
          holdRef.id,
          quote.accountCreditAppliedCents,
        );
      });
      await issueAccessSafely(bookingRef.id, resourceId, request.auth.uid, start, end);
      return { kind: "confirmed", bookingId: bookingRef.id, quote };
    }

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
      successUrl,
      cancelUrl,
      mode: "payment",
      lineItemLabel: `${quote.resourceName} · ${quote.durationHours} hour${quote.durationHours === 1 ? "" : "s"}`,
      metadata: {
        paymentId: payment.id,
        holdId: holdRef.id,
        purpose: "booking",
        purposeRefId: holdRef.id,
        uid: userId,
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
      expiresAt: hold.expiresAt,
      paymentId: payment.id,
      checkoutUrl: session.url,
      quote,
    };
  },
);

export const booking_finalizeCheckout = onCall(
  { secrets: [seamApiKey] },
  async (request) => {
    const { holdId, holdSecret } = request.data as {
      holdId: string;
      holdSecret?: string;
    };
    if (!holdId) throw new HttpsError("invalid-argument", "holdId is required.");
    const holdRef = db().collection("bookingHolds").doc(holdId);
    const holdSnap = await holdRef.get();
    if (!holdSnap.exists) throw new HttpsError("not-found", "Booking hold not found.");
    const hold = holdSnap.data() as Record<string, unknown>;

    const authOwns = Boolean(request.auth && hold.userId === request.auth.uid);
    const secretMatches = Boolean(
      holdSecret
      && hold.secretHash === createHash("sha256").update(holdSecret).digest("hex"),
    );
    if (!authOwns && !secretMatches) {
      throw new HttpsError("permission-denied", "This booking hold does not belong to you.");
    }

    if (hold.status === "CONSUMED" && hold.bookingId) {
      let customToken: string | undefined;
      if (
        !request.auth
        && secretMatches
        && hold.guestAccountCreated === true
        && typeof hold.userId === "string"
        && !hold.userId.startsWith("guest:")
      ) {
        customToken = await admin.auth().createCustomToken(hold.userId, {
          bookingCheckout: true,
        });
      }
      return {
        success: true,
        bookingId: String(hold.bookingId),
        alreadyFinalized: true,
        customToken,
      };
    }

    if (Number(hold.expiresAt || 0) <= Date.now()) {
      await holdRef.update({ status: "EXPIRED", expiredAt: Date.now() });
      throw new HttpsError(
        "deadline-exceeded",
        "Your booking hold expired before payment completed.",
      );
    }
    if (!hold.paymentId) {
      throw new HttpsError("failed-precondition", "No payment is associated with this hold.");
    }

    const paymentSnap = await db().collection("payments").doc(String(hold.paymentId)).get();
    if (!paymentSnap.exists || paymentSnap.data()?.status !== "paid") {
      throw new HttpsError("failed-precondition", "Payment has not been confirmed yet.");
    }

    const guestAccount = request.auth
      ? { uid: request.auth.uid, created: false }
      : await ensureGuestAccount(hold.guest as GuestDetails | undefined);
    const finalUserId = guestAccount.uid;
    const bookingRef = db().collection("bookings").doc();

    const result = await db().runTransaction(async (tx) => {
      const latestHoldSnap = await tx.get(holdRef);
      if (!latestHoldSnap.exists) {
        throw new HttpsError("not-found", "Booking hold not found.");
      }
      const latestHold = latestHoldSnap.data() as Record<string, unknown>;
      if (latestHold.status === "CONSUMED" && latestHold.bookingId) {
        return { bookingId: String(latestHold.bookingId), createdNow: false };
      }

      const bookingQuery = db().collection("bookings").where("end", ">", Number(hold.start));
      const holdQuery = db().collection("bookingHolds").where("end", ">", Number(hold.start));
      const usageRef = latestHold.membershipUsageId
        ? db().collection("membershipUsage").doc(String(latestHold.membershipUsageId))
        : null;
      const userRef = db().collection("users").doc(finalUserId);
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

      const busy = busyFromSnapshots(
        bookingSnap,
        holdRangeSnap,
        Number(hold.end),
        holdId,
      );
      if (resourceConflicts(
        String(hold.resourceId),
        Number(hold.start),
        Number(hold.end),
        busy,
      )) {
        logger.error("Paid hold encountered conflict during finalization", {
          holdId,
          paymentId: hold.paymentId,
        });
        throw new HttpsError(
          "aborted",
          "We received payment but the held space cannot be finalized automatically. Staff has been alerted.",
        );
      }

      const quote = hold.quote as BookingQuote;
      const guest = hold.guest as GuestDetails | null | undefined;
      tx.set(bookingRef, {
        id: bookingRef.id,
        resourceId: hold.resourceId,
        resourceName: hold.resourceName,
        userId: finalUserId,
        userName: guest?.name
          || request.auth?.token.name
          || request.auth?.token.email
          || "Guest",
        guestEmail: guest?.email || null,
        guestPhone: guest?.phone || null,
        start: hold.start,
        end: hold.end,
        status: "CONFIRMED",
        totalPrice: (quote.totalCents || 0) / 100,
        totalCents: quote.totalCents || 0,
        subtotalCents: quote.subtotalCents || quote.totalCents || 0,
        accountCreditAppliedCents: quote.accountCreditAppliedCents || 0,
        paymentMethod: "STRIPE",
        paymentId: hold.paymentId,
        includedHoursApplied: quote.includedHoursApplied || 0,
        createdAt: Date.now(),
      });
      tx.update(holdRef, {
        status: "CONSUMED",
        consumedAt: Date.now(),
        bookingId: bookingRef.id,
        userId: finalUserId,
        guestAccountCreated: guestAccount.created,
      });
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

    if (result.createdNow) {
      await issueAccessSafely(
        result.bookingId,
        String(hold.resourceId),
        finalUserId,
        Number(hold.start),
        Number(hold.end),
      );
    }

    const customToken = !request.auth && guestAccount.created
      ? await admin.auth().createCustomToken(finalUserId, { bookingCheckout: true })
      : undefined;

    return {
      success: true,
      bookingId: result.bookingId,
      customToken,
    };
  },
);
