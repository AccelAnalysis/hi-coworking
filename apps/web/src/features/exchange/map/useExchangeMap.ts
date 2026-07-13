"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import mapboxgl, { type Map as MapboxMap } from "mapbox-gl";
import type { RfxDoc, TerritoryDoc } from "@hi/shared";

import {
  DEFAULT_EXCHANGE_MAP_VIEWPORT,
  EXCHANGE_MAP_STYLE,
  type ExchangeMapViewport,
} from "./mapConfig";
import { buildExchangeMapGeoJson, getExchangeMapDataBounds } from "./geojson";
import {
  registerExchangeMapBaseEvents,
  registerExchangeMapInteractionEvents,
  readExchangeMapBounds,
  type ExchangeMapCallbacks,
} from "./mapEvents";
import { registerExchangeMapLayers } from "./mapLayers";
import {
  registerExchangeMapSources,
  updateExchangeMapSources,
  updateExchangeSelectedRfxSource,
} from "./mapSources";
import {
  updateExchangeMapSelection,
  type ExchangeMapSelection,
} from "./selection";

export type ExchangeMapStatus = "unavailable" | "initializing" | "ready" | "error";

export interface UseExchangeMapOptions extends ExchangeMapCallbacks {
  containerRef: RefObject<HTMLDivElement | null>;
  accessToken?: string;
  rfxList: readonly RfxDoc[];
  releasedTerritories: readonly TerritoryDoc[];
  scheduledTerritories: readonly TerritoryDoc[];
  selection?: ExchangeMapSelection;
  initialViewport?: ExchangeMapViewport;
  viewport?: ExchangeMapViewport;
  fitRequest?: number;
  resizeSignal?: unknown;
  onStatusChange?: (status: ExchangeMapStatus, error: Error | null) => void;
}

export interface UseExchangeMapResult {
  mapRef: RefObject<MapboxMap | null>;
  status: ExchangeMapStatus;
  error: Error | null;
  requestResize: () => void;
}

interface InitialMapOptions {
  accessToken?: string;
  viewport: ExchangeMapViewport;
}

