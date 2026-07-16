"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, TriangleAlert, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExchangeActiveFilters, getActiveExchangeFilterLabels } from "../components/ExchangeActiveFilters";
import { ExchangeCommandBar } from "../components/ExchangeCommandBar";
import { ExchangeDetailSheet } from "../components/ExchangeDetailSheet";
import { ExchangeEntityDetail } from "../components/ExchangeEntityDetail";
import { ExchangeFilters } from "../components/ExchangeFilters";
import { ExchangeLeftPanel } from "../components/ExchangeLeftPanel";
import { ExchangeMobileDrawer } from "../components/ExchangeMobileDrawer";
import { ExchangeMobileToolbar } from "../components/ExchangeMobileToolbar";
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

  const mapAvailable = Boolean(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN);
  useEffect(() => {
    if (!mapAvailable && stateRef.current.surfaceMode !== "list") {
      applyAction(exchangeWorkspaceActions.setSurfaceMode("list"), "replace");
    }
  }, [applyAction, mapAvailable]);

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

  const handleMapStatus = useCallback((status: ExchangeMapStatus) => {
    setMapStatus(status);
    if (status === "error" && stateRef.current.surfaceMode !== "list") {
      applyAction(exchangeWorkspaceActions.setSurfaceMode("list"), "replace");
    }
  }, [applyAction]);

  const retryMap = useCallback(() => {
    setMapRetryKey((value) => value + 1);
    setMapStatus("initializing");
    applyAction(exchangeWorkspaceActions.setSurfaceMode("map"), "push");
  }, [applyAction]);

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

  const effectiveMode: ExchangeSurfaceMode = !mapAvailable
    ? "list"
    : splitSupported !== true && state.surfaceMode === "split"
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">
      <ExchangeCommandBar
        view="opportunities"
        searchQuery={state.searchQuery}
        surfaceMode={effectiveMode}
        resultCount={resultCount}
        activeFilterCount={activeFilterCount}
        filtersOpen={state.mobileFilterOpen}
        mapAvailable={mapAvailable}
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
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900" role="status">
          <WifiOff className="h-4 w-4" aria-hidden="true" /> Offline. Previously loaded results remain available where possible.
        </div>
      ) : degradedError ? (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900" role="status">
          <TriangleAlert className="h-4 w-4" aria-hidden="true" /> {degradedError.message}
          <button type="button" onClick={() => void retry()} className="rounded px-1 underline outline-none focus-visible:ring-2 focus-visible:ring-amber-700">Retry</button>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <ExchangeLeftPanel
          collapsed={state.leftPanelCollapsed}
          filterContent={filterContent()}
          resultsContent={resultsContent()}
          showResults={effectiveMode === "map"}
          onToggle={() => applyAction(exchangeWorkspaceActions.toggleLeftPanel())}
        />

        <section className="relative min-h-0 min-w-0 flex-1 overflow-hidden" aria-label="Exchange discovery surface">
          <div
            className={cn(
              "relative h-full min-h-0",
              effectiveMode === "split" && "lg:grid lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.75fr)]",
            )}
            inert={Boolean(blockingState)}
            aria-hidden={blockingState ? "true" : undefined}
          >
            <div className={cn(
              "min-h-0 overflow-hidden bg-slate-200",
              effectiveMode === "map" && "absolute inset-0",
              effectiveMode === "list" && "pointer-events-none invisible absolute inset-0",
              effectiveMode === "split" && "relative",
            )}>
              {mapAvailable ? (
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
                  className="h-full min-h-0 w-full border-0"
                  onSelect={(selection) => {
                    if (selection) selectEntity(selection);
                  }}
                  onBackgroundClick={clearSelection}
                  onViewportChange={handleViewportChange}
                  onStatusChange={handleMapStatus}
                  onRetry={retryMap}
                />
              ) : (
                <ExchangeStateView kind="token-missing" />
              )}
              <button
                type="button"
                onClick={() => setFitRequest((value) => value + 1)}
                className="absolute left-3 top-3 z-10 hidden min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 text-xs font-bold text-slate-700 shadow-lg outline-none backdrop-blur hover:bg-white focus-visible:ring-2 focus-visible:ring-indigo-500 lg:inline-flex"
              >
                <LocateFixed className="h-4 w-4" aria-hidden="true" /> Fit results
              </button>
              {filtered.rfx.length > 0 && !hasGeocodedRfx ? (
                <div className="absolute inset-x-3 bottom-8 z-10 mx-auto max-w-lg rounded-xl border border-amber-200 bg-amber-50/95 px-3 py-2 text-center text-xs font-semibold text-amber-900 shadow-lg backdrop-blur" role="status">
                  Matching RFx have no map coordinates. Switch to list view to inspect them.
                </div>
              ) : null}
              <ExchangeMobileToolbar
                resultCount={resultCount}
                activeFilterCount={activeFilterCount}
                filtersOpen={state.mobileFilterOpen}
                mapVisible={effectiveMode !== "list"}
                onOpenFilters={() => applyAction(exchangeWorkspaceActions.openMobileFilter())}
                onFitResults={() => setFitRequest((value) => value + 1)}
              />
            </div>

            {effectiveMode !== "map" ? (
              <div className={cn(
                "min-h-0 bg-slate-50 flex flex-col",
                effectiveMode === "list" && "absolute inset-0",
                effectiveMode === "split" && "relative border-l border-slate-200",
              )}>
                {!mapAvailable ? (
                  <div className="border-b border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900" role="status">
                    Map view is unavailable. List view works without <code>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code>.
                  </div>
                ) : mapStatus === "error" ? (
                  <div className="flex items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900" role="alert">
                    <span>Map load failed. Results remain available here.</span>
                    <button type="button" onClick={retryMap} className="min-h-9 rounded-lg border border-amber-300 bg-white px-3 outline-none focus-visible:ring-2 focus-visible:ring-amber-700">Retry map</button>
                  </div>
                ) : null}
                <div className="min-h-0 flex-1">
                  {resultsContent(effectiveMode === "split")}
                </div>
              </div>
            ) : null}
          </div>
          {blockingState ? (
            <div className="absolute inset-0 z-40 overflow-y-auto bg-slate-100 p-4 sm:p-8">
              <ExchangeStateView
                kind={blockingState}
                message={blockingState === "error" ? error?.message : undefined}
                onRetry={blockingState === "error" ? () => void retry() : undefined}
                onClear={blockingState === "filtered-empty" ? clearFilters : undefined}
              />
            </div>
          ) : null}
        </section>

        <ExchangeRightPanel
          open={Boolean(opportunitySelection && state.rightPanelOpen)}
          title={detailTitle}
          onClose={() => applyAction(exchangeWorkspaceActions.closeRightPanel())}
        >
          {detailContent}
        </ExchangeRightPanel>
      </div>

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
