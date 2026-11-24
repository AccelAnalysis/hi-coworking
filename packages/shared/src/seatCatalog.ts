/**
 * Canonical customer-facing seat catalog for the Hi Coworking floor map.
 *
 * Display IDs D1–D7 map to booking resource IDs seat-1–seat-7.
 * Tier prices are the decided ladder from 21 November 2026, 9:33 AM ET
 * (Lance revenue model), confirmed by Jonathan 24 Nov 2026. Checkout charges
 * them (see deskPricing.ts and the functions mirror). Desk bookings use
 * dynamic Stripe Checkout line items; there is no Stripe product per seat.
 *
 * Overage: Coworking Member pays 20% off the seat's guest hourly rate and
 * Coworking Plus 30% off; all billable time is capped at the tier's half-day
 * (up to 4 billable hours) or day (over 4) price.
 *
 * D7 is the equipped-tier reception L-desk and is staff-only / not sellable.
 * The private office is a separate room resource (not a seat tier): see
 * PRIVATE_OFFICE_RESOURCE_ID. It does not consume membership desk hours.
 */
export const BOOKABLE_SEAT_RESOURCE_IDS = [
  "seat-1",
  "seat-2",
  "seat-3",
  "seat-4",
  "seat-5",
  "seat-6",
] as const;

export const STAFF_ONLY_SEAT_RESOURCE_ID = "seat-7";

export type BookableSeatResourceId = (typeof BOOKABLE_SEAT_RESOURCE_IDS)[number];
export type SeatResourceId = BookableSeatResourceId | typeof STAFF_ONLY_SEAT_RESOURCE_ID;
export type SeatDisplayId = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7";
export type SeatTierId = "basic" | "window" | "equipped";
export type SeatAmenity = "sit-stand" | "monitor-dock" | "window";

export type SeatTierRates = {
  id: SeatTierId;
  name: string;
  shortLabel: string;
  /** Guest hourly rate, in cents. */
  guestHourlyCents: number;
  /** Guest half-day (4 hours), in cents. Also the cap for up to 4 billable hours. */
  guestHalfDayCents: number;
  /** Guest full day (9 hours), in cents. Also the cap for over 4 billable hours. */
  guestDayCents: number;
  /** Coworking Member ($159) overage, in cents per hour (20% off guest). */
  memberOverageHourlyCents: number;
  /** Coworking Plus ($289) overage, in cents per hour (30% off guest). */
  plusOverageHourlyCents: number;
};

export const SEAT_TIERS: Record<SeatTierId, SeatTierRates> = {
  basic: {
    id: "basic",
    name: "Basic",
    shortLabel: "Conference table",
    guestHourlyCents: 1750,
    guestHalfDayCents: 2900,
    guestDayCents: 4900,
    memberOverageHourlyCents: 1400,
    plusOverageHourlyCents: 1225,
  },
  window: {
    id: "window",
    name: "Window sit-stand",
    shortLabel: "Window sit-stand",
    guestHourlyCents: 1900,
    guestHalfDayCents: 3900,
    guestDayCents: 6500,
    memberOverageHourlyCents: 1520,
    plusOverageHourlyCents: 1330,
  },
  equipped: {
    id: "equipped",
    name: "Equipped",
    shortLabel: "Sit-stand, monitor, and dock",
    guestHourlyCents: 2200,
    guestHalfDayCents: 4900,
    guestDayCents: 7900,
    // Member includes 0 hours on Equipped; every hour bills at this rate.
    memberOverageHourlyCents: 1760,
    plusOverageHourlyCents: 1540,
  },
};

export type SeatCatalogEntry = {
  resourceId: SeatResourceId;
  displayId: SeatDisplayId;
  /** Customer-facing name, e.g. "D1". */
  name: string;
  /** Existing checkout resource name, e.g. "Desk 1". */
  resourceName: string;
  tierId: SeatTierId;
  amenities: readonly SeatAmenity[];
  bookable: boolean;
  staffOnly: boolean;
};

