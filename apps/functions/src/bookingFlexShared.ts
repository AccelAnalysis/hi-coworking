import { HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  CONFERENCE_ROOM_SLOT_HOURS,
  CONFERENCE_ROOM_SLOT_PRICE_CENTS,
  CONFERENCE_SLOT_MESSAGE,
  DESK_SEAT_TIERS,
  GUEST_BOOKING_WINDOW_DAYS,
  type ConferenceSlotId,
  type MembershipTier,
  getDeskMembershipTierById,
  getTierById,
} from "./payments/stripeConfig";
import {
  conferenceSlotFor,
  deskPricingPlanFor,
  priceDeskSegments,
  pricePrivateOffice,
  type DeskCapApplied,
  type DeskPricingSegment,
} from "./payments/deskPricing";
import {
  PRIVATE_OFFICE_RESOURCE_ID,
  isPrivateOfficeResource,
} from "./payments/stripeConfig";
import {
  BOOKING_CLOSE_HOUR,
  BOOKING_HOURS_MESSAGE,
  BOOKING_OPEN_DAYS,
  BOOKING_OPEN_HOUR,
  bookingHoursViolation,
} from "./bookingOperatingCalendar";

if (admin.apps.length === 0) admin.initializeApp();

export const HOLD_MS = 15 * 60 * 1000;
// Monday to Friday, 8 AM to 5 PM facility time (see bookingOperatingCalendar).
export const OPEN_HOUR = BOOKING_OPEN_HOUR;
export const CLOSE_HOUR = BOOKING_CLOSE_HOUR;
export const OPEN_DAYS = BOOKING_OPEN_DAYS;
export const HOURS_MESSAGE = BOOKING_HOURS_MESSAGE;
export const INCREMENT_MS = 30 * 60 * 1000;
export const LOCATION_TIME_ZONE = "America/New_York";
export const DAY_MS = 24 * 60 * 60 * 1000;
export const FLEX_RESOURCE_ID = "seat-flex";
export const RESCHEDULE_LOCK_END = Date.UTC(2100, 0, 1);

/**
 * Seat guest rates follow the D1–D6 tier ladder (DESK_SEAT_TIERS). The
 * conference room is a flat $249 weekday 4-hour slot; its hourly figure is
 * only the slot price spread over 4 hours, for display.
 */
export type BookableResourceType = "SEAT" | "MODE" | "ROOM";

export const RESOURCE_CONFIG: Record<string, {
  name: string;
  type: BookableResourceType;
  guestRateHourlyCents: number;
  exclusiveGroupId: string;
  blocksResourceIds?: readonly string[];
}> = {
  "seat-1": { name: "Desk 1", type: "SEAT", guestRateHourlyCents: DESK_SEAT_TIERS.basic.guestHourlyCents, exclusiveGroupId: "main_space", blocksResourceIds: [PRIVATE_OFFICE_RESOURCE_ID] },
  "seat-2": { name: "Desk 2", type: "SEAT", guestRateHourlyCents: DESK_SEAT_TIERS.basic.guestHourlyCents, exclusiveGroupId: "main_space" },
  "seat-3": { name: "Desk 3", type: "SEAT", guestRateHourlyCents: DESK_SEAT_TIERS.window.guestHourlyCents, exclusiveGroupId: "main_space" },
  "seat-4": { name: "Desk 4", type: "SEAT", guestRateHourlyCents: DESK_SEAT_TIERS.window.guestHourlyCents, exclusiveGroupId: "main_space" },
  "seat-5": { name: "Desk 5", type: "SEAT", guestRateHourlyCents: DESK_SEAT_TIERS.equipped.guestHourlyCents, exclusiveGroupId: "main_space" },
  "seat-6": { name: "Desk 6", type: "SEAT", guestRateHourlyCents: DESK_SEAT_TIERS.equipped.guestHourlyCents, exclusiveGroupId: "main_space" },
  [PRIVATE_OFFICE_RESOURCE_ID]: {
    name: "Private Office",
    type: "ROOM",
    guestRateHourlyCents: 3900,
    exclusiveGroupId: "private_office",
    blocksResourceIds: ["seat-1", "mode-conference"],
  },
  "mode-conference": {
    name: "Meeting setup",
    type: "MODE",
    guestRateHourlyCents: Math.round(CONFERENCE_ROOM_SLOT_PRICE_CENTS / CONFERENCE_ROOM_SLOT_HOURS),
    exclusiveGroupId: "main_space",
    blocksResourceIds: [PRIVATE_OFFICE_RESOURCE_ID],
  },
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
  /** Evening/weekend conference reservations do not displace weekday desks. */
  afterHours?: boolean;
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
  | { kind: "single"; resourceId: string; resourceName: string; resourceType: BookableResourceType }
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
  resourceType: BookableResourceType;
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
  /** True when a half-day or day cap lowered the price. */
  dailyCapApplied: boolean;
  /** Which cap applied, if any. */
  capApplied?: DeskCapApplied;
  /** Per-segment desk pricing (one entry, or two for a desk change). */
  segmentPricing?: DeskPricingSegment[];
  /** Weekday conference slot, for meeting-room bookings. */
  conferenceSlot?: ConferenceSlotId;
  currency: string;
  deskChangePlanId?: string;
  segments?: [DeskSegment, DeskSegment];
};

