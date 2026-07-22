"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExchangeOrganizationPerspective } from "@hi/shared/exchange-organization-context";
import type { PublicOrganizationEstablishment } from "@hi/shared/organization-establishments";
import type { PublicOrganizationProjection } from "@/lib/firestore";
import { filterPublicOrganizations } from "../data/organizationDiscovery";
import { loadPrimaryBusinessAnchor } from "../data/exchangeMapAnchor";
import {
  loadPublicOrganizationsForExchange,
  subscribePublicOrganizationsForExchange,
} from "../data/publicOrganizationRepository";
import {
  loadPublicOrganizationLocations,
  subscribePublicOrganizationLocations,
} from "../data/publicOrganizationLocationRepository";
import { liveExchangeOpportunityRepository } from "../data/exchangeRepository";
import { useExchangeData } from "../data/useExchangeData";
import { exchangeDemoOpportunityRepository } from "../demo/exchangeDemoGateway";
import { establishmentMarkers, type PublicOrganizationMapRecord } from "../map/geojson";
import {
  DEFAULT_EXCHANGE_MAP_VIEWPORT,
  type ExchangeMapBounds,
  type ExchangeMapViewport,
} from "../map/mapConfig";
import {
  readExchangeMapSession,
  resolveInitialExchangeMapViewport,
  writeExchangeMapSession,
} from "../map/mapSession";
import type { ExchangeMapSelection } from "../map/selection";
import { exchangeWorkspaceActions, type ExchangeWorkspaceAction } from "../state/exchangeWorkspaceActions";
import type { ExchangeView, ExchangeWorkspaceState } from "../state/exchangeWorkspaceTypes";
import type { ExchangeHistoryMode } from "../views/exchangeViewTypes";

const ExchangeMap = dynamic(
  () => import("../map/ExchangeMap").then((module) => module.ExchangeMap),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-sm font-semibold text-slate-600" role="status">
        Preparing your continuous map workspace…
      </div>
    ),
  },
);

type CanonicalExchangeView = "intelligence" | "referrals" | "opportunities" | "resources";

function canonicalView(view: ExchangeView): CanonicalExchangeView {
  if (view === "connections") return "referrals";
  if (view === "businesses" || view === "teaming") return "opportunities";
  return view as CanonicalExchangeView;
}

function asMapSelection(state: ExchangeWorkspaceState): ExchangeMapSelection {
  const selection = state.secondaryContext ?? state.selection;
  return selection && (
    selection.entityType === "organization"
    || selection.entityType === "establishment"
    || selection.entityType === "rfx"
    || selection.entityType === "territory"
  ) ? (selection.entityType === "establishment"
      ? { entityType: "establishment", entityId: selection.entityId, organizationId: selection.organizationId ?? state.subjectOrganizationId ?? "" }
      : selection) : null;
}

function contextOrganizations(
  organizations: readonly PublicOrganizationProjection[],
  actorOrganizationId?: string,
  subjectOrganizationId?: string,
  perspectiveOrganization?: ExchangeOrganizationPerspective["organization"],
): PublicOrganizationMapRecord[] {
  const ids = [...new Set([actorOrganizationId, subjectOrganizationId].filter((value): value is string => Boolean(value)))];
  return ids.flatMap((organizationId) => {
    const organization = perspectiveOrganization?.id === organizationId
      ? perspectiveOrganization
      : organizations.find((candidate) => candidate.id === organizationId);
    if (!organization) return [];
    const contextType = actorOrganizationId === organizationId && subjectOrganizationId === organizationId
      ? "actor_subject"
      : actorOrganizationId === organizationId
        ? "actor"
        : "subject";
    return [{ ...organization, contextType }];
  });
}

