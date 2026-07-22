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
import { useAuth } from "@/lib/authContext";
import { cn } from "@/lib/utils";
import { ConnectionsWorkspace } from "../connections/ConnectionsWorkspace";
import {
  createLiveExchangeRun3Gateway,
  type ExchangeRun3Gateway,
} from "../data/exchangeRun3Gateway";
import { getExchangeDemoGateway } from "../demo/exchangeDemoGateway";
import { ExchangeDemoBanner } from "../demo/ExchangeDemoBanner";
import { isExchangeDemoMode } from "../demo/exchangeDemoMode";
import { IntelligenceWorkspace } from "../intelligence/IntelligenceWorkspace";
import { useExchangeOrganizationContext } from "../data/useExchangeOrganizationContext";
import {
  exchangeWorkspaceActions,
  type ExchangeWorkspaceAction,
} from "../state/exchangeWorkspaceActions";
import { exchangeWorkspaceReducer } from "../state/exchangeWorkspaceReducer";
import {
  createInitialExchangeModeStates,
  createInitialExchangeWorkspaceState,
  type ExchangeView,
  type ExchangeWorkspaceState,
} from "../state/exchangeWorkspaceTypes";
import {
  getExchangeWorkspaceIdentityKey,
  getExchangeWorkspaceSessionKey,
  readExchangeWorkspaceSession,
  writeExchangeWorkspaceSession,
  type ExchangeWorkspaceSessionBinding,
} from "../state/exchangeWorkspaceSession";
import {
  exchangeUrlStateToString,
  parseExchangeUrlState,
} from "../state/exchangeUrlState";
import { ExchangeOpportunitiesView } from "../views/ExchangeOpportunitiesView";
import { ExchangeResourcesView } from "../views/ExchangeResourcesView";
import type { ExchangeHistoryMode } from "../views/exchangeViewTypes";
import { ExchangeOrganizationContextBar } from "./ExchangeOrganizationContextBar";
import { ExchangeOrganizationContextDrawer } from "./ExchangeOrganizationContextDrawer";
import { ExchangeMobileNavigation } from "./ExchangeMobileNavigation";
import { ExchangeWorkspaceMap } from "./ExchangeWorkspaceMap";

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
  const { user, loading: authLoading } = useAuth();
  const demoMode = isExchangeDemoMode();
  const [priorResolvedUid, setPriorResolvedUid] = useState<string | null>();
  const resolvedUid = authLoading ? undefined : user?.uid ?? null;
  const resetInitialWorkspace = !demoMode
    && resolvedUid !== undefined
    && priorResolvedUid !== undefined
    && priorResolvedUid !== resolvedUid;
  useEffect(() => {
    if (!demoMode && resolvedUid !== undefined) setPriorResolvedUid(resolvedUid);
  }, [demoMode, resolvedUid]);
  const identityKey = getExchangeWorkspaceIdentityKey({
    demoMode,
    authLoading,
    uid: user?.uid,
  });

  return (
    <ExchangeWorkspaceIdentityBoundary
      key={identityKey}
      authenticatedUid={user?.uid}
      authLoading={authLoading}
      demoMode={demoMode}
      resetInitialWorkspace={resetInitialWorkspace}
    />
  );
}

