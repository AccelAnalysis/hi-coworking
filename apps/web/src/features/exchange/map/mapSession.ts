import type { TerritoryDoc } from "@hi/shared";

import {
  DEFAULT_EXCHANGE_MAP_VIEWPORT,
  EXCHANGE_3D_VIEWPORT,
  type ExchangeMapViewport,
} from "./mapConfig";

const MAP_SESSION_VERSION = 1;
const MAP_SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1_000;
const MAP_SESSION_PREFIX = "hi.exchange.map-session.v1";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

interface StoredMapSession {
  version: number;
  savedAt: number;
  viewport: ExchangeMapViewport;
}

export interface BusinessMapAnchor {
  latitude: number;
  longitude: number;
}

function finiteInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function normalizeExchangeMapViewport(
  value: unknown,
): ExchangeMapViewport | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ExchangeMapViewport>;
  if (
    !finiteInRange(candidate.longitude, -180, 180) ||
    !finiteInRange(candidate.latitude, -85.051129, 85.051129) ||
    !finiteInRange(candidate.zoom, 0, 22)
  )
    return null;
  const bearing = candidate.bearing ?? 0;
  const pitch = candidate.pitch ?? 0;
  if (!finiteInRange(bearing, -180, 180) || !finiteInRange(pitch, 0, 85))
    return null;
  return {
    longitude: candidate.longitude,
    latitude: candidate.latitude,
    zoom: candidate.zoom,
    bearing,
    pitch,
  };
}

function mapSessionKey(uid: string): string {
  return `${MAP_SESSION_PREFIX}:${uid}`;
}

export function readExchangeMapSession(
  storage: StorageLike,
  uid: string,
  now = Date.now(),
): ExchangeMapViewport | null {
  try {
    const serialized = storage.getItem(mapSessionKey(uid));
    if (!serialized) return null;
    const session = JSON.parse(serialized) as Partial<StoredMapSession>;
    if (
      session.version !== MAP_SESSION_VERSION ||
      typeof session.savedAt !== "number" ||
      !Number.isFinite(session.savedAt) ||
      session.savedAt > now + 60_000 ||
      now - session.savedAt > MAP_SESSION_TTL_MS
    ) {
      storage.removeItem?.(mapSessionKey(uid));
      return null;
    }
    return normalizeExchangeMapViewport(session.viewport);
  } catch {
    storage.removeItem?.(mapSessionKey(uid));
    return null;
  }
}

export function writeExchangeMapSession(
  storage: StorageLike,
  uid: string,
  viewport: ExchangeMapViewport,
  now = Date.now(),
): boolean {
  const normalized = normalizeExchangeMapViewport(viewport);
  if (!normalized) return false;
  try {
    storage.setItem(
      mapSessionKey(uid),
      JSON.stringify({
        version: MAP_SESSION_VERSION,
        savedAt: now,
        viewport: normalized,
      } satisfies StoredMapSession),
    );
    return true;
  } catch {
    return false;
  }
}

export function businessAnchorViewport(
  anchor: BusinessMapAnchor | null,
): ExchangeMapViewport | null {
  if (
    !anchor ||
    !finiteInRange(anchor.longitude, -180, 180) ||
    !finiteInRange(anchor.latitude, -85.051129, 85.051129)
  )
    return null;
  return {
    longitude: anchor.longitude,
    latitude: anchor.latitude,
    zoom: 14.5,
    ...EXCHANGE_3D_VIEWPORT,
  };
}

export function releasedTerritoryViewport(
  territories: readonly TerritoryDoc[],
): ExchangeMapViewport | null {
  const territory = territories.find(
    (candidate) =>
      candidate.status === "released" &&
      finiteInRange(candidate.centroid?.lng, -180, 180) &&
      finiteInRange(candidate.centroid?.lat, -85.051129, 85.051129),
  );
  if (!territory?.centroid) return null;
  return {
    longitude: territory.centroid.lng,
    latitude: territory.centroid.lat,
    zoom: 10.5,
    bearing: 0,
    pitch: 0,
  };
}

export function resolveInitialExchangeMapViewport({
  explicitViewport,
  savedViewport,
  businessAnchor,
  releasedTerritories,
}: {
  explicitViewport?: ExchangeMapViewport;
  savedViewport?: ExchangeMapViewport | null;
  businessAnchor?: BusinessMapAnchor | null;
  releasedTerritories: readonly TerritoryDoc[];
}): ExchangeMapViewport {
  return (
    normalizeExchangeMapViewport(explicitViewport) ??
    normalizeExchangeMapViewport(savedViewport) ??
    businessAnchorViewport(businessAnchor ?? null) ??
    releasedTerritoryViewport(releasedTerritories) ?? {
      ...DEFAULT_EXCHANGE_MAP_VIEWPORT,
    }
  );
}
