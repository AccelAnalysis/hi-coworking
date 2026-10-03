/**
 * Customer booking selection and membership price math.
 * Pure functions so the floor plan, both selection orders, and checkout
 * amounts can be tested without Firebase.
 */

export const ANNUAL_MONTHS_BILLED = 10;
export const BOOKING_STEP_MS = 30 * 60 * 1000;
export const MIN_DESK_CHANGE_SEGMENT_MS = 60 * 60 * 1000;

export type BillingInterval = "month" | "year";

export type OccupancyInterval = {
  resourceId: string;
  start: number;
  end: number;
};

export type TimeWindow = {
  start: number;
  end: number;
};

export type FloorSeat = {
  resourceId: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
};

export type FloorShape = {
  id: string;
  type: string;
  label?: string;
  resourceId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  fill?: string;
};

export type SeatChangeSegment = {
  resourceId: string;
  resourceName: string;
  start: number;
  end: number;
};

export type SeatChangePlan = {
  planId: string;
  kind: "desk_change";
  changeAt: number;
  segments: [SeatChangeSegment, SeatChangeSegment];
};

export type NamedSeat = {
  resourceId: string;
  name: string;
};

export type BookingResolution =
  | { kind: "single"; resourceId: string; resourceName: string }
  | { kind: "desk_change"; plan: SeatChangePlan }
  | { kind: "unavailable" };

export type LayoutElementLike = {
  type: string;
  resourceId?: string;
  label?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  visible?: boolean;
};

const KNOWN_BOOKABLE_SEATS = ["seat-1", "seat-2", "seat-3", "seat-4", "seat-5", "seat-6"] as const;

export function isKnownBookableSeat(resourceId: string) {
  return (KNOWN_BOOKABLE_SEATS as readonly string[]).includes(resourceId);
}

export function membershipChargeCents(monthlyAmountCents: number, interval: BillingInterval) {
  if (!Number.isFinite(monthlyAmountCents) || monthlyAmountCents < 0) {
    throw new Error("Monthly amount must be a non-negative number of cents.");
  }
  if (interval === "month") return Math.round(monthlyAmountCents);
  if (interval === "year") return Math.round(monthlyAmountCents) * ANNUAL_MONTHS_BILLED;
  throw new Error(`Unsupported billing interval: ${interval}`);
}

export function annualSavingsCents(monthlyAmountCents: number) {
  return Math.round(monthlyAmountCents) * 12 - membershipChargeCents(monthlyAmountCents, "year");
}

export function overlaps(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}

export function resourceConflicts(
  resourceId: string,
  start: number,
  end: number,
  busy: OccupancyInterval[],
) {
  return busy.some((record) => (
    record.resourceId === resourceId
    && overlaps(start, end, record.start, record.end)
  ));
}

export function seatsFromLayoutElements(elements: LayoutElementLike[]): FloorSeat[] {
  const seen = new Set<string>();
  const seats: FloorSeat[] = [];
  for (const element of elements) {
    if (element.type !== "SEAT" && element.type !== "DESK") continue;
    if (element.visible === false) continue;
    const resourceId = element.resourceId?.trim();
    if (!resourceId || seen.has(resourceId)) continue;
    seen.add(resourceId);
    seats.push({
      resourceId,
      label: element.label?.trim() || resourceId,
      x: element.x,
      y: element.y,
      width: element.width && element.width > 0 ? element.width : 120,
      height: element.height && element.height > 0 ? element.height : 100,
      rotation: element.rotation,
    });
  }
  return seats;
}

export function defaultCoworkingFloor(): {
  canvasWidth: number;
  canvasHeight: number;
  shell: FloorShape[];
  seats: FloorSeat[];
} {
  const seats: FloorSeat[] = [
    { resourceId: "seat-1", label: "Seat 1", x: 70, y: 130, width: 200, height: 130 },
    { resourceId: "seat-2", label: "Seat 2", x: 390, y: 130, width: 200, height: 130 },
    { resourceId: "seat-3", label: "Seat 3", x: 710, y: 130, width: 200, height: 130 },
    { resourceId: "seat-4", label: "Seat 4", x: 70, y: 380, width: 200, height: 130 },
    { resourceId: "seat-5", label: "Seat 5", x: 390, y: 380, width: 200, height: 130 },
    { resourceId: "seat-6", label: "Seat 6", x: 710, y: 380, width: 200, height: 130 },
  ];
  return {
    canvasWidth: 980,
    canvasHeight: 640,
    shell: [
      {
        id: "wall-north",
        type: "WALL",
        label: "Front of room",
        x: 40,
        y: 36,
        width: 900,
        height: 18,
        rotation: 0,
        fill: "#cbd5e1",
      },
      {
        id: "door-entry",
        type: "DOOR",
        label: "Entrance",
        x: 430,
        y: 54,
        width: 120,
        height: 28,
        rotation: 0,
        fill: "#818cf8",
      },
    ],
    seats,
  };
}

export function freeBlocksForSeat(
  resourceId: string,
  openWindows: TimeWindow[],
  busy: OccupancyInterval[],
  stepMs = BOOKING_STEP_MS,
): TimeWindow[] {
  const blocks: TimeWindow[] = [];
  for (const window of openWindows) {
    if (window.end <= window.start) continue;
    for (let cursor = window.start; cursor + stepMs <= window.end; cursor += stepMs) {
      const slotEnd = cursor + stepMs;
      if (resourceConflicts(resourceId, cursor, slotEnd, busy)) continue;
      const last = blocks[blocks.length - 1];
      if (last && last.end === cursor) last.end = slotEnd;
      else blocks.push({ start: cursor, end: slotEnd });
    }
  }
  return blocks;
}