export const SEAT_CATALOG: Record<SeatResourceId, SeatCatalogEntry> = {
  "seat-1": {
    resourceId: "seat-1",
    displayId: "D1",
    name: "D1",
    resourceName: "Desk 1",
    tierId: "basic",
    amenities: [],
    bookable: true,
    staffOnly: false,
  },
  "seat-2": {
    resourceId: "seat-2",
    displayId: "D2",
    name: "D2",
    resourceName: "Desk 2",
    tierId: "basic",
    amenities: [],
    bookable: true,
    staffOnly: false,
  },
  "seat-3": {
    resourceId: "seat-3",
    displayId: "D3",
    name: "D3",
    resourceName: "Desk 3",
    tierId: "window",
    amenities: ["sit-stand", "window"],
    bookable: true,
    staffOnly: false,
  },
  "seat-4": {
    resourceId: "seat-4",
    displayId: "D4",
    name: "D4",
    resourceName: "Desk 4",
    tierId: "window",
    amenities: ["sit-stand", "window"],
    bookable: true,
    staffOnly: false,
  },
  "seat-5": {
    resourceId: "seat-5",
    displayId: "D5",
    name: "D5",
    resourceName: "Desk 5",
    tierId: "equipped",
    amenities: ["sit-stand", "monitor-dock", "window"],
    bookable: true,
    staffOnly: false,
  },
  "seat-6": {
    resourceId: "seat-6",
    displayId: "D6",
    name: "D6",
    resourceName: "Desk 6",
    tierId: "equipped",
    amenities: ["sit-stand", "monitor-dock", "window"],
    bookable: true,
    staffOnly: false,
  },
  "seat-7": {
    resourceId: "seat-7",
    displayId: "D7",
    name: "D7",
    resourceName: "Reception desk",
    tierId: "equipped",
    amenities: ["monitor-dock"],
    bookable: false,
    staffOnly: true,
  },
};

/** Paint / tab order: window wall left to right, then conference table, then reception. */
export const SEAT_DISPLAY_ORDER: readonly SeatResourceId[] = [
  "seat-3",
  "seat-4",
  "seat-5",
  "seat-6",
  "seat-1",
  "seat-2",
  "seat-7",
];

export const SEAT_AMENITY_LABELS: Record<SeatAmenity, string> = {
  "sit-stand": "Sit-stand",
  "monitor-dock": "Monitor and dock",
  window: "Window",
};

/**
 * Built-in architectural floor plan coordinate space (42' x 25' plan). The
 * customer picker draws the plan in this viewBox; seat centers below are in
 * the same units. Traced from the numbered D1–D7 plan and Jonathan's
 * reference picker (21 Nov 2026). The PNG is not committed.
 */
export const SEAT_MAP_VIEWBOX = { x: -55, y: -55, width: 950, height: 595 } as const;

/** Seat badge centers in SEAT_MAP_VIEWBOX units. */
export const ARCHITECTURAL_SEAT_POINTS: Record<SeatResourceId, { x: number; y: number }> = {
  "seat-1": { x: 132, y: 189 },
  "seat-2": { x: 403, y: 189 },
  "seat-3": { x: 199, y: 455 },
  "seat-4": { x: 291, y: 455 },
  "seat-5": { x: 383, y: 455 },
  "seat-6": { x: 475, y: 455 },
  "seat-7": { x: 44, y: 398 },
};

/** Convert a viewBox point to a percentage of the plan's width and height. */
export function seatMapPointToPercent(point: { x: number; y: number }): { cx: number; cy: number } {
  return {
    cx: ((point.x - SEAT_MAP_VIEWBOX.x) / SEAT_MAP_VIEWBOX.width) * 100,
    cy: ((point.y - SEAT_MAP_VIEWBOX.y) / SEAT_MAP_VIEWBOX.height) * 100,
  };
}

/** Convert a percentage position back to SEAT_MAP_VIEWBOX units. */
export function seatMapPercentToPoint(spot: { cx: number; cy: number }): { x: number; y: number } {
  return {
    x: SEAT_MAP_VIEWBOX.x + (spot.cx / 100) * SEAT_MAP_VIEWBOX.width,
    y: SEAT_MAP_VIEWBOX.y + (spot.cy / 100) * SEAT_MAP_VIEWBOX.height,
  };
}

/**
 * Fallback hotspots as a percentage of the built-in plan. Used when a
 * published Admin layout has no matching seat element.
 */
