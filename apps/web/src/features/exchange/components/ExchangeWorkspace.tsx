"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ConnectionsWorkspace } from "../connections/ConnectionsWorkspace";
import {
  createLiveExchangeRun3Gateway,
  type ExchangeRun3Gateway,
} from "../data/exchangeRun3Gateway";
import { getExchangeDemoGateway } from "../demo/exchangeDemoGateway";
import { ExchangeDemoBanner } from "../demo/ExchangeDemoBanner";
import { isExchangeDemoMode } from "../demo/exchangeDemoMode";
import { IntelligenceWorkspace } from "../intelligence/IntelligenceWorkspace";
import {
  exchangeWorkspaceActions,
  type ExchangeWorkspaceAction,
} from "../state/exchangeWorkspaceActions";
import { exchangeWorkspaceReducer } from "../state/exchangeWorkspaceReducer";
import {
  createInitialExchangeWorkspaceState,
  type ExchangeView,
  type ExchangeWorkspaceState,
} from "../state/exchangeWorkspaceTypes";
import {
  exchangeUrlStateToString,
  parseExchangeUrlState,
} from "../state/exchangeUrlState";
import { ExchangeOpportunitiesView } from "../views/ExchangeOpportunitiesView";
import { ExchangeResourcesView } from "../views/ExchangeResourcesView";
import type { ExchangeHistoryMode } from "../views/exchangeViewTypes";
import { ExchangeContextMap } from "./ExchangeContextMap";
import { ExchangeMobileNavigation } from "./ExchangeMobileNavigation";
import { ExchangeMobileWorkspaceTray } from "./ExchangeMobileWorkspaceTray";

type CanonicalExchangeView = "intelligence" | "referrals" | "opportunities" | "resources";

function exchangeUrl(query: string): string {
  return query ? `/exchange?${query}` : "/exchange";
}

function canonicalExchangeView(view: ExchangeView): CanonicalExchangeView {
  if (view === "connections") return "referrals";
  if (view === "businesses" || view === "teaming") return "opportunities";
  return view as CanonicalExchangeView;
}