export function freeBlocksForSeats(
  resourceIds: string[],
  openWindows: TimeWindow[],
  busy: OccupancyInterval[],
  stepMs = BOOKING_STEP_MS,
) {
  return resourceIds.flatMap((resourceId) => (
    freeBlocksForSeat(resourceId, openWindows, busy, stepMs).map((block) => ({
      resourceId,
      ...block,
    }))
  ));
}

export function seatsAvailableForWindow(
  resourceIds: string[],
  start: number,
  end: number,
  busy: OccupancyInterval[],
) {
  return resourceIds.map((resourceId) => ({
    resourceId,
    available: !resourceConflicts(resourceId, start, end, busy),
  }));
}

function seatSegment(seat: NamedSeat, start: number, end: number): SeatChangeSegment {
  return {
    resourceId: seat.resourceId,
    resourceName: seat.name,
    start,
    end,
  };
}

/**
 * Offer one desk change when no single seat covers the whole stay.
 * Plan ids match the booking function (`resource:changeAt:resource`) so the
 * client can hand the same id to checkout.
 */
export function findSeatChangePlans(
  seats: NamedSeat[],
  start: number,
  end: number,
  busy: OccupancyInterval[],
  stepMs = BOOKING_STEP_MS,
): SeatChangePlan[] {
  const duration = end - start;
  if (duration < 2 * MIN_DESK_CHANGE_SEGMENT_MS) return [];
  if (seats.some((seat) => !resourceConflicts(seat.resourceId, start, end, busy))) return [];

  const candidates: Array<SeatChangePlan & { minSegmentMs: number; firstSegmentMs: number }> = [];
  for (
    let changeAt = start + MIN_DESK_CHANGE_SEGMENT_MS;
    changeAt <= end - MIN_DESK_CHANGE_SEGMENT_MS;
    changeAt += stepMs
  ) {
    for (const first of seats) {
      if (resourceConflicts(first.resourceId, start, changeAt, busy)) continue;
      for (const second of seats) {
        if (second.resourceId === first.resourceId) continue;
        if (resourceConflicts(second.resourceId, changeAt, end, busy)) continue;
        const firstSegmentMs = changeAt - start;
        const secondSegmentMs = end - changeAt;
        candidates.push({
          planId: `${first.resourceId}:${changeAt}:${second.resourceId}`,
          kind: "desk_change",
          changeAt,
          segments: [seatSegment(first, start, changeAt), seatSegment(second, changeAt, end)],
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

  const chosen: SeatChangePlan[] = [];
  const usedPairs = new Set<string>();
  for (const candidate of candidates) {
    const pairKey = `${candidate.segments[0].resourceId}:${candidate.segments[1].resourceId}`;
    if (usedPairs.has(pairKey)) continue;
    usedPairs.add(pairKey);
    chosen.push({
      planId: candidate.planId,
      kind: "desk_change",
      changeAt: candidate.changeAt,
      segments: candidate.segments,
    });
    if (chosen.length >= 3) break;
  }
  return chosen;
}

function firstContinuous(seats: NamedSeat[], start: number, end: number, busy: OccupancyInterval[]) {
  return seats.find((seat) => !resourceConflicts(seat.resourceId, start, end, busy));
}

function singleSeat(seat: NamedSeat): BookingResolution {
  return { kind: "single", resourceId: seat.resourceId, resourceName: seat.name };
}

/**
 * Seats-first and times-first both end here.
 * A seat that is free for the whole stay wins. Otherwise the best two-seat
 * plan that covers the requested window is returned instead of rejecting it.
 * Preferred seats are tried first. If they cannot cover the time, any other
 * seat on the floor can.
 */
export function resolveBookingSelection(input: {
  seats: NamedSeat[];
  preferredSeatIds?: string[];
  start: number;
  end: number;
  busy: OccupancyInterval[];
}): BookingResolution {
  const { start, end, busy } = input;
  if (!(end > start) || input.seats.length === 0) return { kind: "unavailable" };

  const preferred = (input.preferredSeatIds || [])
    .map((resourceId) => input.seats.find((seat) => seat.resourceId === resourceId))
    .filter((seat): seat is NamedSeat => Boolean(seat));

  const preferredContinuous = firstContinuous(preferred, start, end, busy);
  if (preferredContinuous) return singleSeat(preferredContinuous);

  const anyContinuous = firstContinuous(input.seats, start, end, busy);
  if (anyContinuous) return singleSeat(anyContinuous);

  const preferredPlans = preferred.length >= 2
    ? findSeatChangePlans(preferred, start, end, busy)
    : [];
  if (preferredPlans[0]) return { kind: "desk_change", plan: preferredPlans[0] };

  const floorPlans = findSeatChangePlans(input.seats, start, end, busy);
  const touchingPreferred = floorPlans.find((plan) => (
    preferred.some((seat) => (
      seat.resourceId === plan.segments[0].resourceId
      || seat.resourceId === plan.segments[1].resourceId
    ))
  ));
  if (touchingPreferred) return { kind: "desk_change", plan: touchingPreferred };
  if (floorPlans[0]) return { kind: "desk_change", plan: floorPlans[0] };

  return { kind: "unavailable" };
}
