import type {
  GeoJSONSource,
  Map as MapboxMap,
  MapLayerMouseEvent,
  MapboxErrorEvent,
  MapMouseEvent,
} from "mapbox-gl";

import {
  EXCHANGE_MAP_INTERACTIVE_LAYER_IDS,
  EXCHANGE_MAP_LAYER_IDS,
  EXCHANGE_MAP_SOURCE_IDS,
  type ExchangeMapBounds,
} from "./mapConfig";
import type { ExchangeMapSelection } from "./selection";

export interface ExchangeMapCallbacks {
  onSelect?: (selection: ExchangeMapSelection) => void;
  onSelectRfx?: (rfxId: string) => void;
  onSelectOrganization?: (organizationId: string) => void;
  onSelectTerritory?: (territoryId: string, status: "released" | "scheduled") => void;
  onBackgroundClick?: () => void;
  onViewportChange?: (bounds: ExchangeMapBounds) => void;
  onError?: (error: Error) => void;
  onLoad?: () => void;
}

export interface ExchangeMapCallbacksRef {
  current: ExchangeMapCallbacks;
}

export function readExchangeMapBounds(map: MapboxMap): ExchangeMapBounds | null {
  const bounds = map.getBounds();
  if (!bounds) return null;
  const center = map.getCenter();
  return {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
    longitude: center.lng,
    latitude: center.lat,
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
}

function asError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value.trim()) return new Error(value);
  return new Error("The map could not be loaded.");
}

function propertyString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function selectRfx(callbacksRef: ExchangeMapCallbacksRef, id: string): void {
  if (!id) return;
  callbacksRef.current.onSelect?.({ entityType: "rfx", entityId: id });
  callbacksRef.current.onSelectRfx?.(id);
}

function selectTerritory(
  callbacksRef: ExchangeMapCallbacksRef,
  id: string,
  status: "released" | "scheduled",
): void {
  if (!id) return;
  callbacksRef.current.onSelect?.({ entityType: "territory", entityId: id });
  callbacksRef.current.onSelectTerritory?.(id, status);
}

function selectOrganization(callbacksRef: ExchangeMapCallbacksRef, id: string): void {
  if (!id) return;
  callbacksRef.current.onSelect?.({ entityType: "organization", entityId: id });
  callbacksRef.current.onSelectOrganization?.(id);
}

/** Events that must exist before style load, registered once per map. */
export function registerExchangeMapBaseEvents(
  map: MapboxMap,
  callbacksRef: ExchangeMapCallbacksRef,
): () => void {
  const handleError = (event: MapboxErrorEvent) => {
    callbacksRef.current.onError?.(asError(event.error));
  };

  const emitViewport = () => {
    const bounds = readExchangeMapBounds(map);
    if (bounds) callbacksRef.current.onViewportChange?.(bounds);
  };

  map.on("error", handleError);
  map.on("moveend", emitViewport);

  return () => {
    map.off("error", handleError);
    map.off("moveend", emitViewport);
  };
}

/** Layer interactions are registered after the stable sources/layers exist. */
export function registerExchangeMapInteractionEvents(
  map: MapboxMap,
  callbacksRef: ExchangeMapCallbacksRef,
): () => void {
  const handleClick = (event: MapMouseEvent) => {
    const availableLayers = EXCHANGE_MAP_INTERACTIVE_LAYER_IDS.filter((layerId) =>
      Boolean(map.getLayer(layerId)),
    );
    const feature = map.queryRenderedFeatures(event.point, { layers: [...availableLayers] })[0];

    if (!feature) {
      callbacksRef.current.onSelect?.(null);
      callbacksRef.current.onBackgroundClick?.();
      return;
    }

    const layerId = feature.layer?.id;
    if (!layerId) return;

    if (
      layerId === EXCHANGE_MAP_LAYER_IDS.rfxClusters
      || layerId === EXCHANGE_MAP_LAYER_IDS.organizationClusters
    ) {
      const clusterId = Number(feature.properties?.cluster_id);
      const coordinates =
        feature.geometry.type === "Point" ? feature.geometry.coordinates : undefined;
      const source = map.getSource(
        layerId === EXCHANGE_MAP_LAYER_IDS.rfxClusters
          ? EXCHANGE_MAP_SOURCE_IDS.rfx
          : EXCHANGE_MAP_SOURCE_IDS.organizations,
      );

      if (
        source?.type === "geojson" &&
        Number.isFinite(clusterId) &&
        Array.isArray(coordinates) &&
        typeof coordinates[0] === "number" &&
        typeof coordinates[1] === "number"
      ) {
        (source as GeoJSONSource).getClusterExpansionZoom(clusterId, (error, zoom) => {
          if (error) {
            callbacksRef.current.onError?.(asError(error));
            return;
          }
          if (typeof zoom === "number") {
            map.easeTo({ center: [coordinates[0], coordinates[1]], zoom });
          }
        });
      }
      return;
    }

    const id = propertyString(feature.properties?.id);
    if (
      layerId === EXCHANGE_MAP_LAYER_IDS.rfxPoints
      || layerId === EXCHANGE_MAP_LAYER_IDS.selectedRfxPoint
    ) {
      selectRfx(callbacksRef, id);
      return;
    }

    if (
      layerId === EXCHANGE_MAP_LAYER_IDS.organizationPoints
      || layerId === EXCHANGE_MAP_LAYER_IDS.contextOrganizationPoint
      || layerId === EXCHANGE_MAP_LAYER_IDS.selectedOrganizationPoint
    ) {
      selectOrganization(callbacksRef, id);
      return;
    }

    const status = propertyString(feature.properties?.status);
    if (status === "released" || status === "scheduled") {
      selectTerritory(callbacksRef, id, status);
    }
  };

  const showPointer = () => {
    map.getCanvas().style.cursor = "pointer";
  };
  const hidePointer = () => {
    map.getCanvas().style.cursor = "";
  };

  map.on("click", handleClick);
  for (const layerId of EXCHANGE_MAP_INTERACTIVE_LAYER_IDS) {
    map.on("mouseenter", layerId, showPointer);
    map.on("mouseleave", layerId, hidePointer);
  }

  return () => {
    map.off("click", handleClick);
    for (const layerId of EXCHANGE_MAP_INTERACTIVE_LAYER_IDS) {
      map.off("mouseenter", layerId, showPointer as (event: MapLayerMouseEvent) => void);
      map.off("mouseleave", layerId, hidePointer as (event: MapLayerMouseEvent) => void);
    }
  };
}
