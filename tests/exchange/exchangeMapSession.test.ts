import { describe, expect, it } from "vitest";
import type { TerritoryDoc } from "@hi/shared";

import { DEFAULT_EXCHANGE_MAP_VIEWPORT } from "../../apps/web/src/features/exchange/map/mapConfig";
import {
  businessAnchorViewport,
  readExchangeMapSession,
  releasedTerritoryViewport,
  resolveInitialExchangeMapViewport,
  writeExchangeMapSession,
} from "../../apps/web/src/features/exchange/map/mapSession";

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  firstValue() {
    return [...this.values.values()][0] ?? null;
  }
}

const explicit = {
  longitude: -77.4,
  latitude: 37.1,
  zoom: 12,
  bearing: 8,
  pitch: 22,
};
const saved = {
  longitude: -76.3,
  latitude: 36.84,
  zoom: 11,
  bearing: -3,
  pitch: 36,
};
const released: TerritoryDoc[] = [
  {
    fips: "51093",
    name: "Isle of Wight County",
    state: "VA",
    status: "released",
    centroid: { lng: -76.71, lat: 36.91 },
    createdAt: 1,
  },
];

describe("Exchange map session precedence", () => {
  it("prefers explicit URL camera, then saved camera, then business, locality, and default", () => {
    const businessAnchor = { longitude: -76.62, latitude: 36.98 };
    expect(
      resolveInitialExchangeMapViewport({
        explicitViewport: explicit,
        savedViewport: saved,
        businessAnchor,
        releasedTerritories: released,
      }),
    ).toEqual(explicit);
    expect(
      resolveInitialExchangeMapViewport({
        savedViewport: saved,
        businessAnchor,
        releasedTerritories: released,
      }),
    ).toEqual(saved);
    expect(
      resolveInitialExchangeMapViewport({
        businessAnchor,
        releasedTerritories: released,
      }),
    ).toEqual(businessAnchorViewport(businessAnchor));
    expect(
      resolveInitialExchangeMapViewport({
        releasedTerritories: released,
      }),
    ).toEqual(releasedTerritoryViewport(released));
    expect(
      resolveInitialExchangeMapViewport({
        releasedTerritories: [],
      }),
    ).toEqual(DEFAULT_EXCHANGE_MAP_VIEWPORT);
  });

  it("opens a verified business coordinate in 3D without inventing a missing location", () => {
    expect(
      businessAnchorViewport({ longitude: -76.62, latitude: 36.98 }),
    ).toEqual({
      longitude: -76.62,
      latitude: 36.98,
      zoom: 14.5,
      bearing: -14,
      pitch: 58,
    });
    expect(businessAnchorViewport(null)).toBeNull();
    expect(
      businessAnchorViewport({ longitude: 181, latitude: 36.98 }),
    ).toBeNull();
  });
});

describe("Exchange map session persistence", () => {
  it("round-trips a per-user camera and rejects expired or malformed state", () => {
    const storage = new MemoryStorage();
    const now = Date.UTC(2026, 6, 19);
    expect(writeExchangeMapSession(storage, "member-1", saved, now)).toBe(true);
    expect(readExchangeMapSession(storage, "member-1", now + 1_000)).toEqual(
      saved,
    );
    expect(readExchangeMapSession(storage, "member-2", now + 1_000)).toBeNull();
    expect(
      readExchangeMapSession(
        storage,
        "member-1",
        now + 181 * 24 * 60 * 60 * 1_000,
      ),
    ).toBeNull();

    storage.setItem("hi.exchange.map-session.v1:member-1", "not-json");
    expect(readExchangeMapSession(storage, "member-1", now)).toBeNull();
    expect(storage.firstValue()).toBeNull();
  });
});
