import {
  opportunityLocationFilterSchema,
  type OpportunityLocationFilter,
} from "@hi/shared/opportunity-discovery";
import type {
  ExchangeFilterUpdate,
  ExchangeWorkspaceAction,
} from "./exchangeWorkspaceActions";
import {
  DEFAULT_EXCHANGE_COMPENSATION_FILTER,
  DEFAULT_EXCHANGE_INTELLIGENCE_METRIC,
  DEFAULT_EXCHANGE_LOCAL_FIRST,
  DEFAULT_EXCHANGE_OPPORTUNITY_SORT,
  DEFAULT_EXCHANGE_RELATIONSHIP_FILTER,
  createInitialExchangeWorkspaceState,
  isExchangeCompensationFilter,
  isExchangeConnectionMode,
  isExchangeIntelligenceMetric,
  isExchangeOpportunitySort,
  isExchangePersonalizedFilter,
  isExchangeRfxStatus,
  isExchangeReferralStatus,
  isExchangeRelationshipFilter,
  isExchangeSurfaceMode,
  isExchangeTerritoryStatus,
  isExchangeView,
  type ExchangeSelection,
  type ExchangeViewport,
  type ExchangeWorkspaceHydration,
  type ExchangeWorkspaceState,
} from "./exchangeWorkspaceTypes";

const MAX_SEARCH_LENGTH = 240;
const MAX_FILTER_COUNT = 60;
const MAX_FILTER_LENGTH = 160;
const MAX_ENTITY_ID_LENGTH = 160;

function own(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeSearch(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_SEARCH_LENGTH) : "";
}

function normalizeStringList(value: unknown, maxLength = MAX_FILTER_LENGTH): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const candidate = item.trim().slice(0, maxLength);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    normalized.push(candidate);
    if (normalized.length >= MAX_FILTER_COUNT) break;
  }
  return normalized;
}

function normalizeOptionalMoney(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 10_000_000_000
    ? parsed
    : undefined;
}

function normalizeSelection(value: unknown): ExchangeSelection | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;

  const candidate = value as { entityType?: unknown; entityId?: unknown };
  if (
    candidate.entityType !== "rfx"
    && candidate.entityType !== "territory"
    && candidate.entityType !== "organization"
    && candidate.entityType !== "referral"
    && candidate.entityType !== "relationship"
    && candidate.entityType !== "industry"
  ) {
    return undefined;
  }
  if (
    typeof candidate.entityId !== "string"
    || candidate.entityId.length === 0
    || candidate.entityId.length > MAX_ENTITY_ID_LENGTH
    || /[\u0000-\u001f\u007f]/.test(candidate.entityId)
  ) {
    return undefined;
  }

  return {
    entityType: candidate.entityType,
    entityId: candidate.entityId,
  };
}

export function normalizeExchangeViewport(
  value: unknown,
): ExchangeViewport | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<Record<keyof ExchangeViewport, unknown>>;
  const longitude = candidate.longitude;
  const latitude = candidate.latitude;
  const zoom = candidate.zoom;
  const bearing = candidate.bearing;
  const pitch = candidate.pitch;

  if (
    typeof longitude !== "number"
    || !Number.isFinite(longitude)
    || longitude < -180
    || longitude > 180
    || typeof latitude !== "number"
    || !Number.isFinite(latitude)
    || latitude < -85.051129
    || latitude > 85.051129
    || typeof zoom !== "number"
    || !Number.isFinite(zoom)
    || zoom < 0
    || zoom > 24
  ) {
    return undefined;
  }

  if (
    bearing !== undefined
    && (typeof bearing !== "number" || !Number.isFinite(bearing) || bearing < -180 || bearing > 180)
  ) {
    return undefined;
  }
  if (
    pitch !== undefined
    && (typeof pitch !== "number" || !Number.isFinite(pitch) || pitch < 0 || pitch > 85)
  ) {
    return undefined;
  }

  return {
    longitude,
    latitude,
    zoom,
    ...(typeof bearing === "number" ? { bearing } : {}),
    ...(typeof pitch === "number" ? { pitch } : {}),
  };
}

