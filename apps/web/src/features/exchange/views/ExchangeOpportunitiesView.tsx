"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, MapPinned, TriangleAlert, WifiOff, X } from "lucide-react";
import {
  ExchangeActiveFilters,
  getActiveExchangeFilters,
  type ActiveExchangeFilter,
} from "../components/ExchangeActiveFilters";
import { ExchangeCommandBar } from "../components/ExchangeCommandBar";
import { ExchangeDetailSheet } from "../components/ExchangeDetailSheet";
import { ExchangeEntityDetail } from "../components/ExchangeEntityDetail";
import { ExchangeFilters } from "../components/ExchangeFilters";
import { ExchangeLeftPanel } from "../components/ExchangeLeftPanel";
import { ExchangeMobileDrawer } from "../components/ExchangeMobileDrawer";
import { ExchangeMobileWorkspaceTray } from "../components/ExchangeMobileWorkspaceTray";
import { ExchangeResultsList } from "../components/ExchangeResultsList";
import { ExchangeRightPanel } from "../components/ExchangeRightPanel";
import { SavedOpportunitySearchManager } from "../components/SavedOpportunitySearchManager";
import { ExchangeStateView, type ExchangeStateKind } from "../components/ExchangeStateView";
import { resolveExchangeBlockingState } from "../data/exchangePresentationState";
import { selectExchangeResults } from "../data/exchangeSelectors";
import { liveExchangeOpportunityRepository } from "../data/exchangeRepository";
import { useExchangeData } from "../data/useExchangeData";
import { useOpportunityDiscovery } from "../data/useOpportunityDiscovery";
import type { ExchangeDiscoveryRfx } from "../data/opportunityDiscoveryGateway";
import { opportunityQueryToWorkspaceHydration } from "../data/opportunityDiscoveryState";
import { exchangeDemoOpportunityRepository } from "../demo/exchangeDemoGateway";
import { isValidLatitude, isValidLongitude } from "../map/geojson";
import {
  DEFAULT_EXCHANGE_MAP_VIEWPORT,
  type ExchangeMapBounds,
} from "../map/mapConfig";
import type { ExchangeMapSelection } from "../map/selection";
import type { ExchangeMapStatus } from "../map/useExchangeMap";
import {
  exchangeWorkspaceActions,
  type ExchangeFilterUpdate,
} from "../state/exchangeWorkspaceActions";
import type {
  ExchangeSelection,
  ExchangeSurfaceMode,
} from "../state/exchangeWorkspaceTypes";
import type { ExchangeViewProps } from "./exchangeViewTypes";

const ExchangeMap = dynamic(
  () => import("../map/ExchangeMap").then((module) => module.ExchangeMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center bg-slate-100 text-sm font-semibold text-slate-600" role="status">
        Loading map…
      </div>
    ),
  },
);

