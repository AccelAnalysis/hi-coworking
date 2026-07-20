import { afterEach, describe, expect, test, vi } from "vitest";
import {
  MapboxLocationSearchProvider,
  TestLocationSearchProvider,
} from "./opportunityLocationSearchProvider";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("test provider performs case-insensitive label and context matching", async () => {
  const provider = new TestLocationSearchProvider([
    {
      id: "norfolk",
      label: "Norfolk",
      context: "Virginia, United States",
      latitude: 36.8508,
      longitude: -76.2859,
    },
    {
      id: "newport-news",
      label: "Newport News",
      context: "Virginia, United States",
      latitude: 37.0871,
      longitude: -76.4730,
    },
  ]);

  expect((await provider.suggest("NORFOLK")).map((item) => item.id)).toEqual(["norfolk"]);
  expect((await provider.suggest("Virginia")).length).toBe(2);
});

test("Mapbox provider remains unavailable without a token", async () => {
  const provider = new MapboxLocationSearchProvider({ token: "" });
  expect(provider.available).toBe(false);
  expect(await provider.suggest("Norfolk")).toEqual([]);
});

test("Mapbox provider parses valid unique points and does not expose its token", async () => {
  let requestedUrl = "";
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "place.123",
          geometry: { type: "Point", coordinates: [-76.2859, 36.8508] },
          properties: {
            name: "Norfolk",
            place_formatted: "Virginia, United States",
            feature_type: "place",
          },
        },
        {
          type: "Feature",
          id: "invalid-line",
          geometry: { type: "LineString", coordinates: [] },
          properties: { name: "Ignore" },
        },
        {
          type: "Feature",
          id: "invalid-coordinate",
          geometry: { type: "Point", coordinates: [300, 95] },
          properties: { name: "Ignore" },
        },
        {
          type: "Feature",
          id: "place.123",
          geometry: { type: "Point", coordinates: [-76.2859, 36.8508] },
          properties: { name: "Duplicate" },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }));

  const provider = new MapboxLocationSearchProvider({
    token: "test-public-token",
    endpoint: "https://example.test/geocode",
  });
  const results = await provider.suggest("Norfolk");

  expect(results).toHaveLength(1);
  expect(results[0]).toEqual({
    id: "place.123",
    label: "Norfolk",
    context: "Virginia, United States",
    latitude: 36.8508,
    longitude: -76.2859,
    type: "place",
  });
  expect(requestedUrl).toContain("q=Norfolk");
  expect(requestedUrl).toContain("access_token=test-public-token");
  expect(JSON.stringify(results)).not.toContain("test-public-token");
});

describe("Mapbox error handling", () => {
  test.each([
    [429, "rate limit"],
    [503, "temporarily unavailable"],
  ])("maps status %i to a safe user-facing error", async (status, message) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));
    const provider = new MapboxLocationSearchProvider({
      token: "test-public-token",
      endpoint: "https://example.test/geocode",
    });
    await expect(provider.suggest("Norfolk")).rejects.toThrow(message);
  });
});
