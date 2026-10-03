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
  /** Ellipse furniture, such as the round table, is drawn from the same box. */
  shape?: "rect" | "ellipse";
  /** Groups pieces the conference arrangement moves together. */
  role?: string;
  /** Where a conference table sits once the room is in conference mode. */
  conferenceX?: number;
  conferenceY?: number;
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
  id?: string;
  type: string;
  resourceId?: string;
  label?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  visible?: boolean;
  fill?: string;
  meta?: {
    role?: string;
    shape?: string;
    conferenceX?: number;
    conferenceY?: number;
    [key: string]: unknown;
  };
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

const FURNITURE_ELEMENT_TYPES = new Set([
  "FURNITURE",
  "AMENITY",
  "RECEPTION",
  "MODE_ZONE",
  "SIGNAGE",
]);

export function furnitureFromLayoutElements(elements: LayoutElementLike[]): FloorShape[] {
  const furniture: FloorShape[] = [];
  for (const element of elements) {
    if (!FURNITURE_ELEMENT_TYPES.has(element.type)) continue;
    if (element.visible === false) continue;
    const role = typeof element.meta?.role === "string" ? element.meta.role : undefined;
    const shape = element.meta?.shape === "ellipse" ? "ellipse" : "rect";
    furniture.push({
      id: element.id || element.resourceId || `${element.type}-${furniture.length}`,
      type: element.type,
      label: element.label,
      resourceId: element.resourceId,
      x: element.x,
      y: element.y,
      width: element.width && element.width > 0 ? element.width : 80,
      height: element.height && element.height > 0 ? element.height : 60,
      rotation: element.rotation ?? 0,
      fill: element.fill,
      shape,
      role,
      conferenceX: typeof element.meta?.conferenceX === "number" ? element.meta.conferenceX : undefined,
      conferenceY: typeof element.meta?.conferenceY === "number" ? element.meta.conferenceY : undefined,
    });
  }
  return furniture;
}

export function layoutHasOfficeDesks(elements: Array<{ type: string; resourceId?: string }>) {
  const ids = new Set(
    elements
      .filter((element) => element.type === "SEAT" || element.type === "DESK")
      .map((element) => element.resourceId),
  );
  return ["seat-1", "seat-2", "seat-3", "seat-4"].every((resourceId) => ids.has(resourceId));
}

export function shellHasOfficeRoom(elements: Array<{ type: string; label?: string }>) {
  return elements.some((element) => element.type === "ROOM" && /office/i.test(element.label || ""));
}

function chair(id: string, x: number, y: number, width: number, height: number): FloorShape {
  return {
    id,
    type: "FURNITURE",
    label: "",
    x,
    y,
    width,
    height,
    rotation: 0,
    fill: "#94a3b8",
    role: "conference-chair",
  };
}

function chairsAroundTable(table: FloorShape): FloorShape[] {
  const width = 44;
  const depth = 30;
  const gap = 12;
  const count = 4;
  const chairs: FloorShape[] = [];
  const span = table.width - 72;
  for (let index = 0; index < count; index += 1) {
    const x = table.x + 36 + (span * index) / (count - 1) - width / 2;
    chairs.push(chair(`conference-chair-n-${index}`, x, table.y - depth - gap, width, depth));
    chairs.push(chair(`conference-chair-s-${index}`, x, table.y + table.height + gap, width, depth));
  }
  const sideY = table.y + table.height / 2 - width / 2;
  chairs.push(chair("conference-chair-w", table.x - depth - gap, sideY, depth, width));
  chairs.push(chair("conference-chair-e", table.x + table.width + gap, sideY, depth, width));
  return chairs;
}

/** Pull the modular conference table into the middle of the open room and seat it. */
export function withConferenceArrangement(furniture: FloorShape[]): FloorShape[] {
  const table = furniture.find((piece) => piece.role === "conference-table");
  if (!table || table.conferenceX == null || table.conferenceY == null) return furniture;
  const movedTable: FloorShape = {
    ...table,
    x: table.conferenceX,
    y: table.conferenceY,
  };
  const pad = 52;
  return [
    ...furniture
      .filter((piece) => piece.role !== "conference-chair")
      .map((piece) => {
        if (piece.role === "conference-table") return movedTable;
        if (piece.role === "conference-zone") {
          return {
            ...piece,
            x: movedTable.x - pad,
            y: movedTable.y - pad,
            width: movedTable.width + pad * 2,
            height: movedTable.height + pad * 2,
          };
        }
        return piece;
      }),
    ...chairsAroundTable(movedTable),
  ];
}

/**
 * Carrollton office, traced from the 1,050 sq. ft. architectural plan.
 * The storefront is the bottom edge. Desk 4 through Desk 1 run left to right.
 * Coordinates match `public/floor/carrollton-1050-plan.png`.
 */
