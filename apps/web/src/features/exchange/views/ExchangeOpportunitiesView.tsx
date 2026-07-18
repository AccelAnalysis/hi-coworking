"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, TriangleAlert, WifiOff } from "lucide-react";
import { ExchangeActiveFilters, getActiveExchangeFilterLabels } from "../components/ExchangeActiveFilters";
import { ExchangeCommandBar } from "../components/ExchangeCommandBar";
import { ExchangeDetailSheet } from "../components/ExchangeDetailSheet";
import { ExchangeEntityDetail } from "../components/ExchangeEntityDetail";
import { ExchangeFilters } from "../components/ExchangeFilters";
import { ExchangeLeftPanel } from "../components/ExchangeLeftPanel";
import { ExchangeMobileDrawer } from "../components/ExchangeMobileDrawer";
import { ExchangeMobileToolbar } from "../components/ExchangeMobileToolbar";
import { ExchangeMobileWorkspaceTray } from "../components/ExchangeMobileWorkspaceTray";
import { ExchangeResultsList } from "../components/ExchangeResultsList";
import { ExchangeRightPanel } from "../components/ExchangeRightPanel";
import { ExchangeStateView, type ExchangeStateKind } from "../components/ExchangeStateView";
import { resolveExchangeBlockingState } from "../data/exchangePresentationState";
import { selectExchangeResults } from "../data/exchangeSelectors";
import { liveExchangeOpportunityRepository } from "../data/exchangeRepository";
import { useExchangeData } from "../data/useExchangeData";
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