export const FALLBACK_SEAT_POSITIONS: Record<SeatResourceId, { cx: number; cy: number }> = Object.fromEntries(
  (Object.keys(ARCHITECTURAL_SEAT_POINTS) as SeatResourceId[]).map((id) => [
    id,
    seatMapPointToPercent(ARCHITECTURAL_SEAT_POINTS[id]),
  ]),
) as Record<SeatResourceId, { cx: number; cy: number }>;

export const SEAT_MAP_REFERENCE = {
  width: 1024,
  height: 709,
  /**
   * Admin Visual designer: upload the numbered floor plan as the floor
   * background, then place SEAT elements on D1–D7 and bind resourceId to
   * seat-1–seat-7. Optional layout meta.displayId (D1–D7) overrides the label
   * if the resourceId mapping is missing.
   */
} as const;

const RESOURCE_BY_DISPLAY: Record<string, SeatResourceId> = {
  D1: "seat-1",
  D2: "seat-2",
  D3: "seat-3",
  D4: "seat-4",
  D5: "seat-5",
  D6: "seat-6",
  D7: "seat-7",
};

export function isSeatResourceId(value: string): value is SeatResourceId {
  return value in SEAT_CATALOG;
}

export function getSeatByResourceId(resourceId: string): SeatCatalogEntry | undefined {
  return isSeatResourceId(resourceId) ? SEAT_CATALOG[resourceId] : undefined;
}

export function displayIdForResource(resourceId: string): string {
  return getSeatByResourceId(resourceId)?.displayId ?? resourceId;
}

export function resourceIdFromDisplayId(value: string): SeatResourceId | undefined {
  const key = value.trim().toUpperCase();
  return RESOURCE_BY_DISPLAY[key];
}

