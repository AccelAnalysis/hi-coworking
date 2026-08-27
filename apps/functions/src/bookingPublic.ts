import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  CONFERENCE_ROOM_HOURLY_RATE_CENTS,
  GUEST_BOOKING_WINDOW_DAYS,
  GUEST_DAILY_CAP_CENTS,
  GUEST_HOURLY_RATE_CENTS,
  getTierById,
} from "./payments/stripeConfig";

if (admin.apps.length === 0) {
  admin.initializeApp();
}

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
) {
  const now = Date.now();
  const bookings = bookingSnap.docs
    .map((doc) => doc.data() as BusyRecord)
    .filter((item) => item.start < end && item.status !== "CANCELLED");
  const holds = holdSnap.docs
    .map((doc) => doc.data() as BusyRecord)
    .filter((item) => (
      item.start < end
      && (item.expiresAt || 0) > now
      && item.status !== "EXPIRED"
      && item.status !== "CONSUMED"
    ));
  return [...bookings, ...holds];
}

async function getBusy(start: number, end: number) {
  const [bookingSnap, holdSnap] = await Promise.all([
    db().collection("bookings").where("end", ">", start).get(),
    db().collection("bookingHolds").where("end", ">", start).get(),
  ]);
  return busyFromSnapshots(bookingSnap, holdSnap, end);
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

async function quoteFor(
  resourceId: string,
  start: number,
  end: number,
  uid?: string,
): Promise<BookingQuote> {
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
