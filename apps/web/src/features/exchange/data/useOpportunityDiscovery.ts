"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  OpportunityDiscoveryPage,
  OpportunityDiscoveryQuery,
} from "@hi/shared/opportunity-discovery";
import type { ExchangeWorkspaceState } from "../state/exchangeWorkspaceTypes";
import {
  discoverOpportunities,
  discoveryRecordToRfx,
  markOpportunityViewed,
  setOpportunitySaved,
  workspaceToOpportunityQuery,
  type ExchangeDiscoveryRfx,
} from "./opportunityDiscoveryGateway";
import { exchangeActorScopeKey } from "./exchangeActorScope";
import { normalizeExchangeDataError, type ExchangeDataError } from "./exchangeRepository";

export interface OpportunityDiscoveryState {
  rfx: ExchangeDiscoveryRfx[];
  loading: boolean;
  loadingMore: boolean;
  error: ExchangeDataError | null;
  warnings: string[];
  nextCursor?: string;
  totalCount?: number;
  countAccuracy: OpportunityDiscoveryPage["countAccuracy"];
  truncated: boolean;
  degraded: boolean;
  provider?: string;
  queryDurationMs?: number;
}

const INITIAL_STATE: OpportunityDiscoveryState = {
  rfx: [],
  loading: false,
  loadingMore: false,
  error: null,
  warnings: [],
  nextCursor: undefined,
  totalCount: undefined,
  countAccuracy: "unavailable",
  truncated: false,
  degraded: false,
  provider: undefined,
  queryDurationMs: undefined,
};

function deduplicate(
  current: ExchangeDiscoveryRfx[],
  incoming: ExchangeDiscoveryRfx[],
): ExchangeDiscoveryRfx[] {
  const records = new Map(current.map((record) => [record.id, record]));
  incoming.forEach((record) => records.set(record.id, record));
  return [...records.values()];
}

