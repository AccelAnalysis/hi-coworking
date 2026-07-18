import assert from "node:assert/strict";
import test from "node:test";
import {
  MapboxLocationSearchProvider,
  TestLocationSearchProvider,
} from "./opportunityLocationSearchProvider";

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

  assert.deepEqual((await provider.suggest("NORFOLK")).map((item) => item.id), ["norfolk"]);
  assert.equal((await provider.suggest("Virginia")).length, 2);
});

test("Mapbox provider remains unavailable without a token", async () => {
  const provider = new MapboxLocationSearchProvider({ token: "" });
  assert.equal(provider.available, false);
  assert.deepEqual(await provider.suggest("Norfolk"), []);
});

test("Mapbox provider parses point suggestions and does not expose its token", async (context) => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
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
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const provider = new MapboxLocationSearchProvider({
    token: "test-public-token",
    endpoint: "https://example.test/geocode",
  });
  const results = await provider.suggest("Norfolk");

  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    id: "place.123",
    label: "Norfolk",
    context: "Virginia, United States",
    latitude: 36.8508,
    longitude: -76.2859,
    type: "place",
  });
  assert.ok(requestedUrl.includes("q=Norfolk"));
  assert.ok(requestedUrl.includes("access_token=test-public-token"));
  assert.equal(JSON.stringify(results).includes("test-public-token"), false);
});
