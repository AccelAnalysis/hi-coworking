import { describe, expect, it } from "vitest";
import type { RfxDoc, TerritoryDoc } from "@hi/shared";

import {
  buildExchangeMapGeoJson,
  getExchangeMapDataBounds,
  parseTerritoryBoundaryGeometry,
  toRfxFeatureCollection,
  toTerritoryBoundaryFeatureCollection,
  toTerritoryPointFeatureCollection,
} from "../../apps/web/src/features/exchange/map/geojson";
import {
  EXCHANGE_MAP_LAYER_IDS,
  EXCHANGE_MAP_SOURCE_IDS,
  EXCHANGE_RFX_CLUSTER_OPTIONS,
} from "../../apps/web/src/features/exchange/map/mapConfig";
import { createExchangeMapLayerSpecifications } from "../../apps/web/src/features/exchange/map/mapLayers";
import {
  createExchangeMapSourceSpecifications,
  updateExchangeSelectedRfxSource,
} from "../../apps/web/src/features/exchange/map/mapSources";
import { getExchangeSelectionTargets } from "../../apps/web/src/features/exchange/map/selection";

function rfx(overrides: Partial<RfxDoc> = {}): RfxDoc {
  return {
    id: "rfx-1",
    title: "Library HVAC replacement",
    description: "Replace rooftop equipment.",
    memberOnly: false,
    status: "open",
    createdBy: "issuer-1",
    createdByName: "Isle of Wight County",
    evaluationCriteria: [],
    requestedDocuments: [],
    adminApprovalStatus: "approved",
    responseCount: 0,
    createdAt: 1,
    geo: { lng: -76.7, lat: 36.9, geohash: "dq9" },
    ...overrides,
  };
}

function territory(overrides: Partial<TerritoryDoc> = {}): TerritoryDoc {
  return {
    fips: "51093",
    name: "Isle of Wight County",
    state: "VA",
    status: "released",
    createdAt: 1,
    centroid: { lng: -76.71, lat: 36.91 },
    boundaryGeoJSON: {
      type: "Polygon",
      coordinates: [
        [
          [-76.8, 36.8],
          [-76.6, 36.8],
          [-76.6, 37],
          [-76.8, 36.8],
        ],
      ],
    },
    ...overrides,
  };
}

describe("Exchange map GeoJSON", () => {
  it("creates stable RFx point IDs and public selection properties", () => {
    const collection = toRfxFeatureCollection([
      rfx({ id: "rfx-east", territoryFips: "51093", location: "Smithfield, VA" }),
    ]);

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]).toMatchObject({
      id: "rfx-east",
      properties: {
        entityType: "rfx",
        id: "rfx-east",
        title: "Library HVAC replacement",
        status: "open",
        territoryFips: "51093",
        location: "Smithfield, VA",
      },
      geometry: { type: "Point", coordinates: [-76.7, 36.9] },
    });
  });

  it("omits RFx records with missing, non-finite, or out-of-range coordinates", () => {
    const collection = toRfxFeatureCollection([
      rfx({ id: "valid" }),
      rfx({ id: "missing", geo: undefined }),
      rfx({ id: "nan", geo: { lng: Number.NaN, lat: 36.9, geohash: "" } }),
      rfx({ id: "bad-lng", geo: { lng: 181, lat: 36.9, geohash: "" } }),
      rfx({ id: "bad-lat", geo: { lng: -76.7, lat: -91, geohash: "" } }),
    ]);

    expect(collection.features.map((feature) => feature.id)).toEqual(["valid"]);
  });

  it("preserves released and scheduled territory states in points and boundaries", () => {
    const releaseDate = Date.UTC(2027, 0, 15);
    const released = territory();
    const scheduled = territory({
      fips: "51175",
      name: "Southampton County",
      status: "scheduled",
      releaseDate,
      centroid: { lng: -77.1, lat: 36.7 },
    });

    const data = buildExchangeMapGeoJson([], [released], [scheduled]);

    expect(data.releasedTerritoryPoints.features[0].properties).toMatchObject({
      id: "51093",
      status: "released",
      releaseLabel: "",
    });
    expect(data.scheduledTerritoryPoints.features[0].properties).toMatchObject({
      id: "51175",
      status: "scheduled",
      releaseDate,
      releaseLabel: "Releases Jan 15",
    });
    expect(data.releasedTerritoryBoundaries.features[0].id).toBe("51093");
    expect(data.scheduledTerritoryBoundaries.features[0].id).toBe("51175");
    expect(getExchangeMapDataBounds(data)).toEqual({
      west: -77.1,
      south: 36.7,
      east: -76.6,
      north: 37,
    });
  });

  it("defensively rejects malformed territory geometry and centroid coordinates", () => {
    expect(parseTerritoryBoundaryGeometry({ type: "LineString", coordinates: [] })).toBeNull();
    expect(
      parseTerritoryBoundaryGeometry({
        type: "Polygon",
        coordinates: [[[-76.8, 36.8], [-76.6, 36.8], [-76.6, 37], [-76.7, 36.9]]],
      }),
    ).toBeNull();
    expect(
      parseTerritoryBoundaryGeometry({
        type: "Polygon",
        coordinates: [
          [[-76.8, 36.8], [-76.6, Number.NaN], [-76.6, 37], [-76.8, 36.8]],
        ],
      }),
    ).toBeNull();

    const malformed = territory({
      fips: "bad",
      centroid: { lng: 200, lat: 36.9 },
      boundaryGeoJSON: { type: "Feature", geometry: null, properties: {} },
    });
    expect(toTerritoryPointFeatureCollection([malformed], "released").features).toEqual([]);
    expect(toTerritoryBoundaryFeatureCollection([malformed], "released").features).toEqual([]);
    expect(
      toTerritoryPointFeatureCollection([territory({ status: "paused" })], "released").features,
    ).toEqual([]);
  });
});

