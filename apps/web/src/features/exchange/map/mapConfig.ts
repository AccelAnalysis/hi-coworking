export const EXCHANGE_MAP_SOURCE_IDS = Object.freeze({
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
} as const);

export const EXCHANGE_MAP_LAYER_IDS = Object.freeze({
  buildings3d: "exchange-buildings-3d",
  unreleasedTerritoryFill: "exchange-territory-unreleased-fill",
  unreleasedTerritoryOutline: "exchange-territory-unreleased-outline",
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
  organizationClusters: "exchange-organization-clusters",
  organizationClusterCount: "exchange-organization-cluster-count",
  organizationPoints: "exchange-organization-points-unclustered",
  contextOrganizationPoint: "exchange-organization-context-point",
  contextOrganizationLabel: "exchange-organization-context-label",
  selectedOrganizationPoint: "exchange-organization-selected-point",
  organizationLabels: "exchange-organization-labels",
} as const);

/** Stable aliases for consumers that prefer the shorter names. */
export const SOURCE_IDS = EXCHANGE_MAP_SOURCE_IDS;
export const LAYER_IDS = EXCHANGE_MAP_LAYER_IDS;

// Streets v12 is the most broadly compatible first-party Mapbox style for the
// Exchange's current local/browser matrix. The 3D control uses the style's
// composite building source rather than depending on Standard-style config.
export const EXCHANGE_MAP_STYLE = "mapbox://styles/mapbox/streets-v12";
export const EXCHANGE_MAP_CENTER: [number, number] = [-76.7075, 36.9];
export const EXCHANGE_MAP_DIMENSIONS = ["2d", "3d"] as const;
export type ExchangeMapDimension = (typeof EXCHANGE_MAP_DIMENSIONS)[number];

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
  bearing: 0,
  pitch: 0,
});

export const EXCHANGE_3D_VIEWPORT = Object.freeze({
  bearing: -14,
  pitch: 58,
});

export const EXCHANGE_RFX_CLUSTER_OPTIONS = Object.freeze({
  cluster: true,
  clusterRadius: 45,
  clusterMaxZoom: 12,
} as const);

export const EXCHANGE_ORGANIZATION_CLUSTER_OPTIONS = Object.freeze({
  cluster: true,
  clusterRadius: 48,
  clusterMaxZoom: 13,
} as const);

export const EXCHANGE_MAP_INTERACTIVE_LAYER_IDS = Object.freeze([
  EXCHANGE_MAP_LAYER_IDS.rfxClusters,
  EXCHANGE_MAP_LAYER_IDS.selectedRfxPoint,
  EXCHANGE_MAP_LAYER_IDS.rfxPoints,
  EXCHANGE_MAP_LAYER_IDS.organizationClusters,
  EXCHANGE_MAP_LAYER_IDS.contextOrganizationPoint,
  EXCHANGE_MAP_LAYER_IDS.selectedOrganizationPoint,
  EXCHANGE_MAP_LAYER_IDS.organizationPoints,
  EXCHANGE_MAP_LAYER_IDS.releasedTerritoryPoints,
  EXCHANGE_MAP_LAYER_IDS.scheduledTerritoryPoints,
  EXCHANGE_MAP_LAYER_IDS.releasedTerritoryFill,
  EXCHANGE_MAP_LAYER_IDS.scheduledTerritoryFill,
] as const);
