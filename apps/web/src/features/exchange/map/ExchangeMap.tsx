"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { RfxDoc, TerritoryDoc } from "@hi/shared";
import "mapbox-gl/dist/mapbox-gl.css";
import "./exchangeMapLayering.css";

import { cn } from "@/lib/utils";
import {
  EXCHANGE_3D_VIEWPORT,
  EXCHANGE_MAP_LAYER_IDS,
  EXCHANGE_MAP_STYLE,
  type ExchangeMapDimension,
  type ExchangeMapViewport,
} from "./mapConfig";
import type { ExchangeMapCallbacks } from "./mapEvents";
import type { ExchangeMapSelection } from "./selection";
import { useExchangeMap, type ExchangeMapStatus } from "./useExchangeMap";

const MAPBOX_LOAD_TIMEOUT_MS = 12_000;

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
  className = "h-full min-h-[360px] w-full",
  ariaLabel = "Hi Exchange geographic workspace",
  ...props
}: ExchangeMapProps) {
  const normalizedToken = accessToken?.trim();

  if (!normalizedToken) {
    return (
      <ExchangeLeafletFallback
        {...props}
        className={className}
        ariaLabel={ariaLabel}
        tokenState="missing"
        message="Mapbox token not detected"
      />
    );
  }

  if (!normalizedToken.startsWith("pk.")) {
    return (
      <ExchangeLeafletFallback
        {...props}
        className={className}
        ariaLabel={ariaLabel}
        tokenState="invalid"
        message="Mapbox requires a public pk. token"
      />
    );
  }

  return (
    <ExchangeMapboxCanvas
      {...props}
      className={className}
      ariaLabel={ariaLabel}
      accessToken={normalizedToken}
    />
  );
}

function ExchangeLeafletFallback({
  className,
  ariaLabel,
  tokenState,
  message,
  onRetry,
  ...props
}: Omit<ExchangeMapProps, "accessToken"> & {
  tokenState: "missing" | "invalid" | "provider-error";
  message: string;
}) {
  return (
    <div
      className={`${className ?? "h-full min-h-[360px] w-full"} exchange-map-root relative isolate overflow-hidden bg-slate-100`}
      role="region"
      aria-label={ariaLabel}
      data-map-provider="leaflet-openstreetmap"
      data-map-token-state={tokenState}
    >
      <ExchangeLeafletMap
        {...props}
        className="absolute inset-0 h-full min-h-0 w-full border-0"
        ariaLabel={ariaLabel}
      />
      <div
        className={cn(
          "absolute left-3 top-3 z-30 flex max-w-[calc(100%-5.5rem)] items-center gap-2 rounded-2xl border px-3 py-1.5 text-[10px] font-black shadow-lg backdrop-blur-xl",
          tokenState === "missing"
            ? "border-amber-200/80 bg-amber-50/88 text-amber-900"
            : "border-red-200/80 bg-red-50/88 text-red-900",
        )}
        role="status"
      >
        <span>OpenStreetMap fallback · {message}</span>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="pointer-events-auto rounded-lg border border-current/25 bg-white/65 px-2 py-1 font-black uppercase tracking-[0.06em] outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-current"
          >
            Retry Mapbox
          </button>
        ) : null}
      </div>
    </div>
  );
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
  const [loadTimeoutError, setLoadTimeoutError] = useState<Error | null>(null);
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
    if (status !== "initializing") {
      setLoadTimeoutError(null);
      return;
    }
    const timeout = window.setTimeout(() => {
      setLoadTimeoutError(new Error(
        "Mapbox did not finish loading. Check token URL restrictions, restart the Next.js server after env changes, and verify WebGL support.",
      ));
    }, MAPBOX_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    if (status !== "ready") return;
    const map = mapRef.current;
    if (!map) return;
    const threeDimensional = dimension === "3d";
    try {
      map.setConfigProperty("basemap", "show3dObjects", threeDimensional);
    } catch {
      // Streets and custom styles do not expose Standard basemap configuration.
    }
    if (map.getLayer(EXCHANGE_MAP_LAYER_IDS.buildings3d)) {
      map.setLayoutProperty(
        EXCHANGE_MAP_LAYER_IDS.buildings3d,
        "visibility",
        threeDimensional ? "visible" : "none",
      );
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    map.easeTo({
      pitch: threeDimensional ? EXCHANGE_3D_VIEWPORT.pitch : 0,
      bearing: threeDimensional ? EXCHANGE_3D_VIEWPORT.bearing : 0,
      duration: reduceMotion ? 0 : 500,
    });
  }, [dimension, mapRef, status]);

  const providerError = error ?? loadTimeoutError;
  if (status === "error" || providerError) {
    return (
      <ExchangeLeafletFallback
        {...callbacks}
        rfxList={rfxList}
        releasedTerritories={releasedTerritories}
        scheduledTerritories={scheduledTerritories}
        selection={selection}
        initialViewport={initialViewport}
        viewport={viewport}
        fitRequest={fitRequest}
        resizeSignal={resizeSignal}
        className={className}
        ariaLabel={ariaLabel}
        tokenState="provider-error"
        message={providerError?.message || "Mapbox could not load its style or tiles"}
        onRetry={onRetry}
      />
    );
  }

  return (
    <div
      className={`${className} exchange-map-root relative isolate z-0 overflow-hidden border border-white/40 bg-slate-100`}
      role="region"
      aria-label={ariaLabel}
      aria-busy={status === "initializing"}
      data-map-status={status}
      data-map-provider="mapbox"
      data-map-token-state="configured"
      data-map-dimension={dimension}
      data-map-style={EXCHANGE_MAP_STYLE}
    >
      <div ref={containerRef} className="absolute inset-0 z-0" />
      <div className="absolute right-3 top-3 z-30 flex rounded-xl border border-white/50 bg-white/70 p-1 shadow-lg backdrop-blur-xl" role="group" aria-label="Map dimension">
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
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-slate-100/55 text-sm font-semibold text-slate-700 backdrop-blur-sm"
          role="status"
        >
          Loading Mapbox…
        </div>
      ) : null}
    </div>
  );
}
