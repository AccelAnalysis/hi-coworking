"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ExchangeMode,
  ExchangeOrganizationPerspective,
} from "@hi/shared/exchange-organization-context";
import { onIdTokenChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  exchangeWorkspaceActions,
  type ExchangeWorkspaceAction,
} from "../state/exchangeWorkspaceActions";
import type { ExchangeWorkspaceState } from "../state/exchangeWorkspaceTypes";
import type { ExchangeHistoryMode } from "../views/exchangeViewTypes";
import {
  listActorOrganizations,
  resolveOrganizationPerspective,
  type ExchangeActorOrganizationOption,
} from "./organizationContextGateway";
import {
  createOrganizationPerspectiveKey,
  toServerSecondary,
} from "./organizationContextKey";

type ApplyExchangeAction = (
  action: ExchangeWorkspaceAction,
  history?: ExchangeHistoryMode,
) => ExchangeWorkspaceState;

function canonicalMode(view: ExchangeWorkspaceState["view"]): ExchangeMode {
  if (view === "connections") return "referrals";
  if (view === "businesses" || view === "teaming") return "opportunities";
  return view;
}

function safeContextError(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  if (code.includes("unauthenticated")) return "Sign in to choose an organization context.";
  if (code.includes("permission-denied")) return "Your organization access changed. A safe context was restored.";
  return "Organization context could not be refreshed. Private organization data is hidden until it can be verified.";
}

export interface ExchangeOrganizationContextState {
  actors: ExchangeActorOrganizationOption[];
  actorsLoading: boolean;
  actorFallbackApplied: boolean;
  perspective: ExchangeOrganizationPerspective | null;
  perspectiveLoading: boolean;
  error: string | null;
  requestActorOrganization: (organizationId: string) => void;
  refresh: () => void;
}

/**
 * Resolves actor authority and viewer-relative organization data exclusively
 * through server callables. Perspective data is blanked synchronously whenever
 * actor, subject, or mode changes so private fields cannot cross contexts.
 */