export function normalizeOpportunityLocation(
  value: unknown,
): OpportunityLocationFilter | undefined {
  const parsed = opportunityLocationFilterSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const location = parsed.data;
  if (!location.label && location.latitude === undefined && !location.bounds) {
    return undefined;
  }
  return location;
}

function applyFilterUpdate(
  state: ExchangeWorkspaceState,
  filters: ExchangeFilterUpdate,
): ExchangeWorkspaceState {
  const next = { ...state };

  const stringListFields = [
    "naicsFilters",
    "industryFilters",
    "capabilityFilters",
    "territoryFilters",
    "opportunityTypeFilters",
    "rfxTypeFilters",
    "buyerTypeFilters",
    "workArrangementFilters",
    "visibilityFilters",
    "certificationFilters",
    "setAsideFilters",
    "primeClassificationFilters",
    "awardClassificationFilters",
    "connectionIndustryFilters",
    "connectionTerritoryFilters",
  ] as const;
  for (const field of stringListFields) {
    if (own(filters, field)) {
      next[field] = normalizeStringList(filters[field]);
    }
  }
  if (own(filters, "rfxStatusFilters")) {
    next.rfxStatusFilters = normalizeStringList(filters.rfxStatusFilters)
      .filter(isExchangeRfxStatus);
  }
  if (own(filters, "territoryStatusFilters")) {
    next.territoryStatusFilters = normalizeStringList(
      filters.territoryStatusFilters,
    ).filter(isExchangeTerritoryStatus);
  }
  if (own(filters, "personalizedFilters")) {
    next.personalizedFilters = normalizeStringList(filters.personalizedFilters)
      .filter(isExchangePersonalizedFilter);
  }
  if (typeof filters.localFirst === "boolean") next.localFirst = filters.localFirst;
  if (typeof filters.closingSoon === "boolean") next.closingSoon = filters.closingSoon;
  if (typeof filters.teamingSuitable === "boolean") next.teamingSuitable = filters.teamingSuitable;
  if (own(filters, "budgetMin")) next.budgetMin = normalizeOptionalMoney(filters.budgetMin);
  if (own(filters, "budgetMax")) next.budgetMax = normalizeOptionalMoney(filters.budgetMax);
  if (isExchangeOpportunitySort(filters.opportunitySort)) {
    next.opportunitySort = filters.opportunitySort;
  }
  if (filters.clearOpportunityLocation) {
    next.opportunityLocation = undefined;
  } else if (own(filters, "opportunityLocation")) {
    next.opportunityLocation = normalizeOpportunityLocation(filters.opportunityLocation);
  }
  if (own(filters, "referralStatusFilters")) {
    next.referralStatusFilters = normalizeStringList(filters.referralStatusFilters)
      .filter(isExchangeReferralStatus);
  }
  if (isExchangeCompensationFilter(filters.compensationFilter)) {
    next.compensationFilter = filters.compensationFilter;
  }
  if (isExchangeRelationshipFilter(filters.relationshipFilter)) {
    next.relationshipFilter = filters.relationshipFilter;
  }

  return next;
}

function hydrationFilterUpdate(
  hydration: ExchangeWorkspaceHydration,
): ExchangeFilterUpdate {
  const keys: Array<keyof ExchangeFilterUpdate> = [
    "naicsFilters",
    "industryFilters",
    "capabilityFilters",
    "territoryFilters",
    "rfxStatusFilters",
    "territoryStatusFilters",
    "opportunityTypeFilters",
    "rfxTypeFilters",
    "buyerTypeFilters",
    "workArrangementFilters",
    "visibilityFilters",
    "certificationFilters",
    "setAsideFilters",
    "primeClassificationFilters",
    "awardClassificationFilters",
    "personalizedFilters",
    "localFirst",
    "closingSoon",
    "teamingSuitable",
    "budgetMin",
    "budgetMax",
    "opportunitySort",
    "opportunityLocation",
    "referralStatusFilters",
    "connectionIndustryFilters",
    "connectionTerritoryFilters",
    "compensationFilter",
    "relationshipFilter",
  ];
  const result: ExchangeFilterUpdate = {};
  for (const key of keys) {
    if (own(hydration, key)) {
      (result as Record<string, unknown>)[key] = hydration[key as keyof ExchangeWorkspaceHydration];
    }
  }
  if (own(hydration, "opportunityLocation") && hydration.opportunityLocation === undefined) {
    result.clearOpportunityLocation = true;
  }
  return result;
}

