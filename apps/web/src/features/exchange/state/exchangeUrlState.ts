import {
  DEFAULT_EXCHANGE_COMPENSATION_FILTER,
  DEFAULT_EXCHANGE_CONNECTION_MODE,
  DEFAULT_EXCHANGE_INTELLIGENCE_METRIC,
  DEFAULT_EXCHANGE_LOCAL_FIRST,
  DEFAULT_EXCHANGE_OPPORTUNITY_SORT,
  DEFAULT_EXCHANGE_RELATIONSHIP_FILTER,
  DEFAULT_EXCHANGE_SURFACE_MODE,
  DEFAULT_EXCHANGE_VIEW,
  isExchangeCompensationFilter,
  isExchangeConnectionMode,
  isExchangeIntelligenceMetric,
  isExchangeOpportunitySort,
  isExchangePersonalizedFilter,
  isExchangeReferralStatus,
  isExchangeRelationshipFilter,
  isExchangeRfxStatus,
  isExchangeSurfaceMode,
  isExchangeTerritoryStatus,
  isExchangeView,
  type ExchangeSelection,
  type ExchangeUrlState,
  type ExchangeViewport,
  type ExchangeWorkspaceState,
} from "./exchangeWorkspaceTypes";
import {
  normalizeExchangeViewport,
  normalizeOpportunityLocation,
} from "./exchangeWorkspaceReducer";

const MAX_SEARCH_LENGTH = 200;
const MAX_ENTITY_ID_LENGTH = 160;
const MAX_FILTER_COUNT = 60;
const SAFE_ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,159}$/;
const NAICS_PATTERN = /^\d{2,6}$/;
const TERRITORY_PATTERN = /^[A-Za-z0-9_(),.&/ -]{1,64}$/;
const INDUSTRY_PATTERN = /^[A-Za-z0-9_(),.&/ -]{1,64}$/;
const SAFE_FILTER_PATTERN = /^[A-Za-z0-9_(),.&/+:#' -]{1,160}$/;

function asSearchParams(input: URLSearchParams | string): URLSearchParams {
  if (input instanceof URLSearchParams) {
    return new URLSearchParams(input);
  }

  const value = input.trim();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) {
    try {
      return new URL(value).searchParams;
    } catch {
      return new URLSearchParams();
    }
  }
  return new URLSearchParams(value.startsWith("?") ? value.slice(1) : value);
}

function parseCsv(
  value: string | null,
  isValid: (candidate: string) => boolean = (candidate) => SAFE_FILTER_PATTERN.test(candidate),
): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value.split(",")) {
    const candidate = item.trim();
    if (!candidate || !isValid(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
    if (result.length >= MAX_FILTER_COUNT) break;
  }
  return result;
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value === "1") return true;
  if (value === "0") return false;
  return undefined;
}

function parseNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseEntityId(value: string | null): string | undefined {
  return value
    && value.length <= MAX_ENTITY_ID_LENGTH
    && SAFE_ENTITY_ID_PATTERN.test(value)
    ? value
    : undefined;
}

function parseViewport(params: URLSearchParams): ExchangeViewport | undefined {
  const longitude = parseNumber(params.get("lng"));
  const latitude = parseNumber(params.get("lat"));
  const zoom = parseNumber(params.get("z"));
  if (longitude === undefined || latitude === undefined || zoom === undefined) {
    return undefined;
  }

  const bearing = parseNumber(params.get("b"));
  const pitch = parseNumber(params.get("p"));
  return normalizeExchangeViewport({
    longitude,
    latitude,
    zoom,
    ...(bearing !== undefined ? { bearing } : {}),
    ...(pitch !== undefined ? { pitch } : {}),
  });
}

function parseOpportunityLocation(params: URLSearchParams) {
  const label = params.get("place")?.slice(0, 240);
  const latitude = parseNumber(params.get("placeLat"));
  const longitude = parseNumber(params.get("placeLng"));
  const radiusMiles = parseNumber(params.get("radius"));
  const includeRemote = parseBoolean(params.get("includeRemote"));
  const west = parseNumber(params.get("west"));
  const south = parseNumber(params.get("south"));
  const east = parseNumber(params.get("east"));
  const north = parseNumber(params.get("north"));
  const bounds = [west, south, east, north].every((value) => value !== undefined)
    ? {
        west: west as number,
        south: south as number,
        east: east as number,
        north: north as number,
      }
    : undefined;
  return normalizeOpportunityLocation({
    ...(label ? { label } : {}),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined ? { longitude } : {}),
    ...(radiusMiles !== undefined ? { radiusMiles } : {}),
    ...(bounds ? { bounds } : {}),
    ...(includeRemote !== undefined ? { includeRemote } : {}),
  });
}