describe("Exchange map source, layer, and selection contracts", () => {
  it("exports unique, stable source and layer IDs", () => {
    expect(EXCHANGE_MAP_SOURCE_IDS).toEqual({
      rfx: "exchange-rfx-points",
      selectedRfx: "exchange-rfx-selected",
      releasedTerritoryPoints: "exchange-territory-released-points",
      releasedTerritoryBoundaries: "exchange-territory-released-boundaries",
      scheduledTerritoryPoints: "exchange-territory-scheduled-points",
      scheduledTerritoryBoundaries: "exchange-territory-scheduled-boundaries",
    });
    expect(new Set(Object.values(EXCHANGE_MAP_SOURCE_IDS)).size).toBe(
      Object.values(EXCHANGE_MAP_SOURCE_IDS).length,
    );
    expect(new Set(Object.values(EXCHANGE_MAP_LAYER_IDS)).size).toBe(
      Object.values(EXCHANGE_MAP_LAYER_IDS).length,
    );
    expect(Object.isFrozen(EXCHANGE_MAP_SOURCE_IDS)).toBe(true);
    expect(Object.isFrozen(EXCHANGE_MAP_LAYER_IDS)).toBe(true);
  });

  it("keeps clustered RFx source and cluster/unclustered layers compatible", () => {
    const data = buildExchangeMapGeoJson([rfx()], [], []);
    const sources = createExchangeMapSourceSpecifications(data);
    const layers = createExchangeMapLayerSpecifications();
    const rfxSource = sources[EXCHANGE_MAP_SOURCE_IDS.rfx];
    const clusterLayers = layers.filter((layer) =>
      [
        EXCHANGE_MAP_LAYER_IDS.rfxClusters,
        EXCHANGE_MAP_LAYER_IDS.rfxClusterCount,
        EXCHANGE_MAP_LAYER_IDS.rfxPoints,
        EXCHANGE_MAP_LAYER_IDS.rfxLabels,
      ].includes(layer.id as (typeof EXCHANGE_MAP_LAYER_IDS)[keyof typeof EXCHANGE_MAP_LAYER_IDS]),
    );

    expect(rfxSource).toMatchObject({
      type: "geojson",
      cluster: true,
      promoteId: "id",
      clusterRadius: EXCHANGE_RFX_CLUSTER_OPTIONS.clusterRadius,
      clusterMaxZoom: EXCHANGE_RFX_CLUSTER_OPTIONS.clusterMaxZoom,
    });
    expect(clusterLayers).toHaveLength(4);
    expect(clusterLayers.every((layer) => layer.source === EXCHANGE_MAP_SOURCE_IDS.rfx)).toBe(true);
    expect(clusterLayers.find((layer) => layer.id === EXCHANGE_MAP_LAYER_IDS.rfxClusters)?.filter).toEqual([
      "has",
      "point_count",
    ]);
    expect(clusterLayers.find((layer) => layer.id === EXCHANGE_MAP_LAYER_IDS.rfxPoints)?.filter).toEqual([
      "!",
      ["has", "point_count"],
    ]);
    expect(sources[EXCHANGE_MAP_SOURCE_IDS.selectedRfx]).toMatchObject({
      type: "geojson",
      promoteId: "id",
    });
    expect(
      layers.find((layer) => layer.id === EXCHANGE_MAP_LAYER_IDS.selectedRfxPoint)?.source,
    ).toBe(EXCHANGE_MAP_SOURCE_IDS.selectedRfx);
  });

  it("maps RFx and territory selection props to feature-state source targets", () => {
    expect(getExchangeSelectionTargets({ entityType: "rfx", entityId: "rfx-1" })).toEqual([
      { source: EXCHANGE_MAP_SOURCE_IDS.rfx, id: "rfx-1" },
    ]);
    expect(
      getExchangeSelectionTargets({ entityType: "territory", entityId: "51093" }),
    ).toEqual([
      { source: EXCHANGE_MAP_SOURCE_IDS.releasedTerritoryPoints, id: "51093" },
      { source: EXCHANGE_MAP_SOURCE_IDS.releasedTerritoryBoundaries, id: "51093" },
      { source: EXCHANGE_MAP_SOURCE_IDS.scheduledTerritoryPoints, id: "51093" },
      { source: EXCHANGE_MAP_SOURCE_IDS.scheduledTerritoryBoundaries, id: "51093" },
    ]);

    const selectedExpressions = JSON.stringify(createExchangeMapLayerSpecifications());
    expect(selectedExpressions).toContain('["feature-state","selected"]');
  });

  it("projects the selected RFx into a non-clustered overlay source", () => {
    const data = buildExchangeMapGeoJson([rfx({ id: "selected-rfx" })], [], []);
    let selectedData: GeoJSON.GeoJSON | undefined;
    const map = {
      getSource: (sourceId: string) => sourceId === EXCHANGE_MAP_SOURCE_IDS.selectedRfx
        ? { type: "geojson", setData: (next: GeoJSON.GeoJSON) => { selectedData = next; } }
        : undefined,
    };

    updateExchangeSelectedRfxSource(
      map as never,
      data,
      { entityType: "rfx", entityId: "selected-rfx" },
    );
    expect(selectedData).toMatchObject({
      type: "FeatureCollection",
      features: [{ id: "selected-rfx" }],
    });

    updateExchangeSelectedRfxSource(
      map as never,
      data,
      { entityType: "territory", entityId: "51093" },
    );
    expect(selectedData).toMatchObject({ type: "FeatureCollection", features: [] });
  });
});
