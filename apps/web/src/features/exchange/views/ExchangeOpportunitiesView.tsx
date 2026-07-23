"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LocateFixed, MapPinned, TriangleAlert, WifiOff, X } from "lucide-react";
import { useAuth } from "@/lib/authContext";
import type { PublicOrganizationProjection } from "@/lib/firestore";
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
import { ExchangeMobileToolbar } from "../components/ExchangeMobileToolbar";
import { ExchangeMobileWorkspaceTray } from "../components/ExchangeMobileWorkspaceTray";
import { ExchangeResultsList } from "../components/ExchangeResultsList";
import { ExchangeRightPanel } from "../components/ExchangeRightPanel";
import { SavedOpportunitySearchManager } from "../components/SavedOpportunitySearchManager";
import { ExchangeStateView, type ExchangeStateKind } from "../components/ExchangeStateView";
import { resolveExchangeBlockingState } from "../data/exchangePresentationState";
import { loadPrimaryBusinessAnchor } from "../data/exchangeMapAnchor";
import { selectExchangeResults } from "../data/exchangeSelectors";
import { liveExchangeOpportunityRepository } from "../data/exchangeRepository";
import { useExchangeData } from "../data/useExchangeData";
import { useOpportunityDiscovery } from "../data/useOpportunityDiscovery";
import type { ExchangeDiscoveryRfx } from "../data/opportunityDiscoveryGateway";
import { opportunityQueryToWorkspaceHydration } from "../data/opportunityDiscoveryState";
import { filterPublicOrganizations } from "../data/organizationDiscovery";
import {
  loadPublicOrganizationsForExchange,
  subscribePublicOrganizationsForExchange,
} from "../data/publicOrganizationRepository";
import { exchangeDemoOpportunityRepository } from "../demo/exchangeDemoGateway";
import { isValidLatitude, isValidLongitude } from "../map/geojson";
import {
  DEFAULT_EXCHANGE_MAP_VIEWPORT,
  type ExchangeMapBounds,
} from "../map/mapConfig";
import type { ExchangeMapSelection } from "../map/selection";
import {
  readExchangeMapSession,
  resolveInitialExchangeMapViewport,
  writeExchangeMapSession,
} from "../map/mapSession";
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
  workspaceMap = false,
}: ExchangeViewProps & { demoMode: boolean; workspaceMap?: boolean }) {
  const stateRef = useRef(state);
  const mapMoveCount = useRef(0);
  const { user, userDoc, loading: authLoading } = useAuth();
  const splitSupported = useSupportsSplitMode();
  const [mapStatus, setMapStatus] = useState<ExchangeMapStatus>("initializing");
  const [mapRetryKey, setMapRetryKey] = useState(0);
  const [fitRequest, setFitRequest] = useState(0);
  const [pendingMapBounds, setPendingMapBounds] = useState<ExchangeMapBounds | null>(null);
  const [mapAreaDirty, setMapAreaDirty] = useState(false);
  const [publicOrganizations, setPublicOrganizations] = useState<PublicOrganizationProjection[]>([]);
  const [organizationLoadError, setOrganizationLoadError] = useState<string | null>(null);
  const organizationRequestGeneration = useRef(0);
  const [initialMapViewport, setInitialMapViewport] = useState(() =>
    state.viewport ?? (demoMode ? { ...DEFAULT_EXCHANGE_MAP_VIEWPORT } : null),
  );
  const initialViewportResolvedRef = useRef(Boolean(initialMapViewport));
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
    unreleasedTerritories,
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

  const refreshOrganizations = useCallback(async (force = false) => {
    const cacheScope = user?.uid;
    if (!cacheScope) {
      setPublicOrganizations([]);
      return;
    }
    const generation = organizationRequestGeneration.current + 1;
    organizationRequestGeneration.current = generation;
    setOrganizationLoadError(null);
    try {
      const organizations = await loadPublicOrganizationsForExchange({
        cacheScope,
        force,
      });
      if (organizationRequestGeneration.current === generation) {
        setPublicOrganizations(organizations);
      }
    } catch {
      if (organizationRequestGeneration.current !== generation) return;
      setOrganizationLoadError("Public organizations could not be loaded. Opportunity and territory results remain available.");
    }
  }, [user?.uid]);

  useEffect(() => {
    if (demoMode) {
      setPublicOrganizations([]);
      setOrganizationLoadError(null);
      return;
    }
    const cacheScope = user?.uid;
    if (authLoading || !cacheScope) {
      organizationRequestGeneration.current += 1;
      setPublicOrganizations([]);
      return;
    }
    let active = true;
    const unsubscribe = subscribePublicOrganizationsForExchange(
      cacheScope,
      (organizations) => {
        if (active) setPublicOrganizations(organizations);
      },
    );
    void refreshOrganizations();
    return () => {
      active = false;
      unsubscribe();
      organizationRequestGeneration.current += 1;
    };
  }, [authLoading, demoMode, refreshOrganizations, user?.uid]);

  useEffect(() => {
    if (workspaceMap) return;
    if (initialViewportResolvedRef.current) return;
    if (state.viewport) {
      initialViewportResolvedRef.current = true;
      setInitialMapViewport(state.viewport);
      return;
    }
    if (demoMode) {
      initialViewportResolvedRef.current = true;
      setInitialMapViewport({ ...DEFAULT_EXCHANGE_MAP_VIEWPORT });
      return;
    }
    if (authLoading || repositoryLoading || !user) return;

    let active = true;
    void (async () => {
      const savedViewport = readExchangeMapSession(window.localStorage, user.uid);
      const businessAnchor = savedViewport
        ? null
        : await loadPrimaryBusinessAnchor(user.uid, userDoc?.primaryOrganizationId);
      if (!active || initialViewportResolvedRef.current) return;
      initialViewportResolvedRef.current = true;
      setInitialMapViewport(resolveInitialExchangeMapViewport({
        savedViewport,
        businessAnchor,
        releasedTerritories,
      }));
    })();

    return () => {
      active = false;
    };
  }, [authLoading, demoMode, repositoryLoading, releasedTerritories, state.viewport, user, userDoc?.primaryOrganizationId, workspaceMap]);

  const opportunitySelection: ExchangeMapSelection = state.secondaryContext
    && (state.secondaryContext.entityType === "rfx"
      || state.secondaryContext.entityType === "territory")
    ? state.secondaryContext
    : null;
  const resultSelection: ExchangeMapSelection = opportunitySelection
    ?? (state.subjectOrganizationId
      ? { entityType: "organization", entityId: state.subjectOrganizationId }
      : null);
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
  const visibleOrganizations = useMemo(
    () => filterPublicOrganizations(publicOrganizations, state),
    [publicOrganizations, state],
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
    const nextViewport = {
      longitude: bounds.longitude,
      latitude: bounds.latitude,
      zoom: bounds.zoom,
      bearing: bounds.bearing,
      pitch: bounds.pitch,
    };
    if (!demoMode && user) {
      writeExchangeMapSession(window.localStorage, user.uid, nextViewport);
    }
    applyAction(exchangeWorkspaceActions.setViewport(nextViewport));
    scheduleUrlReplace(350);
    setPendingMapBounds(bounds);
    mapMoveCount.current += 1;
    if (mapMoveCount.current > 1) setMapAreaDirty(true);
  }, [applyAction, demoMode, scheduleUrlReplace, updateViewport, user]);

  useEffect(() => {
    if (!workspaceMap) return;
    const receiveBounds = (event: Event) => {
      const bounds = (event as CustomEvent<ExchangeMapBounds>).detail;
      if (!bounds) return;
      setPendingMapBounds(bounds);
      mapMoveCount.current += 1;
      if (mapMoveCount.current > 1) setMapAreaDirty(true);
    };
    window.addEventListener("hi-exchange-map-bounds", receiveBounds);
    return () => window.removeEventListener("hi-exchange-map-bounds", receiveBounds);
  }, [workspaceMap]);

  const fitMapResults = useCallback(() => {
    if (workspaceMap) {
      window.dispatchEvent(new Event("hi-exchange-fit-map"));
      return;
    }
    setFitRequest((value) => value + 1);
  }, [workspaceMap]);

  const handleSearchChange = useCallback((query: string) => {
    applyAction(exchangeWorkspaceActions.setSearch(query));
    scheduleUrlReplace(250);
  }, [applyAction, scheduleUrlReplace]);

  const retryMap = useCallback(() => {
    setMapRetryKey((value) => value + 1);
    setMapStatus("initializing");
  }, []);

  const selectEntity = useCallback((selection: Exclude<ExchangeSelection, null>) => {
    if (selection.entityType === "organization") {
      applyAction(exchangeWorkspaceActions.setOrganizationDrawerOpen(true));
      applyAction(exchangeWorkspaceActions.setSubjectOrganization(selection.entityId), "push");
      return;
    }
    if (selection.entityType === "rfx") discovery.markViewed(selection.entityId);
    applyAction(exchangeWorkspaceActions.setSecondaryContext(selection), "push");
  }, [applyAction, discovery]);

  const clearSelection = useCallback(() => {
    applyAction(exchangeWorkspaceActions.clearSecondaryContext(), "push");
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
  const loadedResultCount = opportunityRfx.length
    + visibleTerritories.territories.length
    + visibleOrganizations.length;
  const resultCount = !demoMode && discovery.totalCount !== undefined
    ? discovery.totalCount + visibleTerritories.territories.length + visibleOrganizations.length
    : loadedResultCount;
  const sourceCount = demoMode
    ? repositoryRfx.length + allTerritories.length
    : opportunityRfx.length + allTerritories.length + publicOrganizations.length;
  const isFiltered = activeFilterCount > 0;
  const loading = demoMode ? repositoryLoading : discovery.loading;
  const refreshing = demoMode
    ? repositoryRefreshing
    : discovery.loading || discovery.loadingMore;
  const error = demoMode ? repositoryError : discovery.error;

  const selectedRfx = opportunitySelection?.entityType === "rfx"
    ? opportunityRfx.find((record) => record.id === opportunitySelection.entityId)
      ?? repositoryRfx.find((record) => record.id === opportunitySelection.entityId) as ExchangeDiscoveryRfx | undefined
    : undefined;
  const selectedTerritory = opportunitySelection?.entityType === "territory"
    ? allTerritories.find((record) => record.fips === opportunitySelection.entityId)
    : undefined;
  const detailTitle = selectedRfx?.title
    || selectedTerritory?.name
    || "Selected Exchange record";
  const effectiveMode: ExchangeSurfaceMode = splitSupported !== true && state.surfaceMode === "split"
    ? "map"
    : state.surfaceMode;
  const hasGeocodedRfx = opportunityRfx.some((record) =>
    isValidLatitude(record.geo?.lat) && isValidLongitude(record.geo?.lng));
  const hasGeocodedOrganization = visibleOrganizations.some((organization) =>
    !organization.homeBased
    && !organization.privacySuppressed
    && organization.coordinatePublicationApproved === true
    && isValidLatitude(organization.latitude)
    && isValidLongitude(organization.longitude));

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
            onRun={(query, id) => {
              applyAction(
                exchangeWorkspaceActions.hydrateFromUrl(
                  {
                    ...opportunityQueryToWorkspaceHydration(query),
                    activeSavedSearchId: id,
                  },
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
      organizations={visibleOrganizations}
      selection={resultSelection}
      manageableRfxIds={manageableSet}
      compact={compact}
      hasMore={!demoMode && Boolean(discovery.nextCursor)}
      loadingMore={!demoMode && discovery.loadingMore}
      initialScrollTop={state.modeStates.opportunities.listScrollTop}
      onSelect={selectEntity}
      onSave={!demoMode ? discovery.setSaved : undefined}
      onLoadMore={!demoMode ? discovery.loadMore : undefined}
      onScrollTopChange={(scrollTop) => applyAction(
        exchangeWorkspaceActions.setModeListScroll(scrollTop, "opportunities"),
      )}
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
        manageable={selectedRfx
          ? manageableSet.has(selectedRfx.id)
            || Boolean(selectedRfx.discovery?.relationship.managed)
          : false}
        onSave={selectedRfx && !demoMode
          ? (saved) => discovery.setSaved(selectedRfx.id, saved)
          : undefined}
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
    : degradedError?.message ?? organizationLoadError;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      <ExchangeCommandBar
        view="opportunities"
        searchQuery={state.searchQuery}
        surfaceMode={effectiveMode}
        resultCount={resultCount}
        activeFilterCount={activeFilterCount}
        filtersOpen={state.mobileFilterOpen}
        mapAvailable={mapStatus !== "error" && mapStatus !== "unavailable"}
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
          ...(demoMode ? [] : [refreshOrganizations(true)]),
          ...(demoMode ? [] : [Promise.resolve(discovery.retry())]),
        ])}
        onOpportunitySortChange={(sort) => applyAction(
          exchangeWorkspaceActions.setOpportunitySort(sort),
          "push",
        )}
        onOpportunityLocationChange={(location) => applyAction(
          exchangeWorkspaceActions.setOpportunityLocation(location),
          "push",
        )}
      />
      <ExchangeActiveFilters
        state={state}
        onClear={clearFilters}
        onRemove={removeActiveFilter}
      />

      {!online ? (
        <div className="absolute left-1/2 top-32 z-[1150] flex max-w-[90%] -translate-x-1/2 items-center justify-center gap-2 rounded-full border border-amber-200/80 bg-amber-50/88 px-4 py-2 text-xs font-semibold text-amber-900 shadow-lg backdrop-blur-xl" role="status">
          <WifiOff className="h-4 w-4" aria-hidden="true" /> Offline. Previously loaded results remain available.
        </div>
      ) : conciseWarning ? (
        <div className="absolute left-1/2 top-32 z-[1150] flex max-w-[90%] -translate-x-1/2 items-center justify-center gap-2 rounded-full border border-amber-200/80 bg-amber-50/88 px-4 py-2 text-xs font-semibold text-amber-900 shadow-lg backdrop-blur-xl" role="status">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="line-clamp-1">{conciseWarning}</span>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {!workspaceMap && initialMapViewport ? <ExchangeMap
          key={mapRetryKey}
          rfxList={opportunityRfx}
          organizations={visibleOrganizations}
          releasedTerritories={visibleTerritories.releasedTerritories}
          scheduledTerritories={visibleTerritories.scheduledTerritories}
          unreleasedTerritories={unreleasedTerritories}
          selection={opportunitySelection}
          initialViewport={initialMapViewport}
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
        /> : !workspaceMap ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-sm font-semibold text-slate-600" role="status">
            Preparing your map…
          </div>
        ) : null}

        <div className="absolute left-3 top-16 z-20 hidden max-w-[calc(100%-7rem)] flex-wrap gap-2 lg:left-[22rem] lg:flex">
          <button
            type="button"
            onClick={fitMapResults}
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

        {(opportunityRfx.length > 0 || visibleOrganizations.length > 0)
          && !hasGeocodedRfx
          && !hasGeocodedOrganization ? (
          <div className="absolute inset-x-3 bottom-8 z-20 mx-auto max-w-lg rounded-2xl border border-amber-200/80 bg-amber-50/82 px-3 py-2 text-center text-xs font-semibold text-amber-900 shadow-lg backdrop-blur-xl" role="status">
            {opportunityRfx.length > 0
              ? "Matching opportunities have no authoritative coordinates."
              : "Matching organizations have no permitted coordinates."}{" "}
            They remain available in the result drawer and are not placed at fabricated centroids.
          </div>
        ) : null}

        <ExchangeMobileToolbar
          resultCount={resultCount}
          mapVisible
          onFitResults={fitMapResults}
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
                message={blockingState === "error"
                  ? error?.message
                  : blockingState === "filtered-empty"
                    && state.modeStates.opportunities.filters.issuerOrganizationId
                    ? "This organization has no published opportunities. Its organization marker remains available, and no opportunity was created."
                    : undefined}
                onRetry={blockingState === "error"
                  ? () => void (demoMode ? retryRepository() : discovery.retry())
                  : undefined}
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