export function ExchangeWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.toString();
  const [state, dispatch] = useReducer(
    exchangeWorkspaceReducer,
    currentQuery,
    (query) => exchangeWorkspaceReducer(
      createInitialExchangeWorkspaceState(),
      exchangeWorkspaceActions.hydrateFromUrl(parseExchangeUrlState(query)),
    ),
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const stateRef = useRef<ExchangeWorkspaceState>(state);
  const selfWrittenQueriesRef = useRef<Set<string>>(new Set());
  const browserHistoryNavigationRef = useRef(false);
  const urlReplaceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoMode = isExchangeDemoMode();
  const gateway = useMemo<ExchangeRun3Gateway>(
    () => demoMode ? getExchangeDemoGateway() : createLiveExchangeRun3Gateway(),
    [demoMode],
  );
  const activeView = canonicalExchangeView(state.view);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const writeUrl = useCallback((
    next: ExchangeWorkspaceState,
    mode: Exclude<ExchangeHistoryMode, "none">,
  ) => {
    const query = exchangeUrlStateToString(next);
    if (query === exchangeUrlStateToString(parseExchangeUrlState(window.location.search))) return;
    if (selfWrittenQueriesRef.current.size >= 32) selfWrittenQueriesRef.current.clear();
    selfWrittenQueriesRef.current.add(query);
    if (mode === "push") router.push(exchangeUrl(query), { scroll: false });
    else router.replace(exchangeUrl(query), { scroll: false });
  }, [router]);

  const scheduleUrlReplace = useCallback((delay = 300) => {
    if (urlReplaceTimerRef.current) clearTimeout(urlReplaceTimerRef.current);
    urlReplaceTimerRef.current = setTimeout(() => {
      urlReplaceTimerRef.current = null;
      writeUrl(stateRef.current, "replace");
    }, delay);
  }, [writeUrl]);

  const applyAction = useCallback((
    action: ExchangeWorkspaceAction,
    history: ExchangeHistoryMode = "none",
  ) => {
    const next = exchangeWorkspaceReducer(stateRef.current, action);
    stateRef.current = next;
    dispatch(action);
    if (history === "push" && urlReplaceTimerRef.current) {
      clearTimeout(urlReplaceTimerRef.current);
      urlReplaceTimerRef.current = null;
    }
    if (history !== "none") writeUrl(next, history);
    return next;
  }, [writeUrl]);

  useEffect(() => {
    if (activeView === state.view) return;
    applyAction(exchangeWorkspaceActions.setView(activeView), "replace");
  }, [activeView, applyAction, state.view]);

  useEffect(() => {
    const fromBrowserHistory = browserHistoryNavigationRef.current;
    browserHistoryNavigationRef.current = false;
    if (!fromBrowserHistory && selfWrittenQueriesRef.current.delete(currentQuery)) {
      if (currentQuery !== exchangeUrlStateToString(stateRef.current)) {
        writeUrl(stateRef.current, "replace");
      }
      return;
    }
    const hydration = parseExchangeUrlState(currentQuery);
    if (exchangeUrlStateToString(stateRef.current) === exchangeUrlStateToString(hydration)) return;
    const action = exchangeWorkspaceActions.hydrateFromUrl(hydration);
    stateRef.current = exchangeWorkspaceReducer(stateRef.current, action);
    dispatch(action);
  }, [currentQuery, writeUrl]);

  useEffect(() => {
    const markBrowserHistoryNavigation = () => {
      browserHistoryNavigationRef.current = true;
      selfWrittenQueriesRef.current.clear();
      if (urlReplaceTimerRef.current) {
        clearTimeout(urlReplaceTimerRef.current);
        urlReplaceTimerRef.current = null;
      }
    };
    window.addEventListener("popstate", markBrowserHistoryNavigation);
    return () => window.removeEventListener("popstate", markBrowserHistoryNavigation);
  }, []);

  useEffect(() => () => {
    if (urlReplaceTimerRef.current) clearTimeout(urlReplaceTimerRef.current);
  }, []);

  const onViewChange = useCallback((view: ExchangeView) => {
    setMobileMenuOpen(false);
    applyAction(exchangeWorkspaceActions.setView(canonicalExchangeView(view)), "push");
  }, [applyAction]);
  const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);

  const sharedState: ExchangeWorkspaceState = activeView === state.view
    ? state
    : { ...state, view: activeView };
  const shared = {
    state: sharedState,
    applyAction,
    scheduleUrlReplace,
    onViewChange,
  };
  const mobileMapVisible = activeView !== "opportunities" && state.surfaceMode !== "list";

  return (
    <div className="fixed inset-0 z-[60] flex h-dvh min-h-0 flex-col overflow-hidden bg-slate-100 lg:relative lg:inset-auto lg:z-auto lg:h-full">
      {demoMode ? <ExchangeDemoBanner /> : null}
      <div className="relative min-h-0 flex-1 pb-[4.75rem] lg:pb-0">
        {activeView === "opportunities" ? (
          <ExchangeOpportunitiesView {...shared} demoMode={demoMode} />
        ) : activeView === "referrals" ? (
          <ConnectionsWorkspace {...shared} gateway={gateway} />
        ) : activeView === "intelligence" ? (
          <IntelligenceWorkspace {...shared} gateway={gateway} />
        ) : (
          <ExchangeResourcesView {...shared} demoMode={demoMode} />
        )}

        {mobileMapVisible ? (
          <div className="absolute inset-x-0 bottom-0 top-[4.25rem] z-20 lg:hidden">
            <ExchangeContextMap view={activeView} demoMode={demoMode} />
          </div>
        ) : null}
      </div>

      {!mobileMenuOpen && activeView !== "opportunities" ? (
        <ExchangeMobileWorkspaceTray
          view={activeView}
          surfaceMode={state.surfaceMode}
          onSurfaceModeChange={(mode) => applyAction(exchangeWorkspaceActions.setSurfaceMode(mode), "push")}
        />
      ) : null}
      <ExchangeMobileNavigation
        view={activeView}
        menuOpen={mobileMenuOpen}
        onChange={onViewChange}
        onMenuOpen={() => setMobileMenuOpen(true)}
        onMenuClose={closeMobileMenu}
      />
    </div>
  );
}