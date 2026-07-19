"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RfxDoc, TerritoryDoc } from "@hi/shared";
import type { ViewportBounds } from "@/lib/firestore";
import {
  liveExchangeOpportunityRepository,
  mergeExchangeRfxWithPinned,
  normalizeExchangeDataError,
  resolvePinnedExchangeRfx,
  type ExchangeDataError,
  type ExchangeOpportunityRepository,
} from "./exchangeRepository";

export interface ExchangeDataState {
  rfx: RfxDoc[];
  baselineRfx: RfxDoc[];
  viewportRfx: RfxDoc[];
  pinnedRfx: RfxDoc | null;
  releasedTerritories: TerritoryDoc[];
  scheduledTerritories: TerritoryDoc[];
  unreleasedTerritories: TerritoryDoc[];
  manageableRfxIds: string[];
  loading: boolean;
  refreshing: boolean;
  error: ExchangeDataError | null;
  viewportError: ExchangeDataError | null;
  online: boolean;
  lastUpdatedAt: number | null;
}

const INITIAL_STATE: ExchangeDataState = {
  rfx: [],
  baselineRfx: [],
  viewportRfx: [],
  pinnedRfx: null,
  releasedTerritories: [],
  scheduledTerritories: [],
  unreleasedTerritories: [],
  manageableRfxIds: [],
  loading: true,
  refreshing: false,
  error: null,
  viewportError: null,
  online: true,
  lastUpdatedAt: null,
};

export function useExchangeData(
  repository: ExchangeOpportunityRepository = liveExchangeOpportunityRepository,
) {
  const [state, setState] = useState<ExchangeDataState>(INITIAL_STATE);
  const loadVersionRef = useRef(0);
  const viewportVersionRef = useRef(0);
  const viewportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const version = ++loadVersionRef.current;
    setState((current) => ({
      ...current,
      loading: current.lastUpdatedAt === null,
      refreshing: current.lastUpdatedAt !== null,
      error: null,
      viewportError: null,
    }));

    try {
      const snapshot = await repository.loadSnapshot();
      if (version !== loadVersionRef.current) return;
      setState((current) => {
        const baselineRfx = snapshot.rfx;
        const pinnedRfx = resolvePinnedExchangeRfx(
          [...baselineRfx, ...current.viewportRfx],
          current.pinnedRfx?.id ?? null,
          current.pinnedRfx,
        );
        return {
          ...current,
          ...snapshot,
          baselineRfx,
          pinnedRfx,
          rfx: mergeExchangeRfxWithPinned(
            baselineRfx,
            current.viewportRfx,
            pinnedRfx,
          ),
          loading: false,
          refreshing: false,
          error: null,
          lastUpdatedAt: Date.now(),
        };
      });
    } catch (error) {
      if (version !== loadVersionRef.current) return;
      setState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: normalizeExchangeDataError(error),
      }));
    }
  }, [repository]);

  useEffect(() => {
    void refresh();
    return () => {
      loadVersionRef.current += 1;
      viewportVersionRef.current += 1;
      if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
    };
  }, [refresh]);

  useEffect(() => {
    const update = () => {
      setState((current) => ({ ...current, online: navigator.onLine }));
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const updateViewport = useCallback((bounds: ViewportBounds) => {
    if (viewportTimerRef.current) clearTimeout(viewportTimerRef.current);
    const version = ++viewportVersionRef.current;
    viewportTimerRef.current = setTimeout(async () => {
      try {
        const viewportRfx = await repository.loadViewportRfx(bounds);
        if (version !== viewportVersionRef.current) return;
        setState((current) => {
          const pinnedRfx = resolvePinnedExchangeRfx(
            [...viewportRfx, ...current.baselineRfx],
            current.pinnedRfx?.id ?? null,
            current.pinnedRfx,
          );
          return {
            ...current,
            viewportRfx,
            pinnedRfx,
            rfx: mergeExchangeRfxWithPinned(
              current.baselineRfx,
              viewportRfx,
              pinnedRfx,
            ),
            viewportError: null,
          };
        });
      } catch (error) {
        if (version !== viewportVersionRef.current) return;
        // Keep the last safe discovery snapshot. A viewport refresh should not
        // replace usable results with an error-only surface.
        setState((current) => ({
          ...current,
          viewportError: normalizeExchangeDataError(error),
        }));
      }
    }, 450);
  }, [repository]);

  const pinSelectedRfx = useCallback((selectedRfxId: string | null) => {
    setState((current) => {
      const pinnedRfx = resolvePinnedExchangeRfx(
        current.rfx,
        selectedRfxId,
        current.pinnedRfx,
      );
      if (pinnedRfx === current.pinnedRfx) return current;
      return {
        ...current,
        pinnedRfx,
        rfx: mergeExchangeRfxWithPinned(
          current.baselineRfx,
          current.viewportRfx,
          pinnedRfx,
        ),
      };
    });
  }, []);

  return {
    ...state,
    retry: refresh,
    updateViewport,
    pinSelectedRfx,
  };
}
