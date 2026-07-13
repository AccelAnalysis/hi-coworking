import type {
  ExchangeFilterUpdate,
  ExchangeWorkspaceAction,
} from "./exchangeWorkspaceActions";
import {
  DEFAULT_EXCHANGE_LOCAL_FIRST,
  createInitialExchangeWorkspaceState,
  isExchangeRfxStatus,
  isExchangeSurfaceMode,
  isExchangeTerritoryStatus,
  isExchangeView,
  type ExchangeSelection,
  type ExchangeViewport,
  type ExchangeWorkspaceHydration,
  type ExchangeWorkspaceState,
} from "./exchangeWorkspaceTypes";

const MAX_SEARCH_LENGTH = 200;
const MAX_FILTER_COUNT = 50;
const MAX_FILTER_LENGTH = 64;
const MAX_ENTITY_ID_LENGTH = 160;

function own(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeSearch(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_SEARCH_LENGTH) : "";
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const candidate = item.trim().slice(0, MAX_FILTER_LENGTH);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    normalized.push(candidate);
    if (normalized.length >= MAX_FILTER_COUNT) break;
  }
  return normalized;
}

function normalizeSelection(value: unknown): ExchangeSelection | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;

  const candidate = value as { entityType?: unknown; entityId?: unknown };
  if (candidate.entityType !== "rfx" && candidate.entityType !== "territory") {
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

function applyFilterUpdate(
  state: ExchangeWorkspaceState,
  filters: ExchangeFilterUpdate,
): ExchangeWorkspaceState {
  const next = { ...state };

  if (own(filters, "naicsFilters")) {
    next.naicsFilters = normalizeStringList(filters.naicsFilters);
  }
  if (own(filters, "territoryFilters")) {
    next.territoryFilters = normalizeStringList(filters.territoryFilters);
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
  if (typeof filters.localFirst === "boolean") {
    next.localFirst = filters.localFirst;
  }

  return next;
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
    own(hydration, "surfaceMode")
    && isExchangeSurfaceMode(hydration.surfaceMode)
  ) {
    next.surfaceMode = hydration.surfaceMode;
  }
  if (own(hydration, "searchQuery")) {
    next.searchQuery = normalizeSearch(hydration.searchQuery);
  }

  next = applyFilterUpdate(next, {
    ...(own(hydration, "naicsFilters")
      ? { naicsFilters: hydration.naicsFilters }
      : {}),
    ...(own(hydration, "territoryFilters")
      ? { territoryFilters: hydration.territoryFilters }
      : {}),
    ...(own(hydration, "rfxStatusFilters")
      ? { rfxStatusFilters: hydration.rfxStatusFilters }
      : {}),
    ...(own(hydration, "territoryStatusFilters")
      ? { territoryStatusFilters: hydration.territoryStatusFilters }
      : {}),
    ...(own(hydration, "localFirst")
      ? { localFirst: hydration.localFirst }
      : {}),
  });

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
    case "SET_SEARCH":
      return { ...state, searchQuery: normalizeSearch(action.query) };
    case "SET_FILTERS":
      return applyFilterUpdate(state, action.filters);
    case "CLEAR_FILTERS":
      return {
        ...state,
        searchQuery: "",
        naicsFilters: [],
        territoryFilters: [],
        rfxStatusFilters: [],
        territoryStatusFilters: [],
        localFirst: DEFAULT_EXCHANGE_LOCAL_FIRST,
      };
    case "SET_SURFACE_MODE":
      return isExchangeSurfaceMode(action.mode)
        ? { ...state, surfaceMode: action.mode }
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
