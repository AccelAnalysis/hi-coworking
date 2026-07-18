"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OpportunityDiscoveryPage } from "@hi/shared/opportunity-discovery";
import type { ExchangeWorkspaceState } from "../state/exchangeWorkspaceTypes";
import {
  discoverOpportunities,
  discoveryRecordToRfx,
  markOpportunityViewed,
  setOpportunitySaved,
  workspaceToOpportunityQuery,
  type ExchangeDiscoveryRfx,
} from "./opportunityDiscoveryGateway";
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

export function useOpportunityDiscovery(state: ExchangeWorkspaceState) {
  const [result, setResult] = useState<OpportunityDiscoveryState>(INITIAL_STATE);
  const requestVersion = useRef(0);
  const loadMoreVersion = useRef(0);
  const query = useMemo(() => workspaceToOpportunityQuery(state), [state]);
  const queryKey = useMemo(() => JSON.stringify(query), [query]);

  const execute = useCallback(async (version: number) => {
    try {
      const page = await discoverOpportunities(query);
      if (version !== requestVersion.current) return;
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
      if (version !== requestVersion.current) return;
      setResult((current) => ({
        ...current,
        loading: false,
        loadingMore: false,
        error: normalizeExchangeDataError(error),
      }));
    }
  }, [query]);

  useEffect(() => {
    const version = ++requestVersion.current;
    loadMoreVersion.current += 1;
    setResult((current) => ({
      ...current,
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
  }, [execute, queryKey]);

  const retry = useCallback(() => {
    const version = ++requestVersion.current;
    setResult((current) => ({ ...current, loading: true, error: null }));
    void execute(version);
  }, [execute]);

  const loadMore = useCallback(async () => {
    const cursor = result.nextCursor;
    if (!cursor || result.loadingMore) return;
    const version = ++loadMoreVersion.current;
    setResult((current) => ({ ...current, loadingMore: true }));
    try {
      const page = await discoverOpportunities({ ...query, cursor });
      if (version !== loadMoreVersion.current) return;
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
      if (version !== loadMoreVersion.current) return;
      setResult((current) => ({
        ...current,
        loadingMore: false,
        error: normalizeExchangeDataError(error),
      }));
    }
  }, [query, result.loadingMore, result.nextCursor]);

  const setSaved = useCallback(async (rfxId: string, saved: boolean) => {
    const previous = result.rfx;
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
      await setOpportunitySaved(rfxId, saved);
    } catch (error) {
      setResult((current) => ({
        ...current,
        rfx: previous,
        error: normalizeExchangeDataError(error),
      }));
      throw error;
    }
  }, [result.rfx]);

  const markViewed = useCallback((rfxId: string) => {
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
    void markOpportunityViewed(rfxId).catch(() => {
      // Viewing remains usable when the relationship write is unavailable.
    });
  }, []);

  return {
    ...result,
    retry,
    loadMore,
    setSaved,
    markViewed,
  };
}