export function useOpportunityDiscovery(
  state: ExchangeWorkspaceState,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled !== false;
  const [result, setResult] = useState<OpportunityDiscoveryState>(INITIAL_STATE);
  const [resultScopeKey, setResultScopeKey] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const loadMoreVersion = useRef(0);
  const currentActorScopeKey = exchangeActorScopeKey(state.actorOrganizationId);
  const actorScopeRef = useRef(currentActorScopeKey);
  actorScopeRef.current = currentActorScopeKey;
  const queryKey = JSON.stringify(workspaceToOpportunityQuery(state));
  const query = useMemo(
    () => JSON.parse(queryKey) as OpportunityDiscoveryQuery,
    [queryKey],
  );

  const execute = useCallback(async (version: number) => {
    if (!enabled) return;
    const requestScopeKey = exchangeActorScopeKey(query.actorOrganizationId);
    try {
      const page = await discoverOpportunities(query);
      if (
        version !== requestVersion.current
        || actorScopeRef.current !== requestScopeKey
      ) return;
      setResultScopeKey(requestScopeKey);
      setResult({
        rfx: page.records.map(discoveryRecordToRfx),
        loading: false,
        loadingMore: false,
        error: null,
        warnings: page.warnings,
        nextCursor: page.nextCursor,
        totalCount: page.totalCount,
        countAccuracy: page.countAccuracy,
        truncated: page.truncated,
        degraded: page.degraded,
        provider: page.provider,
        queryDurationMs: page.queryDurationMs,
      });
    } catch (error) {
      if (
        version !== requestVersion.current
        || actorScopeRef.current !== requestScopeKey
      ) return;
      setResultScopeKey(requestScopeKey);
      setResult((current) => ({
        ...current,
        loading: false,
        loadingMore: false,
        error: normalizeExchangeDataError(error),
      }));
    }
  }, [enabled, query]);

  useEffect(() => {
    if (!enabled) {
      requestVersion.current += 1;
      loadMoreVersion.current += 1;
      setResult(INITIAL_STATE);
      setResultScopeKey(null);
      return;
    }
    const version = ++requestVersion.current;
    loadMoreVersion.current += 1;
    const actorChanged = resultScopeKey !== currentActorScopeKey;
    setResultScopeKey(currentActorScopeKey);
    setResult((current) => ({
      ...(actorChanged ? INITIAL_STATE : current),
      loading: true,
      loadingMore: false,
      error: null,
      nextCursor: undefined,
    }));
    const timer = setTimeout(() => void execute(version), 250);
    return () => {
      clearTimeout(timer);
      requestVersion.current += 1;
      loadMoreVersion.current += 1;
    };
  }, [currentActorScopeKey, enabled, execute, queryKey, resultScopeKey]);

  const scopeIsCurrent = resultScopeKey === currentActorScopeKey;
  const scopedResult: OpportunityDiscoveryState = scopeIsCurrent
    ? result
    : { ...INITIAL_STATE, loading: enabled };

  const retry = useCallback(() => {
    if (!enabled) return;
    const version = ++requestVersion.current;
    setResultScopeKey(currentActorScopeKey);
    setResult((current) => ({ ...current, loading: true, error: null }));
    void execute(version);
  }, [currentActorScopeKey, enabled, execute]);

  const loadMore = useCallback(async () => {
    const cursor = scopedResult.nextCursor;
    if (!enabled || !cursor || scopedResult.loadingMore) return;
    const version = ++loadMoreVersion.current;
    const requestScopeKey = currentActorScopeKey;
    setResult((current) => ({ ...current, loadingMore: true }));
    try {
      const page = await discoverOpportunities({ ...query, cursor });
      if (
        version !== loadMoreVersion.current
        || actorScopeRef.current !== requestScopeKey
      ) return;
      setResult((current) => ({
        ...current,
        rfx: deduplicate(current.rfx, page.records.map(discoveryRecordToRfx)),
        loadingMore: false,
        error: null,
        warnings: [...new Set([...current.warnings, ...page.warnings])].slice(0, 10),
        nextCursor: page.nextCursor,
        totalCount: page.totalCount ?? current.totalCount,
        countAccuracy: page.countAccuracy,
        truncated: page.truncated,
        degraded: current.degraded || page.degraded,
        provider: page.provider,
        queryDurationMs: page.queryDurationMs,
      }));
    } catch (error) {
      if (
        version !== loadMoreVersion.current
        || actorScopeRef.current !== requestScopeKey
      ) return;
      setResult((current) => ({
        ...current,
        loadingMore: false,
        error: normalizeExchangeDataError(error),
      }));
    }
  }, [currentActorScopeKey, enabled, query, scopedResult.loadingMore, scopedResult.nextCursor]);

  const setSaved = useCallback(async (rfxId: string, saved: boolean) => {
    const actorAtStart = state.actorOrganizationId;
    const actorScopeAtStart = exchangeActorScopeKey(actorAtStart);
    const previous = scopedResult.rfx;
    setResult((current) => ({
      ...current,
      rfx: current.rfx.map((record) => record.id === rfxId && record.discovery
        ? {
            ...record,
            discovery: {
              ...record.discovery,
              relationship: { ...record.discovery.relationship, saved },
            },
          }
        : record),
    }));
    try {
      await setOpportunitySaved(rfxId, saved, actorAtStart);
    } catch (error) {
      if (actorScopeRef.current !== actorScopeAtStart) return;
      setResult((current) => ({
        ...current,
        rfx: previous,
        error: normalizeExchangeDataError(error),
      }));
      throw error;
    }
  }, [scopedResult.rfx, state.actorOrganizationId]);

  const markViewed = useCallback((rfxId: string) => {
    const actorAtStart = state.actorOrganizationId;
    const actorScopeAtStart = exchangeActorScopeKey(actorAtStart);
    if (actorScopeRef.current !== actorScopeAtStart) return;
    setResult((current) => ({
      ...current,
      rfx: current.rfx.map((record) => record.id === rfxId && record.discovery
        ? {
            ...record,
            discovery: {
              ...record.discovery,
              relationship: {
                ...record.discovery.relationship,
                viewed: true,
                newSinceLastVisit: false,
                updatedSinceViewed: false,
              },
            },
          }
        : record),
    }));
    if (enabled) {
      void markOpportunityViewed(rfxId, actorAtStart).catch(() => {
        // Viewing remains usable when the relationship write is unavailable.
      });
    }
  }, [enabled, state.actorOrganizationId]);

  return {
    ...scopedResult,
    retry,
    loadMore,
    setSaved,
    markViewed,
  };
}
