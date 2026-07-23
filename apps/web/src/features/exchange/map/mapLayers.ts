import type { LayerSpecification, Map as MapboxMap } from "mapbox-gl";

import { EXCHANGE_MAP_LAYER_IDS, EXCHANGE_MAP_SOURCE_IDS } from "./mapConfig";

const selected = ["boolean", ["feature-state", "selected"], false] as const;

/**
 * Pure layer specifications make ordering and source compatibility auditable.
 * They are registered once; feature-state and setData drive later updates.
 */
export function createExchangeMapLayerSpecifications(): LayerSpecification[] {
  return [
    {
      id: EXCHANGE_MAP_LAYER_IDS.buildings3d,
      source: "composite",
      "source-layer": "building",
      type: "fill-extrusion",
      minzoom: 14,
      filter: ["==", ["get", "extrude"], "true"],
      layout: {
        visibility: "none",
      },
      paint: {
        "fill-extrusion-color": "#cbd5e1",
        "fill-extrusion-height": ["coalesce", ["get", "height"], 0],
        "fill-extrusion-base": ["coalesce", ["get", "min_height"], 0],
        "fill-extrusion-opacity": 0.62,
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.unreleasedTerritoryFill,
      type: "fill",
      source: EXCHANGE_MAP_SOURCE_IDS.unreleasedTerritoryBoundaries,
      paint: {
        "fill-color": "#64748b",
        "fill-opacity": 0.28,
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.scheduledTerritoryFill,
      type: "fill",
      source: EXCHANGE_MAP_SOURCE_IDS.scheduledTerritoryBoundaries,
      paint: {
        "fill-color": ["case", selected, "#78716c", "#94a3b8"],
        "fill-opacity": ["case", selected, 0.28, 0.18],
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.releasedTerritoryFill,
      type: "fill",
      source: EXCHANGE_MAP_SOURCE_IDS.releasedTerritoryBoundaries,
      paint: {
        "fill-color": ["case", selected, "#15803d", "#22c55e"],
        "fill-opacity": ["case", selected, 0.2, 0.08],
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.unreleasedTerritoryOutline,
      type: "line",
      source: EXCHANGE_MAP_SOURCE_IDS.unreleasedTerritoryBoundaries,
      paint: {
        "line-color": "#475569",
        "line-width": 1.5,
        "line-opacity": 0.72,
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.scheduledTerritoryOutline,
      type: "line",
      source: EXCHANGE_MAP_SOURCE_IDS.scheduledTerritoryBoundaries,
      paint: {
        "line-color": "#64748b",
        "line-width": ["case", selected, 3, 1.5],
        "line-opacity": ["case", selected, 0.95, 0.55],
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.releasedTerritoryOutline,
      type: "line",
      source: EXCHANGE_MAP_SOURCE_IDS.releasedTerritoryBoundaries,
      paint: {
        "line-color": "#166534",
        "line-width": ["case", selected, 3, 1.5],
        "line-opacity": ["case", selected, 0.9, 0.5],
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.releasedTerritoryPoints,
      type: "circle",
      source: EXCHANGE_MAP_SOURCE_IDS.releasedTerritoryPoints,
      paint: {
        "circle-color": "#22c55e",
        "circle-radius": ["case", selected, 11, 8],
        "circle-opacity": ["case", selected, 0.95, 0.68],
        "circle-stroke-width": ["case", selected, 3, 2],
        "circle-stroke-color": "#166534",
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.scheduledTerritoryPoints,
      type: "circle",
      source: EXCHANGE_MAP_SOURCE_IDS.scheduledTerritoryPoints,
      paint: {
        "circle-color": "#f59e0b",
        "circle-radius": ["case", selected, 11, 8],
        "circle-opacity": ["case", selected, 0.85, 0.5],
        "circle-stroke-width": ["case", selected, 3, 2],
        "circle-stroke-color": "#92400e",
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.scheduledTerritoryLabels,
      type: "symbol",
      source: EXCHANGE_MAP_SOURCE_IDS.scheduledTerritoryPoints,
      layout: {
        "text-field": ["coalesce", ["get", "releaseLabel"], ""],
        "text-size": 10,
        "text-offset": [0, 1.35],
        "text-anchor": "top",
        "text-max-width": 12,
      },
      paint: {
        "text-color": "#78350f",
        "text-halo-color": "#fffbeb",
        "text-halo-width": 1,
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.organizationClusters,
      type: "circle",
      source: EXCHANGE_MAP_SOURCE_IDS.organizations,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#7c3aed", 25, "#6d28d9", 100, "#4c1d95"],
        "circle-radius": ["step", ["get", "point_count"], 17, 25, 22, 100, 28],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.organizationClusterCount,
      type: "symbol",
      source: EXCHANGE_MAP_SOURCE_IDS.organizations,
      filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 },
      paint: { "text-color": "#ffffff" },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.organizationPoints,
      type: "circle",
      source: EXCHANGE_MAP_SOURCE_IDS.organizations,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": [
          "case",
          selected,
          "#312e81",
          ["match", ["get", "verificationStatus"], "verified", "#7c3aed", "#a78bfa"],
        ],
        "circle-radius": ["case", selected, 10, 6],
        "circle-stroke-width": ["case", selected, 3, 1.5],
        "circle-stroke-color": "#ffffff",
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.contextOrganizationPoint,
      type: "circle",
      source: EXCHANGE_MAP_SOURCE_IDS.contextOrganizations,
      paint: {
        "circle-color": [
          "match",
          ["get", "contextType"],
          "actor_subject",
          "#0f766e",
          "actor",
          "#0369a1",
          "#312e81",
        ],
        "circle-radius": 10,
        "circle-stroke-width": 4,
        "circle-stroke-color": "#ffffff",
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.contextOrganizationLabel,
      type: "symbol",
      source: EXCHANGE_MAP_SOURCE_IDS.contextOrganizations,
      minzoom: 8,
      layout: {
        "text-field": ["concat", ["get", "name"], " · context"],
        "text-size": 11,
        "text-offset": [0, 1.3],
        "text-anchor": "top",
        "text-max-width": 14,
      },
      paint: {
        "text-color": "#1e1b4b",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.selectedOrganizationPoint,
      type: "circle",
      source: EXCHANGE_MAP_SOURCE_IDS.selectedOrganization,
      paint: {
        "circle-color": "#312e81",
        "circle-radius": 16,
        "circle-stroke-width": 6,
        "circle-stroke-color": "#ffffff",
        "circle-blur": 0.04,
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.organizationLabels,
      type: "symbol",
      source: EXCHANGE_MAP_SOURCE_IDS.organizations,
      filter: ["!", ["has", "point_count"]],
      minzoom: 11,
      layout: {
        "text-field": ["get", "name"],
        "text-size": 10,
        "text-offset": [0, 1.15],
        "text-anchor": "top",
        "text-max-width": 13,
      },
      paint: {
        "text-color": "#312e81",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1,
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.rfxClusters,
      type: "circle",
      source: EXCHANGE_MAP_SOURCE_IDS.rfx,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#334155", 10, "#1d4ed8", 30, "#0f766e"],
        "circle-radius": ["step", ["get", "point_count"], 18, 10, 22, 30, 28],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.rfxClusterCount,
      type: "symbol",
      source: EXCHANGE_MAP_SOURCE_IDS.rfx,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": 12,
      },
      paint: { "text-color": "#ffffff" },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.rfxPoints,
      type: "circle",
      source: EXCHANGE_MAP_SOURCE_IDS.rfx,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": [
          "case",
          selected,
          "#0f172a",
          [
            "match",
            ["get", "status"],
            "open",
            "#16a34a",
            "awarded",
            "#4338ca",
            "closed",
            "#64748b",
            "#ca8a04",
          ],
        ],
        "circle-radius": ["case", selected, 10, 6],
        "circle-stroke-width": ["case", selected, 3, 1.5],
        "circle-stroke-color": "#ffffff",
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.selectedRfxPoint,
      type: "circle",
      source: EXCHANGE_MAP_SOURCE_IDS.selectedRfx,
      paint: {
        "circle-color": "#0f172a",
        "circle-radius": 11,
        "circle-stroke-width": 4,
        "circle-stroke-color": "#ffffff",
      },
    },
    {
      id: EXCHANGE_MAP_LAYER_IDS.rfxLabels,
      type: "symbol",
      source: EXCHANGE_MAP_SOURCE_IDS.rfx,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "text-field": ["get", "title"],
        "text-size": 11,
        "text-offset": [0, 1.2],
        "text-anchor": "top",
        "text-max-width": 14,
      },
      paint: {
        "text-color": "#0f172a",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1,
      },
    },
  ];
}

export function registerExchangeMapLayers(map: MapboxMap): void {
  for (const layer of createExchangeMapLayerSpecifications()) {
    if (!map.getLayer(layer.id)) {
      map.addLayer(layer);
    }
  }
}
