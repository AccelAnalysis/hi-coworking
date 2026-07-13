import type {
  ExchangeRfxStatus,
  ExchangeSelection,
  ExchangeSurfaceMode,
  ExchangeTerritoryStatus,
  ExchangeViewport,
  ExchangeWorkspaceHydration,
} from "./exchangeWorkspaceTypes";

export interface ExchangeFilterUpdate {
  naicsFilters?: string[];
  territoryFilters?: string[];
  rfxStatusFilters?: ExchangeRfxStatus[];
  territoryStatusFilters?: ExchangeTerritoryStatus[];
  localFirst?: boolean;
}

export type ExchangeWorkspaceAction =
  | { type: "SET_SEARCH"; query: string }
  | { type: "SET_FILTERS"; filters: ExchangeFilterUpdate }
  | { type: "CLEAR_FILTERS" }
  | { type: "SET_SURFACE_MODE"; mode: ExchangeSurfaceMode }
  | { type: "SELECT_ENTITY"; selection: Exclude<ExchangeSelection, null> }
  | { type: "CLEAR_SELECTION" }
  | { type: "TOGGLE_LEFT_PANEL" }
  | { type: "SET_LEFT_PANEL_COLLAPSED"; collapsed: boolean }
  | { type: "OPEN_RIGHT_PANEL" }
  | { type: "CLOSE_RIGHT_PANEL" }
  | { type: "OPEN_MOBILE_FILTER" }
  | { type: "CLOSE_MOBILE_FILTER" }
  | { type: "OPEN_MOBILE_DETAIL" }
  | { type: "CLOSE_MOBILE_DETAIL" }
  | { type: "SET_VIEWPORT"; viewport?: ExchangeViewport }
  | { type: "HYDRATE_FROM_URL"; state: ExchangeWorkspaceHydration };

export const exchangeWorkspaceActions = {
  setSearch(query: string): ExchangeWorkspaceAction {
    return { type: "SET_SEARCH", query };
  },
  setFilters(filters: ExchangeFilterUpdate): ExchangeWorkspaceAction {
    return { type: "SET_FILTERS", filters };
  },
  clearFilters(): ExchangeWorkspaceAction {
    return { type: "CLEAR_FILTERS" };
  },
  setSurfaceMode(mode: ExchangeSurfaceMode): ExchangeWorkspaceAction {
    return { type: "SET_SURFACE_MODE", mode };
  },
  selectEntity(
    selection: Exclude<ExchangeSelection, null>,
  ): ExchangeWorkspaceAction {
    return { type: "SELECT_ENTITY", selection };
  },
  clearSelection(): ExchangeWorkspaceAction {
    return { type: "CLEAR_SELECTION" };
  },
  toggleLeftPanel(): ExchangeWorkspaceAction {
    return { type: "TOGGLE_LEFT_PANEL" };
  },
  setLeftPanelCollapsed(collapsed: boolean): ExchangeWorkspaceAction {
    return { type: "SET_LEFT_PANEL_COLLAPSED", collapsed };
  },
  openRightPanel(): ExchangeWorkspaceAction {
    return { type: "OPEN_RIGHT_PANEL" };
  },
  closeRightPanel(): ExchangeWorkspaceAction {
    return { type: "CLOSE_RIGHT_PANEL" };
  },
  openMobileFilter(): ExchangeWorkspaceAction {
    return { type: "OPEN_MOBILE_FILTER" };
  },
  closeMobileFilter(): ExchangeWorkspaceAction {
    return { type: "CLOSE_MOBILE_FILTER" };
  },
  openMobileDetail(): ExchangeWorkspaceAction {
    return { type: "OPEN_MOBILE_DETAIL" };
  },
  closeMobileDetail(): ExchangeWorkspaceAction {
    return { type: "CLOSE_MOBILE_DETAIL" };
  },
  setViewport(viewport?: ExchangeViewport): ExchangeWorkspaceAction {
    return { type: "SET_VIEWPORT", viewport };
  },
  hydrateFromUrl(state: ExchangeWorkspaceHydration): ExchangeWorkspaceAction {
    return { type: "HYDRATE_FROM_URL", state };
  },
};