export function ExchangeWorkspaceMap({
  state,
  applyAction,
  scheduleUrlReplace,
  demoMode,
  viewerUid,
  perspective,
}: {
  state: ExchangeWorkspaceState;
  applyAction: (
    action: ExchangeWorkspaceAction,
    history?: ExchangeHistoryMode,
  ) => ExchangeWorkspaceState;
  scheduleUrlReplace: (delay?: number) => void;
  demoMode: boolean;
  viewerUid?: string;
  perspective?: ExchangeOrganizationPerspective | null;
}) {
  const [organizations, setOrganizations] = useState<PublicOrganizationProjection[]>([]);
  const [locations, setLocations] = useState<PublicOrganizationEstablishment[]>([]);
  const [fitRequest, setFitRequest] = useState(0);
  const [initialViewport, setInitialViewport] = useState<ExchangeMapViewport | null>(() =>
    state.viewport ?? (demoMode ? { ...DEFAULT_EXCHANGE_MAP_VIEWPORT } : null),
  );
  const initialViewportResolvedRef = useRef(Boolean(initialViewport));
  const repository = demoMode
    ? exchangeDemoOpportunityRepository
    : liveExchangeOpportunityRepository;
  const {
    rfx,
    releasedTerritories,
    scheduledTerritories,
    unreleasedTerritories,
    loading: repositoryLoading,
    updateViewport,
  } = useExchangeData(repository);
  const activeView = canonicalView(state.view);

  useEffect(() => {
    if (initialViewportResolvedRef.current) return;
    if (state.viewport) {
      initialViewportResolvedRef.current = true;
      setInitialViewport(state.viewport);
      return;
    }
    if (demoMode) {
      initialViewportResolvedRef.current = true;
      setInitialViewport({ ...DEFAULT_EXCHANGE_MAP_VIEWPORT });
      return;
    }
    if (!viewerUid || repositoryLoading) return;

    let active = true;
    void (async () => {
      const savedViewport = readExchangeMapSession(window.localStorage, viewerUid);
      const businessAnchor = savedViewport
        ? null
        : await loadPrimaryBusinessAnchor(viewerUid);
      if (!active || initialViewportResolvedRef.current) return;
      initialViewportResolvedRef.current = true;
      setInitialViewport(resolveInitialExchangeMapViewport({
        savedViewport,
        businessAnchor,
        releasedTerritories,
      }));
    })();

    return () => {
      active = false;
    };
  }, [demoMode, releasedTerritories, repositoryLoading, state.viewport, viewerUid]);

  useEffect(() => {
    if (demoMode) {
      setOrganizations([]);
      return;
    }
    const cacheScope = viewerUid;
    if (!cacheScope) {
      setOrganizations([]);
      return;
    }
    let active = true;
    const unsubscribe = subscribePublicOrganizationsForExchange(
      cacheScope,
      (records) => {
        if (active) setOrganizations(records);
      },
    );
    void loadPublicOrganizationsForExchange({ cacheScope })
      .then((records) => {
        if (active) setOrganizations(records);
      })
      .catch(() => {
        if (active) setOrganizations([]);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [demoMode, viewerUid]);

  useEffect(() => {
    if (demoMode || !viewerUid) { setLocations([]); return; }
    let active = true;
    const unsubscribe = subscribePublicOrganizationLocations((records) => {
      if (active) setLocations(records);
    });
    void loadPublicOrganizationLocations().then((records) => {
      if (active) setLocations(records);
    }).catch(() => { if (active) setLocations([]); });
    return () => { active = false; unsubscribe(); };
  }, [demoMode, viewerUid]);

  useEffect(() => {
    const fit = () => setFitRequest((value) => value + 1);
    window.addEventListener("hi-exchange-fit-map", fit);
    return () => window.removeEventListener("hi-exchange-fit-map", fit);
  }, []);

  const filteredOrganizations = useMemo(
    () => filterPublicOrganizations(organizations, state),
    [organizations, state],
  );
  const modeOrganizations = useMemo(() => {
    if (activeView !== "resources") return filteredOrganizations;
    return filteredOrganizations.filter((organization) =>
      organization.resourceProviderStatus === "approved");
  }, [activeView, filteredOrganizations]);
  const modeMarkers = useMemo(
    () => establishmentMarkers(
      modeOrganizations,
      locations.filter((location) => modeOrganizations.some((organization) => organization.id === location.organizationId)),
    ),
    [locations, modeOrganizations],
  );
  const activeContextOrganizations = useMemo(
    () => contextOrganizations(
      organizations,
      state.actorOrganizationId,
      state.subjectOrganizationId,
      perspective?.organization,
    ),
    [organizations, perspective?.organization, state.actorOrganizationId, state.subjectOrganizationId],
  );

  const handleViewportChange = useCallback((bounds: ExchangeMapBounds) => {
    const viewport = {
      longitude: bounds.longitude,
      latitude: bounds.latitude,
      zoom: bounds.zoom,
      bearing: bounds.bearing,
      pitch: bounds.pitch,
    };
    updateViewport(bounds);
    if (!demoMode && viewerUid) writeExchangeMapSession(window.localStorage, viewerUid, viewport);
    applyAction(exchangeWorkspaceActions.setViewport(viewport));
    scheduleUrlReplace(350);
    window.dispatchEvent(new CustomEvent<ExchangeMapBounds>("hi-exchange-map-bounds", {
      detail: bounds,
    }));
  }, [applyAction, demoMode, scheduleUrlReplace, updateViewport, viewerUid]);

  return (
    <div
      className="absolute inset-0 z-0 overflow-hidden bg-slate-200"
      data-exchange-map-host="persistent"
      aria-label="Continuous Exchange map workspace"
    >
      {initialViewport ? <ExchangeMap
        rfxList={activeView === "opportunities" ? rfx : []}
        organizations={modeMarkers}
        contextOrganizations={activeContextOrganizations}
        releasedTerritories={releasedTerritories}
        scheduledTerritories={scheduledTerritories}
        unreleasedTerritories={unreleasedTerritories}
        selection={asMapSelection(state)}
        initialViewport={initialViewport}
        viewport={state.viewport}
        fitRequest={fitRequest}
        resizeSignal={`${state.leftPanelCollapsed}:${state.rightPanelOpen}:${state.mobileFilterOpen}:${state.mobileDetailOpen}:${activeView}`}
        className="absolute inset-0 h-full min-h-0 w-full border-0"
        ariaLabel={`${activeView} map with persistent organization context`}
        onSelect={(selection) => {
          if (!selection) return;
          if (selection.entityType === "organization") {
            applyAction(exchangeWorkspaceActions.setOrganizationDrawerOpen(true));
            applyAction(exchangeWorkspaceActions.setSubjectOrganization(selection.entityId), "push");
            return;
          }
          if (selection.entityType === "establishment") {
            applyAction(exchangeWorkspaceActions.setOrganizationDrawerOpen(true));
            applyAction(exchangeWorkspaceActions.setSubjectOrganization(selection.organizationId), "push");
            applyAction(exchangeWorkspaceActions.setSecondaryContext(selection), "push");
            return;
          }
          applyAction(exchangeWorkspaceActions.setSecondaryContext(selection), "push");
        }}
        onBackgroundClick={() => {
          if (state.secondaryContext) {
            applyAction(exchangeWorkspaceActions.clearSecondaryContext(), "push");
          }
        }}
        onViewportChange={handleViewportChange}
      /> : (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 text-sm font-semibold text-slate-600" role="status">
          Preparing your user-scoped map camera…
        </div>
      )}
    </div>
  );
}
