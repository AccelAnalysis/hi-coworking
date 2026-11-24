import type { FloorDoc, LayoutVariant } from "@hi/shared";
import {
  buildSeatMapSpots,
  type PublishedSeatElement,
  type SeatMapSpot,
} from "@hi/shared";
import { getFloors, getLocations, resolvePublishedLayout } from "@/lib/firestore";

export type SeatMapLayoutView = {
  spots: SeatMapSpot[];
  backgroundUrl?: string;
  layoutName?: string;
  source: "published" | "fallback";
};

function toPublishedInput(floor: FloorDoc, layout: LayoutVariant): {
  canvasWidth: number;
  canvasHeight: number;
  elements: PublishedSeatElement[];
  backgroundUrl?: string;
} {
  return {
    canvasWidth: floor.canvasWidth,
    canvasHeight: floor.canvasHeight,
    backgroundUrl: floor.background?.downloadUrl || undefined,
    elements: (layout.elements ?? []).map((element) => ({
      type: element.type,
      resourceId: element.resourceId,
      label: element.label,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      meta: element.meta,
    })),
  };
}

/**
 * Load the first published Admin layout that has seat elements, or fall back
 * to the numbered-plan coordinates. Failures never break booking: the picker
 * always has fallback spots.
 */
export async function loadPublishedSeatMap(): Promise<SeatMapLayoutView> {
  try {
    const locations = await getLocations();
    for (const location of locations) {
      const floors = await getFloors(location.id);
      for (const floor of floors) {
        const layout = await resolvePublishedLayout(location.id, floor.id);
        if (!layout) continue;
        const published = toPublishedInput(floor, layout);
        const spots = buildSeatMapSpots(published);
        const usedPublished = spots.some((spot) => spot.source === "published");
        if (!usedPublished && !published.backgroundUrl) continue;
        return {
          spots,
          backgroundUrl: published.backgroundUrl,
          layoutName: layout.name,
          source: usedPublished || published.backgroundUrl ? "published" : "fallback",
        };
      }
    }
  } catch (caught) {
    console.warn("Published seat layout could not be loaded", caught);
  }
  return {
    spots: buildSeatMapSpots(null),
    source: "fallback",
  };
}

export function fallbackSeatMap(): SeatMapLayoutView {
  return {
    spots: buildSeatMapSpots(null),
    source: "fallback",
  };
}
