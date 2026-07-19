import type { GeoJSONSource, GeoJSONSourceSpecification, Map as MapboxMap } from "mapbox-gl";

import { EXCHANGE_MAP_SOURCE_IDS, EXCHANGE_RFX_CLUSTER_OPTIONS } from "./mapConfig";
import type { ExchangeMapGeoJson } from "./geojson";
import type { ExchangeMapSelection } from "./selection";

export type ExchangeMapSourceSpecifications = Record<
  (typeof EXCHANGE_MAP_SOURCE_IDS)[keyof typeof EXCHANGE_MAP_SOURCE_IDS],
  GeoJSONSourceSpecification
>;

export function createExchangeMapSourceSpecifications(
  data: ExchangeMapGeoJson,
): ExchangeMapSourceSpecifications {
  return {
    [EXCHANGE_MAP_SOURCE_IDS.rfx]: {
      type: "geojson",
      data: data.rfx,
      promoteId: "id",
      ...EXCHANGE_RFX_CLUSTER_OPTIONS,
    },
    [EXCHANGE_MAP_SOURCE_IDS.selectedRfx]: {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      promoteId: "id",
    },
    [EXCHANGE_MAP_SOURCE_IDS.releasedTerritoryPoints]: {
      type: "geojson",
      data: data.releasedTerritoryPoints,
      promoteId: "id",
    },
    [EXCHANGE_MAP_SOURCE_IDS.releasedTerritoryBoundaries]: {
      type: "geojson",
      data: data.releasedTerritoryBoundaries,
      promoteId: "id",
    },
    [EXCHANGE_MAP_SOURCE_IDS.scheduledTerritoryPoints]: {
      type: "geojson",
      data: data.scheduledTerritoryPoints,
      promoteId: "id",
    },
    [EXCHANGE_MAP_SOURCE_IDS.scheduledTerritoryBoundaries]: {
      type: "geojson",
      data: data.scheduledTerritoryBoundaries,
      promoteId: "id",
    },
    [EXCHANGE_MAP_SOURCE_IDS.unreleasedTerritoryBoundaries]: {
      type: "geojson",
      data: data.unreleasedTerritoryBoundaries,
      promoteId: "id",
    },
  };
}

/** Register each stable source once after style load. */
export function registerExchangeMapSources(map: MapboxMap, data: ExchangeMapGeoJson): void {
  const sources = createExchangeMapSourceSpecifications(data);

  for (const [sourceId, specification] of Object.entries(sources)) {
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, specification);
    }
  }
}

function setGeoJsonSourceData(
  map: MapboxMap,
  sourceId: string,
  data: GeoJSON.GeoJSON,
): void {
  const source = map.getSource(sourceId);
  if (source && source.type === "geojson") {
    (source as GeoJSONSource).setData(data);
  }
}

/** Update data without replacing the map, source, layers, or listeners. */
export function updateExchangeMapSources(map: MapboxMap, data: ExchangeMapGeoJson): void {
  setGeoJsonSourceData(map, EXCHANGE_MAP_SOURCE_IDS.rfx, data.rfx);
  setGeoJsonSourceData(
    map,
    EXCHANGE_MAP_SOURCE_IDS.releasedTerritoryPoints,
    data.releasedTerritoryPoints,
  );
  setGeoJsonSourceData(
    map,
    EXCHANGE_MAP_SOURCE_IDS.releasedTerritoryBoundaries,
    data.releasedTerritoryBoundaries,
  );
  setGeoJsonSourceData(
    map,
    EXCHANGE_MAP_SOURCE_IDS.scheduledTerritoryPoints,
    data.scheduledTerritoryPoints,
  );
  setGeoJsonSourceData(
    map,
    EXCHANGE_MAP_SOURCE_IDS.scheduledTerritoryBoundaries,
    data.scheduledTerritoryBoundaries,
  );
  setGeoJsonSourceData(
    map,
    EXCHANGE_MAP_SOURCE_IDS.unreleasedTerritoryBoundaries,
    data.unreleasedTerritoryBoundaries,
  );
}

/** Keep a selected RFx visible even while its ordinary point is clustered. */
export function updateExchangeSelectedRfxSource(
  map: MapboxMap,
  data: ExchangeMapGeoJson,
  selection: ExchangeMapSelection,
): void {
  const selectedFeature = selection?.entityType === "rfx"
    ? data.rfx.features.find((feature) => feature.properties.id === selection.entityId)
    : undefined;
  setGeoJsonSourceData(map, EXCHANGE_MAP_SOURCE_IDS.selectedRfx, {
    type: "FeatureCollection",
    features: selectedFeature ? [selectedFeature] : [],
  });
}