function useSupportsSplitMode(): boolean | null {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setSupported(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return supported;
}

function removeFrom(values: readonly string[], value: string): string[] {
  return values.filter((candidate) => candidate !== value);
}

export function ExchangeOpportunitiesView({
  state,
  applyAction,
  scheduleUrlReplace,
  onViewChange,
  demoMode,
}: ExchangeViewProps & { demoMode: boolean }) {
  const stateRef = useRef(state);
  const mapMoveCount = useRef(0);
  const splitSupported = useSupportsSplitMode();
  const [mapStatus, setMapStatus] = useState<ExchangeMapStatus>("initializing");
  const [mapRetryKey, setMapRetryKey] = useState(0);
  const [fitRequest, setFitRequest] = useState(0);
  const [pendingMapBounds, setPendingMapBounds] = useState<ExchangeMapBounds | null>(null);
  const [mapAreaDirty, setMapAreaDirty] = useState(false);
  const repository = demoMode
    ? exchangeDemoOpportunityRepository
    : liveExchangeOpportunityRepository;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const baseData = useExchangeData(repository);
  const discovery = useOpportunityDiscovery(state, { enabled: !demoMode });

  const {
    rfx: repositoryRfx,
    releasedTerritories,
    scheduledTerritories,
    manageableRfxIds,
    loading: repositoryLoading,
    refreshing: repositoryRefreshing,
    error: repositoryError,
    viewportError,
    online,
    lastUpdatedAt,
    retry: retryRepository,
    updateViewport,
    pinSelectedRfx,
  } = baseData;

  const opportunitySelection: ExchangeMapSelection = state.selection
    && (state.selection.entityType === "rfx" || state.selection.entityType === "territory")
    ? state.selection
    : null;
  const selectedRfxId = opportunitySelection?.entityType === "rfx"
    ? opportunitySelection.entityId
    : null;

  useEffect(() => {
    pinSelectedRfx(selectedRfxId);
  }, [pinSelectedRfx, repositoryRfx, selectedRfxId]);

  const allTerritories = useMemo(
    () => [...releasedTerritories, ...scheduledTerritories],
    [releasedTerritories, scheduledTerritories],
  );
  const releasedFips = useMemo(
    () => releasedTerritories.map((territory) => territory.fips),
    [releasedTerritories],
  );
  const baseFilterState = useMemo(() => ({
    searchQuery: state.searchQuery,
    naicsFilters: state.naicsFilters,
    territoryFilters: state.territoryFilters,
    rfxStatusFilters: state.rfxStatusFilters,
    territoryStatusFilters: state.territoryStatusFilters,
    localFirst: state.localFirst,
  }), [
    state.localFirst,
    state.naicsFilters,
    state.rfxStatusFilters,
    state.searchQuery,
    state.territoryFilters,
    state.territoryStatusFilters,
  ]);
  const demoFiltered = useMemo(
    () => selectExchangeResults(
      repositoryRfx,
      allTerritories,
      baseFilterState,
      { priorityTerritoryFips: releasedFips },
    ),
    [allTerritories, baseFilterState, releasedFips, repositoryRfx],
  );
  const filteredTerritories = useMemo(
    () => selectExchangeResults(
      [],
      allTerritories,
      baseFilterState,
      { priorityTerritoryFips: releasedFips },
    ),
    [allTerritories, baseFilterState, releasedFips],
  );
  const opportunityRfx = (demoMode
    ? demoFiltered.rfx
    : discovery.rfx) as ExchangeDiscoveryRfx[];
  const visibleTerritories = demoMode ? demoFiltered : filteredTerritories;
  const manageableSet = useMemo(() => new Set(manageableRfxIds), [manageableRfxIds]);

  useEffect(() => {
    if (splitSupported === false && stateRef.current.surfaceMode === "split") {
      applyAction(exchangeWorkspaceActions.setSurfaceMode("map"), "replace");
    }
    if (splitSupported === true && stateRef.current.mobileFilterOpen) {
      applyAction(exchangeWorkspaceActions.closeMobileFilter());
    }
  }, [applyAction, splitSupported]);

  const handleViewportChange = useCallback((bounds: ExchangeMapBounds) => {
    updateViewport(bounds);
    applyAction(exchangeWorkspaceActions.setViewport({
      longitude: bounds.longitude,
      latitude: bounds.latitude,
      zoom: bounds.zoom,
      bearing: bounds.bearing,
      pitch: bounds.pitch,
    }));
    scheduleUrlReplace(350);
    setPendingMapBounds(bounds);
    mapMoveCount.current += 1;
    if (mapMoveCount.current > 1) setMapAreaDirty(true);
  }, [applyAction, scheduleUrlReplace, updateViewport]);

  const handleSearchChange = useCallback((query: string) => {
    applyAction(exchangeWorkspaceActions.setSearch(query));
    scheduleUrlReplace(250);
  }, [applyAction, scheduleUrlReplace]);

  const retryMap = useCallback(() => {
    setMapRetryKey((value) => value + 1);
    setMapStatus("initializing");
  }, []);

  const selectEntity = useCallback((selection: Exclude<ExchangeSelection, null>) => {
    if (selection.entityType === "rfx") discovery.markViewed(selection.entityId);
    applyAction(exchangeWorkspaceActions.selectEntity(selection), "push");
  }, [applyAction, discovery]);

  const clearSelection = useCallback(() => {
    applyAction(exchangeWorkspaceActions.clearSelection(), "push");
  }, [applyAction]);

  const setFilters = useCallback((
    filters: ExchangeFilterUpdate,
    history: "push" | "replace" = "push",
  ) => {
    applyAction(exchangeWorkspaceActions.setFilters(filters), history);
  }, [applyAction]);

  const clearFilters = useCallback(() => {
    applyAction(exchangeWorkspaceActions.clearFilters(), "push");
  }, [applyAction]);

  const removeActiveFilter = useCallback((filter: ActiveExchangeFilter) => {
    const [kind, ...rest] = filter.id.split(":");
    const value = rest.join(":");
    switch (kind) {
      case "search": handleSearchChange(""); break;
      case "location": setFilters({ clearOpportunityLocation: true }); break;
      case "naics": setFilters({ naicsFilters: removeFrom(state.naicsFilters, value) }); break;
      case "industry": setFilters({ industryFilters: removeFrom(state.industryFilters, value) }); break;
      case "capability": setFilters({ capabilityFilters: removeFrom(state.capabilityFilters, value) }); break;
      case "territory": setFilters({ territoryFilters: removeFrom(state.territoryFilters, value) }); break;
      case "rfxStatus": setFilters({ rfxStatusFilters: state.rfxStatusFilters.filter((candidate) => candidate !== value) }); break;
      case "territoryStatus": setFilters({ territoryStatusFilters: state.territoryStatusFilters.filter((candidate) => candidate !== value) }); break;
      case "opportunityType": setFilters({ opportunityTypeFilters: removeFrom(state.opportunityTypeFilters, value) }); break;
      case "rfxType": setFilters({ rfxTypeFilters: removeFrom(state.rfxTypeFilters, value) }); break;
      case "buyerType": setFilters({ buyerTypeFilters: removeFrom(state.buyerTypeFilters, value) }); break;
      case "work": setFilters({ workArrangementFilters: removeFrom(state.workArrangementFilters, value) }); break;
      case "visibility": setFilters({ visibilityFilters: removeFrom(state.visibilityFilters, value) }); break;
      case "certification": setFilters({ certificationFilters: removeFrom(state.certificationFilters, value) }); break;
      case "setAside": setFilters({ setAsideFilters: removeFrom(state.setAsideFilters, value) }); break;
      case "prime": setFilters({ primeClassificationFilters: removeFrom(state.primeClassificationFilters, value) }); break;
      case "award": setFilters({ awardClassificationFilters: removeFrom(state.awardClassificationFilters, value) }); break;
      case "personalized": setFilters({ personalizedFilters: state.personalizedFilters.filter((candidate) => candidate !== value) }); break;
      case "closingSoon": setFilters({ closingSoon: false }); break;
      case "teamingSuitable": setFilters({ teamingSuitable: false }); break;
      case "budgetMin": setFilters({ budgetMin: undefined }); break;
      case "budgetMax": setFilters({ budgetMax: undefined }); break;
      case "localFirst": setFilters({ localFirst: true }); break;
      default: break;
    }
  }, [handleSearchChange, setFilters, state]);

  const activeFilters = getActiveExchangeFilters(state);
  const activeFilterCount = activeFilters.length;
  const loadedResultCount = opportunityRfx.length + visibleTerritories.territories.length;
  const resultCount = !demoMode && discovery.totalCount !== undefined
    ? discovery.totalCount + visibleTerritories.territories.length
    : loadedResultCount;
  const sourceCount = demoMode
    ? repositoryRfx.length + allTerritories.length
    : opportunityRfx.length + allTerritories.length;
  const isFiltered = activeFilterCount > 0;
  const loading = demoMode ? repositoryLoading : discovery.loading;
  const refreshing = demoMode ? repositoryRefreshing : discovery.loading || discovery.loadingMore;
  const error = demoMode ? repositoryError : discovery.error;

  const selectedRfx = opportunitySelection?.entityType === "rfx"
    ? opportunityRfx.find((record) => record.id === opportunitySelection.entityId)
      ?? repositoryRfx.find((record) => record.id === opportunitySelection.entityId) as ExchangeDiscoveryRfx | undefined
    : undefined;
  const selectedTerritory = opportunitySelection?.entityType === "territory"
    ? allTerritories.find((record) => record.fips === opportunitySelection.entityId)
    : undefined;
  const detailTitle = selectedRfx?.title || selectedTerritory?.name || "Selected Exchange record";
  const effectiveMode: ExchangeSurfaceMode = splitSupported !== true && state.surfaceMode === "split"
    ? "map"
    : state.surfaceMode;
  const hasGeocodedRfx = opportunityRfx.some((record) =>
    isValidLatitude(record.geo?.lat) && isValidLongitude(record.geo?.lng));

  const filterContent = () => (
    <div>
      <ExchangeFilters
        state={state}
        territories={allTerritories}
        activeFilterCount={activeFilterCount}
        onChange={setFilters}
        onClear={clearFilters}
      />
      {!demoMode ? (
        <div className="px-4 pb-4">
          <SavedOpportunitySearchManager
            state={state}
            onRun={(query) => {
              applyAction(
                exchangeWorkspaceActions.hydrateFromUrl(
                  opportunityQueryToWorkspaceHydration(query),
                ),
                "push",
              );
            }}
          />
        </div>
      ) : null}
    </div>
  );

  const resultsContent = (compact = false) => (
    <ExchangeResultsList
      rfx={opportunityRfx}
      territories={visibleTerritories.territories}
      selection={opportunitySelection}
      manageableRfxIds={manageableSet}
      compact={compact}
      hasMore={!demoMode && Boolean(discovery.nextCursor)}
      loadingMore={!demoMode && discovery.loadingMore}
      onSelect={selectEntity}
      onSave={!demoMode ? discovery.setSaved : undefined}
      onLoadMore={!demoMode ? discovery.loadMore : undefined}
    />
  );

  const blockingState: ExchangeStateKind | null = resolveExchangeBlockingState({
    loading,
    errorKind: error?.kind,
    sourceCount,
    resultCount,
    isFiltered,
  });

  let detailContent;
  if (!opportunitySelection || selectedRfx || selectedTerritory) {
    detailContent = (
      <ExchangeEntityDetail
        rfx={selectedRfx}
        territory={selectedTerritory}
        manageable={selectedRfx ? manageableSet.has(selectedRfx.id) || Boolean(selectedRfx.discovery?.relationship.managed) : false}
        onSave={selectedRfx && !demoMode ? (saved) => discovery.setSaved(selectedRfx.id, saved) : undefined}
      />
    );
  } else if (loading || (lastUpdatedAt === null && !error)) {
    detailContent = <ExchangeStateView kind="loading" compact />;
  } else if (error) {
    detailContent = (
      <ExchangeStateView
        kind={error.kind === "permission" ? "permission" : "error"}
        compact
        message={error.message}
        onRetry={() => void (demoMode ? retryRepository() : discovery.retry())}
      />
    );
  } else {
    detailContent = <ExchangeStateView kind="selection-unavailable" compact />;
  }

  const degradedError = demoMode && repositoryError && sourceCount > 0
    ? repositoryError
    : viewportError;
  const conciseWarning = !demoMode && discovery.warnings.length
    ? discovery.warnings[0]
    : degradedError?.message;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">
      <ExchangeCommandBar
        view="opportunities"
        searchQuery={state.searchQuery}
        surfaceMode={effectiveMode}
        resultCount={resultCount}
        activeFilterCount={activeFilterCount}
        filtersOpen={state.mobileFilterOpen}
        mapAvailable={mapStatus !== "failed"}
        refreshing={refreshing}
        opportunitySort={state.opportunitySort}
        opportunityLocation={state.opportunityLocation}
        onViewChange={onViewChange}
        onSearchChange={handleSearchChange}
        onSurfaceModeChange={(mode) => applyAction(exchangeWorkspaceActions.setSurfaceMode(mode), "push")}
        onOpenFilters={() => applyAction(exchangeWorkspaceActions.openMobileFilter())}
        onClearFilters={clearFilters}
        onRefresh={() => void Promise.all([
          retryRepository(),
          ...(demoMode ? [] : [Promise.resolve(discovery.retry())]),
        ])}
        onOpportunitySortChange={(sort) => applyAction(exchangeWorkspaceActions.setOpportunitySort(sort), "push")}
        onOpportunityLocationChange={(location) => applyAction(exchangeWorkspaceActions.setOpportunityLocation(location), "push")}
      />
      <ExchangeActiveFilters state={state} onClear={clearFilters} onRemove={removeActiveFilter} />

      {!online ? (
        <div className="absolute left-1/2 top-32 z-[1150] flex max-w-[90%] -translate-x-1/2 items-center justify-center gap-2 rounded-full border border-amber-200/80 bg-amber-50/88 px-4 py-2 text-xs font-semibold text-amber-900 shadow-lg backdrop-blur-xl" role="status">
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" /> Offline. Previously loaded results remain available.
        </div>
      ) : conciseWarning ? (
        <div className="absolute left-1/2 top-32 z-[1150] flex max-w-[90%] -translate-x-1/2 items-center justify-center gap-2 rounded-full border border-amber-200/80 bg-amber-50/88 px-4 py-2 text-xs font-semibold text-amber-900 shadow-lg backdrop-blur-xl" role="status">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="line-clamp-1">{conciseWarning}</span>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <ExchangeMap
          key={mapRetryKey}
          rfxList={opportunityRfx}
          releasedTerritories={visibleTerritories.releasedTerritories}
          scheduledTerritories={visibleTerritories.scheduledTerritories}
          selection={opportunitySelection}
          initialViewport={state.viewport ?? DEFAULT_EXCHANGE_MAP_VIEWPORT}
          viewport={state.viewport}
          fitRequest={fitRequest}
          resizeSignal={`${state.leftPanelCollapsed}:${state.rightPanelOpen}:${state.mobileFilterOpen}:${state.mobileDetailOpen}:${effectiveMode}`}
          className="absolute inset-0 h-full min-h-0 w-full border-0"
          onSelect={(selection) => {
            if (selection) selectEntity(selection);
          }}
          onBackgroundClick={clearSelection}
          onViewportChange={handleViewportChange}
          onStatusChange={setMapStatus}
          onRetry={retryMap}
        />

        <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-7rem)] flex-wrap gap-2 lg:left-[22rem]">
          <button
            type="button"
            onClick={() => setFitRequest((value) => value + 1)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/60 bg-white/78 px-3 text-xs font-black text-slate-700 shadow-lg backdrop-blur-2xl outline-none hover:bg-white/95 focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <LocateFixed className="h-4 w-4" aria-hidden="true" /> Fit results
          </button>
          {mapAreaDirty && pendingMapBounds ? (
            <button
              type="button"
              onClick={() => {
                setFilters({
                  opportunityLocation: {
                    label: "Current map area",
                    bounds: {
                      west: pendingMapBounds.west,
                      south: pendingMapBounds.south,
                      east: pendingMapBounds.east,
                      north: pendingMapBounds.north,
                    },
                    includeRemote: false,
                  },
                });
                setMapAreaDirty(false);
              }}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-950/86 px-3 text-xs font-black text-white shadow-lg backdrop-blur-2xl outline-none hover:bg-slate-900 focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <MapPinned className="h-4 w-4" aria-hidden="true" /> Search this map area
            </button>
          ) : null}
          {state.opportunityLocation?.bounds ? (
            <button
              type="button"
              onClick={() => setFilters({ clearOpportunityLocation: true })}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/60 bg-white/78 text-slate-700 shadow-lg backdrop-blur-2xl outline-none hover:bg-white/95 focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-label="Clear map-area filter"
              title="Clear map-area filter"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {opportunityRfx.length > 0 && !hasGeocodedRfx ? (
          <div className="absolute inset-x-3 bottom-8 z-20 mx-auto max-w-lg rounded-2xl border border-amber-200/80 bg-amber-50/82 px-3 py-2 text-center text-xs font-semibold text-amber-900 shadow-lg backdrop-blur-xl" role="status">
            Matching opportunities have no authoritative coordinates. They remain available in the result drawer and are not placed at fabricated centroids.
          </div>
        ) : null}

        <ExchangeLeftPanel
          collapsed={state.leftPanelCollapsed}
          filterContent={filterContent()}
          resultsContent={resultsContent()}
          showResults
          onToggle={() => applyAction(exchangeWorkspaceActions.toggleLeftPanel())}
        />

        <ExchangeRightPanel
          open={Boolean(opportunitySelection && state.rightPanelOpen)}
          title={detailTitle}
          onClose={() => applyAction(exchangeWorkspaceActions.closeRightPanel())}
        >
          {detailContent}
        </ExchangeRightPanel>

        {blockingState ? (
          <div className="pointer-events-none absolute bottom-5 left-1/2 z-30 w-[min(92%,32rem)] -translate-x-1/2 lg:bottom-4">
            <div className="pointer-events-auto rounded-3xl border border-white/60 bg-white/76 p-3 shadow-2xl backdrop-blur-2xl">
              <ExchangeStateView
                kind={blockingState}
                compact
                message={blockingState === "error" ? error?.message : undefined}
                onRetry={blockingState === "error" ? () => void (demoMode ? retryRepository() : discovery.retry()) : undefined}
                onClear={blockingState === "filtered-empty" ? clearFilters : undefined}
              />
            </div>
          </div>
        ) : null}
      </div>

      <ExchangeMobileWorkspaceTray
        view="opportunities"
        surfaceMode={effectiveMode}
        resultCount={resultCount}
        loading={loading}
        onSurfaceModeChange={(mode) => applyAction(exchangeWorkspaceActions.setSurfaceMode(mode), "push")}
      >
        {resultsContent(true)}
      </ExchangeMobileWorkspaceTray>

      <ExchangeMobileDrawer
        open={splitSupported === false && state.mobileFilterOpen}
        activeFilterCount={activeFilterCount}
        onClose={() => applyAction(exchangeWorkspaceActions.closeMobileFilter())}
        onClear={clearFilters}
      >
        {filterContent()}
      </ExchangeMobileDrawer>

      <ExchangeDetailSheet
        open={Boolean(splitSupported === false && opportunitySelection && state.mobileDetailOpen)}
        title={detailTitle}
        onClose={clearSelection}
      >
        {detailContent}
      </ExchangeDetailSheet>
    </div>
  );
}
