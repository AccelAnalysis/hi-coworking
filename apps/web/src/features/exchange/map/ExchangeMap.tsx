"use client";

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
import {
  fingerprintMapboxToken,
  MapboxRuntimeError,
  validateMapboxRuntime,
  type MapboxRuntimeDiagnostics,
} from "./mapboxDiagnostics";
import type { ExchangeMapCallbacks } from "./mapEvents";
import type { ExchangeMapSelection } from "./selection";
import { useExchangeMap, type ExchangeMapStatus } from "./useExchangeMap";

const MAPBOX_LOAD_TIMEOUT_MS = 12_000;

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
      <MapboxConfigurationFailure
        className={className}
        ariaLabel={ariaLabel}
        title="Mapbox token not detected"
        message="Add NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to apps/web/.env.local, then rebuild or fully restart the Next.js process."
        onRetry={props.onRetry}
      />
    );
  }

  if (!normalizedToken.startsWith("pk.")) {
    return (
      <MapboxConfigurationFailure
        className={className}
        ariaLabel={ariaLabel}
        title="Mapbox public token required"
        message="The browser map requires a public Mapbox token beginning with pk. Do not use an sk. secret token in a NEXT_PUBLIC variable."
        tokenFingerprint={fingerprintMapboxToken(normalizedToken)}
        onRetry={props.onRetry}
      />
    );
  }

  return (
    <ExchangeMapRuntimeGate
      {...props}
      className={className}
      ariaLabel={ariaLabel}
      accessToken={normalizedToken}
    />
  );
}

