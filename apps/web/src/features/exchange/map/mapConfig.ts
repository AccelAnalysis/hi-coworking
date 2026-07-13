export const EXCHANGE_MAP_SOURCE_IDS = Object.freeze({
  rfx: "exchange-rfx-points",
  selectedRfx: "exchange-rfx-selected",
  releasedTerritoryPoints: "exchange-territory-released-points",
  releasedTerritoryBoundaries: "exchange-territory-released-boundaries",
  scheduledTerritoryPoints: "exchange-territory-scheduled-points",
  scheduledTerritoryBoundaries: "exchange-territory-scheduled-boundaries",
} as const);

export const EXCHANGE_MAP_LAYER_IDS = Object.freeze({
  scheduledTerritoryFill: "exchange-territory-scheduled-fill",
  releasedTerritoryFill: "exchange-territory-released-fill",
  scheduledTerritoryOutline: "exchange-territory-scheduled-outline",
  releasedTerritoryOutline: "exchange-territory-released-outline",
  scheduledTerritoryPoints: "exchange-territory-scheduled-points",
  releasedTerritoryPoints: "exchange-territory-released-points",
  scheduledTerritoryLabels: "exchange-territory-scheduled-labels",
  rfxClusters: "exchange-rfx-clusters",
  rfxClusterCount: "exchange-rfx-cluster-count",
  rfxPoints: "exchange-rfx-points-unclustered",
  selectedRfxPoint: "exchange-rfx-selected-point",
  rfxLabels: "exchange-rfx-labels",
} as const);

/** Stable aliases for consumers that prefer the shorter names. */
export const SOURCE_IDS = EXCHANGE_MAP_SOURCE_IDS;
export const LAYER_IDS = EXCHANGE_MAP_LAYER_IDS;

export const EXCHANGE_MAP_STYLE = "mapbox://styles/mapbox/light-v11";
export const EXCHANGE_MAP_CENTER: [number, number] = [-76.7075, 36.9];

export interface ExchangeMapViewport {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface ExchangeMapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
}

export const DEFAULT_EXCHANGE_MAP_VIEWPORT: Readonly<ExchangeMapViewport> = Object.freeze({
  longitude: EXCHANGE_MAP_CENTER[0],
  latitude: EXCHANGE_MAP_CENTER[1],
  zoom: 9.7,
  bearing: -10,
  pitch: 35,
});

export const EXCHANGE_RFX_CLUSTER_OPTIONS = Object.freeze({
  cluster: true,
  clusterRadius: 45,
  clusterMaxZoom: 12,
} as const);

export const EXCHANGE_MAP_INTERACTIVE_LAYER_IDS = Object.freeze([
  EXCHANGE_MAP_LAYER_IDS.rfxClusters,
  EXCHANGE_MAP_LAYER_IDS.selectedRfxPoint,
  EXCHANGE_MAP_LAYER_IDS.rfxPoints,
  EXCHANGE_MAP_LAYER_IDS.releasedTerritoryPoints,
  EXCHANGE_MAP_LAYER_IDS.scheduledTerritoryPoints,
  EXCHANGE_MAP_LAYER_IDS.releasedTerritoryFill,
  EXCHANGE_MAP_LAYER_IDS.scheduledTerritoryFill,
] as const);
