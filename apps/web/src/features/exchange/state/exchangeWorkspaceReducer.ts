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
  canonicalExchangeMode,
  createInitialExchangeModeStates,
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
  type ExchangeCanonicalMode,
  type ExchangeDraftRefs,
  type ExchangeModeState,
  type ExchangeModeStates,
  type ExchangeViewport,
  type ExchangeWorkspaceHydration,
  type ExchangeWorkspaceSessionHydration,
  type ExchangeWorkspaceState,
} from "./exchangeWorkspaceTypes";

const MAX_SEARCH_LENGTH = 240;
const MAX_FILTER_COUNT = 60;
const MAX_FILTER_LENGTH = 160;
const MAX_ENTITY_ID_LENGTH = 160;
const MAX_SESSION_LABEL_LENGTH = 160;
const MAX_SCROLL_TOP = 10_000_000;

function own(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeSearch(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_SEARCH_LENGTH) : "";
}

export function normalizeExchangeEntityId(value: unknown): string | undefined {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_ENTITY_ID_LENGTH
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return undefined;
  }
  return value;
}

function normalizeOptionalLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim().slice(0, MAX_SESSION_LABEL_LENGTH);
  return candidate && !/[\u0000-\u001f\u007f]/.test(candidate)
    ? candidate
    : undefined;
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

