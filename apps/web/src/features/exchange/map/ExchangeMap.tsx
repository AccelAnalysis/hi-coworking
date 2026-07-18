"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { RfxDoc, TerritoryDoc } from "@hi/shared";
import "mapbox-gl/dist/mapbox-gl.css";

import { cn } from "@/lib/utils";
import {
  EXCHANGE_3D_VIEWPORT,
  type ExchangeMapDimension,
  type ExchangeMapViewport,
} from "./mapConfig";
import type { ExchangeMapCallbacks } from "./mapEvents";
import type { ExchangeMapSelection } from "./selection";
import { useExchangeMap, type ExchangeMapStatus } from "./useExchangeMap";

const ExchangeLeafletMap = dynamic(
  () => import("./ExchangeLeafletMap").then((module) => module.ExchangeLeafletMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[360px] w-full items-center justify-center bg-slate-100 text-sm font-semibold text-slate-600" role="status">
        Loading map…
      </div>
    ),
  },
);

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
  accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
  ...props
}: ExchangeMapProps) {
  if (!accessToken) {
    return <ExchangeLeafletMap {...props} />;
  }
  return <ExchangeMapboxCanvas {...props} accessToken={accessToken} />;
}

function ExchangeMapboxCanvas({
  rfxList,
  releasedTerritories,
  scheduledTerritories,
  selection = null,
  initialViewport,
  viewport,
  fitRequest,
  resizeSignal,
  accessToken,
  className = "h-full min-h-[360px] w-full",
  ariaLabel = "Hi Exchange opportunity and territory map",
  onStatusChange,
  onRetry,
  ...callbacks
}: ExchangeMapProps & { accessToken: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dimension, setDimension] = useState<ExchangeMapDimension>("2d");
  const { mapRef, status, error } = useExchangeMap({
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

  useEffect(() => {
    if (status !== "ready") return;
    const map = mapRef.current;
    if (!map) return;
    const threeDimensional = dimension === "3d";
    try {
      map.setConfigProperty("basemap", "show3dObjects", threeDimensional);
    } catch {
      // Custom Mapbox styles may not expose Standard basemap configuration.
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    map.easeTo({
      pitch: threeDimensional ? EXCHANGE_3D_VIEWPORT.pitch : 0,
      bearing: threeDimensional ? EXCHANGE_3D_VIEWPORT.bearing : 0,
      duration: reduceMotion ? 0 : 500,
    });
  }, [dimension, mapRef, status]);

  return (
    <div
      className={`${className} relative overflow-hidden border border-white/40 bg-slate-100`}
      role="region"
      aria-label={ariaLabel}
      aria-busy={status === "initializing"}
      data-map-status={status}
      data-map-provider="mapbox"
      data-map-dimension={dimension}
    >
      <div ref={containerRef} className="absolute inset-0" />
      <div className="absolute right-3 top-3 z-20 flex rounded-xl border border-white/50 bg-white/70 p-1 shadow-lg backdrop-blur-xl" role="group" aria-label="Map dimension">
        {(["2d", "3d"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setDimension(candidate)}
            aria-pressed={dimension === candidate}
            className={cn(
              "min-h-9 rounded-lg px-3 text-xs font-black uppercase tracking-[0.08em] outline-none transition focus-visible:ring-2 focus-visible:ring-blue-600",
              dimension === candidate
                ? "bg-slate-950 text-white shadow-sm"
                : "text-slate-600 hover:bg-white/80 hover:text-slate-950",
            )}
          >
            {candidate.toUpperCase()}
          </button>
        ))}
      </div>
      {status === "initializing" ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-100/55 text-sm font-semibold text-slate-700 backdrop-blur-sm"
          role="status"
        >
          Loading Mapbox…
        </div>
      ) : null}
      {status === "error" ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-slate-50/75 p-6 text-center backdrop-blur-md"
          role="alert"
        >
          <div className="max-w-md rounded-3xl border border-white/70 bg-white/80 p-6 shadow-2xl backdrop-blur-2xl">
            <p className="font-bold text-slate-900">The Mapbox map could not be loaded.</p>
            <p className="mt-1 text-sm text-slate-600">
              Verify the public token and its allowed URLs. The result list remains available.
            </p>
            {onRetry ? (
              <button
                type="button"
                className="mt-4 min-h-11 rounded-xl border border-slate-300 bg-white/90 px-4 text-sm font-bold text-slate-800 hover:bg-white focus:outline-none focus:ring-2 focus:ring-slate-700"
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