export function defaultCoworkingFloor(): {
  planId: "carrollton-1050";
  canvasWidth: number;
  canvasHeight: number;
  backgroundPath: string;
  shell: FloorShape[];
  furniture: FloorShape[];
  seats: FloorSeat[];
} {
  const wall = "#334155";
  const shell: FloorShape[] = [
    { id: "room-open", type: "ROOM", label: "", x: 49, y: 60, width: 989, height: 936, rotation: 0, fill: "rgba(255,255,255,0.2)" },
    { id: "room-storage", type: "ROOM", label: "To Storage", x: 1038, y: 60, width: 598, height: 148, rotation: 0, fill: "rgba(226,232,240,0.55)" },
    { id: "room-office", type: "ROOM", label: "Office", x: 1038, y: 208, width: 598, height: 302, rotation: 0, fill: "rgba(224,231,255,0.55)" },
    { id: "room-customers", type: "ROOM", label: "Customers", x: 1038, y: 510, width: 598, height: 486, rotation: 0, fill: "rgba(241,245,249,0.72)" },
    { id: "wall-north", type: "WALL", x: 49, y: 60, width: 1587, height: 14, rotation: 0, fill: wall },
    { id: "wall-south", type: "WALL", label: "Storefront", x: 49, y: 982, width: 1587, height: 14, rotation: 0, fill: wall },
    { id: "wall-west", type: "WALL", x: 49, y: 60, width: 14, height: 936, rotation: 0, fill: wall },
    { id: "wall-east", type: "WALL", x: 1622, y: 60, width: 14, height: 936, rotation: 0, fill: wall },
    { id: "wall-partition", type: "WALL", x: 1038, y: 60, width: 14, height: 936, rotation: 0, fill: wall },
    { id: "wall-storage", type: "WALL", x: 1038, y: 208, width: 598, height: 12, rotation: 0, fill: wall },
    { id: "wall-office", type: "WALL", x: 1038, y: 510, width: 598, height: 12, rotation: 0, fill: wall },
    { id: "window-storefront", type: "WINDOW", x: 300, y: 984, width: 720, height: 10, rotation: 0, fill: "#7dd3fc" },
    { id: "door-storefront", type: "DOOR", label: "Storefront", x: 130, y: 978, width: 130, height: 18, rotation: 0, fill: "#818cf8" },
    { id: "door-office", type: "DOOR", label: "Office", x: 1032, y: 300, width: 22, height: 86, rotation: 0, fill: "#818cf8" },
    { id: "door-customers", type: "DOOR", label: "Customers", x: 1032, y: 640, width: 22, height: 96, rotation: 0, fill: "#818cf8" },
    { id: "door-storage", type: "DOOR", label: "To Storage", x: 1280, y: 54, width: 120, height: 20, rotation: 0, fill: "#818cf8" },
  ];

  const seats: FloorSeat[] = [
    { resourceId: "seat-4", label: "Desk 4", x: 306, y: 870, width: 168, height: 86 },
    { resourceId: "seat-3", label: "Desk 3", x: 490, y: 870, width: 168, height: 86 },
    { resourceId: "seat-2", label: "Desk 2", x: 670, y: 870, width: 176, height: 86 },
    { resourceId: "seat-1", label: "Desk 1", x: 862, y: 870, width: 168, height: 86 },
  ];

  const furniture: FloorShape[] = [
    {
      id: "zone-conference",
      type: "MODE_ZONE",
      label: "Conference",
      resourceId: "mode-conference",
      x: 380,
      y: 370,
      width: 360,
      height: 140,
      rotation: 0,
      fill: "rgba(191,219,254,0.35)",
      role: "conference-zone",
    },
    { id: "ref", type: "FURNITURE", label: "Ref", x: 105, y: 95, width: 100, height: 110, rotation: 0, fill: "#e2e8f0" },
    {
      id: "round-table",
      type: "FURNITURE",
      label: "Round table · 5' radius",
      x: 430,
      y: 90,
      width: 300,
      height: 190,
      rotation: 0,
      fill: "#f8fafc",
      shape: "ellipse",
    },
    { id: "work-nook", type: "FURNITURE", label: "Work nook", x: 790, y: 110, width: 200, height: 90, rotation: 0, fill: "#f1f5f9" },
    { id: "tv", type: "FURNITURE", label: "Flat Screen TV", x: 450, y: 308, width: 260, height: 26, rotation: 0, fill: "#0f172a" },
    {
      id: "conference-table",
      type: "FURNITURE",
      label: "Conference table",
      x: 380,
      y: 370,
      width: 360,
      height: 140,
      rotation: 0,
      fill: "#dbeafe",
      role: "conference-table",
      conferenceX: 364,
      conferenceY: 458,
    },
    { id: "open-chair-1", type: "FURNITURE", x: 430, y: 522, width: 48, height: 28, rotation: 0, fill: "#94a3b8", role: "conference-chair" },
    { id: "open-chair-2", type: "FURNITURE", x: 536, y: 522, width: 48, height: 28, rotation: 0, fill: "#94a3b8", role: "conference-chair" },
    { id: "open-chair-3", type: "FURNITURE", x: 642, y: 522, width: 48, height: 28, rotation: 0, fill: "#94a3b8", role: "conference-chair" },
    { id: "reception", type: "FURNITURE", label: "Reception Station", x: 94, y: 584, width: 150, height: 186, rotation: 0, fill: "#e0e7ff" },
    { id: "print", type: "FURNITURE", label: "Print Station", x: 906, y: 522, width: 122, height: 122, rotation: 0, fill: "#fef3c7" },
    { id: "counter-32", type: "FURNITURE", label: "32\" counter", x: 1100, y: 560, width: 460, height: 40, rotation: 0, fill: "#cbd5e1" },
    { id: "counter-42", type: "FURNITURE", label: "42\" counter", x: 1100, y: 630, width: 460, height: 44, rotation: 0, fill: "#94a3b8" },
  ];

  return {
    planId: "carrollton-1050",
    canvasWidth: 1690,
    canvasHeight: 1060,
    backgroundPath: "/floor/carrollton-1050-plan.png",
    shell,
    furniture,
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