function parseSelection(
  params: URLSearchParams,
  view: ExchangeUrlState["view"],
): ExchangeSelection {
  const entityType = params.get("secondaryEntity") ?? params.get("entity");
  const entityId = params.get("secondarySelected")
    ?? params.get("selected")
    ?? "";
  if (
    !["rfx", "opportunity", "territory", "organization", "referral", "resource", "team", "relationship", "industry"].includes(
      entityType ?? "",
    )
    || entityId.length === 0
    || entityId.length > MAX_ENTITY_ID_LENGTH
    || !SAFE_ENTITY_ID_PATTERN.test(entityId)
  ) {
    return null;
  }
  const allowedForView = entityType === "organization"
    ? true
    : view === "opportunities" || view === "businesses" || view === "teaming"
      ? entityType === "rfx"
        || entityType === "opportunity"
        || entityType === "territory"
        || entityType === "team"
      : view === "connections" || view === "referrals"
        ? entityType === "referral"
        : view === "resources"
          ? entityType === "resource" || entityType === "territory"
        : entityType === "relationship"
          || entityType === "territory"
          || entityType === "industry";
  if (!allowedForView) return null;
  return {
    entityType: entityType as Exclude<ExchangeSelection, null>["entityType"],
    entityId,
  };
}

export function createDefaultExchangeUrlState(): ExchangeUrlState {
  return {
    view: DEFAULT_EXCHANGE_VIEW,
    surfaceMode: DEFAULT_EXCHANGE_SURFACE_MODE,
    selection: null,
    requestedActorOrganizationId: undefined,
    subjectOrganizationId: undefined,
    secondaryContext: null,
    organizationDrawerOpen: false,
    rightPanelOpen: false,
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
    connectionMode: DEFAULT_EXCHANGE_CONNECTION_MODE,
    referralStatusFilters: [],
    connectionIndustryFilters: [],
    connectionTerritoryFilters: [],
    compensationFilter: DEFAULT_EXCHANGE_COMPENSATION_FILTER,
    relationshipFilter: DEFAULT_EXCHANGE_RELATIONSHIP_FILTER,
    intelligenceMetric: DEFAULT_EXCHANGE_INTELLIGENCE_METRIC,
    viewport: undefined,
  };
}

