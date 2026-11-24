import { ARCHITECTURAL_SEAT_POINTS, SEAT_MAP_VIEWBOX, type SeatResourceId } from "@hi/shared";

/**
 * Geometry for the customer seat map picker. The plan is drawn in
 * SEAT_MAP_VIEWBOX units and scaled to the rendered width, so seat badges
 * look like the reference picker (r 17.5 units) while each seat gets a larger
 * invisible touch target that never drops below 44 CSS px (Apple HIG; above
 * WCAG 2.2 AA 2.5.8).
 */
export const SEAT_BADGE_RADIUS = 17.5;
export const SEAT_HALO_RADIUS = 23;
export const MIN_TOUCH_TARGET_PX = 44;
/** Hit area as a share of the rendered plan width (8% ≈ 76 units). */
export const SEAT_HIT_TARGET_FRACTION = 0.08;
/**
 * The plan never renders narrower than this. On a 390 px phone the main room
 * (every bookable seat) fills the visible width and the lounge and private
 * office scroll in from the right.
 */
export const SEAT_MAP_MIN_WIDTH_PX = 540;

/** CSS for the hit-area width. Height follows via aspect-ratio: 1. */
export const SEAT_HIT_TARGET_CSS = `max(${MIN_TOUCH_TARGET_PX}px, ${SEAT_HIT_TARGET_FRACTION * 100}%)`;

export function seatMapScale(renderedWidthPx: number): number {
  return renderedWidthPx / SEAT_MAP_VIEWBOX.width;
}

export function seatHitTargetPx(renderedWidthPx: number): number {
  return Math.max(MIN_TOUCH_TARGET_PX, renderedWidthPx * SEAT_HIT_TARGET_FRACTION);
}

export function seatBadgeDiameterPx(renderedWidthPx: number): number {
  return SEAT_BADGE_RADIUS * 2 * seatMapScale(renderedWidthPx);
}

/**
 * Rendered plan width for a viewport width, matching the picker layout:
 * page px-4 (sm:px-6), max-w-6xl; at lg the map takes 8 of 12 columns with a
 * 24 px gap; the map card has p-3 (sm:p-5) and a 1 px border.
 */
export function renderedPlanWidthPx(viewportWidthPx: number): number {
  let inner: number;
  if (viewportWidthPx >= 1024) {
    const content = Math.min(viewportWidthPx, 1152) - 48;
    inner = ((content - 24) * 8) / 12 - 40 - 2;
  } else if (viewportWidthPx >= 640) {
    inner = viewportWidthPx - 48 - 40 - 2;
  } else {
    inner = viewportWidthPx - 32 - 24 - 2;
  }
  return Math.max(SEAT_MAP_MIN_WIDTH_PX, inner);
}

/**
 * Pairs of seats whose square hit areas would overlap at this rendered width.
 * Empty means every target is clear of its neighbours.
 */
export function overlappingSeatTargets(
  renderedWidthPx: number,
  points: Record<SeatResourceId, { x: number; y: number }> = ARCHITECTURAL_SEAT_POINTS,
): Array<[SeatResourceId, SeatResourceId]> {
  const scale = seatMapScale(renderedWidthPx);
  const hit = seatHitTargetPx(renderedWidthPx);
  const ids = Object.keys(points) as SeatResourceId[];
  const overlaps: Array<[SeatResourceId, SeatResourceId]> = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = points[ids[i]];
      const b = points[ids[j]];
      const dx = Math.abs(a.x - b.x) * scale;
      const dy = Math.abs(a.y - b.y) * scale;
      if (dx < hit && dy < hit) overlaps.push([ids[i], ids[j]]);
    }
  }
  return overlaps;
}
