import { HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  CONFERENCE_ROOM_HOURLY_RATE_CENTS,
  GUEST_BOOKING_WINDOW_DAYS,
  GUEST_DAILY_CAP_CENTS,
  GUEST_HOURLY_RATE_CENTS,
  getDeskMembershipTierById,
  getTierById,
} from "./payments/stripeConfig";

if (admin.apps.length === 0) admin.initializeApp();

export const HOLD_MS = 15 * 60 * 1000;
export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 20;
export const INCREMENT_MS = 30 * 60 * 1000;
export const LOCATION_TIME_ZONE = "America/New_York";
export const DAY_MS = 24 * 60 * 60 * 1000;
export const FLEX_RESOURCE_ID = "seat-flex";
export const RESCHEDULE_LOCK_END = Date.UTC(2100, 0, 1);

export const RESOURCE_CONFIG: Record<string, {
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

export const DESK_RESOURCE_IDS = Object.keys(RESOURCE_CONFIG).filter(
  (resourceId) => RESOURCE_CONFIG[resourceId]?.type === "SEAT",
);

export type BusyRecord = {
  resourceId: string;
  start: number;
  end: number;
  status?: string;
  expiresAt?: number;
};

export type DeskSegment = {
  resourceId: string;
  resourceName: string;
  start: number;
  end: number;
};

export type DeskChangePlan = {
  planId: string;
  kind: "desk_change";
  changeAt: number;
  segments: [DeskSegment, DeskSegment];
};

export type BookingChoice =
  | { kind: "single"; resourceId: string; resourceName: string; resourceType: "SEAT" | "MODE" }
  | { kind: "desk_change"; resourceId: typeof FLEX_RESOURCE_ID; resourceName: string; resourceType: "SEAT"; planId: string; segments: [DeskSegment, DeskSegment] };

export type UsageReservation = { hours: number; expiresAt: number };
export type CreditReservation = { amountCents: number; expiresAt: number };
export type MembershipUsage = {
  uid: string;
  monthKey: string;
  usedHours: number;
  reservations: Record<string, UsageReservation>;
  updatedAt: number;
};

export type BookingQuote = {
  resourceId: string;
  resourceName: string;
  resourceType: "SEAT" | "MODE";
  bookingKind: "single" | "desk_change";
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
  deskChangePlanId?: string;
  segments?: [DeskSegment, DeskSegment];
};

export function db() {
  return admin.firestore();
}

function localClock(timestamp: number) {
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

export function localDayKey(timestamp: number) {
  const value = localClock(timestamp);
  return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

export function localMonthKey(timestamp: number) {
  const value = localClock(timestamp);
  return `${value.year}-${String(value.month).padStart(2, "0")}`;
}

export function validateWindow(start: number, end: number) {
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

export async function bookingWindowDaysFor(uid?: string) {
  if (!uid) return GUEST_BOOKING_WINDOW_DAYS;
  const userSnap = await db().collection("users").doc(uid).get();
  const user = userSnap.data();
  if (user?.membershipStatus !== "active" || !user?.plan) return GUEST_BOOKING_WINDOW_DAYS;
  return getTierById(user.plan)?.bookingWindowDays ?? GUEST_BOOKING_WINDOW_DAYS;
}

export async function enforceBookingHorizon(start: number, uid?: string) {
  const days = await bookingWindowDaysFor(uid);
  if (start > Date.now() + days * DAY_MS) {
    throw new HttpsError(
      "failed-precondition",
      `That date is outside your current ${days}-day booking window.`,
    );
  }
}

export function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

export function resourceConflicts(resourceId: string, start: number, end: number, busy: BusyRecord[]) {
  const target = RESOURCE_CONFIG[resourceId];
  if (!target) return true;
  return busy.some((record) => {
    if (!overlaps(start, end, record.start, record.end)) return false;
    if (["CANCELLED", "EXPIRED", "CONSUMED"].includes(String(record.status || ""))) return false;
    if (record.resourceId === resourceId) return true;
    const other = RESOURCE_CONFIG[record.resourceId];
    if (!other || other.exclusiveGroupId !== target.exclusiveGroupId) return false;
    return target.type === "MODE" || other.type === "MODE";
  });
}

export function busyFromSnapshots(
  bookingSnap: FirebaseFirestore.QuerySnapshot,
  holdSnap: FirebaseFirestore.QuerySnapshot,
  end: number,
  excludeHoldIds: Set<string> = new Set(),
) {
  const now = Date.now();
  const bookings = bookingSnap.docs
    .map((doc) => doc.data() as BusyRecord)
    .filter((item) => item.start < end && item.status !== "CANCELLED");
  const holds = holdSnap.docs
    .filter((doc) => !excludeHoldIds.has(doc.id))
    .map((doc) => doc.data() as BusyRecord)
    .filter((item) => (
      item.start < end
      && Number(item.expiresAt || 0) > now
      && item.status !== "EXPIRED"
      && item.status !== "CONSUMED"
      && item.status !== "CANCELLED"
    ));
  return [...bookings, ...holds];
}

export async function getBusy(start: number, end: number, excludeHoldIds: Set<string> = new Set()) {
  const [bookingSnap, holdSnap] = await Promise.all([
    db().collection("bookings").where("end", ">", start).get(),
    db().collection("bookingHolds").where("end", ">", start).get(),
  ]);
  return busyFromSnapshots(bookingSnap, holdSnap, end, excludeHoldIds);
}

function deskSegment(resourceId: string, start: number, end: number): DeskSegment {
  return {
    resourceId,
    resourceName: RESOURCE_CONFIG[resourceId]?.name || resourceId,
    start,
    end,
  };
}

export function findDeskChangePlans(start: number, end: number, busy: BusyRecord[]): DeskChangePlan[] {
  const duration = end - start;
  if (duration < 2 * 60 * 60 * 1000) return [];
  if (DESK_RESOURCE_IDS.some((resourceId) => !resourceConflicts(resourceId, start, end, busy))) return [];

  const candidates: Array<DeskChangePlan & { minSegmentMs: number; firstSegmentMs: number }> = [];
  for (let changeAt = start + 60 * 60 * 1000; changeAt <= end - 60 * 60 * 1000; changeAt += INCREMENT_MS) {
    for (const firstResourceId of DESK_RESOURCE_IDS) {
      if (resourceConflicts(firstResourceId, start, changeAt, busy)) continue;
      for (const secondResourceId of DESK_RESOURCE_IDS) {
        if (secondResourceId === firstResourceId) continue;
        if (resourceConflicts(secondResourceId, changeAt, end, busy)) continue;
        const firstSegmentMs = changeAt - start;
        const secondSegmentMs = end - changeAt;
        candidates.push({
          planId: `${firstResourceId}:${changeAt}:${secondResourceId}`,
          kind: "desk_change",
          changeAt,
          segments: [
            deskSegment(firstResourceId, start, changeAt),
            deskSegment(secondResourceId, changeAt, end),
          ],
          minSegmentMs: Math.min(firstSegmentMs, secondSegmentMs),
          firstSegmentMs,
        });
      }
    }
  }

  candidates.sort((a, b) => (
    b.minSegmentMs - a.minSegmentMs
    || b.firstSegmentMs - a.firstSegmentMs
    || a.planId.localeCompare(b.planId)
  ));

  const chosen: DeskChangePlan[] = [];
  const usedPairs = new Set<string>();
  for (const candidate of candidates) {
    const pairKey = `${candidate.segments[0].resourceId}:${candidate.segments[1].resourceId}`;
    if (usedPairs.has(pairKey)) continue;
    usedPairs.add(pairKey);
    chosen.push({
      planId: candidate.planId,
      kind: candidate.kind,
      changeAt: candidate.changeAt,
      segments: candidate.segments,
    });
    if (chosen.length >= 3) break;
  }
  return chosen;
}

export function resolveChoice(
  input: { resourceId?: string; deskChangePlanId?: string },
  start: number,
  end: number,
  busy: BusyRecord[],
): BookingChoice {
  if (input.deskChangePlanId) {
    const plan = findDeskChangePlans(start, end, busy).find(
      (candidate) => candidate.planId === input.deskChangePlanId,
    );
    if (!plan) {
      throw new HttpsError(
        "failed-precondition",
        "That desk-change option is no longer available. Check availability again.",
      );
    }
    return {
      kind: "desk_change",
      resourceId: FLEX_RESOURCE_ID,
      resourceName: `${plan.segments[0].resourceName} → ${plan.segments[1].resourceName}`,
      resourceType: "SEAT",
      planId: plan.planId,
      segments: plan.segments,
    };
  }

  const resourceId = input.resourceId || "";
  const resource = RESOURCE_CONFIG[resourceId];
  if (!resource) throw new HttpsError("not-found", "Space not found.");
  if (resourceConflicts(resourceId, start, end, busy)) {
    throw new HttpsError("failed-precondition", "That option is no longer available.");
  }
  return {
    kind: "single",
    resourceId,
    resourceName: resource.name,
    resourceType: resource.type,
  };
}

export function activeUsageReservations(
  reservations: Record<string, UsageReservation> | undefined,
  now = Date.now(),
) {
  return Object.fromEntries(
    Object.entries(reservations || {}).filter(([, reservation]) => reservation.expiresAt > now),
  ) as Record<string, UsageReservation>;
}

export function activeCreditReservations(
  reservations: Record<string, CreditReservation> | undefined,
  now = Date.now(),
) {
  return Object.fromEntries(
    Object.entries(reservations || {}).filter(([, reservation]) => reservation.expiresAt > now),
  ) as Record<string, CreditReservation>;
}

export function reservedHours(reservations: Record<string, UsageReservation>) {
  return Object.values(reservations).reduce(
    (sum, reservation) => sum + Math.max(0, reservation.hours),
    0,
  );
}

export function reservedCreditCents(reservations: Record<string, CreditReservation>) {
  return Object.values(reservations).reduce(
    (sum, reservation) => sum + Math.max(0, Math.round(reservation.amountCents)),
    0,
  );
}

export function hoursFromBookingDocs(
  docs: FirebaseFirestore.QueryDocumentSnapshot[],
  monthKey: string,
) {
  return docs.reduce((sum, doc) => {
    const booking = doc.data();
    if (booking.status === "CANCELLED" || localMonthKey(booking.start) !== monthKey) return sum;
    const isSeat = RESOURCE_CONFIG[booking.resourceId]?.type === "SEAT" || booking.resourceId === FLEX_RESOURCE_ID;
    if (!isSeat) return sum;
    const explicitlyApplied = Number(booking.includedHoursApplied);
    if (Number.isFinite(explicitlyApplied)) return sum + Math.max(0, explicitlyApplied);
    return sum + Math.max(0, (booking.end - booking.start) / 3_600_000);
  }, 0);
}

export async function getMembershipUsageState(uid: string, monthKey: string) {
  const usageRef = db().collection("membershipUsage").doc(`${uid}_${monthKey}`);
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

export function guestSeatSubtotal(durationHours: number) {
  return Math.min(
    Math.round(durationHours * GUEST_HOURLY_RATE_CENTS),
    GUEST_DAILY_CAP_CENTS,
  );
}

export async function quoteForChoice(
  choice: BookingChoice,
  start: number,
  end: number,
  uid?: string,
): Promise<BookingQuote> {
  validateWindow(start, end);
  await enforceBookingHorizon(start, uid);

  const durationHours = (end - start) / 3_600_000;
  let includedHoursRemaining = 0;
  let includedHoursApplied = 0;
  let billableHours = durationHours;
  const pricingResourceId = choice.kind === "desk_change"
    ? choice.segments[0].resourceId
    : choice.resourceId;
  const pricingResource = RESOURCE_CONFIG[pricingResourceId];
  if (!pricingResource) throw new HttpsError("not-found", "Space not found.");

  let hourlyRateCents = pricingResource.guestRateHourlyCents;
  let membershipName: string | null = null;
  let user: FirebaseFirestore.DocumentData | undefined;
  if (uid) user = (await db().collection("users").doc(uid).get()).data();

  if (uid && user && choice.resourceType === "SEAT" && user.membershipStatus === "active" && user.plan) {
    const tier = getDeskMembershipTierById(user.plan);
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
  if (choice.resourceType === "SEAT" && !membershipName) {
    const uncapped = Math.round(durationHours * GUEST_HOURLY_RATE_CENTS);
    subtotalCents = Math.min(uncapped, GUEST_DAILY_CAP_CENTS);
    hourlyRateCents = GUEST_HOURLY_RATE_CENTS;
    billableHours = durationHours;
    dailyCapApplied = uncapped >= GUEST_DAILY_CAP_CENTS;
  }

  const creditReservations = activeCreditReservations(user?.accountCreditReservations);
  const accountCreditAvailableCents = uid
    ? Math.max(0, Math.round(Number(user?.accountCreditCents || 0)) - reservedCreditCents(creditReservations))
    : 0;
  const accountCreditAppliedCents = Math.min(subtotalCents, accountCreditAvailableCents);

  return {
    resourceId: choice.resourceId,
    resourceName: choice.resourceName,
    resourceType: choice.resourceType,
    bookingKind: choice.kind,
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
    totalCents: Math.max(0, subtotalCents - accountCreditAppliedCents),
    dailyCapApplied,
    currency: "usd",
    ...(choice.kind === "desk_change" ? {
      deskChangePlanId: choice.planId,
      segments: choice.segments,
    } : {}),
  };
}
