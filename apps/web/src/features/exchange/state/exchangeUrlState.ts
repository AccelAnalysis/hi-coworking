import {
  DEFAULT_EXCHANGE_LOCAL_FIRST,
  DEFAULT_EXCHANGE_SURFACE_MODE,
  DEFAULT_EXCHANGE_VIEW,
  isExchangeRfxStatus,
  isExchangeSurfaceMode,
  isExchangeTerritoryStatus,
  isExchangeView,
  type ExchangeSelection,
  type ExchangeUrlState,
  type ExchangeViewport,
  type ExchangeWorkspaceState,
} from "./exchangeWorkspaceTypes";
import { normalizeExchangeViewport } from "./exchangeWorkspaceReducer";

const MAX_SEARCH_LENGTH = 200;
const MAX_ENTITY_ID_LENGTH = 160;
const MAX_FILTER_COUNT = 50;
const NAICS_PATTERN = /^\d{2,6}$/;
const TERRITORY_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

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
  isValid: (candidate: string) => boolean,
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

function parseNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

function parseSelection(params: URLSearchParams): ExchangeSelection {
  const entityType = params.get("entity");
  const entityId = params.get("selected") ?? "";
  if (
    (entityType !== "rfx" && entityType !== "territory")
    || entityId.length === 0
    || entityId.length > MAX_ENTITY_ID_LENGTH
    || /[\u0000-\u001f\u007f]/.test(entityId)
  ) {
    return null;
  }
  return { entityType, entityId };
}

export function createDefaultExchangeUrlState(): ExchangeUrlState {
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

  const local = params.get("local");
  if (local === "0") state.localFirst = false;
  if (local === "1") state.localFirst = true;

  state.selection = parseSelection(params);
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

/**
 * Serializes only the explicit public interaction-state allowlist above.
 * Fetched documents, user identity, auth state, panel state, and arbitrary
 * object properties can never enter the URL through this codec.
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
  serializeCsv(params, "territory", state.territoryFilters);
  serializeCsv(params, "naics", state.naicsFilters);
  serializeCsv(params, "rfxStatus", state.rfxStatusFilters);
  serializeCsv(params, "territoryStatus", state.territoryStatusFilters);
  if (state.localFirst !== DEFAULT_EXCHANGE_LOCAL_FIRST) {
    params.set("local", state.localFirst ? "1" : "0");
  }

  if (state.selection) {
    params.set("entity", state.selection.entityType);
    params.set("selected", state.selection.entityId);
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