export function normalizeExchangeSelection(
  value: unknown,
): ExchangeSelection | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;

  const candidate = value as { entityType?: unknown; entityId?: unknown };
  if (
    candidate.entityType !== "rfx"
    && candidate.entityType !== "opportunity"
    && candidate.entityType !== "territory"
    && candidate.entityType !== "organization"
    && candidate.entityType !== "referral"
    && candidate.entityType !== "resource"
    && candidate.entityType !== "team"
    && candidate.entityType !== "relationship"
    && candidate.entityType !== "industry"
  ) {
    return undefined;
  }
  const entityId = normalizeExchangeEntityId(candidate.entityId);
  if (!entityId) return undefined;

  return {
    entityType: candidate.entityType,
    entityId,
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

const DRAFT_REF_KEYS = [
  "referralDraftId",
  "contactRequestDraftId",
  "teamingInvitationDraftId",
  "organizationClaimDraftId",
  "opportunityResponseDraftId",
  "savedSearchDraftId",
  "resourceContactDraftId",
] as const satisfies readonly (keyof ExchangeDraftRefs)[];

function normalizeDraftRefs(
  value: unknown,
  fallback: ExchangeDraftRefs = {},
): ExchangeDraftRefs {
  if (!value || typeof value !== "object") return { ...fallback };
  const next: ExchangeDraftRefs = {};
  for (const key of DRAFT_REF_KEYS) {
    if (!own(value, key)) {
      if (fallback[key]) next[key] = fallback[key];
      continue;
    }
    const id = normalizeExchangeEntityId(
      (value as Partial<Record<keyof ExchangeDraftRefs, unknown>>)[key],
    );
    if (id) next[key] = id;
  }
  return next;
}

function modeFilterSnapshot(
  state: ExchangeWorkspaceState,
  mode: ExchangeCanonicalMode,
): ExchangeModeState["filters"] {
  if (mode === "opportunities") {
    return {
      naicsFilters: [...state.naicsFilters],
      industryFilters: [...state.industryFilters],
      capabilityFilters: [...state.capabilityFilters],
      territoryFilters: [...state.territoryFilters],
      rfxStatusFilters: [...state.rfxStatusFilters],
      territoryStatusFilters: [...state.territoryStatusFilters],
      opportunityTypeFilters: [...state.opportunityTypeFilters],
      rfxTypeFilters: [...state.rfxTypeFilters],
      buyerTypeFilters: [...state.buyerTypeFilters],
      workArrangementFilters: [...state.workArrangementFilters],
      visibilityFilters: [...state.visibilityFilters],
      certificationFilters: [...state.certificationFilters],
      setAsideFilters: [...state.setAsideFilters],
      primeClassificationFilters: [...state.primeClassificationFilters],
      awardClassificationFilters: [...state.awardClassificationFilters],
      personalizedFilters: [...state.personalizedFilters],
      localFirst: state.localFirst,
      closingSoon: state.closingSoon,
      teamingSuitable: state.teamingSuitable,
      budgetMin: state.budgetMin,
      budgetMax: state.budgetMax,
      opportunitySort: state.opportunitySort,
      activeSavedSearchId: state.activeSavedSearchId,
    };
  }
  if (mode === "referrals") {
    return {
      connectionMode: state.connectionMode,
      referralStatusFilters: [...state.referralStatusFilters],
      connectionIndustryFilters: [...state.connectionIndustryFilters],
      connectionTerritoryFilters: [...state.connectionTerritoryFilters],
      compensationFilter: state.compensationFilter,
      relationshipFilter: state.relationshipFilter,
    };
  }
  if (mode === "intelligence") {
    return {
      connectionIndustryFilters: [...state.connectionIndustryFilters],
      connectionTerritoryFilters: [...state.connectionTerritoryFilters],
      relationshipFilter: state.relationshipFilter,
      intelligenceMetric: state.intelligenceMetric,
    };
  }
  return {};
}

function snapshotMode(
  state: ExchangeWorkspaceState,
  mode: ExchangeCanonicalMode = canonicalExchangeMode(state.view),
): ExchangeWorkspaceState {
  const existing = state.modeStates[mode];
  return {
    ...state,
    modeStates: {
      ...state.modeStates,
      [mode]: {
        ...existing,
        filters: mode === "resources"
          ? existing.filters
          : modeFilterSnapshot(state, mode),
        secondaryContext: state.secondaryContext,
      },
    },
  };
}

function restoreMode(
  state: ExchangeWorkspaceState,
  mode: ExchangeCanonicalMode,
): ExchangeWorkspaceState {
  const initial = createInitialExchangeWorkspaceState();
  const stored = state.modeStates[mode];
  const filters = stored.filters;
  let next: ExchangeWorkspaceState = {
    ...state,
    secondaryContext: stored.secondaryContext,
    selection: stored.secondaryContext
      ?? (state.subjectOrganizationId
        ? { entityType: "organization", entityId: state.subjectOrganizationId }
        : null),
  };

  if (mode === "opportunities") {
    next = {
      ...next,
      naicsFilters: filters.naicsFilters ?? initial.naicsFilters,
      industryFilters: filters.industryFilters ?? initial.industryFilters,
      capabilityFilters: filters.capabilityFilters ?? initial.capabilityFilters,
      territoryFilters: filters.territoryFilters ?? initial.territoryFilters,
      rfxStatusFilters: filters.rfxStatusFilters ?? initial.rfxStatusFilters,
      territoryStatusFilters: filters.territoryStatusFilters ?? initial.territoryStatusFilters,
      opportunityTypeFilters: filters.opportunityTypeFilters ?? initial.opportunityTypeFilters,
      rfxTypeFilters: filters.rfxTypeFilters ?? initial.rfxTypeFilters,
      buyerTypeFilters: filters.buyerTypeFilters ?? initial.buyerTypeFilters,
      workArrangementFilters: filters.workArrangementFilters ?? initial.workArrangementFilters,
      visibilityFilters: filters.visibilityFilters ?? initial.visibilityFilters,
      certificationFilters: filters.certificationFilters ?? initial.certificationFilters,
      setAsideFilters: filters.setAsideFilters ?? initial.setAsideFilters,
      primeClassificationFilters: filters.primeClassificationFilters ?? initial.primeClassificationFilters,
      awardClassificationFilters: filters.awardClassificationFilters ?? initial.awardClassificationFilters,
      personalizedFilters: filters.personalizedFilters ?? initial.personalizedFilters,
      localFirst: filters.localFirst ?? initial.localFirst,
      closingSoon: filters.closingSoon ?? initial.closingSoon,
      teamingSuitable: filters.teamingSuitable ?? initial.teamingSuitable,
      budgetMin: filters.budgetMin,
      budgetMax: filters.budgetMax,
      opportunitySort: filters.opportunitySort ?? initial.opportunitySort,
      activeSavedSearchId: filters.activeSavedSearchId,
    };
  } else if (mode === "referrals") {
    next = {
      ...next,
      connectionMode: filters.connectionMode ?? initial.connectionMode,
      referralStatusFilters: filters.referralStatusFilters ?? initial.referralStatusFilters,
      connectionIndustryFilters: filters.connectionIndustryFilters ?? initial.connectionIndustryFilters,
      connectionTerritoryFilters: filters.connectionTerritoryFilters ?? initial.connectionTerritoryFilters,
      compensationFilter: filters.compensationFilter ?? initial.compensationFilter,
      relationshipFilter: filters.relationshipFilter ?? initial.relationshipFilter,
    };
  } else if (mode === "intelligence") {
    next = {
      ...next,
      connectionIndustryFilters: filters.connectionIndustryFilters ?? initial.connectionIndustryFilters,
      connectionTerritoryFilters: filters.connectionTerritoryFilters ?? initial.connectionTerritoryFilters,
      relationshipFilter: filters.relationshipFilter ?? initial.relationshipFilter,
      intelligenceMetric: filters.intelligenceMetric ?? initial.intelligenceMetric,
    };
  }
  return next;
}

function normalizeModeState(
  mode: ExchangeCanonicalMode,
  value: unknown,
  fallback: ExchangeModeState,
): ExchangeModeState {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Record<string, unknown>;
  const rawFilters = candidate.filters && typeof candidate.filters === "object"
    ? candidate.filters as Record<string, unknown>
    : {};
  let filterState = createInitialExchangeWorkspaceState();
  filterState = applyFilterUpdate(filterState, rawFilters as ExchangeFilterUpdate);
  if (isExchangeConnectionMode(rawFilters.connectionMode)) {
    filterState.connectionMode = rawFilters.connectionMode;
  }
  if (isExchangeIntelligenceMetric(rawFilters.intelligenceMetric)) {
    filterState.intelligenceMetric = rawFilters.intelligenceMetric;
  }
  const savedSearchId = normalizeExchangeEntityId(rawFilters.activeSavedSearchId);
  if (savedSearchId) filterState.activeSavedSearchId = savedSearchId;

  const secondary = normalizeExchangeSelection(candidate.secondaryContext);
  const scrollTop = candidate.listScrollTop;
  const filters = mode === "resources"
    ? {
        eligibilityFilters: normalizeStringList(rawFilters.eligibilityFilters),
        providerFilters: normalizeStringList(rawFilters.providerFilters),
        serviceFilters: normalizeStringList(rawFilters.serviceFilters),
      }
    : modeFilterSnapshot(filterState, mode);
  return {
    filters,
    secondaryContext: secondary === undefined ? fallback.secondaryContext : secondary,
    listScrollTop: typeof scrollTop === "number"
      && Number.isFinite(scrollTop)
      && scrollTop >= 0
      && scrollTop <= MAX_SCROLL_TOP
      ? scrollTop
      : fallback.listScrollTop,
    panelSubsection: normalizeOptionalLabel(candidate.panelSubsection),
    resourceCategory: mode === "resources"
      ? normalizeOptionalLabel(candidate.resourceCategory)
      : undefined,
    draftRefs: normalizeDraftRefs(candidate.draftRefs),
  };
}

export function normalizeExchangeModeStates(
  value: unknown,
  fallback: ExchangeModeStates = createInitialExchangeModeStates(),
): ExchangeModeStates {
  const candidate = value && typeof value === "object"
    ? value as Partial<Record<ExchangeCanonicalMode, unknown>>
    : {};
  return {
    opportunities: normalizeModeState("opportunities", candidate.opportunities, fallback.opportunities),
    referrals: normalizeModeState("referrals", candidate.referrals, fallback.referrals),
    intelligence: normalizeModeState("intelligence", candidate.intelligence, fallback.intelligence),
    resources: normalizeModeState("resources", candidate.resources, fallback.resources),
  };
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
  let next = snapshotMode(state);

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
  if (own(hydration, "requestedActorOrganizationId")) {
    next.requestedActorOrganizationId = normalizeExchangeEntityId(
      hydration.requestedActorOrganizationId,
    );
  }
  if (own(hydration, "subjectOrganizationId")) {
    next.subjectOrganizationId = normalizeExchangeEntityId(
      hydration.subjectOrganizationId,
    );
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

  if (own(hydration, "secondaryContext")) {
    const secondary = normalizeExchangeSelection(hydration.secondaryContext);
    if (secondary !== undefined) next.secondaryContext = secondary;
  } else if (own(hydration, "selection")) {
    const selection = normalizeExchangeSelection(hydration.selection);
    if (selection?.entityType === "organization") {
      next.subjectOrganizationId = selection.entityId;
      next.secondaryContext = null;
    } else if (selection !== undefined) {
      next.secondaryContext = selection;
    }
  }
  if (own(hydration, "organizationDrawerOpen")) {
    next.organizationDrawerOpen = hydration.organizationDrawerOpen === true
      && Boolean(next.subjectOrganizationId);
  }
  if (own(hydration, "rightPanelOpen")) {
    next.rightPanelOpen = hydration.rightPanelOpen === true
      && next.secondaryContext !== null;
  }
  if (own(hydration, "selection") || own(hydration, "secondaryContext") || own(hydration, "subjectOrganizationId")) {
    next.selection = next.secondaryContext
      ?? (next.subjectOrganizationId
        ? { entityType: "organization", entityId: next.subjectOrganizationId }
        : null);
    next.mobileDetailOpen = next.rightPanelOpen || next.organizationDrawerOpen;
  }

  if (own(hydration, "viewport")) {
    next.viewport = hydration.viewport === undefined
      ? undefined
      : normalizeExchangeViewport(hydration.viewport);
  }

  return snapshotMode(next);
}

function hydrateSessionWorkspace(
  state: ExchangeWorkspaceState,
  hydration: ExchangeWorkspaceSessionHydration,
): ExchangeWorkspaceState {
  let next = snapshotMode(state);
  if (isExchangeView(hydration.view)) next.view = hydration.view;
  if (isExchangeSurfaceMode(hydration.surfaceMode)) {
    next.surfaceMode = hydration.surfaceMode;
  }
  if (own(hydration, "modeStates")) {
    next.modeStates = normalizeExchangeModeStates(hydration.modeStates, next.modeStates);
  }
  next = restoreMode(next, canonicalExchangeMode(next.view));

  if (own(hydration, "subjectOrganizationId")) {
    next.subjectOrganizationId = normalizeExchangeEntityId(
      hydration.subjectOrganizationId,
    );
  }
  if (own(hydration, "secondaryContext")) {
    const secondary = normalizeExchangeSelection(hydration.secondaryContext);
    if (secondary !== undefined) next.secondaryContext = secondary;
  }
  if (own(hydration, "searchQuery")) {
    next.searchQuery = normalizeSearch(hydration.searchQuery);
  }
  if (own(hydration, "opportunityLocation")) {
    next.opportunityLocation = normalizeOpportunityLocation(
      hydration.opportunityLocation,
    );
  }
  if (own(hydration, "viewport")) {
    next.viewport = normalizeExchangeViewport(hydration.viewport);
  }
  if (typeof hydration.leftPanelCollapsed === "boolean") {
    next.leftPanelCollapsed = hydration.leftPanelCollapsed;
  }
  if (typeof hydration.rightPanelOpen === "boolean") {
    next.rightPanelOpen = hydration.rightPanelOpen && next.secondaryContext !== null;
  }
  if (typeof hydration.mobileFilterOpen === "boolean") {
    next.mobileFilterOpen = hydration.mobileFilterOpen;
  }
  if (typeof hydration.mobileDetailOpen === "boolean") {
    next.mobileDetailOpen = hydration.mobileDetailOpen;
  }
  if (typeof hydration.organizationDrawerOpen === "boolean") {
    next.organizationDrawerOpen = hydration.organizationDrawerOpen
      && Boolean(next.subjectOrganizationId);
  }
  next.selection = next.secondaryContext
    ?? (next.subjectOrganizationId
      ? { entityType: "organization", entityId: next.subjectOrganizationId }
      : null);
  return snapshotMode(next);
}

export function exchangeWorkspaceReducer(
  state: ExchangeWorkspaceState = createInitialExchangeWorkspaceState(),
  action: ExchangeWorkspaceAction,
): ExchangeWorkspaceState {
  switch (action.type) {
    case "SET_VIEW":
      if (!isExchangeView(action.view)) return state;
      return restoreMode(
        { ...snapshotMode(state), view: action.view },
        canonicalExchangeMode(action.view),
      );
    case "SET_REQUESTED_ACTOR_ORGANIZATION":
      return {
        ...state,
        requestedActorOrganizationId: normalizeExchangeEntityId(action.id),
      };
    case "SET_VALIDATED_ACTOR_ORGANIZATION":
      return {
        ...state,
        actorOrganizationId: normalizeExchangeEntityId(action.id),
      };
    case "SET_SUBJECT_ORGANIZATION": {
      const subjectOrganizationId = normalizeExchangeEntityId(action.id);
      return {
        ...state,
        subjectOrganizationId,
        organizationDrawerOpen: Boolean(subjectOrganizationId),
        selection: state.secondaryContext
          ?? (subjectOrganizationId
            ? { entityType: "organization", entityId: subjectOrganizationId }
            : null),
        mobileDetailOpen: subjectOrganizationId ? true : state.rightPanelOpen,
      };
    }
    case "CLEAR_SUBJECT_ORGANIZATION":
      return {
        ...state,
        subjectOrganizationId: undefined,
        organizationDrawerOpen: false,
        selection: state.secondaryContext,
        mobileDetailOpen: state.rightPanelOpen,
      };
    case "SET_SECONDARY_CONTEXT": {
      const secondaryContext = normalizeExchangeSelection(action.context);
      if (secondaryContext === undefined) return state;
      return snapshotMode({
        ...state,
        secondaryContext,
        selection: secondaryContext
          ?? (state.subjectOrganizationId
            ? { entityType: "organization", entityId: state.subjectOrganizationId }
            : null),
        rightPanelOpen: secondaryContext !== null,
        mobileDetailOpen: secondaryContext !== null || state.organizationDrawerOpen,
      });
    }
    case "CLEAR_SECONDARY_CONTEXT":
      return snapshotMode({
        ...state,
        secondaryContext: null,
        selection: state.subjectOrganizationId
          ? { entityType: "organization", entityId: state.subjectOrganizationId }
          : null,
        rightPanelOpen: false,
        mobileDetailOpen: state.organizationDrawerOpen,
      });
    case "SET_ORGANIZATION_DRAWER_OPEN": {
      const open = action.open === true && Boolean(state.subjectOrganizationId);
      return {
        ...state,
        organizationDrawerOpen: open,
        mobileDetailOpen: open || state.rightPanelOpen,
      };
    }
    case "SET_MODE_LIST_SCROLL": {
      const mode = action.mode ?? canonicalExchangeMode(state.view);
      if (!state.modeStates[mode]
        || !Number.isFinite(action.scrollTop)
        || action.scrollTop < 0
        || action.scrollTop > MAX_SCROLL_TOP) return state;
      return {
        ...state,
        modeStates: {
          ...state.modeStates,
          [mode]: { ...state.modeStates[mode], listScrollTop: action.scrollTop },
        },
      };
    }
    case "SET_MODE_FILTERS": {
      const mode = action.mode ?? canonicalExchangeMode(state.view);
      const existing = state.modeStates[mode];
      if (!existing) return state;
      const modeState = normalizeModeState(mode, {
        ...existing,
        filters: { ...existing.filters, ...action.filters },
      }, existing);
      const next = {
        ...state,
        modeStates: { ...state.modeStates, [mode]: modeState },
      };
      return canonicalExchangeMode(state.view) === mode
        ? restoreMode(next, mode)
        : next;
    }
    case "SET_MODE_PANEL_SUBSECTION": {
      const mode = action.mode ?? canonicalExchangeMode(state.view);
      if (!state.modeStates[mode]) return state;
      return {
        ...state,
        modeStates: {
          ...state.modeStates,
          [mode]: {
            ...state.modeStates[mode],
            panelSubsection: normalizeOptionalLabel(action.subsection),
          },
        },
      };
    }
    case "SET_RESOURCE_CATEGORY":
      return {
        ...state,
        modeStates: {
          ...state.modeStates,
          resources: {
            ...state.modeStates.resources,
            resourceCategory: normalizeOptionalLabel(action.category),
          },
        },
      };
    case "SET_MODE_DRAFT_REFS": {
      const mode = action.mode ?? canonicalExchangeMode(state.view);
      if (!state.modeStates[mode]) return state;
      return {
        ...state,
        modeStates: {
          ...state.modeStates,
          [mode]: {
            ...state.modeStates[mode],
            draftRefs: normalizeDraftRefs(
              action.refs,
              state.modeStates[mode].draftRefs,
            ),
          },
        },
      };
    }
    case "SET_SEARCH":
      return canonicalExchangeMode(state.view) === "opportunities"
        ? snapshotMode({
            ...state,
            searchQuery: normalizeSearch(action.query),
            activeSavedSearchId: undefined,
          })
        : { ...state, searchQuery: normalizeSearch(action.query) };
    case "SET_FILTERS":
      return snapshotMode({
        ...applyFilterUpdate(state, action.filters),
        activeSavedSearchId: undefined,
      });
    case "CLEAR_FILTERS":
      if (state.view === "connections" || state.view === "referrals") {
        return snapshotMode({
          ...state,
          searchQuery: "",
          referralStatusFilters: [],
          connectionIndustryFilters: [],
          connectionTerritoryFilters: [],
          compensationFilter: DEFAULT_EXCHANGE_COMPENSATION_FILTER,
          relationshipFilter: DEFAULT_EXCHANGE_RELATIONSHIP_FILTER,
        });
      }
      if (state.view === "intelligence") {
        return snapshotMode({
          ...state,
          searchQuery: "",
          connectionIndustryFilters: [],
          connectionTerritoryFilters: [],
          relationshipFilter: DEFAULT_EXCHANGE_RELATIONSHIP_FILTER,
          intelligenceMetric: DEFAULT_EXCHANGE_INTELLIGENCE_METRIC,
        });
      }
      return snapshotMode({
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
      });
    case "SET_OPPORTUNITY_SORT":
      return isExchangeOpportunitySort(action.sort)
        ? snapshotMode({ ...state, opportunitySort: action.sort, activeSavedSearchId: undefined })
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
        ? snapshotMode({ ...state, activeSavedSearchId: action.id })
        : state;
    case "SET_SURFACE_MODE":
      return isExchangeSurfaceMode(action.mode)
        ? { ...state, surfaceMode: action.mode }
        : state;
    case "SET_CONNECTION_MODE":
      return isExchangeConnectionMode(action.mode)
        ? snapshotMode({ ...state, connectionMode: action.mode })
        : state;
    case "SET_INTELLIGENCE_METRIC":
      return isExchangeIntelligenceMetric(action.metric)
        ? snapshotMode({ ...state, intelligenceMetric: action.metric })
        : state;
    case "SELECT_ENTITY": {
      const selection = normalizeExchangeSelection(action.selection);
      if (!selection) return state;
      if (selection.entityType === "organization") {
        return {
          ...state,
          subjectOrganizationId: selection.entityId,
          selection: state.secondaryContext ?? selection,
          organizationDrawerOpen: true,
          mobileDetailOpen: true,
        };
      }
      return snapshotMode({
        ...state,
        selection,
        secondaryContext: selection,
        rightPanelOpen: true,
        mobileDetailOpen: true,
      });
    }
    case "CLEAR_SELECTION":
      return snapshotMode({
        ...state,
        selection: state.subjectOrganizationId
          ? { entityType: "organization", entityId: state.subjectOrganizationId }
          : null,
        secondaryContext: null,
        rightPanelOpen: false,
        mobileDetailOpen: state.organizationDrawerOpen,
      });
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
    case "HYDRATE_FROM_SESSION":
      return hydrateSessionWorkspace(state, action.state);
    default:
      return state;
  }
}