export function ExchangeOpportunitiesView({
  state,
  applyAction,
  scheduleUrlReplace,
  onViewChange,
  demoMode,
}: ExchangeViewProps & { demoMode: boolean }) {
  const stateRef = useRef(state);
  const splitSupported = useSupportsSplitMode();
  const [mapStatus, setMapStatus] = useState<ExchangeMapStatus>("initializing");
  const [mapRetryKey, setMapRetryKey] = useState(0);
  const [fitRequest, setFitRequest] = useState(0);
  const repository = demoMode
    ? exchangeDemoOpportunityRepository
    : liveExchangeOpportunityRepository;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const {
    rfx,
    releasedTerritories,
    scheduledTerritories,
    manageableRfxIds,
    loading,
    refreshing,
    error,
    viewportError,
    online,
    lastUpdatedAt,
    retry,
    updateViewport,
    pinSelectedRfx,
  } = useExchangeData(repository);

  const opportunitySelection: ExchangeMapSelection = state.selection
    && (state.selection.entityType === "rfx" || state.selection.entityType === "territory")
    ? state.selection
    : null;
  const selectedRfxId = opportunitySelection?.entityType === "rfx"
    ? opportunitySelection.entityId
    : null;

  useEffect(() => {
    pinSelectedRfx(selectedRfxId);
  }, [pinSelectedRfx, rfx, selectedRfxId]);

  const allTerritories = useMemo(
    () => [...releasedTerritories, ...scheduledTerritories],
    [releasedTerritories, scheduledTerritories],
  );
  const releasedFips = useMemo(
    () => releasedTerritories.map((territory) => territory.fips),
    [releasedTerritories],
  );
  const filterState = useMemo(() => ({
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
  const filtered = useMemo(
    () => selectExchangeResults(
      rfx,
      allTerritories,
      filterState,
      { priorityTerritoryFips: releasedFips },
    ),
    [allTerritories, filterState, releasedFips, rfx],
  );
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
  }, [applyAction, scheduleUrlReplace, updateViewport]);

  const handleSearchChange = useCallback((query: string) => {
    applyAction(exchangeWorkspaceActions.setSearch(query));
    scheduleUrlReplace(250);
  }, [applyAction, scheduleUrlReplace]);

  const handleNaicsChange = useCallback((values: string[]) => {
    applyAction(exchangeWorkspaceActions.setFilters({ naicsFilters: values }));
    scheduleUrlReplace(250);
  }, [applyAction, scheduleUrlReplace]);

  const retryMap = useCallback(() => {
    setMapRetryKey((value) => value + 1);
    setMapStatus("initializing");
  }, []);

  const selectEntity = useCallback((selection: Exclude<ExchangeSelection, null>) => {
    applyAction(exchangeWorkspaceActions.selectEntity(selection), "push");
  }, [applyAction]);

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

  const activeFilterLabels = getActiveExchangeFilterLabels(state);
  const activeFilterCount = activeFilterLabels.length;
  const sourceCount = rfx.length + allTerritories.length;
  const resultCount = filtered.rfx.length + filtered.territories.length;
  const isFiltered = activeFilterCount > 0;

  const selectedRfx = opportunitySelection?.entityType === "rfx"
    ? rfx.find((record) => record.id === opportunitySelection.entityId)
    : undefined;
  const selectedTerritory = opportunitySelection?.entityType === "territory"
    ? allTerritories.find((record) => record.fips === opportunitySelection.entityId)
    : undefined;
  const detailTitle = selectedRfx?.title || selectedTerritory?.name || "Selected Exchange record";
  const effectiveMode: ExchangeSurfaceMode = splitSupported !== true && state.surfaceMode === "split"
    ? "map"
    : state.surfaceMode;
  const hasGeocodedRfx = filtered.rfx.some((record) =>
    isValidLatitude(record.geo?.lat) && isValidLongitude(record.geo?.lng));

  const filterContent = () => (
    <ExchangeFilters
      territories={allTerritories}
      naicsFilters={state.naicsFilters}
      territoryFilters={state.territoryFilters}
      territoryStatusFilters={state.territoryStatusFilters}
      localFirst={state.localFirst}
      activeFilterCount={activeFilterCount}
      onNaicsChange={handleNaicsChange}
      onTerritoryChange={(values) => setFilters({ territoryFilters: values })}
      onTerritoryStatusChange={(values) => setFilters({ territoryStatusFilters: values })}
      onLocalFirstChange={(value) => setFilters({ localFirst: value })}
      onClear={clearFilters}
    />
  );

  const resultsContent = (compact = false) => (
    <ExchangeResultsList
      rfx={filtered.rfx}
      territories={filtered.territories}
      selection={opportunitySelection}
      manageableRfxIds={manageableSet}
      compact={compact}
      onSelect={selectEntity}
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
        manageable={selectedRfx ? manageableSet.has(selectedRfx.id) : false}
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
        onRetry={() => void retry()}
      />
    );
  } else {
    detailContent = <ExchangeStateView kind="selection-unavailable" compact />;
  }

  const degradedError = error && sourceCount > 0 ? error : viewportError;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">
      <ExchangeCommandBar
        view="opportunities"
        searchQuery={state.searchQuery}
        surfaceMode={effectiveMode}
        resultCount={resultCount}
        activeFilterCount={activeFilterCount}
        filtersOpen={state.mobileFilterOpen}
        mapAvailable
        refreshing={refreshing}
        onViewChange={onViewChange}
        onSearchChange={handleSearchChange}
        onSurfaceModeChange={(mode) => applyAction(exchangeWorkspaceActions.setSurfaceMode(mode), "push")}
        onOpenFilters={() => applyAction(exchangeWorkspaceActions.openMobileFilter())}
        onClearFilters={clearFilters}
        onRefresh={() => void retry()}
      />
      <ExchangeActiveFilters state={state} onClear={clearFilters} />

      {!online ? (
        <div className="absolute left-1/2 top-20 z-50 flex -translate-x-1/2 items-center justify-center gap-2 rounded-full border border-amber-200/80 bg-amber-50/88 px-4 py-2 text-xs font-semibold text-amber-900 shadow-lg backdrop-blur-xl" role="status">
          <WifiOff className="h-4 w-4" aria-hidden="true" /> Offline. Previously loaded results remain available.
        </div>
      ) : degradedError ? (
        <div className="absolute left-1/2 top-20 z-50 flex -translate-x-1/2 items-center justify-center gap-2 rounded-full border border-amber-200/80 bg-amber-50/88 px-4 py-2 text-xs font-semibold text-amber-900 shadow-lg backdrop-blur-xl" role="status">
          <TriangleAlert className="h-4 w-4" aria-hidden="true" /> {degradedError.message}
          <button type="button" onClick={() => void retry()} className="rounded px-1 underline outline-none focus-visible:ring-2 focus-visible:ring-amber-700">Retry</button>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <ExchangeMap
          key={mapRetryKey}
          rfxList={filtered.rfx}
          releasedTerritories={filtered.releasedTerritories}
          scheduledTerritories={filtered.scheduledTerritories}
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

        <button
          type="button"
          onClick={() => setFitRequest((value) => value + 1)}
          className="absolute right-3 top-16 z-20 hidden min-h-10 items-center gap-2 rounded-xl border border-white/60 bg-white/72 px-3 text-xs font-black text-slate-700 shadow-lg backdrop-blur-2xl outline-none hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-indigo-500 lg:inline-flex"
        >
          <LocateFixed className="h-4 w-4" aria-hidden="true" /> Fit results
        </button>

        {filtered.rfx.length > 0 && !hasGeocodedRfx ? (
          <div className="absolute inset-x-3 bottom-8 z-20 mx-auto max-w-lg rounded-2xl border border-amber-200/80 bg-amber-50/82 px-3 py-2 text-center text-xs font-semibold text-amber-900 shadow-lg backdrop-blur-xl" role="status">
            Matching opportunities have no verified coordinates yet. They remain available in the result drawer.
          </div>
        ) : null}

        <ExchangeMobileToolbar
          resultCount={resultCount}
          activeFilterCount={activeFilterCount}
          filtersOpen={state.mobileFilterOpen}
          mapVisible
          onOpenFilters={() => applyAction(exchangeWorkspaceActions.openMobileFilter())}
          onFitResults={() => setFitRequest((value) => value + 1)}
        />

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
                onRetry={blockingState === "error" ? () => void retry() : undefined}
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