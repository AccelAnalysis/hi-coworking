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
  /** Where this seat sits once the modular table is pulled into the room. */
  conferenceX?: number;
  conferenceY?: number;
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
    const conferenceX = typeof element.meta?.conferenceX === "number" ? element.meta.conferenceX : undefined;
    const conferenceY = typeof element.meta?.conferenceY === "number" ? element.meta.conferenceY : undefined;
    seats.push({
      resourceId,
      label: element.label?.trim() || resourceId,
      x: element.x,
      y: element.y,
      width: element.width && element.width > 0 ? element.width : 120,
      height: element.height && element.height > 0 ? element.height : 100,
      rotation: element.rotation,
      ...(conferenceX != null && conferenceY != null ? { conferenceX, conferenceY } : {}),
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
  return ["seat-1", "seat-2", "seat-3", "seat-4", "seat-5", "seat-6"].every((resourceId) => ids.has(resourceId));
}

/** The traced plan has the office, the customer room, and the bathrooms. */
export function shellHasOfficeRoom(elements: Array<{ type: string; label?: string }>) {
  const hasOffice = elements.some((element) => element.type === "ROOM" && /office/i.test(element.label || ""));
  const hasCustomers = elements.some((element) => element.type === "ROOM" && /customer/i.test(element.label || ""));
  const hasBathroom = elements.some((element) => element.type === "BATHROOM");
  return hasOffice && hasCustomers && hasBathroom;
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
  const chairs: FloorShape[] = [];
  const span = table.width - 72;
  for (let index = 0; index < 4; index += 1) {
    const x = table.x + 36 + (span * index) / 3 - width / 2;
    chairs.push(chair(`conference-chair-n-${index}`, x, table.y - depth - gap, width, depth));
  }
  // The two bookable table seats occupy the middle of the near side.
  chairs.push(chair("conference-chair-s-0", table.x + 8, table.y + table.height + gap, width, depth));
  chairs.push(chair("conference-chair-s-1", table.x + table.width - width - 8, table.y + table.height + gap, width, depth));
  const sideY = table.y + table.height / 2 - width / 2;
  chairs.push(chair("conference-chair-w", table.x - depth - gap, sideY, depth, width));
  chairs.push(chair("conference-chair-e", table.x + table.width + gap, sideY, depth, width));
  return chairs;
}

/** Move the two conference-table seats onto the centered table. Desks stay put. */
export function seatsForConference(seats: FloorSeat[]): FloorSeat[] {
  return seats.map((seat) => (
    seat.conferenceX == null || seat.conferenceY == null
      ? seat
      : { ...seat, x: seat.conferenceX, y: seat.conferenceY }
  ));
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
 * Coordinates match `public/floor/carrollton-1050-plan.png` (drawing cropped at 350, 160).
 * The storefront is the bottom edge. Desk 4 through Desk 1 run left to right.
 * The two table seats stay at the wall-mounted conference table until conference mode.
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
  const door = "#818cf8";
  const partition = 1035;
  const east = 1636;
  const south = 992;
  const shell: FloorShape[] = [
    { id: "room-open", type: "ROOM", label: "", x: 63, y: 74, width: partition - 63, height: south - 74, rotation: 0, fill: "rgba(255,255,255,0.2)" },
    { id: "room-ref", type: "ROOM", label: "Ref", x: 99, y: 83, width: 163, height: 79, rotation: 0, fill: "rgba(226,232,240,0.9)" },
    { id: "bath-ref", type: "BATHROOM", label: "Bathroom", x: 274, y: 83, width: 78, height: 79, rotation: 0, fill: "rgba(186,230,253,0.72)" },
    { id: "bath-round", type: "BATHROOM", label: "Bathroom", x: 586, y: 83, width: 122, height: 223, rotation: 0, fill: "rgba(186,230,253,0.72)" },
    { id: "room-upper", type: "ROOM", label: "", x: 720, y: 83, width: partition - 720, height: 223, rotation: 0, fill: "rgba(241,245,249,0.45)" },
    { id: "room-storage", type: "ROOM", label: "To Storage", x: partition + 14, y: 74, width: east - partition - 14, height: 136, rotation: 0, fill: "rgba(226,232,240,0.55)" },
    { id: "room-office", type: "ROOM", label: "Office", x: partition + 14, y: 222, width: east - partition - 14, height: 278, rotation: 0, fill: "rgba(224,231,255,0.55)" },
    { id: "room-customers", type: "ROOM", label: "Customers", x: partition + 14, y: 512, width: east - partition - 14, height: 240, rotation: 0, fill: "rgba(241,245,249,0.72)" },
    { id: "room-storefront", type: "ROOM", label: "Storefront", x: partition + 14, y: 764, width: east - partition - 14, height: south - 764, rotation: 0, fill: "rgba(255,251,235,0.55)" },
    { id: "wall-north-open", type: "WALL", x: 49, y: 60, width: partition - 49, height: 14, rotation: 0, fill: wall },
    { id: "wall-north-storage", type: "WALL", x: partition, y: 60, width: 250, height: 14, rotation: 0, fill: wall },
    { id: "wall-north-storage-b", type: "WALL", x: 1405, y: 60, width: east + 14 - 1405, height: 14, rotation: 0, fill: wall },
    { id: "wall-south-open", type: "WALL", x: 49, y: south, width: partition - 49, height: 14, rotation: 0, fill: wall },
    { id: "wall-south-right-a", type: "WALL", x: partition, y: south, width: 98, height: 14, rotation: 0, fill: wall },
    { id: "wall-south-right-b", type: "WALL", x: 1245, y: south, width: east + 14 - 1245, height: 14, rotation: 0, fill: wall },
    { id: "wall-west-a", type: "WALL", x: 49, y: 60, width: 14, height: 410, rotation: 0, fill: wall },
    { id: "wall-west-b", type: "WALL", x: 49, y: 583, width: 14, height: south + 14 - 583, rotation: 0, fill: wall },
    { id: "wall-east", type: "WALL", x: east, y: 60, width: 14, height: south + 14 - 60, rotation: 0, fill: wall },
    { id: "wall-partition-a", type: "WALL", x: partition, y: 60, width: 14, height: 250, rotation: 0, fill: wall },
    { id: "wall-partition-b", type: "WALL", x: partition, y: 396, width: 14, height: 180, rotation: 0, fill: wall },
    { id: "wall-partition-c", type: "WALL", x: partition, y: 680, width: 14, height: south + 14 - 680, rotation: 0, fill: wall },
    { id: "wall-ref-bottom", type: "WALL", x: 99, y: 154, width: 175, height: 10, rotation: 0, fill: wall },
    { id: "wall-ref-right", type: "WALL", x: 262, y: 74, width: 12, height: 90, rotation: 0, fill: wall },
    { id: "wall-bath-ref-bottom", type: "WALL", x: 274, y: 154, width: 90, height: 10, rotation: 0, fill: wall },
    { id: "wall-round-left", type: "WALL", x: 352, y: 74, width: 12, height: 244, rotation: 0, fill: wall },
    { id: "wall-bath-left", type: "WALL", x: 574, y: 74, width: 12, height: 244, rotation: 0, fill: wall },
    { id: "wall-bath-right", type: "WALL", x: 708, y: 74, width: 12, height: 244, rotation: 0, fill: wall },
    { id: "wall-tv", type: "WALL", x: 352, y: 306, width: 222, height: 12, rotation: 0, fill: wall },
    { id: "wall-tv-b", type: "WALL", x: 708, y: 306, width: 40, height: 12, rotation: 0, fill: wall },
    { id: "wall-tv-c", type: "WALL", x: 830, y: 306, width: partition + 14 - 830, height: 12, rotation: 0, fill: wall },
    { id: "wall-storage", type: "WALL", x: partition, y: 210, width: 220, height: 12, rotation: 0, fill: wall },
    { id: "wall-storage-b", type: "WALL", x: 1365, y: 210, width: east + 14 - 1365, height: 12, rotation: 0, fill: wall },
    { id: "wall-office", type: "WALL", x: partition, y: 500, width: east + 14 - partition, height: 12, rotation: 0, fill: wall },
    { id: "wall-customers", type: "WALL", x: partition, y: 752, width: 180, height: 12, rotation: 0, fill: wall },
    { id: "wall-customers-b", type: "WALL", x: 1325, y: 752, width: east + 14 - 1325, height: 12, rotation: 0, fill: wall },
    { id: "window-storefront", type: "WINDOW", x: 180, y: south + 2, width: 780, height: 10, rotation: 0, fill: "#7dd3fc" },
    { id: "door-entrance", type: "DOOR", label: "Entrance", x: 63, y: 508, width: 113, height: 22, rotation: 0, fill: door },
    { id: "door-storefront", type: "DOOR", label: "Storefront", x: 1133, y: south - 4, width: 112, height: 22, rotation: 0, fill: door },
    { id: "door-office", type: "DOOR", label: "Office", x: partition - 4, y: 310, width: 22, height: 86, rotation: 0, fill: door },
    { id: "door-customers", type: "DOOR", label: "Customers", x: partition - 4, y: 576, width: 22, height: 104, rotation: 0, fill: door },
    { id: "door-storage", type: "DOOR", x: 1285, y: 54, width: 120, height: 22, rotation: 0, fill: door },
    { id: "door-storage-office", type: "DOOR", x: 1255, y: 204, width: 110, height: 22, rotation: 0, fill: door },
    { id: "door-upper", type: "DOOR", x: 748, y: 300, width: 82, height: 22, rotation: 0, fill: door },
    { id: "door-store-room", type: "DOOR", x: 1215, y: 746, width: 110, height: 22, rotation: 0, fill: door },
    { id: "column-storefront", type: "COLUMN", x: 1311, y: 820, width: 16, height: 150, rotation: 0, fill: "#475569" },
    { id: "elect-panel", type: "UTILITY", label: "Elect panel", x: 1548, y: 108, width: 88, height: 56, rotation: 0, fill: "#fcd34d" },
  ];

  const tableX = 370;
  const tableY = 378;
  const tableW = 380;
  const tableH = 112;
  const centeredX = 400;
  const centeredY = 560;
  const seatW = 108;
  const seatH = 52;

  const seats: FloorSeat[] = [
    { resourceId: "seat-4", label: "Desk 4", x: 304, y: 875, width: 172, height: 78 },
    { resourceId: "seat-3", label: "Desk 3", x: 489, y: 875, width: 172, height: 78 },
    { resourceId: "seat-2", label: "Desk 2", x: 674, y: 875, width: 172, height: 78 },
    { resourceId: "seat-1", label: "Desk 1", x: 861, y: 875, width: 172, height: 78 },
    {
      resourceId: "seat-5",
      label: "Table 1",
      x: tableX + 70,
      y: tableY + tableH + 10,
      width: seatW,
      height: seatH,
      conferenceX: centeredX + 70,
      conferenceY: centeredY + tableH + 10,
    },
    {
      resourceId: "seat-6",
      label: "Table 2",
      x: tableX + tableW - 70 - seatW,
      y: tableY + tableH + 10,
      width: seatW,
      height: seatH,
      conferenceX: centeredX + tableW - 70 - seatW,
      conferenceY: centeredY + tableH + 10,
    },
  ];

  const roundX = 379;
  const roundY = 112;
  const roundD = 184;
  const furniture: FloorShape[] = [
    {
      id: "zone-conference",
      type: "MODE_ZONE",
      label: "Conference",
      resourceId: "mode-conference",
      x: tableX,
      y: tableY,
      width: tableW,
      height: tableH,
      rotation: 0,
      fill: "rgba(191,219,254,0.35)",
      role: "conference-zone",
    },
    { id: "ref-unit", type: "FURNITURE", x: 124, y: 98, width: 70, height: 42, rotation: 0, fill: "#cbd5e1", role: "fixture" },
    { id: "bath-ref-wc", type: "FURNITURE", x: 292, y: 98, width: 36, height: 46, rotation: 0, fill: "#e2e8f0", role: "fixture" },
    { id: "bath-round-wc", type: "FURNITURE", x: 608, y: 110, width: 42, height: 52, rotation: 0, fill: "#e2e8f0", role: "fixture" },
    { id: "bath-round-chair", type: "FURNITURE", x: 648, y: 200, width: 36, height: 36, rotation: 0, fill: "#94a3b8", role: "fixture" },
    {
      id: "round-table",
      type: "FURNITURE",
      label: "Round table · 5' radius",
      x: roundX,
      y: roundY,
      width: roundD,
      height: roundD,
      rotation: 0,
      fill: "#fde68a",
      shape: "ellipse",
    },
    { id: "round-chair-n", type: "FURNITURE", x: roundX + roundD / 2 - 16, y: roundY - 8, width: 32, height: 22, rotation: 0, fill: "#94a3b8", role: "round-chair" },
    { id: "round-chair-s", type: "FURNITURE", x: roundX + roundD / 2 - 16, y: roundY + roundD - 16, width: 32, height: 22, rotation: 0, fill: "#94a3b8", role: "round-chair" },
    { id: "round-chair-w", type: "FURNITURE", x: roundX - 6, y: roundY + roundD / 2 - 16, width: 22, height: 32, rotation: 0, fill: "#94a3b8", role: "round-chair" },
    { id: "round-chair-e", type: "FURNITURE", x: roundX + roundD - 16, y: roundY + roundD / 2 - 16, width: 22, height: 32, rotation: 0, fill: "#94a3b8", role: "round-chair" },
    { id: "tv", type: "FURNITURE", label: "Flat Screen TV", x: 470, y: 324, width: 210, height: 28, rotation: 0, fill: "#0f172a" },
    {
      id: "conference-table",
      type: "FURNITURE",
      label: "Modular conference table",
      x: tableX,
      y: tableY,
      width: tableW,
      height: tableH,
      rotation: 0,
      fill: "#dbeafe",
      role: "conference-table",
      conferenceX: centeredX,
      conferenceY: centeredY,
    },
    { id: "reception", type: "FURNITURE", label: "Reception Station", x: 94, y: 592, width: 142, height: 169, rotation: 0, fill: "#e0e7ff" },
    { id: "print", type: "FURNITURE", label: "Print Station", x: 906, y: 522, width: 122, height: 122, rotation: 0, fill: "#fef3c7" },
    { id: "counter-32", type: "FURNITURE", label: "32\" counter", x: 1108, y: 430, width: 470, height: 36, rotation: 0, fill: "#cbd5e1" },
    { id: "counter-42", type: "FURNITURE", label: "42\" counter", x: 1108, y: 528, width: 470, height: 44, rotation: 0, fill: "#94a3b8" },
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
