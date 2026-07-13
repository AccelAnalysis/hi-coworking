import type { RfxDoc, TerritoryDoc } from "@hi/shared";
import type { ExchangeWorkspaceState } from "../state/exchangeWorkspaceTypes";

export interface ExchangeSelectorContext {
  /**
   * Released-territory ranking input only. It does not represent the member's
   * locality and never grants or implies permission to transact.
   */
  priorityTerritoryFips?: readonly string[];
}

export type ExchangeFilterState = Pick<
  ExchangeWorkspaceState,
  | "searchQuery"
  | "naicsFilters"
  | "territoryFilters"
  | "rfxStatusFilters"
  | "territoryStatusFilters"
  | "localFirst"
>;

export interface ExchangeFilteredResults {
  rfx: RfxDoc[];
  territories: TerritoryDoc[];
  releasedTerritories: TerritoryDoc[];
  scheduledTerritories: TerritoryDoc[];
}

const EMPTY_LOCAL_TERRITORIES: readonly string[] = Object.freeze([]);

function normalizedSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function includesSearch(haystack: Array<string | undefined>, query: string): boolean {
  if (!query) return true;
  return haystack.some((value) => value?.toLocaleLowerCase().includes(query));
}

function naicsMatchesFilter(code: string, filter: string): boolean {
  const normalizedCode = code.trim();
  const normalizedFilter = filter.trim();
  return normalizedCode.startsWith(normalizedFilter)
    || normalizedFilter.startsWith(normalizedCode);
}

function stableLocalFirst<T>(
  records: readonly T[],
  enabled: boolean,
  localTerritories: ReadonlySet<string>,
  territoryOf: (record: T) => string | undefined,
): T[] {
  if (!enabled || localTerritories.size === 0) return [...records];

  return records
    .map((record, index) => ({
      record,
      index,
      local: localTerritories.has(territoryOf(record) ?? ""),
    }))
    .sort((left, right) => Number(right.local) - Number(left.local) || left.index - right.index)
    .map(({ record }) => record);
}

/** Run 2 discovery is deliberately limited to approved, open RFx records. */
export function selectDiscoverableRfx(records: readonly RfxDoc[]): RfxDoc[] {
  return records.filter(
    (record) => record.status === "open"
      && record.adminApprovalStatus === "approved",
  );
}

/** Paused and archived territories are not part of the Run 2 workspace. */
export function selectDiscoverableTerritories(
  records: readonly TerritoryDoc[],
): TerritoryDoc[] {
  return records.filter(
    (record) => record.status === "released" || record.status === "scheduled",
  );
}

export function selectFilteredRfx(
  records: readonly RfxDoc[],
  state: ExchangeFilterState,
  context: ExchangeSelectorContext = {},
): RfxDoc[] {
  const query = normalizedSearch(state.searchQuery);
  const territoryFilters = new Set(state.territoryFilters);
  const statusFilters = new Set<string>(state.rfxStatusFilters);
  const localTerritories = new Set(
    context.priorityTerritoryFips ?? EMPTY_LOCAL_TERRITORIES,
  );

  const filtered = selectDiscoverableRfx(records).filter((record) => {
    if (statusFilters.size > 0 && !statusFilters.has(record.status)) return false;
    if (
      territoryFilters.size > 0
      && (!record.territoryFips || !territoryFilters.has(record.territoryFips))
    ) {
      return false;
    }
    if (
      state.naicsFilters.length > 0
      && !record.naicsCodes?.some((code) =>
        state.naicsFilters.some((filter) => naicsMatchesFilter(code, filter)))
    ) {
      return false;
    }

    return includesSearch(
      [
        record.id,
        record.title,
        record.description,
        record.location,
        record.createdByName,
        record.territoryFips,
        ...(record.naicsCodes ?? []),
      ],
      query,
    );
  });

  // Released-territory-first is ranking only. A released territory does not make
  // an RFx or user transaction-eligible; authorization remains server-side.
  return stableLocalFirst(
    filtered,
    state.localFirst,
    localTerritories,
    (record) => record.territoryFips,
  );
}

export function selectFilteredTerritories(
  records: readonly TerritoryDoc[],
  state: ExchangeFilterState,
  context: ExchangeSelectorContext = {},
): TerritoryDoc[] {
  const query = normalizedSearch(state.searchQuery);
  const territoryFilters = new Set(state.territoryFilters);
  // String-valued here because TerritoryDoc also models paused/archived, while
  // the workspace state deliberately exposes only released/scheduled filters.
  const statusFilters = new Set<string>(state.territoryStatusFilters);
  const localTerritories = new Set(
    context.priorityTerritoryFips ?? EMPTY_LOCAL_TERRITORIES,
  );

  const filtered = selectDiscoverableTerritories(records).filter((record) => {
    if (territoryFilters.size > 0 && !territoryFilters.has(record.fips)) return false;
    if (statusFilters.size > 0 && !statusFilters.has(record.status)) return false;
    return includesSearch(
      [record.fips, record.name, record.state, record.status],
      query,
    );
  });

  return stableLocalFirst(
    filtered,
    state.localFirst,
    localTerritories,
    (record) => record.fips,
  );
}

/**
 * Small dependency-free memoizer suitable for use with useMemo/useRef. Inputs
 * must be treated as immutable, as they are throughout the workspace reducer.
 */
export function createExchangeResultsSelector() {
  let previousRfx: readonly RfxDoc[] | undefined;
  let previousTerritories: readonly TerritoryDoc[] | undefined;
  let previousState: ExchangeFilterState | undefined;
  let previousLocalTerritories: readonly string[] | undefined;
  let previousResult: ExchangeFilteredResults | undefined;

  return (
    rfx: readonly RfxDoc[],
    territories: readonly TerritoryDoc[],
    state: ExchangeFilterState,
    context: ExchangeSelectorContext = {},
  ): ExchangeFilteredResults => {
    const localTerritories = context.priorityTerritoryFips
      ?? EMPTY_LOCAL_TERRITORIES;
    if (
      previousResult
      && rfx === previousRfx
      && territories === previousTerritories
      && state === previousState
      && localTerritories === previousLocalTerritories
    ) {
      return previousResult;
    }

    const filteredRfx = selectFilteredRfx(rfx, state, context);
    const filteredTerritories = selectFilteredTerritories(
      territories,
      state,
      context,
    );
    const result: ExchangeFilteredResults = {
      rfx: filteredRfx,
      territories: filteredTerritories,
      releasedTerritories: filteredTerritories.filter(
        (territory) => territory.status === "released",
      ),
      scheduledTerritories: filteredTerritories.filter(
        (territory) => territory.status === "scheduled",
      ),
    };

    previousRfx = rfx;
    previousTerritories = territories;
    previousState = state;
    previousLocalTerritories = localTerritories;
    previousResult = result;
    return result;
  };
}

export const selectExchangeResults = createExchangeResultsSelector();