export function useExchangeOrganizationContext(
  state: ExchangeWorkspaceState,
  applyAction: ApplyExchangeAction,
  onBeforeActorChange?: () => void,
  demoMode = false,
): ExchangeOrganizationContextState {
  const [actors, setActors] = useState<ExchangeActorOrganizationOption[]>([]);
  const [actorsLoading, setActorsLoading] = useState(true);
  const [actorFallbackApplied, setActorFallbackApplied] = useState(false);
  const [perspectiveResult, setPerspectiveResult] = useState<{
    key: string;
    value: ExchangeOrganizationPerspective;
  } | null>(null);
  const [perspectiveLoadingKey, setPerspectiveLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const actorRequestGeneration = useRef(0);
  const perspectiveRequestGeneration = useRef(0);
  const persistActorRequestRef = useRef(false);

  useEffect(() => onIdTokenChanged(auth, () => {
    setRefreshGeneration((value) => value + 1);
  }), []);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        setRefreshGeneration((value) => value + 1);
      }
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, []);

  useEffect(() => {
    const generation = ++actorRequestGeneration.current;
    const persistSelection = persistActorRequestRef.current;
    persistActorRequestRef.current = false;
    setActorsLoading(true);
    setPerspectiveResult(null);
    perspectiveRequestGeneration.current += 1;

    if (demoMode) {
      const demoActor = {
        organizationId: "demo-organization",
        name: "Demo Organization",
        membershipRole: "owner" as const,
        capabilities: ["view_exchange"],
      };
      setActors([demoActor]);
      setActorFallbackApplied(false);
      setActorsLoading(false);
      setError(null);
      if (state.actorOrganizationId !== demoActor.organizationId) {
        applyAction(exchangeWorkspaceActions.setValidatedActorOrganization(demoActor.organizationId));
      }
      if (state.requestedActorOrganizationId !== demoActor.organizationId) {
        applyAction(exchangeWorkspaceActions.setRequestedActorOrganization(demoActor.organizationId), "replace");
      }
      return;
    }

    if (!auth.currentUser) {
      setActors([]);
      setActorFallbackApplied(false);
      setActorsLoading(false);
      if (state.actorOrganizationId) {
        applyAction(exchangeWorkspaceActions.setValidatedActorOrganization(undefined));
      }
      return;
    }

    void listActorOrganizations({
      requestedActorOrganizationId: state.requestedActorOrganizationId,
      persistSelection,
    }).then((result) => {
      if (generation !== actorRequestGeneration.current) return;
      const selectedId = result.selectedActorOrganizationId ?? undefined;
      setActors(result.actors);
      setActorFallbackApplied(result.fallbackApplied);
      setError(null);
      setActorsLoading(false);
      if (state.actorOrganizationId !== selectedId) {
        applyAction(exchangeWorkspaceActions.setValidatedActorOrganization(selectedId));
      }
      if (state.requestedActorOrganizationId !== selectedId) {
        applyAction(
          exchangeWorkspaceActions.setRequestedActorOrganization(selectedId),
          "replace",
        );
      }
    }).catch((caught: unknown) => {
      if (generation !== actorRequestGeneration.current) return;
      setActors([]);
      setActorFallbackApplied(false);
      setActorsLoading(false);
      setError(safeContextError(caught));
      if (state.actorOrganizationId) {
        applyAction(exchangeWorkspaceActions.setValidatedActorOrganization(undefined));
      }
    });
  }, [applyAction, demoMode, refreshGeneration, state.actorOrganizationId, state.requestedActorOrganizationId]);

  const mode = canonicalMode(state.view);
  const secondary = useMemo(
    () => toServerSecondary(state.secondaryContext),
    [state.secondaryContext],
  );
  const perspectiveKey = createOrganizationPerspectiveKey({
    actorOrganizationId: state.actorOrganizationId,
    subjectOrganizationId: state.subjectOrganizationId,
    mode,
    secondary,
  });
  const perspective = perspectiveKey && perspectiveResult?.key === perspectiveKey
    ? perspectiveResult.value
    : null;
  const perspectiveLoading = perspectiveKey !== null
    && perspectiveLoadingKey === perspectiveKey;

  useEffect(() => {
    const generation = ++perspectiveRequestGeneration.current;
    setPerspectiveResult(null);
    if (
      demoMode
      || !auth.currentUser
      || !state.subjectOrganizationId
      || !perspectiveKey
      || actorsLoading
    ) {
      setPerspectiveLoadingKey(null);
      return;
    }
    setPerspectiveLoadingKey(perspectiveKey);

    void resolveOrganizationPerspective({
      actorOrganizationId: state.actorOrganizationId,
      subjectOrganizationId: state.subjectOrganizationId,
      mode,
      secondary,
    }).then((result) => {
      if (generation !== perspectiveRequestGeneration.current) return;
      const resolvedActorId = result.actor.organizationId ?? undefined;
      const resultKey = createOrganizationPerspectiveKey({
        actorOrganizationId: resolvedActorId,
        subjectOrganizationId: result.subject.organizationId,
        mode: result.perspective.mode,
        secondary: result.secondary,
      });
      setPerspectiveResult(resultKey === perspectiveKey
        ? { key: perspectiveKey, value: result }
        : null);
      setPerspectiveLoadingKey(null);
      setError(null);
      if (state.actorOrganizationId !== resolvedActorId) {
        applyAction(exchangeWorkspaceActions.setValidatedActorOrganization(resolvedActorId));
      }
    }).catch((caught: unknown) => {
      if (generation !== perspectiveRequestGeneration.current) return;
      setPerspectiveResult(null);
      setPerspectiveLoadingKey(null);
      setError(safeContextError(caught));
    });
  }, [
    actorsLoading,
    applyAction,
    demoMode,
    mode,
    perspectiveKey,
    refreshGeneration,
    secondary,
    state.actorOrganizationId,
    state.subjectOrganizationId,
  ]);

  const requestActorOrganization = useCallback((organizationId: string) => {
    onBeforeActorChange?.();
    persistActorRequestRef.current = true;
    setPerspectiveResult(null);
    setPerspectiveLoadingKey(null);
    perspectiveRequestGeneration.current += 1;
    applyAction(exchangeWorkspaceActions.setValidatedActorOrganization(undefined));
    applyAction(
      exchangeWorkspaceActions.setRequestedActorOrganization(organizationId),
      "push",
    );
  }, [applyAction, onBeforeActorChange]);

  const refresh = useCallback(() => {
    setPerspectiveResult(null);
    setPerspectiveLoadingKey(null);
    perspectiveRequestGeneration.current += 1;
    setRefreshGeneration((value) => value + 1);
  }, []);

  return {
    actors,
    actorsLoading,
    actorFallbackApplied,
    perspective,
    perspectiveLoading,
    error,
    requestActorOrganization,
    refresh,
  };
}
