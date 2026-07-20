import type {
  OpportunityLocationFilter,
  OpportunitySort,
} from "@hi/shared/opportunity-discovery";
import type {
  ExchangeCompensationFilter,
  ExchangeConnectionMode,
  ExchangeIntelligenceMetric,
  ExchangePersonalizedFilter,
  ExchangeReferralStatus,
  ExchangeRelationshipFilter,
  ExchangeRfxStatus,
  ExchangeSelection,
  ExchangeSurfaceMode,
  ExchangeTerritoryStatus,
  ExchangeView,
  ExchangeViewport,
  ExchangeWorkspaceHydration,
} from "./exchangeWorkspaceTypes";

export interface ExchangeFilterUpdate {
  naicsFilters?: string[];
  industryFilters?: string[];
  capabilityFilters?: string[];
  territoryFilters?: string[];
  rfxStatusFilters?: ExchangeRfxStatus[];
  territoryStatusFilters?: ExchangeTerritoryStatus[];
  opportunityTypeFilters?: string[];
  rfxTypeFilters?: string[];
  buyerTypeFilters?: string[];
  workArrangementFilters?: string[];
  visibilityFilters?: string[];
  certificationFilters?: string[];
  setAsideFilters?: string[];
  primeClassificationFilters?: string[];
  awardClassificationFilters?: string[];
  personalizedFilters?: ExchangePersonalizedFilter[];
  localFirst?: boolean;
  closingSoon?: boolean;
  teamingSuitable?: boolean;
  budgetMin?: number;
  budgetMax?: number;
  opportunitySort?: OpportunitySort;
  opportunityLocation?: OpportunityLocationFilter;
  clearOpportunityLocation?: boolean;
  referralStatusFilters?: ExchangeReferralStatus[];
  connectionIndustryFilters?: string[];
  connectionTerritoryFilters?: string[];
  compensationFilter?: ExchangeCompensationFilter;
  relationshipFilter?: ExchangeRelationshipFilter;
}

export type ExchangeWorkspaceAction =
  | { type: "SET_VIEW"; view: ExchangeView }
  | { type: "SET_SEARCH"; query: string }
  | { type: "SET_FILTERS"; filters: ExchangeFilterUpdate }
  | { type: "CLEAR_FILTERS" }
  | { type: "SET_OPPORTUNITY_SORT"; sort: OpportunitySort }
  | { type: "SET_OPPORTUNITY_LOCATION"; location?: OpportunityLocationFilter }
  | { type: "SET_ACTIVE_SAVED_SEARCH"; id?: string }
  | { type: "SET_SURFACE_MODE"; mode: ExchangeSurfaceMode }
  | { type: "SET_CONNECTION_MODE"; mode: ExchangeConnectionMode }
  | { type: "SET_INTELLIGENCE_METRIC"; metric: ExchangeIntelligenceMetric }
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
  setView(view: ExchangeView): ExchangeWorkspaceAction {
    return { type: "SET_VIEW", view };
  },
  setSearch(query: string): ExchangeWorkspaceAction {
    return { type: "SET_SEARCH", query };
  },
  setFilters(filters: ExchangeFilterUpdate): ExchangeWorkspaceAction {
    return { type: "SET_FILTERS", filters };
  },
  clearFilters(): ExchangeWorkspaceAction {
    return { type: "CLEAR_FILTERS" };
  },
  setOpportunitySort(sort: OpportunitySort): ExchangeWorkspaceAction {
    return { type: "SET_OPPORTUNITY_SORT", sort };
  },
  setOpportunityLocation(
    location?: OpportunityLocationFilter,
  ): ExchangeWorkspaceAction {
    return { type: "SET_OPPORTUNITY_LOCATION", location };
  },
  setActiveSavedSearch(id?: string): ExchangeWorkspaceAction {
    return { type: "SET_ACTIVE_SAVED_SEARCH", id };
  },
  setSurfaceMode(mode: ExchangeSurfaceMode): ExchangeWorkspaceAction {
    return { type: "SET_SURFACE_MODE", mode };
  },
  setConnectionMode(mode: ExchangeConnectionMode): ExchangeWorkspaceAction {
    return { type: "SET_CONNECTION_MODE", mode };
  },
  setIntelligenceMetric(
    metric: ExchangeIntelligenceMetric,
  ): ExchangeWorkspaceAction {
    return { type: "SET_INTELLIGENCE_METRIC", metric };
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
