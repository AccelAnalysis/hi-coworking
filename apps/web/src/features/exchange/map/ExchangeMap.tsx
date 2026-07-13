"use client";

import { useRef } from "react";
import type { RfxDoc, TerritoryDoc } from "@hi/shared";
import "mapbox-gl/dist/mapbox-gl.css";

import type { ExchangeMapViewport } from "./mapConfig";
import type { ExchangeMapCallbacks } from "./mapEvents";
import type { ExchangeMapSelection } from "./selection";
import { useExchangeMap, type ExchangeMapStatus } from "./useExchangeMap";

export interface ExchangeMapProps extends ExchangeMapCallbacks {
  rfxList: readonly RfxDoc[];
  releasedTerritories: readonly TerritoryDoc[];
  scheduledTerritories: readonly TerritoryDoc[];
  selection?: ExchangeMapSelection;
  initialViewport?: ExchangeMapViewport;
  viewport?: ExchangeMapViewport;
  fitRequest?: number;
  resizeSignal?: unknown;
  accessToken?: string;
  className?: string;
  ariaLabel?: string;
  onStatusChange?: (status: ExchangeMapStatus, error: Error | null) => void;
  onRetry?: () => void;
}

export function ExchangeMap({
  rfxList,
  releasedTerritories,
  scheduledTerritories,
  selection = null,
  initialViewport,
  viewport,
  fitRequest,
  resizeSignal,
  accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  className = "h-full min-h-[360px] w-full",
  ariaLabel = "Hi Exchange opportunity and territory map",
  onStatusChange,
  onRetry,
  ...callbacks
}: ExchangeMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { status, error } = useExchangeMap({
    containerRef,
    accessToken,
    rfxList,
    releasedTerritories,
    scheduledTerritories,
    selection,
    initialViewport,
    viewport,
    fitRequest,
    resizeSignal,
    onStatusChange,
    ...callbacks,
  });

  if (!accessToken) {
    return (
      <div
        className={`${className} flex items-center justify-center border border-slate-200 bg-slate-50 p-6 text-center`}
        role="status"
      >
        <div className="max-w-md">
          <p className="font-medium text-slate-800">Map view is unavailable.</p>
          <p className="mt-1 text-sm text-slate-600">
            Continue in list view. Configure{" "}
            <code className="rounded bg-slate-200 px-1 py-0.5 text-xs">
              NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
            </code>{" "}
            to enable the map.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${className} relative overflow-hidden border border-slate-200 bg-slate-100`}
      role="region"
      aria-label={ariaLabel}
      aria-busy={status === "initializing"}
      data-map-status={status}
    >
      <div ref={containerRef} className="absolute inset-0" />
      {status === "initializing" ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-100/80 text-sm text-slate-600"
          role="status"
        >
          Loading map…
        </div>
      ) : null}
      {status === "error" ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-slate-50/95 p-6 text-center"
          role="alert"
        >
          <div className="max-w-md">
            <p className="font-medium text-slate-800">The map could not be loaded.</p>
            <p className="mt-1 text-sm text-slate-600">
              Continue in list view. {error?.message ? "Map services may be temporarily unavailable." : ""}
            </p>
            {onRetry ? (
              <button
                type="button"
                className="mt-4 min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-700"
                onClick={onRetry}
              >
                Retry map
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
