import { describe, expect, it } from "vitest";
import type { RfxDoc, TerritoryDoc } from "@hi/shared";

import {
  buildExchangeMapGeoJson,
  getExchangeMapDataBounds,
  parseTerritoryBoundaryGeometry,
  toRfxFeatureCollection,
  toOrganizationFeatureCollection,
  toTerritoryBoundaryFeatureCollection,
  toTerritoryPointFeatureCollection,
} from "../../apps/web/src/features/exchange/map/geojson";
import {
  EXCHANGE_MAP_LAYER_IDS,
  EXCHANGE_MAP_SOURCE_IDS,
  EXCHANGE_ORGANIZATION_CLUSTER_OPTIONS,
  EXCHANGE_RFX_CLUSTER_OPTIONS,
} from "../../apps/web/src/features/exchange/map/mapConfig";
import { createExchangeMapLayerSpecifications } from "../../apps/web/src/features/exchange/map/mapLayers";
import {
  createExchangeMapSourceSpecifications,
  updateExchangeSelectedOrganizationSource,
  updateExchangeSelectedRfxSource,
} from "../../apps/web/src/features/exchange/map/mapSources";
import { getExchangeSelectionTargets } from "../../apps/web/src/features/exchange/map/selection";
import { filterPublicOrganizations } from "../../apps/web/src/features/exchange/data/organizationDiscovery";
import type { PublicOrganizationProjection } from "../../apps/web/src/lib/firestore";

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

