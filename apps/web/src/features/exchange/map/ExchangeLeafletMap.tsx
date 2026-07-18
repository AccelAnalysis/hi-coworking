"use client";

import { useEffect, useRef } from "react";
import type { RfxDoc, TerritoryDoc } from "@hi/shared";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import {
  DEFAULT_EXCHANGE_MAP_VIEWPORT,
  type ExchangeMapBounds,
  type ExchangeMapViewport,
} from "./mapConfig";
import type { ExchangeMapCallbacks } from "./mapEvents";
import type { ExchangeMapSelection } from "./selection";
import type { ExchangeMapStatus } from "./useExchangeMap";

interface ExchangeLeafletMapProps extends ExchangeMapCallbacks {
  rfxList: readonly RfxDoc[];
  releasedTerritories: readonly TerritoryDoc[];
  scheduledTerritories: readonly TerritoryDoc[];
  selection?: ExchangeMapSelection;
  initialViewport?: ExchangeMapViewport;
  viewport?: ExchangeMapViewport;
  fitRequest?: number;
  resizeSignal?: unknown;
  className?: string;
  ariaLabel?: string;
  onStatusChange?: (status: ExchangeMapStatus, error: Error | null) => void;
}

function validCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readLeafletBounds(map: L.Map): ExchangeMapBounds {
  const bounds = map.getBounds();
  const center = map.getCenter();
  return {
    north: bounds.getNorth(),
    south: bounds.getSouth(),
    east: bounds.getEast(),
    west: bounds.getWest(),
    longitude: center.lng,
    latitude: center.lat,
    zoom: map.getZoom(),
    bearing: 0,
    pitch: 0,
  };
}