function ExchangeWorkspaceIdentityBoundary({
  authenticatedUid,
  authLoading,
  demoMode,
  resetInitialWorkspace,
}: {
  authenticatedUid?: string;
  authLoading: boolean;
  demoMode: boolean;
  resetInitialWorkspace: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentQuery = searchParams.toString();
  const [state, dispatch] = useReducer(
    exchangeWorkspaceReducer,
    resetInitialWorkspace ? "" : currentQuery,
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
  const sessionWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedSessionKeyRef = useRef<string | null>(null);
  const firstSessionBindingRef = useRef<string | null>(null);
  const activeSessionBindingRef = useRef<ExchangeWorkspaceSessionBinding | null>(null);
  const resetInitialUrlRef = useRef(resetInitialWorkspace);
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

  const persistCurrentWorkspaceSession = useCallback(() => {
    const binding = activeSessionBindingRef.current;
    if (!binding) return;
    writeExchangeWorkspaceSession(window.sessionStorage, binding, stateRef.current);
  }, []);
  const organizationContext = useExchangeOrganizationContext(
    state,
    applyAction,
    persistCurrentWorkspaceSession,
    demoMode,
  );

  useEffect(() => {
    if (authLoading || !authenticatedUid || organizationContext.actorsLoading) return;
    const binding: ExchangeWorkspaceSessionBinding = {
      uid: authenticatedUid,
      actorOrganizationId: state.actorOrganizationId,
    };
    const key = getExchangeWorkspaceSessionKey(binding);
    if (!key) return;
    activeSessionBindingRef.current = binding;
    if (hydratedSessionKeyRef.current === key) return;
    hydratedSessionKeyRef.current = key;

    const firstBinding = firstSessionBindingRef.current === null;
    if (firstBinding) firstSessionBindingRef.current = key;
    const restored = readExchangeWorkspaceSession(window.sessionStorage, binding);

    if (restored) {
      applyAction(
        exchangeWorkspaceActions.hydrateFromSession(restored),
        firstBinding ? "none" : "replace",
      );
      if (firstBinding && currentQuery && !resetInitialWorkspace) {
        applyAction(
          exchangeWorkspaceActions.hydrateFromUrl(parseExchangeUrlState(currentQuery)),
          "none",
        );
      }
      return;
    }

    if (!firstBinding) {
      applyAction(exchangeWorkspaceActions.hydrateFromSession({
        modeStates: createInitialExchangeModeStates(),
        secondaryContext: null,
        rightPanelOpen: false,
        mobileDetailOpen: false,
      }), "replace");
    }
  }, [
    applyAction,
    authenticatedUid,
    authLoading,
    currentQuery,
    organizationContext.actorsLoading,
    resetInitialWorkspace,
    state.actorOrganizationId,
  ]);

  useEffect(() => {
    const binding = activeSessionBindingRef.current;
    if (!binding) return;
    const key = getExchangeWorkspaceSessionKey(binding);
    if (!key || hydratedSessionKeyRef.current !== key) return;
    if (sessionWriteTimerRef.current) clearTimeout(sessionWriteTimerRef.current);
    sessionWriteTimerRef.current = setTimeout(() => {
      sessionWriteTimerRef.current = null;
      writeExchangeWorkspaceSession(window.sessionStorage, binding, stateRef.current);
    }, 300);
    return () => {
      if (sessionWriteTimerRef.current) {
        clearTimeout(sessionWriteTimerRef.current);
        sessionWriteTimerRef.current = null;
      }
    };
  }, [state]);

  useEffect(() => {
    if (activeView === state.view) return;
    applyAction(exchangeWorkspaceActions.setView(activeView), "replace");
  }, [activeView, applyAction, state.view]);

  useEffect(() => {
    if (resetInitialUrlRef.current) {
      resetInitialUrlRef.current = false;
      selfWrittenQueriesRef.current.clear();
      writeUrl(stateRef.current, "replace");
      return;
    }
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
    if (sessionWriteTimerRef.current) clearTimeout(sessionWriteTimerRef.current);
    const binding = activeSessionBindingRef.current;
    if (binding) {
      writeExchangeWorkspaceSession(window.sessionStorage, binding, stateRef.current);
    }
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
  const actorOrganizationName = organizationContext.actors.find(
    (candidate) => candidate.organizationId === state.actorOrganizationId,
  )?.name;
  const stateForMode = (view: CanonicalExchangeView): ExchangeWorkspaceState => (
    view === activeView
      ? sharedState
      : exchangeWorkspaceReducer(sharedState, exchangeWorkspaceActions.setView(view))
  );

  return (
    <div className="fixed inset-0 z-[60] flex h-dvh min-h-0 flex-col overflow-hidden bg-slate-100 lg:relative lg:inset-auto lg:z-auto lg:h-full">
      {demoMode ? <ExchangeDemoBanner /> : null}
      <ExchangeOrganizationContextBar
        state={sharedState}
        context={organizationContext}
        applyAction={applyAction}
      />
      <div className="relative min-h-0 flex-1 pb-[4.75rem] lg:pb-0">
        <ExchangeWorkspaceMap
          state={sharedState}
          applyAction={applyAction}
          scheduleUrlReplace={scheduleUrlReplace}
          demoMode={demoMode}
          viewerUid={authenticatedUid}
          perspective={organizationContext.perspective}
        />

        <div className={cn(
          "relative z-10 h-full min-h-0 pointer-events-none [&_header]:pointer-events-auto [&_aside]:pointer-events-auto [&_main]:pointer-events-auto [&_section]:pointer-events-auto [&_button]:pointer-events-auto [&_a]:pointer-events-auto [&_input]:pointer-events-auto [&_select]:pointer-events-auto [&_textarea]:pointer-events-auto",
          "lg:[&>div]:bg-transparent lg:[&_aside]:border-white/60 lg:[&_aside]:bg-white/70 lg:[&_aside]:shadow-2xl lg:[&_aside]:backdrop-blur-2xl lg:[&_main]:bg-white/25 lg:[&_main]:backdrop-blur-sm lg:[_.bg-white]:bg-white/60 lg:[_.bg-slate-50]:bg-white/40 lg:[_.bg-slate-100]:bg-white/30 lg:[_.border-slate-200]:border-white/60",
        )}>
          <div className={activeView === "opportunities" ? "h-full min-h-0" : "hidden"} aria-hidden={activeView !== "opportunities"}>
            <ExchangeOpportunitiesView
              {...shared}
              state={stateForMode("opportunities")}
              demoMode={demoMode}
              workspaceMap
            />
          </div>
          <div className={activeView === "referrals" ? "h-full min-h-0" : "hidden"} aria-hidden={activeView !== "referrals"}>
            <ConnectionsWorkspace
              {...shared}
              state={stateForMode("referrals")}
              gateway={gateway}
              actorOrganizationName={actorOrganizationName}
            />
          </div>
          <div className={activeView === "intelligence" ? "h-full min-h-0" : "hidden"} aria-hidden={activeView !== "intelligence"}>
            <IntelligenceWorkspace
              {...shared}
              state={stateForMode("intelligence")}
              gateway={gateway}
            />
          </div>
          <div className={activeView === "resources" ? "h-full min-h-0" : "hidden"} aria-hidden={activeView !== "resources"}>
            <ExchangeResourcesView
              {...shared}
              state={stateForMode("resources")}
              demoMode={demoMode}
              workspaceMap
            />
          </div>
        </div>
        <ExchangeOrganizationContextDrawer
          state={sharedState}
          context={organizationContext}
          applyAction={applyAction}
        />
      </div>

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