function organization(
  overrides: Partial<PublicOrganizationProjection> = {},
): PublicOrganizationProjection {
  return {
    id: "org-1",
    name: "Isle Services",
    city: "Smithfield",
    state: "VA",
    territoryFips: "51093",
    status: "active",
    claimStatus: "unclaimed",
    verificationStatus: "verified",
    coordinatePublicationApproved: true,
    coordinateConfidence: "authoritative",
    latitude: 36.92,
    longitude: -76.7,
    naicsCodes: ["541330"],
    capabilityKeywords: ["engineering"],
    certifications: ["SWaM"],
    description: "Public organization description.",
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

  it("creates privacy-minimized organization markers and keeps suppressed records list-only", () => {
    const collection = toOrganizationFeatureCollection([
      organization({ id: "visible" }),
      organization({ id: "not-approved", coordinatePublicationApproved: false }),
      organization({ id: "approval-missing", coordinatePublicationApproved: undefined }),
      organization({ id: "home", homeBased: true }),
      organization({ id: "suppressed", privacySuppressed: true }),
      organization({ id: "no-coordinate", latitude: undefined, longitude: undefined }),
      organization({ id: "inactive", status: "inactive" }),
    ]);

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0]).toMatchObject({
      id: "visible",
      properties: {
        entityType: "organization",
        id: "visible",
        name: "Isle Services",
        territoryFips: "51093",
        coordinateConfidence: "authoritative",
      },
      geometry: { type: "Point", coordinates: [-76.7, 36.92] },
    });
    expect(JSON.stringify(collection)).not.toMatch(/email|phone|address|evidence|owner/i);
  });

  it("filters and de-duplicates list-only organizations without fabricating coordinates", () => {
    const records = [
      organization({ id: "matching", latitude: undefined, longitude: undefined }),
      organization({ id: "matching", name: "Duplicate" }),
      organization({ id: "other", capabilityKeywords: ["construction"] }),
    ];
    const result = filterPublicOrganizations(records, {
      searchQuery: "isle engineering",
      naicsFilters: ["541"],
      capabilityFilters: ["engineering"],
      certificationFilters: ["SWaM"],
      territoryFilters: ["51093"],
      opportunityLocation: undefined,
    });

    expect(result.map((record) => record.id)).toEqual(["matching"]);
    expect(result[0].latitude).toBeUndefined();
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

    const unreleased = territory({
      fips: "51800",
      name: "Suffolk",
      status: "paused",
      centroid: { lng: -79, lat: 38 },
      boundaryGeoJSON: {
        type: "Polygon",
        coordinates: [[[-79.1, 37.9], [-78.9, 37.9], [-78.9, 38.1], [-79.1, 37.9]]],
      },
    });
    const data = buildExchangeMapGeoJson([], [released], [scheduled], [unreleased]);

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
    expect(data.unreleasedTerritoryBoundaries.features[0]).toMatchObject({
      id: "51800",
      properties: { status: "paused" },
    });
    // Fit Results remains scoped to discoverable records; inactive context
    // geometry does not pull the camera away from the current workspace.
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
      organizations: "exchange-organization-points",
      contextOrganizations: "exchange-organization-context",
      selectedOrganization: "exchange-organization-selected",
      releasedTerritoryPoints: "exchange-territory-released-points",
      releasedTerritoryBoundaries: "exchange-territory-released-boundaries",
      scheduledTerritoryPoints: "exchange-territory-scheduled-points",
      scheduledTerritoryBoundaries: "exchange-territory-scheduled-boundaries",
      unreleasedTerritoryBoundaries: "exchange-territory-unreleased-boundaries",
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

  it("keeps organizations in a distinct clustered source and selected overlay", () => {
    const data = buildExchangeMapGeoJson([], [], [], [], [organization()]);
    const sources = createExchangeMapSourceSpecifications(data);
    const layers = createExchangeMapLayerSpecifications();

    expect(sources[EXCHANGE_MAP_SOURCE_IDS.organizations]).toMatchObject({
      type: "geojson",
      cluster: true,
      promoteId: "id",
      clusterRadius: EXCHANGE_ORGANIZATION_CLUSTER_OPTIONS.clusterRadius,
      clusterMaxZoom: EXCHANGE_ORGANIZATION_CLUSTER_OPTIONS.clusterMaxZoom,
    });
    expect(layers.find((layer) => layer.id === EXCHANGE_MAP_LAYER_IDS.organizationClusters)).toMatchObject({
      source: EXCHANGE_MAP_SOURCE_IDS.organizations,
      filter: ["has", "point_count"],
    });
    expect(layers.find((layer) => layer.id === EXCHANGE_MAP_LAYER_IDS.organizationPoints)).toMatchObject({
      source: EXCHANGE_MAP_SOURCE_IDS.organizations,
      filter: ["!", ["has", "point_count"]],
    });
    expect(layers.find((layer) => layer.id === EXCHANGE_MAP_LAYER_IDS.selectedOrganizationPoint)?.source)
      .toBe(EXCHANGE_MAP_SOURCE_IDS.selectedOrganization);
  });

  it("keeps actor and subject organizations in a separate unclustered context source", () => {
    const result = organization({ id: "result-org" });
    const actor = organization({ id: "actor-org", contextType: "actor" });
    const subject = organization({ id: "subject-org", contextType: "subject" });
    const data = buildExchangeMapGeoJson([], [], [], [], [result], [actor, subject]);
    const sources = createExchangeMapSourceSpecifications(data);
    const layers = createExchangeMapLayerSpecifications();

    expect(data.organizations.features.map((feature) => feature.id)).toEqual(["result-org"]);
    expect(data.contextOrganizations.features).toMatchObject([
      { id: "actor-org", properties: { contextType: "actor" } },
      { id: "subject-org", properties: { contextType: "subject" } },
    ]);
    expect(sources[EXCHANGE_MAP_SOURCE_IDS.contextOrganizations]).toMatchObject({
      type: "geojson",
      promoteId: "id",
      data: { features: [{ id: "actor-org" }, { id: "subject-org" }] },
    });
    expect(sources[EXCHANGE_MAP_SOURCE_IDS.contextOrganizations]).not.toHaveProperty("cluster");
    expect(layers.find(
      (layer) => layer.id === EXCHANGE_MAP_LAYER_IDS.contextOrganizationPoint,
    )).toMatchObject({
      source: EXCHANGE_MAP_SOURCE_IDS.contextOrganizations,
      type: "circle",
    });
    expect(layers.find(
      (layer) => layer.id === EXCHANGE_MAP_LAYER_IDS.contextOrganizationLabel,
    )).toMatchObject({
      source: EXCHANGE_MAP_SOURCE_IDS.contextOrganizations,
      type: "symbol",
    });
  });

  it("renders scheduled and inactive admin territory boundaries as non-discoverable gray context", () => {
    const paused = territory({ fips: "51800", status: "paused" });
    const data = buildExchangeMapGeoJson([], [], [], [paused]);
    const sources = createExchangeMapSourceSpecifications(data);
    const layers = createExchangeMapLayerSpecifications();

    expect(sources[EXCHANGE_MAP_SOURCE_IDS.unreleasedTerritoryBoundaries]).toMatchObject({
      type: "geojson",
      promoteId: "id",
      data: { features: [{ properties: { status: "paused" } }] },
    });
    expect(layers.find((layer) => layer.id === EXCHANGE_MAP_LAYER_IDS.unreleasedTerritoryFill)).toMatchObject({
      type: "fill",
      source: EXCHANGE_MAP_SOURCE_IDS.unreleasedTerritoryBoundaries,
      paint: { "fill-color": "#64748b", "fill-opacity": 0.28 },
    });
    expect(JSON.stringify(layers.find((layer) => layer.id === EXCHANGE_MAP_LAYER_IDS.scheduledTerritoryFill))).toContain("#94a3b8");
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
    expect(
      getExchangeSelectionTargets({ entityType: "organization", entityId: "org-1" }),
    ).toEqual([
      { source: EXCHANGE_MAP_SOURCE_IDS.organizations, id: "org-1" },
      { source: EXCHANGE_MAP_SOURCE_IDS.contextOrganizations, id: "org-1" },
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

  it("projects a selected organization into a non-clustered overlay source", () => {
    const data = buildExchangeMapGeoJson([], [], [], [], [organization({ id: "selected-org" })]);
    let selectedData: GeoJSON.GeoJSON | undefined;
    const map = {
      getSource: (sourceId: string) => sourceId === EXCHANGE_MAP_SOURCE_IDS.selectedOrganization
        ? { type: "geojson", setData: (next: GeoJSON.GeoJSON) => { selectedData = next; } }
        : undefined,
    };

    updateExchangeSelectedOrganizationSource(
      map as never,
      data,
      { entityType: "organization", entityId: "selected-org" },
    );
    expect(selectedData).toMatchObject({
      type: "FeatureCollection",
      features: [{ id: "selected-org" }],
    });
  });

  it("projects a selected context organization even when it is absent from mode results", () => {
    const data = buildExchangeMapGeoJson(
      [],
      [],
      [],
      [],
      [],
      [organization({ id: "subject-org", contextType: "subject" })],
    );
    let selectedData: GeoJSON.GeoJSON | undefined;
    const map = {
      getSource: (sourceId: string) => sourceId === EXCHANGE_MAP_SOURCE_IDS.selectedOrganization
        ? { type: "geojson", setData: (next: GeoJSON.GeoJSON) => { selectedData = next; } }
        : undefined,
    };

    updateExchangeSelectedOrganizationSource(
      map as never,
      data,
      { entityType: "organization", entityId: "subject-org" },
    );
    expect(selectedData).toMatchObject({
      type: "FeatureCollection",
      features: [{ id: "subject-org", properties: { contextType: "subject" } }],
    });
  });

  it.each([100, 1_000, 10_000])(
    "builds and serializes %i public organization markers within the regression budget",
    (count) => {
      const records = Array.from({ length: count }, (_, index) => organization({
        id: `scale-${index}`,
        name: `Scale organization ${index}`,
        longitude: -76.9 + (index % 100) * 0.002,
        latitude: 36.7 + (index % 80) * 0.002,
      }));
      const startedAt = performance.now();
      const collection = toOrganizationFeatureCollection(records);
      const payloadBytes = new TextEncoder().encode(JSON.stringify(collection)).byteLength;
      const elapsedMs = performance.now() - startedAt;

      expect(collection.features).toHaveLength(count);
      expect(elapsedMs).toBeLessThan(500);
      expect(payloadBytes).toBeLessThan(count * 400);
      console.info(JSON.stringify({ benchmark: "organization-markers", count, elapsedMs, payloadBytes }));
    },
  );
});