export type ChoicePricing = Pick<
  BookingQuote,
  | "membershipName"
  | "includedHoursRemaining"
  | "includedHoursApplied"
  | "billableHours"
  | "hourlyRateCents"
  | "subtotalCents"
  | "dailyCapApplied"
  | "capApplied"
  | "segmentPricing"
  | "conferenceSlot"
>;

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

/** Facility-local minutes after midnight. */
export function localMinutes(timestamp: number) {
  const value = localClock(timestamp);
  return value.hour * 60 + value.minute;
}

/** Weekday conference slot for this window, or a clear error for anything else. */
export function requireConferenceSlot(start: number, end: number): ConferenceSlotId {
  const endMinutes = localMinutes(end) || 24 * 60;
  const slot = conferenceSlotFor(localMinutes(start), endMinutes);
  if (!slot) throw new HttpsError("invalid-argument", CONFERENCE_SLOT_MESSAGE);
  return slot;
}


/** Convert a facility-local YYYY-MM-DD and HH:MM (or 24:00) to a UTC timestamp. */
export function facilityWallTimeToTimestamp(dateValue: string, timeValue: string) {
  const normalized = timeValue === "24:00" ? "00:00" : timeValue;
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = normalized.split(":").map(Number);
  const dayOffset = timeValue === "24:00" ? 1 : 0;
  const targetAsUtc = Date.UTC(year, month - 1, day + dayOffset, hour, minute, 0, 0);
  let guess = targetAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const values = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: LOCATION_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const observedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      0,
      0,
    );
    guess += targetAsUtc - observedAsUtc;
  }
  return guess;
}