function hydrateWorkspace(
  state: ExchangeWorkspaceState,
  hydration: ExchangeWorkspaceHydration,
): ExchangeWorkspaceState {
  let next = { ...state };

  if (own(hydration, "view") && isExchangeView(hydration.view)) {
    next.view = hydration.view;
  }
  if (
    own(hydration, "connectionMode")
    && isExchangeConnectionMode(hydration.connectionMode)
  ) {
    next.connectionMode = hydration.connectionMode;
  }
  if (
    own(hydration, "intelligenceMetric")
    && isExchangeIntelligenceMetric(hydration.intelligenceMetric)
  ) {
    next.intelligenceMetric = hydration.intelligenceMetric;
  }
  if (
    own(hydration, "surfaceMode")
    && isExchangeSurfaceMode(hydration.surfaceMode)
  ) {
    next.surfaceMode = hydration.surfaceMode;
  }
  if (own(hydration, "searchQuery")) {
    next.searchQuery = normalizeSearch(hydration.searchQuery);
  }
  if (own(hydration, "activeSavedSearchId")) {
    const id = hydration.activeSavedSearchId;
    next.activeSavedSearchId = typeof id === "string"
      && id.length > 0
      && id.length <= MAX_ENTITY_ID_LENGTH
      && !/[\u0000-\u001f\u007f]/.test(id)
      ? id
      : undefined;
  }

  next = applyFilterUpdate(next, hydrationFilterUpdate(hydration));

  if (own(hydration, "selection")) {
    const selection = normalizeSelection(hydration.selection);
    if (selection !== undefined) {
      next.selection = selection;
      next.rightPanelOpen = selection !== null;
      next.mobileDetailOpen = selection !== null;
    }
  }

  if (own(hydration, "viewport")) {
    next.viewport = hydration.viewport === undefined
      ? undefined
      : normalizeExchangeViewport(hydration.viewport);
  }

  return next;
}