/** Parse a complete, safe URL state so browser history can also clear old state. */
export function parseExchangeUrlState(
  input: URLSearchParams | string,
): ExchangeUrlState {
  const params = asSearchParams(input);
  const state = createDefaultExchangeUrlState();

  const view = params.get("view");
  if (isExchangeView(view)) state.view = view;

  const mode = params.get("mode");
  if (isExchangeSurfaceMode(mode)) state.surfaceMode = mode;

  const query = params.get("q");
  if (query !== null && query.length <= MAX_SEARCH_LENGTH) {
    state.searchQuery = query;
  }

  state.requestedActorOrganizationId = parseEntityId(
    params.get("actorOrg") ?? params.get("actor"),
  );
  state.subjectOrganizationId = parseEntityId(
    params.get("subjectOrg") ?? params.get("subject"),
  );

  state.territoryFilters = parseCsv(
    params.get("territory"),
    (candidate) => TERRITORY_PATTERN.test(candidate),
  );
  state.naicsFilters = parseCsv(
    params.get("naics"),
    (candidate) => NAICS_PATTERN.test(candidate),
  );
  state.rfxStatusFilters = parseCsv(
    params.get("rfxStatus"),
    isExchangeRfxStatus,
  ).filter(isExchangeRfxStatus);
  state.territoryStatusFilters = parseCsv(
    params.get("territoryStatus"),
    isExchangeTerritoryStatus,
  ).filter(isExchangeTerritoryStatus);
  state.industryFilters = parseCsv(params.get("industryFilter"));
  state.capabilityFilters = parseCsv(params.get("capability"));
  state.opportunityTypeFilters = parseCsv(params.get("opportunityType"));
  state.rfxTypeFilters = parseCsv(params.get("rfxType"));
  state.buyerTypeFilters = parseCsv(params.get("buyerType"));
  state.workArrangementFilters = parseCsv(params.get("work"));
  state.visibilityFilters = parseCsv(params.get("visibility"));
  state.certificationFilters = parseCsv(params.get("certification"));
  state.setAsideFilters = parseCsv(params.get("setAside"));
  state.primeClassificationFilters = parseCsv(params.get("prime"));
  state.awardClassificationFilters = parseCsv(params.get("award"));
  state.personalizedFilters = parseCsv(
    params.get("personalized"),
    isExchangePersonalizedFilter,
  ).filter(isExchangePersonalizedFilter);

  const local = parseBoolean(params.get("local"));
  if (local !== undefined) state.localFirst = local;
  state.closingSoon = parseBoolean(params.get("closingSoon")) ?? false;
  state.teamingSuitable = parseBoolean(params.get("teaming")) ?? false;
  state.budgetMin = parseNumber(params.get("budgetMin"));
  state.budgetMax = parseNumber(params.get("budgetMax"));
  const sort = params.get("sort");
  if (isExchangeOpportunitySort(sort)) state.opportunitySort = sort;
  state.opportunityLocation = parseOpportunityLocation(params);
  const savedSearchId = params.get("savedSearch");
  if (
    savedSearchId
    && savedSearchId.length <= MAX_ENTITY_ID_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(savedSearchId)
  ) {
    state.activeSavedSearchId = savedSearchId;
  }

  const connectionMode = params.get("connectionMode");
  if (isExchangeConnectionMode(connectionMode)) {
    state.connectionMode = connectionMode;
  }
  state.referralStatusFilters = parseCsv(
    params.get("referralStatus"),
    isExchangeReferralStatus,
  ).filter(isExchangeReferralStatus);
  state.connectionIndustryFilters = parseCsv(
    params.get("industry"),
    (candidate) => INDUSTRY_PATTERN.test(candidate),
  );
  state.connectionTerritoryFilters = parseCsv(
    params.get("connectionTerritory"),
    (candidate) => TERRITORY_PATTERN.test(candidate),
  );
  const compensation = params.get("compensation");
  if (isExchangeCompensationFilter(compensation)) {
    state.compensationFilter = compensation;
  }
  const relationship = params.get("relationship");
  if (isExchangeRelationshipFilter(relationship)) {
    state.relationshipFilter = relationship;
  }
  const metric = params.get("metric");
  if (isExchangeIntelligenceMetric(metric)) {
    state.intelligenceMetric = metric;
  }

  const parsedSelection = parseSelection(params, state.view);
  if (parsedSelection?.entityType === "organization") {
    state.subjectOrganizationId ??= parsedSelection.entityId;
  } else {
    state.secondaryContext = parsedSelection;
  }
  state.organizationDrawerOpen = Boolean(state.subjectOrganizationId)
    && (params.get("drawer") === "organization"
      || parsedSelection?.entityType === "organization");
  const panel = params.get("panel");
  state.rightPanelOpen = state.secondaryContext !== null
    && (panel === "detail" || panel === null);
  state.selection = state.secondaryContext
    ?? (state.subjectOrganizationId
      ? { entityType: "organization", entityId: state.subjectOrganizationId }
      : null);
  state.viewport = parseViewport(params);
  return state;
}

function stableNumber(value: number): string {
  return String(Number(value.toFixed(5)));
}

function serializeCsv(
  params: URLSearchParams,
  name: string,
  values: readonly string[],
): void {
  if (values.length > 0) params.set(name, values.join(","));
}

function serializeNumber(
  params: URLSearchParams,
  name: string,
  value?: number,
): void {
  if (value !== undefined && Number.isFinite(value)) {
    params.set(name, stableNumber(value));
  }
}

/**
 * Serializes only the explicit public interaction-state allowlist above.
 * Fetched documents, user identity, auth claims, panel dimensions, and
 * arbitrary object properties can never enter the URL through this codec.
 */
