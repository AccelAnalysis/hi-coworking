import type { RfxStatus } from "@hi/shared";

export const EXCHANGE_SURFACE_MODES = ["map", "list", "split"] as const;
export type ExchangeSurfaceMode = (typeof EXCHANGE_SURFACE_MODES)[number];

export const EXCHANGE_VIEWS = ["opportunities"] as const;
export type ExchangeView = (typeof EXCHANGE_VIEWS)[number];

export const EXCHANGE_TERRITORY_STATUSES = ["released", "scheduled"] as const;
export type ExchangeTerritoryStatus =
  (typeof EXCHANGE_TERRITORY_STATUSES)[number];

export const EXCHANGE_RFX_STATUSES = [
  "open",
] as const satisfies readonly RfxStatus[];
export type ExchangeRfxStatus = (typeof EXCHANGE_RFX_STATUSES)[number];

export type ExchangeSelection =
  | { entityType: "rfx"; entityId: string }
  | { entityType: "territory"; entityId: string }
  | null;

export interface ExchangeViewport {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface ExchangeWorkspaceState {
  view: ExchangeView;
  surfaceMode: ExchangeSurfaceMode;
  selection: ExchangeSelection;

  searchQuery: string;
  naicsFilters: string[];
  territoryFilters: string[];
  rfxStatusFilters: ExchangeRfxStatus[];
  territoryStatusFilters: ExchangeTerritoryStatus[];
  localFirst: boolean;

  leftPanelCollapsed: boolean;
  rightPanelOpen: boolean;

  mobileFilterOpen: boolean;
  mobileDetailOpen: boolean;

  viewport?: ExchangeViewport;
}

/**
 * The subset of interaction state that is meaningful in a shareable URL.
 * Drawer and panel animation state intentionally does not cross this boundary.
 */
export type ExchangeUrlState = Pick<
  ExchangeWorkspaceState,
  | "view"
  | "surfaceMode"
  | "selection"
  | "searchQuery"
  | "naicsFilters"
  | "territoryFilters"
  | "rfxStatusFilters"
  | "territoryStatusFilters"
  | "localFirst"
  | "viewport"
>;

export type ExchangeWorkspaceHydration = Partial<ExchangeUrlState>;

export const DEFAULT_EXCHANGE_VIEW: ExchangeView = "opportunities";
export const DEFAULT_EXCHANGE_SURFACE_MODE: ExchangeSurfaceMode = "split";
export const DEFAULT_EXCHANGE_LOCAL_FIRST = true;

export function createInitialExchangeWorkspaceState(): ExchangeWorkspaceState {
  return {
    view: DEFAULT_EXCHANGE_VIEW,
    surfaceMode: DEFAULT_EXCHANGE_SURFACE_MODE,
    selection: null,
    searchQuery: "",
    naicsFilters: [],
    territoryFilters: [],
    rfxStatusFilters: [],
    territoryStatusFilters: [],
    localFirst: DEFAULT_EXCHANGE_LOCAL_FIRST,
    leftPanelCollapsed: false,
    rightPanelOpen: false,
    mobileFilterOpen: false,
    mobileDetailOpen: false,
    viewport: undefined,
  };
}

export const initialExchangeWorkspaceState =
  createInitialExchangeWorkspaceState();

export function isExchangeSurfaceMode(
  value: unknown,
): value is ExchangeSurfaceMode {
  return typeof value === "string"
    && (EXCHANGE_SURFACE_MODES as readonly string[]).includes(value);
}

export function isExchangeView(value: unknown): value is ExchangeView {
  return typeof value === "string"
    && (EXCHANGE_VIEWS as readonly string[]).includes(value);
}

export function isExchangeRfxStatus(
  value: unknown,
): value is ExchangeRfxStatus {
  return typeof value === "string"
    && (EXCHANGE_RFX_STATUSES as readonly string[]).includes(value);
}

export function isExchangeTerritoryStatus(
  value: unknown,
): value is ExchangeTerritoryStatus {
  return typeof value === "string"
    && (EXCHANGE_TERRITORY_STATUSES as readonly string[]).includes(value);
}
