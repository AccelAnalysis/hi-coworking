import type { RfxDoc, TerritoryDoc } from "@hi/shared";
import {
  getOpenRfxByViewportGeohash,
  getOpenRfxListFromFirestore,
  type ViewportBounds,
} from "@/lib/firestore";
import { listManagedRfxFn, listReleasedTerritoriesFn } from "@/lib/functions";
import {
  mergeExchangeRfx as mergeBoundedExchangeRfx,
  mergeExchangeRfxWithPinned as mergeBoundedExchangeRfxWithPinned,
  uniqueDiscoverableExchangeRfx,
} from "./exchangeRecordMerge";

export { resolvePinnedExchangeRfx } from "./exchangeRecordMerge";

const MAX_DISCOVERY_RFX = 200;
const MAX_VIEWPORT_RFX = 220;

export interface ExchangeRepositorySnapshot {
  rfx: RfxDoc[];
  releasedTerritories: TerritoryDoc[];
  scheduledTerritories: TerritoryDoc[];
  manageableRfxIds: string[];
}

export interface ExchangeOpportunityRepository {
  loadSnapshot(): Promise<ExchangeRepositorySnapshot>;
  loadViewportRfx(bounds: ViewportBounds): Promise<RfxDoc[]>;
}

export type ExchangeDataErrorKind = "permission" | "offline" | "unknown";

export interface ExchangeDataError {
  kind: ExchangeDataErrorKind;
  message: string;
}

export function normalizeExchangeDataError(error: unknown): ExchangeDataError {
  const record = error && typeof error === "object"
    ? error as Record<string, unknown>
    : {};
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  const message = typeof record.message === "string" ? record.message.toLowerCase() : "";

  if (code.includes("permission-denied") || code.includes("unauthenticated")) {
    return {
      kind: "permission",
      message: "Your account cannot access the requested Exchange records.",
    };
  }
  if (
    code.includes("not-found")
    || message.includes("404")
    || message.includes("cloudfunctions.net")
  ) {
    return {
      kind: "unknown",
      message: "The Exchange backend functions are not available in this Firebase environment. Deploy the matching Functions build, run the emulator stack, or use the local Exchange demo mode.",
    };
  }
  if (
    code.includes("unavailable")
    || code.includes("network")
    || message.includes("offline")
    || message.includes("network")
    || message.includes("failed to fetch")
    || message.includes("load failed")
  ) {
    return {
      kind: "offline",
      message: "Exchange data is temporarily unavailable. Check your connection and try again.",
    };
  }
  return {
    kind: "unknown",
    message: "Exchange data could not be loaded. Try again in a moment.",
  };
}

export async function loadExchangeSnapshot(): Promise<ExchangeRepositorySnapshot> {
  const [rfx, territoryResult, managedResult] = await Promise.all([
    getOpenRfxListFromFirestore(MAX_DISCOVERY_RFX),
    // Territory and management callables are enhancements to the public
    // discovery snapshot. A branch whose Functions have not been deployed
    // must not erase otherwise usable Firestore RFx records or the basemap.
    listReleasedTerritoriesFn({}).catch(() => null),
    listManagedRfxFn({ maxResults: MAX_DISCOVERY_RFX }).catch(() => null),
  ]);

  return {
    rfx: uniqueDiscoverableExchangeRfx(rfx, MAX_DISCOVERY_RFX),
    releasedTerritories: (territoryResult?.data.released ?? [])
      .filter((territory) => territory.status === "released"),
    scheduledTerritories: (territoryResult?.data.scheduled ?? [])
      .filter((territory) => territory.status === "scheduled"),
    manageableRfxIds: managedResult?.data.manageableRfxIds ?? [],
  };
}

export async function loadExchangeViewportRfx(
  bounds: ViewportBounds,
): Promise<RfxDoc[]> {
  const records = await getOpenRfxByViewportGeohash(bounds, MAX_VIEWPORT_RFX);
  return uniqueDiscoverableExchangeRfx(records, MAX_VIEWPORT_RFX);
}

export const liveExchangeOpportunityRepository: ExchangeOpportunityRepository = {
  loadSnapshot: loadExchangeSnapshot,
  loadViewportRfx: loadExchangeViewportRfx,
};

export function mergeExchangeRfx(
  current: RfxDoc[],
  viewport: RfxDoc[],
  maximum = MAX_DISCOVERY_RFX + MAX_VIEWPORT_RFX,
): RfxDoc[] {
  return mergeBoundedExchangeRfx(current, viewport, maximum);
}

export function mergeExchangeRfxWithPinned(
  current: RfxDoc[],
  viewport: RfxDoc[],
  pinnedRfx: RfxDoc | null,
  maximum = MAX_DISCOVERY_RFX + MAX_VIEWPORT_RFX,
): RfxDoc[] {
  return mergeBoundedExchangeRfxWithPinned(
    current,
    viewport,
    pinnedRfx,
    maximum,
  );
}