export function exchangeWorkspaceReducer(
  state: ExchangeWorkspaceState = createInitialExchangeWorkspaceState(),
  action: ExchangeWorkspaceAction,
): ExchangeWorkspaceState {
  switch (action.type) {
    case "SET_VIEW":
      return isExchangeView(action.view)
        ? {
            ...state,
            view: action.view,
            selection: null,
            rightPanelOpen: false,
            mobileDetailOpen: false,
            mobileFilterOpen: false,
          }
        : state;
    case "SET_SEARCH":
      return { ...state, searchQuery: normalizeSearch(action.query), activeSavedSearchId: undefined };
    case "SET_FILTERS":
      return { ...applyFilterUpdate(state, action.filters), activeSavedSearchId: undefined };
    case "CLEAR_FILTERS":
      if (state.view === "connections" || state.view === "referrals") {
        return {
          ...state,
          searchQuery: "",
          referralStatusFilters: [],
          connectionIndustryFilters: [],
          connectionTerritoryFilters: [],
          compensationFilter: DEFAULT_EXCHANGE_COMPENSATION_FILTER,
          relationshipFilter: DEFAULT_EXCHANGE_RELATIONSHIP_FILTER,
        };
      }
      if (state.view === "intelligence") {
        return {
          ...state,
          searchQuery: "",
          connectionIndustryFilters: [],
          connectionTerritoryFilters: [],
          relationshipFilter: DEFAULT_EXCHANGE_RELATIONSHIP_FILTER,
          intelligenceMetric: DEFAULT_EXCHANGE_INTELLIGENCE_METRIC,
        };
      }
      return {
        ...state,
        searchQuery: "",
        naicsFilters: [],
        industryFilters: [],
        capabilityFilters: [],
        territoryFilters: [],
        rfxStatusFilters: [],
        territoryStatusFilters: [],
        opportunityTypeFilters: [],
        rfxTypeFilters: [],
        buyerTypeFilters: [],
        workArrangementFilters: [],
        visibilityFilters: [],
        certificationFilters: [],
        setAsideFilters: [],
        primeClassificationFilters: [],
        awardClassificationFilters: [],
        personalizedFilters: [],
        localFirst: DEFAULT_EXCHANGE_LOCAL_FIRST,
        closingSoon: false,
        teamingSuitable: false,
        budgetMin: undefined,
        budgetMax: undefined,
        opportunitySort: DEFAULT_EXCHANGE_OPPORTUNITY_SORT,
        opportunityLocation: undefined,
        activeSavedSearchId: undefined,
      };
    case "SET_OPPORTUNITY_SORT":
      return isExchangeOpportunitySort(action.sort)
        ? { ...state, opportunitySort: action.sort, activeSavedSearchId: undefined }
        : state;
    case "SET_OPPORTUNITY_LOCATION":
      return {
        ...state,
        opportunityLocation: action.location === undefined
          ? undefined
          : normalizeOpportunityLocation(action.location),
        activeSavedSearchId: undefined,
      };
    case "SET_ACTIVE_SAVED_SEARCH":
      return action.id === undefined
        || (typeof action.id === "string"
          && action.id.length > 0
          && action.id.length <= MAX_ENTITY_ID_LENGTH
          && !/[\u0000-\u001f\u007f]/.test(action.id))
        ? { ...state, activeSavedSearchId: action.id }
        : state;
    case "SET_SURFACE_MODE":
      return isExchangeSurfaceMode(action.mode)
        ? { ...state, surfaceMode: action.mode }
        : state;
    case "SET_CONNECTION_MODE":
      return isExchangeConnectionMode(action.mode)
        ? { ...state, connectionMode: action.mode }
        : state;
    case "SET_INTELLIGENCE_METRIC":
      return isExchangeIntelligenceMetric(action.metric)
        ? { ...state, intelligenceMetric: action.metric }
        : state;
    case "SELECT_ENTITY": {
      const selection = normalizeSelection(action.selection);
      if (!selection) return state;
      return {
        ...state,
        selection,
        rightPanelOpen: true,
        mobileDetailOpen: true,
      };
    }
    case "CLEAR_SELECTION":
      return {
        ...state,
        selection: null,
        rightPanelOpen: false,
        mobileDetailOpen: false,
      };
    case "TOGGLE_LEFT_PANEL":
      return { ...state, leftPanelCollapsed: !state.leftPanelCollapsed };
    case "SET_LEFT_PANEL_COLLAPSED":
      return typeof action.collapsed === "boolean"
        ? { ...state, leftPanelCollapsed: action.collapsed }
        : state;
    case "OPEN_RIGHT_PANEL":
      return { ...state, rightPanelOpen: true };
    case "CLOSE_RIGHT_PANEL":
      return { ...state, rightPanelOpen: false };
    case "OPEN_MOBILE_FILTER":
      return { ...state, mobileFilterOpen: true };
    case "CLOSE_MOBILE_FILTER":
      return { ...state, mobileFilterOpen: false };
    case "OPEN_MOBILE_DETAIL":
      return { ...state, mobileDetailOpen: true };
    case "CLOSE_MOBILE_DETAIL":
      return { ...state, mobileDetailOpen: false };
    case "SET_VIEWPORT": {
      if (action.viewport === undefined) {
        return { ...state, viewport: undefined };
      }
      const viewport = normalizeExchangeViewport(action.viewport);
      return viewport ? { ...state, viewport } : state;
    }
    case "HYDRATE_FROM_URL":
      return hydrateWorkspace(state, action.state);
    default:
      return state;
  }
}