function pointIcon(active: boolean, scheduled = false): L.DivIcon {
  const background = scheduled ? "#d97706" : active ? "#1d4ed8" : "#4f46e5";
  const size = active ? 22 : 16;
  return L.divIcon({
    className: "exchange-leaflet-marker",
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${background};border:3px solid white;box-shadow:0 4px 14px rgba(15,23,42,.35)"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export function ExchangeLeafletMap({
  rfxList,
  releasedTerritories,
  scheduledTerritories,
  selection = null,
  initialViewport = DEFAULT_EXCHANGE_MAP_VIEWPORT,
  viewport,
  fitRequest,
  resizeSignal,
  className = "h-full min-h-[360px] w-full",
  ariaLabel = "Hi Exchange geographic workspace",
  onSelect,
  onSelectRfx,
  onSelectTerritory,
  onBackgroundClick,
  onViewportChange,
  onError,
  onLoad,
  onStatusChange,
}: ExchangeLeafletMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const callbacksRef = useRef({
    onSelect,
    onSelectRfx,
    onSelectTerritory,
    onBackgroundClick,
    onViewportChange,
    onError,
    onLoad,
    onStatusChange,
  });

  callbacksRef.current = {
    onSelect,
    onSelectRfx,
    onSelectTerritory,
    onBackgroundClick,
    onViewportChange,
    onError,
    onLoad,
    onStatusChange,
  };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    try {
      callbacksRef.current.onStatusChange?.("initializing", null);
      const starting = viewport ?? initialViewport;
      const map = L.map(containerRef.current, {
        center: [starting.latitude, starting.longitude],
        zoom: starting.zoom,
        zoomControl: false,
        attributionControl: true,
      });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      const layerGroup = L.layerGroup().addTo(map);
      mapRef.current = map;
      layerGroupRef.current = layerGroup;

      map.on("click", () => {
        callbacksRef.current.onSelect?.(null);
        callbacksRef.current.onBackgroundClick?.();
      });
      map.on("moveend", () => {
        callbacksRef.current.onViewportChange?.(readLeafletBounds(map));
      });
      map.whenReady(() => {
        callbacksRef.current.onStatusChange?.("ready", null);
        callbacksRef.current.onLoad?.();
      });
    } catch (value) {
      const error = value instanceof Error ? value : new Error("The map could not be initialized.");
      callbacksRef.current.onStatusChange?.("error", error);
      callbacksRef.current.onError?.(error);
    }

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
  }, []);

  useEffect(() => {
    const group = layerGroupRef.current;
    if (!group) return;
    group.clearLayers();

    const addTerritory = (territory: TerritoryDoc, status: "released" | "scheduled") => {
      const lng = territory.centroid?.lng;
      const lat = territory.centroid?.lat;
      if (!validCoordinate(lng) || !validCoordinate(lat)) return;
      const active = selection?.entityType === "territory" && selection.entityId === territory.fips;
      const marker = L.marker([lat, lng], {
        icon: pointIcon(active, status === "scheduled"),
        keyboard: true,
        bubblingMouseEvents: false,
        title: territory.name,
      });
      marker.bindTooltip(`${territory.name} · ${status}`, { direction: "top" });
      marker.on("click", () => {
        callbacksRef.current.onSelect?.({ entityType: "territory", entityId: territory.fips });
        callbacksRef.current.onSelectTerritory?.(territory.fips, status);
      });
      marker.addTo(group);
    };

    releasedTerritories.forEach((territory) => addTerritory(territory, "released"));
    scheduledTerritories.forEach((territory) => addTerritory(territory, "scheduled"));

    for (const rfx of rfxList) {
      const lng = rfx.geo?.lng;
      const lat = rfx.geo?.lat;
      if (!validCoordinate(lng) || !validCoordinate(lat)) continue;
      const active = selection?.entityType === "rfx" && selection.entityId === rfx.id;
      const marker = L.marker([lat, lng], {
        icon: pointIcon(active),
        keyboard: true,
        bubblingMouseEvents: false,
        title: rfx.title,
      });
      marker.bindTooltip(rfx.title, { direction: "top" });
      marker.on("click", () => {
        callbacksRef.current.onSelect?.({ entityType: "rfx", entityId: rfx.id });
        callbacksRef.current.onSelectRfx?.(rfx.id);
      });
      marker.addTo(group);
    }
  }, [releasedTerritories, rfxList, scheduledTerritories, selection]);

  useEffect(() => {
    const map = mapRef.current;
    const next = viewport;
    if (!map || !next) return;
    const center = map.getCenter();
    if (
      Math.abs(center.lng - next.longitude) > 0.0001
      || Math.abs(center.lat - next.latitude) > 0.0001
      || Math.abs(map.getZoom() - next.zoom) > 0.01
    ) {
      map.setView([next.latitude, next.longitude], next.zoom, { animate: false });
    }
  }, [viewport]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || fitRequest === undefined) return;
    const coordinates: L.LatLngExpression[] = [];
    for (const territory of [...releasedTerritories, ...scheduledTerritories]) {
      if (validCoordinate(territory.centroid?.lat) && validCoordinate(territory.centroid?.lng)) {
        coordinates.push([territory.centroid.lat, territory.centroid.lng]);
      }
    }
    for (const rfx of rfxList) {
      if (validCoordinate(rfx.geo?.lat) && validCoordinate(rfx.geo?.lng)) {
        coordinates.push([rfx.geo.lat, rfx.geo.lng]);
      }
    }
    if (coordinates.length === 1) map.setView(coordinates[0], Math.max(map.getZoom(), 11));
    if (coordinates.length > 1) map.fitBounds(L.latLngBounds(coordinates), { padding: [40, 40], maxZoom: 12 });
  }, [fitRequest, releasedTerritories, rfxList, scheduledTerritories]);

  useEffect(() => {
    mapRef.current?.invalidateSize({ animate: false });
  }, [resizeSignal]);

  return (
    <div
      className={`${className} relative overflow-hidden border border-slate-200 bg-slate-100`}
      role="region"
      aria-label={ariaLabel}
      data-map-provider="leaflet-openstreetmap"
    >
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