export function formatUsdCents(cents: number | undefined | null): string | null {
  if (cents == null || !Number.isFinite(cents)) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function tierRatesForSeat(resourceId: string): SeatTierRates | undefined {
  const seat = getSeatByResourceId(resourceId);
  return seat ? SEAT_TIERS[seat.tierId] : undefined;
}

/** Guest rates to show as badges. Omits any amount that has not been set. */
export function visibleGuestRates(resourceId: string): {
  hourly: string | null;
  halfDay: string | null;
  day: string | null;
} {
  if (resourceId === PRIVATE_OFFICE_RESOURCE_ID) {
    return {
      hourly: formatUsdCents(PRIVATE_OFFICE_RATES.guestHourlyCents),
      halfDay: formatUsdCents(PRIVATE_OFFICE_RATES.guestHalfDayCents),
      day: formatUsdCents(PRIVATE_OFFICE_RATES.guestDayCents),
    };
  }
  const tier = tierRatesForSeat(resourceId);
  return {
    hourly: formatUsdCents(tier?.guestHourlyCents),
    halfDay: formatUsdCents(tier?.guestHalfDayCents),
    day: formatUsdCents(tier?.guestDayCents),
  };
}

/** Coworking Member overage label for a seat (null for unknown seats). */
export function visibleMemberOverage(resourceId: string): string | null {
  const tier = tierRatesForSeat(resourceId);
  return formatUsdCents(tier?.memberOverageHourlyCents);
}

/** Coworking Plus overage label for a seat (null for unknown seats). */
export function visiblePlusOverage(resourceId: string): string | null {
  const tier = tierRatesForSeat(resourceId);
  return formatUsdCents(tier?.plusOverageHourlyCents);
}

export function isBookableSeatResource(resourceId: string): boolean {
  return getSeatByResourceId(resourceId)?.bookable === true;
}

export type PublishedSeatElement = {
  type?: string;
  resourceId?: string;
  label?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  meta?: { displayId?: unknown; [key: string]: unknown };
};

export type SeatMapSpot = {
  resourceId: SeatResourceId;
  displayId: SeatDisplayId;
  name: string;
  cx: number;
  cy: number;
  bookable: boolean;
  staffOnly: boolean;
  tierId: SeatTierId;
  amenities: readonly SeatAmenity[];
  source: "published" | "fallback";
};

function displayIdFromMetaOrLabel(element: PublishedSeatElement): SeatDisplayId | undefined {
  const meta = typeof element.meta?.displayId === "string" ? element.meta.displayId : "";
  const fromMeta = resourceIdFromDisplayId(meta);
  if (fromMeta) return SEAT_CATALOG[fromMeta].displayId;
  const label = String(element.label || "");
  const match = label.toUpperCase().match(/\b(D[1-7])\b/);
  if (match) return match[1] as SeatDisplayId;
  return undefined;
}

function resourceIdFromElement(element: PublishedSeatElement): SeatResourceId | undefined {
  const raw = String(element.resourceId || "").trim();
  if (isSeatResourceId(raw)) return raw;
  const displayId = displayIdFromMetaOrLabel(element);
  return displayId ? resourceIdFromDisplayId(displayId) : undefined;
}

/**
 * Build D1–D7 spots. Published Admin layout positions win when a SEAT (or
 * MODE_ZONE) element maps to a catalog resource; otherwise the fallback
 * numbered-plan coordinates are used. The private office is never included.
 */
export function buildSeatMapSpots(
  published?: {
    canvasWidth?: number;
    canvasHeight?: number;
    elements?: PublishedSeatElement[];
  } | null,
): SeatMapSpot[] {
  const width = Number(published?.canvasWidth || 0);
  const height = Number(published?.canvasHeight || 0);
  const byResource = new Map<SeatResourceId, { cx: number; cy: number }>();

  if (published?.elements && width > 0 && height > 0) {
    for (const element of published.elements) {
      const type = String(element.type || "");
      if (type && type !== "SEAT" && type !== "DESK") continue;
      const resourceId = resourceIdFromElement(element);
      if (!resourceId || byResource.has(resourceId)) continue;
      const elWidth = Number(element.width ?? 0);
      const elHeight = Number(element.height ?? 0);
      const cx = ((Number(element.x) + elWidth / 2) / width) * 100;
      const cy = ((Number(element.y) + elHeight / 2) / height) * 100;
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;
      byResource.set(resourceId, {
        cx: Math.min(98, Math.max(2, cx)),
        cy: Math.min(98, Math.max(2, cy)),
      });
    }
  }

  return SEAT_DISPLAY_ORDER.map((resourceId) => {
    const seat = SEAT_CATALOG[resourceId];
    const publishedPos = byResource.get(resourceId);
    const fallback = FALLBACK_SEAT_POSITIONS[resourceId];
    return {
      resourceId,
      displayId: seat.displayId,
      name: seat.name,
      cx: publishedPos?.cx ?? fallback.cx,
      cy: publishedPos?.cy ?? fallback.cy,
      bookable: seat.bookable,
      staffOnly: seat.staffOnly,
      tierId: seat.tierId,
      amenities: seat.amenities,
      source: publishedPos ? "published" : "fallback",
    };
  });
}

export function accessibleSeatName(resourceId: string): string {
  const seat = getSeatByResourceId(resourceId);
  if (!seat) return resourceId;
  const tier = SEAT_TIERS[seat.tierId];
  const amenities = seat.amenities.map((item) => SEAT_AMENITY_LABELS[item]).join(", ");
  const parts = [seat.displayId, tier.name];
  if (tier.shortLabel && tier.shortLabel !== tier.name) parts.push(tier.shortLabel);
  if (amenities) parts.push(amenities);
  if (seat.staffOnly) parts.push("staff only");
  return parts.join(", ");
}


/** Bookable right-hand private office — a ROOM, not a hot desk. */
export const PRIVATE_OFFICE_RESOURCE_ID = "private-office";
export const PRIVATE_OFFICE_BLOCKED_SEAT_ID = "seat-1";
export const PRIVATE_OFFICE_RATES = {
  name: "Private Office",
  shortLabel: "Right-hand room",
  guestHourlyCents: 3900,
  guestHalfDayCents: 9900,
  guestDayCents: 14900,
} as const;

export function isPrivateOfficeResource(resourceId: string): boolean {
  return resourceId === PRIVATE_OFFICE_RESOURCE_ID;
}

/**
 * ViewBox coordinates for the right-hand private office room on the
 * architectural floor plan (`x=628 y=36 width=198 height=368`).
 */
export const ARCHITECTURAL_PRIVATE_OFFICE = {
  x: 628,
  y: 36,
  width: 198,
  height: 368,
  cx: 727,
  cy: 220,
} as const;