export function useExchangeMap({
  containerRef,
  accessToken,
  rfxList,
  releasedTerritories,
  scheduledTerritories,
  selection = null,
  initialViewport,
  viewport,
  fitRequest = 0,
  resizeSignal,
  onSelect,
  onSelectRfx,
  onSelectTerritory,
  onBackgroundClick,
  onViewportChange,
  onError,
  onLoad,
  onStatusChange,
}: UseExchangeMapOptions): UseExchangeMapResult {
  const mapRef = useRef<MapboxMap | null>(null);
  const loadedRef = useRef(false);
  const selectionRef = useRef<ExchangeMapSelection>(selection);
  const previousSelectionRef = useRef<ExchangeMapSelection>(null);
  const viewportRef = useRef<ExchangeMapViewport | undefined>(viewport);
  const fitRequestRef = useRef(fitRequest);
  const completedFitRequestRef = useRef(fitRequest);
  const initialOptionsRef = useRef<InitialMapOptions>({
    accessToken,
    viewport: initialViewport ?? viewport ?? DEFAULT_EXCHANGE_MAP_VIEWPORT,
  });
  const [status, setStatus] = useState<ExchangeMapStatus>(
    accessToken ? "initializing" : "unavailable",
  );
  const [error, setError] = useState<Error | null>(null);

  const data = useMemo(
    () => buildExchangeMapGeoJson(rfxList, releasedTerritories, scheduledTerritories),
    [rfxList, releasedTerritories, scheduledTerritories],
  );
  const dataRef = useRef(data);
  const externalCallbacksRef = useRef<ExchangeMapCallbacks>({});
  const statusCallbackRef = useRef(onStatusChange);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    fitRequestRef.current = fitRequest;
  }, [fitRequest]);

  useEffect(() => {
    statusCallbackRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    externalCallbacksRef.current = {
      onSelect,
      onSelectRfx,
      onSelectTerritory,
      onBackgroundClick,
      onViewportChange,
      onError: (mapError) => {
        if (!loadedRef.current) {
          setError(mapError);
          setStatus("error");
        }
        onError?.(mapError);
      },
      onLoad,
    };
  }, [
    onBackgroundClick,
    onError,
    onLoad,
    onSelect,
    onSelectRfx,
    onSelectTerritory,
    onViewportChange,
  ]);

  const requestResize = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    window.requestAnimationFrame(() => mapRef.current?.resize());
  }, []);

  const synchronizeViewport = useCallback(
    (map: MapboxMap, nextViewport: ExchangeMapViewport | undefined) => {
      if (!nextViewport) return;
      const center = map.getCenter();
      const meaningfullyDifferent =
        Math.abs(center.lng - nextViewport.longitude) > 0.00001 ||
        Math.abs(center.lat - nextViewport.latitude) > 0.00001 ||
        Math.abs(map.getZoom() - nextViewport.zoom) > 0.001 ||
        Math.abs(map.getBearing() - (nextViewport.bearing ?? 0)) > 0.01 ||
        Math.abs(map.getPitch() - (nextViewport.pitch ?? 0)) > 0.01;

      if (meaningfullyDifferent) {
        map.jumpTo({
          center: [nextViewport.longitude, nextViewport.latitude],
          zoom: nextViewport.zoom,
          bearing: nextViewport.bearing ?? 0,
          pitch: nextViewport.pitch ?? 0,
        });
      }
    },
    [],
  );

  const fitCurrentResults = useCallback((map: MapboxMap): boolean => {
    const bounds = getExchangeMapDataBounds(dataRef.current);
    if (!bounds) return false;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    map.fitBounds(
      [
        [bounds.west, bounds.south],
        [bounds.east, bounds.north],
      ],
      { padding: 56, maxZoom: 12, duration: reduceMotion ? 0 : 500 },
    );
    return true;
  }, []);

  useEffect(() => {
    statusCallbackRef.current?.(status, error);
  }, [error, status]);

  // Construction owns only the container and immutable, first-render config.
  // Data, selection, callbacks, URL state, filters, and panel state live in refs
  // or separate effects and therefore cannot recreate this Mapbox instance.
  useEffect(() => {
    const container = containerRef.current;
    const initial = initialOptionsRef.current;
    if (!container || !initial.accessToken || mapRef.current) return;

    let map: MapboxMap | null = null;
    let destroyed = false;
    let removeBaseEvents: (() => void) | undefined;
    let removeInteractionEvents: (() => void) | undefined;
    let observer: ResizeObserver | undefined;
    let resizeFrame: number | undefined;

    const scheduleResize = () => {
      if (resizeFrame !== undefined) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => map?.resize());
    };

    try {
      mapboxgl.accessToken = initial.accessToken;
      map = new mapboxgl.Map({
        container,
        style: EXCHANGE_MAP_STYLE,
        center: [initial.viewport.longitude, initial.viewport.latitude],
        zoom: initial.viewport.zoom,
        bearing: initial.viewport.bearing ?? 0,
        pitch: initial.viewport.pitch ?? 0,
        antialias: true,
        attributionControl: true,
      });
      mapRef.current = map;
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      removeBaseEvents = registerExchangeMapBaseEvents(map, externalCallbacksRef);

      const handleLoad = () => {
        if (destroyed || !map) return;
        try {
          registerExchangeMapSources(map, dataRef.current);
          registerExchangeMapLayers(map);
          removeInteractionEvents = registerExchangeMapInteractionEvents(
            map,
            externalCallbacksRef,
          );
          loadedRef.current = true;
          updateExchangeMapSelection(map, null, selectionRef.current);
          updateExchangeSelectedRfxSource(map, dataRef.current, selectionRef.current);
          previousSelectionRef.current = selectionRef.current;
          synchronizeViewport(map, viewportRef.current);
          if (
            fitRequestRef.current !== completedFitRequestRef.current &&
            fitCurrentResults(map)
          ) {
            completedFitRequestRef.current = fitRequestRef.current;
          }
          setError(null);
          setStatus("ready");
          externalCallbacksRef.current.onLoad?.();
          const currentBounds = readExchangeMapBounds(map);
          if (currentBounds) {
            externalCallbacksRef.current.onViewportChange?.(currentBounds);
          }
          scheduleResize();
        } catch (loadError) {
          const normalized =
            loadError instanceof Error ? loadError : new Error("The map could not be loaded.");
          setError(normalized);
          setStatus("error");
          externalCallbacksRef.current.onError?.(normalized);
        }
      };

      map.on("load", handleLoad);

      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(scheduleResize);
        observer.observe(container);
      } else {
        window.addEventListener("resize", scheduleResize);
      }

      return () => {
        destroyed = true;
        observer?.disconnect();
        window.removeEventListener("resize", scheduleResize);
        if (resizeFrame !== undefined) window.cancelAnimationFrame(resizeFrame);
        removeInteractionEvents?.();
        removeBaseEvents?.();
        map?.off("load", handleLoad);
        map?.remove();
        mapRef.current = null;
        loadedRef.current = false;
        previousSelectionRef.current = null;
      };
    } catch (constructionError) {
      const normalized =
        constructionError instanceof Error
          ? constructionError
          : new Error("The map could not be initialized.");
      mapRef.current = null;
      setError(normalized);
      setStatus("error");
      externalCallbacksRef.current.onError?.(normalized);
      return;
    }
  }, [containerRef, fitCurrentResults, synchronizeViewport]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && loadedRef.current) {
      updateExchangeMapSources(map, data);
      updateExchangeSelectedRfxSource(map, data, selectionRef.current);
    }
  }, [data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    updateExchangeMapSelection(map, previousSelectionRef.current, selection);
    updateExchangeSelectedRfxSource(map, dataRef.current, selection);
    previousSelectionRef.current = selection;
  }, [selection]);

  // Browser back/forward hydration may deliberately restore a saved viewport.
  // The comparison prevents the moveend -> URL update -> prop loop.
  useEffect(() => {
    const map = mapRef.current;
    if (map && loadedRef.current) synchronizeViewport(map, viewport);
  }, [synchronizeViewport, viewport]);

  // Results are fitted only when the caller increments this explicit signal.
  // Ordinary data refreshes and filter/selection changes preserve the viewport.
  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !loadedRef.current ||
      fitRequest === completedFitRequestRef.current ||
      !fitCurrentResults(map)
    ) {
      return;
    }
    completedFitRequestRef.current = fitRequest;
  }, [data, fitCurrentResults, fitRequest]);

  useEffect(() => {
    if (resizeSignal !== undefined) requestResize();
  }, [requestResize, resizeSignal]);

  return { mapRef, status, error, requestResize };
}