function ExchangeMapRuntimeGate({
  accessToken,
  className = "h-full min-h-[360px] w-full",
  ariaLabel = "Hi Exchange geographic workspace",
  onStatusChange,
  onRetry,
  ...props
}: ExchangeMapProps & { accessToken: string }) {
  const [attempt, setAttempt] = useState(0);
  const [diagnostics, setDiagnostics] = useState<MapboxRuntimeDiagnostics | null>(null);
  const [preflightError, setPreflightError] = useState<MapboxRuntimeError | null>(null);

  useEffect(() => {
    let active = true;
    setDiagnostics(null);
    setPreflightError(null);
    onStatusChange?.("initializing", null);

    void validateMapboxRuntime(accessToken)
      .then((result) => {
        if (!active) return;
        setDiagnostics(result);
      })
      .catch((value: unknown) => {
        if (!active) return;
        const error = value instanceof MapboxRuntimeError
          ? value
          : new MapboxRuntimeError(
            value instanceof Error ? value.message : "Mapbox runtime validation failed.",
            {
              origin: window.location.origin || "null",
              protocol: window.location.protocol,
              style: EXCHANGE_MAP_STYLE,
              tokenFingerprint: fingerprintMapboxToken(accessToken),
              webglSupported: false,
            },
          );
        setPreflightError(error);
        onStatusChange?.("error", error);
      });

    return () => {
      active = false;
    };
  }, [accessToken, attempt, onStatusChange]);

  const retry = () => {
    setAttempt((value) => value + 1);
    onRetry?.();
  };

  if (preflightError) {
    return (
      <MapboxConfigurationFailure
        className={className}
        ariaLabel={ariaLabel}
        title="Mapbox configuration check failed"
        message={preflightError.message}
        diagnostics={preflightError.diagnostics}
        onRetry={retry}
      />
    );
  }

  if (!diagnostics) {
    return (
      <div
        className={`${className} exchange-map-root relative isolate overflow-hidden bg-slate-100`}
        role="region"
        aria-label={ariaLabel}
        aria-busy="true"
        data-map-provider="mapbox"
        data-map-status="preflight"
        data-map-token-fingerprint={fingerprintMapboxToken(accessToken)}
      >
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <div className="rounded-2xl border border-white/70 bg-white/82 px-5 py-4 shadow-xl backdrop-blur-xl">
            <p className="text-sm font-black text-slate-900">Validating Mapbox…</p>
            <p className="mt-1 text-xs text-slate-600">Checking the compiled token, browser origin, Streets style access, and WebGL support.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ExchangeMapboxCanvas
      {...props}
      className={className}
      ariaLabel={ariaLabel}
      accessToken={accessToken}
      diagnostics={diagnostics}
      onStatusChange={onStatusChange}
      onRetry={retry}
    />
  );
}

function MapboxConfigurationFailure({
  className,
  ariaLabel,
  title,
  message,
  diagnostics,
  tokenFingerprint,
  onRetry,
}: {
  className: string;
  ariaLabel: string;
  title: string;
  message: string;
  diagnostics?: MapboxRuntimeDiagnostics;
  tokenFingerprint?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className={`${className} exchange-map-root relative isolate overflow-hidden bg-slate-100 p-4`}
      role="alert"
      aria-label={ariaLabel}
      data-map-provider="mapbox"
      data-map-status="error"
      data-map-token-fingerprint={diagnostics?.tokenFingerprint ?? tokenFingerprint}
    >
      <div className="flex h-full min-h-[320px] items-center justify-center">
        <div className="w-full max-w-xl rounded-3xl border border-red-200/80 bg-white/92 p-6 shadow-2xl backdrop-blur-2xl">
          <p className="text-base font-black text-slate-950">{title}</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{message}</p>
          <dl className="mt-4 grid gap-2 rounded-2xl bg-slate-950 p-4 font-mono text-[11px] text-slate-100 sm:grid-cols-[9rem_1fr]">
            <dt className="font-bold text-slate-400">Origin</dt>
            <dd className="break-all">{diagnostics?.origin ?? (typeof window === "undefined" ? "unknown" : window.location.origin || "null")}</dd>
            <dt className="font-bold text-slate-400">Token fingerprint</dt>
            <dd>{diagnostics?.tokenFingerprint ?? tokenFingerprint ?? "not available"}</dd>
            <dt className="font-bold text-slate-400">Map style</dt>
            <dd className="break-all">{diagnostics?.style ?? EXCHANGE_MAP_STYLE}</dd>
            <dt className="font-bold text-slate-400">WebGL</dt>
            <dd>{diagnostics ? (diagnostics.webglSupported ? "supported" : "not supported") : "not checked"}</dd>
            <dt className="font-bold text-slate-400">Style response</dt>
            <dd>{diagnostics?.styleStatus ?? "not received"}</dd>
          </dl>
          <p className="mt-4 text-xs leading-5 text-slate-600">
            A changed NEXT_PUBLIC token is compiled into the browser bundle only after the Next.js process is restarted or the static site is rebuilt and redeployed.
          </p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-black text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Retry Mapbox check
            </button>
          ) : null}
        </div>
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
  diagnostics,
  className = "h-full min-h-[360px] w-full",
  ariaLabel = "Hi Exchange opportunity and territory map",
  onStatusChange,
  onRetry,
  ...callbacks
}: ExchangeMapProps & { accessToken: string; diagnostics: MapboxRuntimeDiagnostics }) {
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
      const container = containerRef.current;
      const dimensions = container
        ? `${Math.round(container.getBoundingClientRect().width)}×${Math.round(container.getBoundingClientRect().height)}`
        : "not mounted";
      setLoadTimeoutError(new Error(
        `The Mapbox token and Streets style passed preflight, but the WebGL map did not complete its first tile render. Canvas container: ${dimensions}.`,
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

  return (
    <div
      className={`${className} exchange-map-root relative isolate z-0 overflow-hidden border border-white/40 bg-slate-100`}
      role="region"
      aria-label={ariaLabel}
      aria-busy={status === "initializing"}
      data-map-status={status}
      data-map-provider="mapbox"
      data-map-token-state="validated"
      data-map-token-fingerprint={diagnostics.tokenFingerprint}
      data-map-origin={diagnostics.origin}
      data-map-dimension={dimension}
      data-map-style={EXCHANGE_MAP_STYLE}
    >
      <div ref={containerRef} className="absolute inset-0 z-0 min-h-full min-w-full" />
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
      {status === "initializing" && !providerError ? (
        <div
          className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-slate-100/55 p-6 text-center backdrop-blur-sm"
          role="status"
        >
          <div className="rounded-2xl border border-white/70 bg-white/82 px-5 py-4 shadow-xl">
            <p className="text-sm font-black text-slate-900">Rendering Mapbox Streets…</p>
            <p className="mt-1 font-mono text-[10px] text-slate-500">{diagnostics.tokenFingerprint} · {diagnostics.origin}</p>
          </div>
        </div>
      ) : null}
      {providerError ? (
        <div className="absolute inset-0 z-50 bg-slate-100/88 p-4 backdrop-blur-md">
          <MapboxConfigurationFailure
            className="h-full min-h-0 w-full border-0 bg-transparent p-0"
            ariaLabel={ariaLabel}
            title="Mapbox passed access checks but did not render"
            message={providerError.message}
            diagnostics={diagnostics}
            onRetry={onRetry}
          />
        </div>
      ) : null}
    </div>
  );
}