export function fullDayWindowForDate(dateValue: string) {
  return {
    start: facilityWallTimeToTimestamp(dateValue, "08:00"),
    end: facilityWallTimeToTimestamp(dateValue, "17:00"),
  };
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
  const hoursViolation = bookingHoursViolation(start, end);
  if (hoursViolation) throw new HttpsError("failed-precondition", hoursViolation);
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
    if (["CANCELLED", "EXPIRED", "CONSUMED", "DECLINED"].includes(String(record.status || ""))) return false;
    if (record.resourceId === resourceId) return true;
    const other = RESOURCE_CONFIG[record.resourceId];
    if (!other) return false;
    // Evening/weekend conference is by appointment and does not displace desks
    // or the private office. It only conflicts with other conference use.
    if (record.afterHours && other.type === "MODE") return false;
    if (target.type === "MODE" && record.afterHours) return resourceId === "mode-conference" && record.resourceId === "mode-conference";
    const blocked = (target.blocksResourceIds || []).includes(record.resourceId)
      || (other.blocksResourceIds || []).includes(resourceId);
    if (blocked) return true;
    if (other.exclusiveGroupId !== target.exclusiveGroupId) return false;
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

export function findDeskChangePlans(
  start: number,
  end: number,
  busy: BusyRecord[],
  allowedResourceIds: readonly string[] = DESK_RESOURCE_IDS,
): DeskChangePlan[] {
  const desks = DESK_RESOURCE_IDS.filter((resourceId) => allowedResourceIds.includes(resourceId));
  const duration = end - start;
  if (duration < 2 * 60 * 60 * 1000) return [];
  if (desks.some((resourceId) => !resourceConflicts(resourceId, start, end, busy))) return [];

  const candidates: Array<DeskChangePlan & { minSegmentMs: number; firstSegmentMs: number }> = [];
  for (let changeAt = start + 60 * 60 * 1000; changeAt <= end - 60 * 60 * 1000; changeAt += INCREMENT_MS) {
    for (const firstResourceId of desks) {
      if (resourceConflicts(firstResourceId, start, changeAt, busy)) continue;
      for (const secondResourceId of desks) {
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
  allowedDeskIds?: readonly string[],
): BookingChoice {
  if (input.deskChangePlanId) {
    const plan = findDeskChangePlans(start, end, busy, allowedDeskIds).find(
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

/** Desk segments a choice occupies, with hours, for pricing. */
export function pricingSegmentsForChoice(choice: BookingChoice, start: number, end: number) {
  if (choice.kind === "desk_change") {
    return choice.segments.map((segment) => ({
      resourceId: segment.resourceId,
      hours: (segment.end - segment.start) / 3_600_000,
    }));
  }
  return [{ resourceId: choice.resourceId, hours: (end - start) / 3_600_000 }];
}

/**
 * Price a resolved choice. Desk tiers, included-hour eligibility and the
 * half-day / day caps come from payments/deskPricing; the conference room is a
 * flat weekday slot. `membershipTier` is the active desk plan (Member / Plus),
 * or undefined for guests and SayHi Connect.
 */
export function priceChoice(
  choice: BookingChoice,
  start: number,
  end: number,
  options: { membershipTier?: MembershipTier; includedHoursRemaining?: number } = {},
): ChoicePricing {
  if (isPrivateOfficeResource(choice.resourceId) || choice.resourceType === "ROOM") {
    const priced = pricePrivateOffice((end - start) / 3_600_000);
    return {
      membershipName: null,
      includedHoursRemaining: 0,
      includedHoursApplied: 0,
      billableHours: priced.billableHours,
      hourlyRateCents: priced.hourlyRateCents,
      subtotalCents: priced.subtotalCents,
      dailyCapApplied: priced.capApplied !== null,
      capApplied: priced.capApplied,
    };
  }
  if (choice.resourceType === "MODE") {
    const conferenceSlot = requireConferenceSlot(start, end);
    return {
      membershipName: null,
      includedHoursRemaining: 0,
      includedHoursApplied: 0,
      billableHours: (end - start) / 3_600_000,
      hourlyRateCents: RESOURCE_CONFIG[choice.resourceId]?.guestRateHourlyCents ?? 0,
      subtotalCents: CONFERENCE_ROOM_SLOT_PRICE_CENTS,
      dailyCapApplied: false,
      capApplied: null,
      conferenceSlot,
    };
  }
  const tier = options.membershipTier;
  const includedHoursRemaining = tier ? Math.max(0, options.includedHoursRemaining || 0) : 0;
  const priced = priceDeskSegments({
    plan: deskPricingPlanFor(tier?.id),
    segments: pricingSegmentsForChoice(choice, start, end),
    includedHoursRemaining,
  });
  return {
    membershipName: tier?.name ?? null,
    includedHoursRemaining,
    includedHoursApplied: priced.includedHoursApplied,
    billableHours: priced.billableHours,
    hourlyRateCents: priced.hourlyRateCents,
    subtotalCents: priced.subtotalCents,
    dailyCapApplied: priced.capApplied !== null,
    capApplied: priced.capApplied,
    segmentPricing: priced.segments,
  };
}

/** Checkout line description, e.g. "D3 · Window sit-stand · 4 hours (half-day price)". */
export function checkoutLineLabel(quote: BookingQuote) {
  const hours = `${quote.durationHours} hour${quote.durationHours === 1 ? "" : "s"}`;
  if (quote.resourceType === "MODE") {
    const slot = quote.conferenceSlot === "afternoon" ? "Afternoon 1–5 PM" : "Morning 8 AM–12 PM";
    return `Conference room · ${slot} · 4-hour slot`;
  }
  if (quote.resourceType === "ROOM" || isPrivateOfficeResource(quote.resourceId)) {
    const cap = quote.capApplied === "half_day"
      ? " (half-day price)"
      : quote.capApplied === "day" ? " (day price)" : "";
    return `Private Office · ${hours}${cap}`;
  }
  const cap = quote.capApplied === "half_day"
    ? " (half-day price)"
    : quote.capApplied === "day" ? " (day price)" : "";
  return `${quote.resourceName} · ${hours}${cap}`;
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
  const pricingResourceId = choice.kind === "desk_change"
    ? choice.segments[0].resourceId
    : choice.resourceId;
  if (!RESOURCE_CONFIG[pricingResourceId]) throw new HttpsError("not-found", "Space not found.");

  let user: FirebaseFirestore.DocumentData | undefined;
  if (uid) user = (await db().collection("users").doc(uid).get()).data();

  let membershipTier: MembershipTier | undefined;
  let includedHoursRemaining = 0;
  if (uid && user && choice.resourceType === "SEAT" && user.membershipStatus === "active" && user.plan) {
    membershipTier = getDeskMembershipTierById(user.plan);
    if (membershipTier) {
      const usage = await getMembershipUsageState(uid, localMonthKey(start));
      includedHoursRemaining = Math.max(
        0,
        membershipTier.includedHoursPerMonth - usage.usedHours - reservedHours(usage.reservations),
      );
    }
  }

  const pricing = priceChoice(choice, start, end, { membershipTier, includedHoursRemaining });
  const subtotalCents = pricing.subtotalCents;

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
    ...pricing,
    accountCreditAvailableCents,
    accountCreditAppliedCents,
    totalCents: Math.max(0, subtotalCents - accountCreditAppliedCents),
    currency: "usd",
    ...(choice.kind === "desk_change" ? {
      deskChangePlanId: choice.planId,
      segments: choice.segments,
    } : {}),
  };
}
