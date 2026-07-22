"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ExchangeRun3Gateway,
  ReferralIntelligenceSnapshot,
} from "./exchangeRun3Gateway";
import { actorScopedValue, exchangeActorScopeKey } from "./exchangeActorScope";

export function useIntelligenceData(
  gateway: ExchangeRun3Gateway,
  actorOrganizationId?: string,
) {
  const [snapshot, setSnapshot] = useState<ReferralIntelligenceSnapshot | null>(null);
  const [snapshotScopeKey, setSnapshotScopeKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorScopeKey, setErrorScopeKey] = useState<string | null>(null);
  const generationRef = useRef(0);
  const currentScopeKey = exchangeActorScopeKey(actorOrganizationId);
  const currentScopeKeyRef = useRef(currentScopeKey);
  currentScopeKeyRef.current = currentScopeKey;
  const scopedSnapshot = actorScopedValue(
    snapshot,
    snapshotScopeKey,
    actorOrganizationId,
  );

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current;
    const requestScopeKey = exchangeActorScopeKey(actorOrganizationId);
    const hasCurrentSnapshot = snapshotScopeKey === requestScopeKey && snapshot !== null;
    setLoading(!hasCurrentSnapshot);
    setRefreshing(hasCurrentSnapshot);
    setError(null);
    setErrorScopeKey(null);
    try {
      const next = await gateway.getIntelligence(actorOrganizationId);
      if (
        generation !== generationRef.current
        || currentScopeKeyRef.current !== requestScopeKey
      ) return;
      setSnapshot(next);
      setSnapshotScopeKey(requestScopeKey);
    } catch {
      if (
        generation !== generationRef.current
        || currentScopeKeyRef.current !== requestScopeKey
      ) return;
      setSnapshot(null);
      setSnapshotScopeKey(requestScopeKey);
      setError("Referral intelligence could not be loaded for this authorized scope.");
      setErrorScopeKey(requestScopeKey);
    } finally {
      if (
        generation !== generationRef.current
        || currentScopeKeyRef.current !== requestScopeKey
      ) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [actorOrganizationId, gateway, snapshot, snapshotScopeKey]);

  useEffect(() => {
    generationRef.current += 1;
    setSnapshot(null);
    setSnapshotScopeKey(null);
    setError(null);
    setErrorScopeKey(null);
    setLoading(true);
    setRefreshing(false);
    void refresh();
    // One load per mounted gateway and validated actor. Refresh is also exposed explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorOrganizationId, gateway]);

  const scopeIsLoaded = snapshotScopeKey === currentScopeKey;
  return {
    snapshot: scopedSnapshot,
    loading: !scopeIsLoaded || loading,
    refreshing: scopeIsLoaded && refreshing,
    error: errorScopeKey === currentScopeKey ? error : null,
    refresh,
  };
}