export function serializeExchangeUrlState(
  state: ExchangeWorkspaceState | ExchangeUrlState,
): URLSearchParams {
  const params = new URLSearchParams();

  if (state.view !== DEFAULT_EXCHANGE_VIEW) params.set("view", state.view);
  if (state.surfaceMode !== DEFAULT_EXCHANGE_SURFACE_MODE) {
    params.set("mode", state.surfaceMode);
  }
  if (state.searchQuery) params.set("q", state.searchQuery.slice(0, MAX_SEARCH_LENGTH));
  const actorRequest = state.requestedActorOrganizationId
    ?? ("actorOrganizationId" in state ? state.actorOrganizationId : undefined);
  const safeActorRequest = parseEntityId(actorRequest ?? null);
  const safeSubject = parseEntityId(state.subjectOrganizationId ?? null);
  if (safeActorRequest) params.set("actorOrg", safeActorRequest);
  if (safeSubject) params.set("subjectOrg", safeSubject);
  serializeCsv(params, "territory", state.territoryFilters);
  serializeCsv(params, "naics", state.naicsFilters);
  serializeCsv(params, "industryFilter", state.industryFilters);
  serializeCsv(params, "capability", state.capabilityFilters);
  serializeCsv(params, "rfxStatus", state.rfxStatusFilters);
  serializeCsv(params, "territoryStatus", state.territoryStatusFilters);
  serializeCsv(params, "opportunityType", state.opportunityTypeFilters);
  serializeCsv(params, "rfxType", state.rfxTypeFilters);
  serializeCsv(params, "buyerType", state.buyerTypeFilters);
  serializeCsv(params, "work", state.workArrangementFilters);
  serializeCsv(params, "visibility", state.visibilityFilters);
  serializeCsv(params, "certification", state.certificationFilters);
  serializeCsv(params, "setAside", state.setAsideFilters);
  serializeCsv(params, "prime", state.primeClassificationFilters);
  serializeCsv(params, "award", state.awardClassificationFilters);
  serializeCsv(params, "personalized", state.personalizedFilters);
  if (state.localFirst !== DEFAULT_EXCHANGE_LOCAL_FIRST) {
    params.set("local", state.localFirst ? "1" : "0");
  }
  if (state.closingSoon) params.set("closingSoon", "1");
  if (state.teamingSuitable) params.set("teaming", "1");
  serializeNumber(params, "budgetMin", state.budgetMin);
  serializeNumber(params, "budgetMax", state.budgetMax);
  if (state.opportunitySort !== DEFAULT_EXCHANGE_OPPORTUNITY_SORT) {
    params.set("sort", state.opportunitySort);
  }

  const location = normalizeOpportunityLocation(state.opportunityLocation);
  if (location) {
    if (location.label) params.set("place", location.label);
    serializeNumber(params, "placeLat", location.latitude);
    serializeNumber(params, "placeLng", location.longitude);
    serializeNumber(params, "radius", location.radiusMiles);
    if (location.includeRemote === false) params.set("includeRemote", "0");
    if (location.bounds) {
      serializeNumber(params, "west", location.bounds.west);
      serializeNumber(params, "south", location.bounds.south);
      serializeNumber(params, "east", location.bounds.east);
      serializeNumber(params, "north", location.bounds.north);
    }
  }
  if (state.activeSavedSearchId) {
    params.set("savedSearch", state.activeSavedSearchId);
  }
  if (state.connectionMode !== DEFAULT_EXCHANGE_CONNECTION_MODE) {
    params.set("connectionMode", state.connectionMode);
  }
  serializeCsv(params, "referralStatus", state.referralStatusFilters);
  serializeCsv(params, "industry", state.connectionIndustryFilters);
  serializeCsv(
    params,
    "connectionTerritory",
    state.connectionTerritoryFilters,
  );
  if (state.compensationFilter !== DEFAULT_EXCHANGE_COMPENSATION_FILTER) {
    params.set("compensation", state.compensationFilter);
  }
  if (state.relationshipFilter !== DEFAULT_EXCHANGE_RELATIONSHIP_FILTER) {
    params.set("relationship", state.relationshipFilter);
  }
  if (state.intelligenceMetric !== DEFAULT_EXCHANGE_INTELLIGENCE_METRIC) {
    params.set("metric", state.intelligenceMetric);
  }

  const secondary = state.secondaryContext
    ?? (state.selection?.entityType !== "organization" ? state.selection : null);
  if (secondary) {
    params.set("entity", secondary.entityType);
    params.set("selected", secondary.entityId);
    params.set("panel", state.rightPanelOpen ? "detail" : "closed");
  }
  if (safeSubject && state.organizationDrawerOpen) {
    params.set("drawer", "organization");
  }

  const viewport = normalizeExchangeViewport(state.viewport);
  if (viewport) {
    params.set("lng", stableNumber(viewport.longitude));
    params.set("lat", stableNumber(viewport.latitude));
    params.set("z", stableNumber(viewport.zoom));
    if (viewport.bearing !== undefined && viewport.bearing !== 0) {
      params.set("b", stableNumber(viewport.bearing));
    }
    if (viewport.pitch !== undefined && viewport.pitch !== 0) {
      params.set("p", stableNumber(viewport.pitch));
    }
  }

  return params;
}

export function exchangeUrlStateToString(
  state: ExchangeWorkspaceState | ExchangeUrlState,
): string {
  return serializeExchangeUrlState(state).toString();
}
