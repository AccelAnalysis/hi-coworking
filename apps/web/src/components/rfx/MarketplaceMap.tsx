"use client";

import { useEffect, useMemo, useRef } from "react";
import mapboxgl from "mapbox-gl";
import type { RfxDoc, TerritoryDoc } from "@hi/shared";

interface MarketplaceMapProps {
  rfxList: RfxDoc[];
  releasedTerritories: TerritoryDoc[];
  scheduledTerritories: TerritoryDoc[];
  selectedRfxId?: string;
  onSelectRfx?: (rfxId: string) => void;
  onTerritoryMessage?: (message: string) => void;
  onViewportChange?: (bounds: { north: number; south: number; east: number; west: number; zoom: number }) => void;
}

const ISLE_OF_WIGHT_CENTER: [number, number] = [-76.7075, 36.9];
const HI_HUB_COORDINATES: [number, number] = [-76.52067, 36.92904];

function toFeatureCollection(rfxList: RfxDoc[]) {
  return {
    type: "FeatureCollection" as const,
    features: rfxList
      .filter((rfx) => rfx.geo?.lng != null && rfx.geo?.lat != null)
      .map((rfx) => ({
        type: "Feature" as const,
        properties: {
          id: rfx.id,
          title: rfx.title,
          status: rfx.status,
          territoryFips: rfx.territoryFips || "",
        },
        geometry: {
          type: "Point" as const,
          coordinates: [rfx.geo!.lng, rfx.geo!.lat],
        },
      })),
  };
}

function toTerritoryMask(territories: TerritoryDoc[]) {
  return {
    type: "FeatureCollection" as const,
    features: territories
      .filter((t) => Boolean(t.boundaryGeoJSON))
      .map((t) => ({
        type: "Feature" as const,
        properties: {
          fips: t.fips,
          name: t.name,
          status: t.status,
          releaseDate: t.releaseDate ?? 0,
        },
        geometry: t.boundaryGeoJSON as GeoJSON.Geometry,
      })),
  };
}

function toTerritoryPoints(territories: TerritoryDoc[]) {
  return {
    type: "FeatureCollection" as const,
    features: territories
      .filter((t) => t.centroid?.lng != null && t.centroid?.lat != null)
      .map((t) => ({
        type: "Feature" as const,
        properties: {
          fips: t.fips,
          name: t.name,
          status: t.status,
          releaseDate: t.releaseDate ?? 0,
          releaseLabel:
            t.releaseDate && t.status === "scheduled"
              ? `Releases on ${new Date(t.releaseDate).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}`
              : "",
        },
        geometry: {
          type: "Point" as const,
          coordinates: [t.centroid!.lng, t.centroid!.lat],
        },
      })),
  };
}

export function MarketplaceMap({
  rfxList,
  releasedTerritories,
  scheduledTerritories,
  selectedRfxId,
  onSelectRfx,
  onTerritoryMessage,
  onViewportChange,
}: MarketplaceMapProps) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);

  const rfxGeoJson = useMemo(() => toFeatureCollection(rfxList), [rfxList]);
  const releasedGeoJson = useMemo(() => toTerritoryPoints(releasedTerritories), [releasedTerritories]);
  const scheduledGeoJson = useMemo(() => toTerritoryPoints(scheduledTerritories), [scheduledTerritories]);
  const releasedMaskGeoJson = useMemo(() => toTerritoryMask(releasedTerritories), [releasedTerritories]);
  const scheduledMaskGeoJson = useMemo(() => toTerritoryMask(scheduledTerritories), [scheduledTerritories]);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!token || !mapRef.current || mapInstanceRef.current) return;

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: mapRef.current,
      style: "mapbox://styles/mapbox/light-v11",
      center: ISLE_OF_WIGHT_CENTER,
      zoom: 9.7,
      pitch: 45,
      bearing: -10,
      antialias: true,
    });

    mapInstanceRef.current = map;

    map.on("load", () => {
      map.addSource("territory-released", { type: "geojson", data: releasedGeoJson });
      map.addSource("territory-scheduled", { type: "geojson", data: scheduledGeoJson });
      map.addSource("territory-released-mask", { type: "geojson", data: releasedMaskGeoJson });
      map.addSource("territory-scheduled-mask", { type: "geojson", data: scheduledMaskGeoJson });
      map.addSource("rfx-points", {
        type: "geojson",
        data: rfxGeoJson,
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 12,
      });

      map.addLayer({
        id: "territory-mask",
        type: "background",
        paint: {
          "background-color": "#d1d5db",
          "background-opacity": 0.12,
        },
      });

      map.addLayer({
        id: "territory-scheduled-fill",
        type: "fill",
        source: "territory-scheduled-mask",
        paint: {
          "fill-color": "#f59e0b",
          "fill-opacity": 0.1,
        },
      });

      map.addLayer({
        id: "territory-released-fill",
        type: "fill",
        source: "territory-released-mask",
        paint: {
          "fill-color": "#22c55e",
          "fill-opacity": 0.08,
        },
      });

      map.addLayer({
        id: "territory-scheduled-outline",
        type: "line",
        source: "territory-scheduled-mask",
        paint: {
          "line-color": "#92400e",
          "line-width": 1.5,
          "line-opacity": 0.5,
        },
      });

      map.addLayer({
        id: "territory-released-outline",
        type: "line",
        source: "territory-released-mask",
        paint: {
          "line-color": "#166534",
          "line-width": 1.5,
          "line-opacity": 0.45,
        },
      });

      map.addLayer({
        id: "territory-released-circles",
        type: "circle",
        source: "territory-released",
        paint: {
          "circle-color": "#22c55e",
          "circle-radius": 8,
          "circle-opacity": 0.6,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#166534",
        },
      });

      map.addLayer({
        id: "territory-scheduled-circles",
        type: "circle",
        source: "territory-scheduled",
        paint: {
          "circle-color": "#f59e0b",
          "circle-radius": 8,
          "circle-opacity": 0.45,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#92400e",
        },
      });

      map.addLayer({
        id: "territory-scheduled-labels",
        type: "symbol",
        source: "territory-scheduled",
        layout: {
          "text-field": ["coalesce", ["get", "releaseLabel"], ""],
          "text-size": 10,
          "text-offset": [0, 1.35],
          "text-anchor": "top",
          "text-max-width": 12,
        },
        paint: {
          "text-color": "#78350f",
          "text-halo-color": "#fffbeb",
          "text-halo-width": 1,
        },
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "rfx-points",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": [
            "step",
            ["get", "point_count"],
            "#334155",
            10,
            "#1d4ed8",
            30,
            "#0f766e",
          ],
          "circle-radius": ["step", ["get", "point_count"], 18, 10, 22, 30, 28],
        },
      });

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "rfx-points",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      map.addLayer({
        id: "rfx-points-unclustered",
        type: "circle",
        source: "rfx-points",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match",
            ["get", "status"],
            "open",
            "#16a34a",
            "awarded",
            "#4338ca",
            "closed",
            "#64748b",
            "#ca8a04",
          ],
          "circle-radius": [
            "case",
            ["==", ["get", "id"], selectedRfxId || ""],
            9,
            6,
          ],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#0f172a",
        },
      });

      map.addLayer({
        id: "rfx-points-label",
        type: "symbol",
        source: "rfx-points",
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["get", "title"],
          "text-size": 11,
          "text-offset": [0, 1.2],
          "text-anchor": "top",
          "text-max-width": 14,
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1,
        },
      });

      const hubEl = document.createElement("div");
      hubEl.className = "h-5 w-5 rounded-full border-2 border-white bg-slate-900 shadow";
      new mapboxgl.Marker({ element: hubEl })
        .setLngLat(HI_HUB_COORDINATES)
        .setPopup(new mapboxgl.Popup({ offset: 16 }).setHTML("<strong>Hi Coworking Hub</strong><br/>Carrollton, VA"))
        .addTo(map);

      map.on("click", "rfx-points-unclustered", (e) => {
        const feature = e.features?.[0];
        const id = feature?.properties?.id;
        if (id && onSelectRfx) {
          onSelectRfx(id);
        }
      });

      map.on("click", "territory-scheduled-circles", (e) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const name = String(feature.properties?.name || "Territory");
        const releaseDate = Number(feature.properties?.releaseDate || 0);
        const dateLabel = releaseDate ? new Date(releaseDate).toLocaleString() : "soon";
        onTerritoryMessage?.(`${name} is scheduled for release on ${dateLabel}.`);
      });

      map.on("click", (e) => {
        const features = map.queryRenderedFeatures(e.point, {
          layers: ["territory-released-circles", "territory-scheduled-circles", "rfx-points-unclustered"],
        });
        if (features.length === 0) {
          onTerritoryMessage?.("This area is not released yet. Request activation or join waitlist.");
        }
      });

      const emitViewport = () => {
        const bounds = map.getBounds();
        if (!bounds) return;
        onViewportChange?.({
          north: bounds.getNorth(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          west: bounds.getWest(),
          zoom: map.getZoom(),
        });
      };

      emitViewport();
      map.on("moveend", emitViewport);

      setTimeout(() => {
        if (!map.getLayer("3d-buildings")) {
          map.addLayer({
            id: "3d-buildings",
            source: "composite",
            "source-layer": "building",
            filter: ["==", ["get", "extrude"], "true"],
            type: "fill-extrusion",
            minzoom: 14,
            paint: {
              "fill-extrusion-color": "#cbd5e1",
              "fill-extrusion-height": ["get", "height"],
              "fill-extrusion-base": ["get", "min_height"],
              "fill-extrusion-opacity": 0.55,
            },
          });
        }
      }, 700);
    });

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [
    onSelectRfx,
    onTerritoryMessage,
    onViewportChange,
    rfxGeoJson,
    releasedGeoJson,
    scheduledGeoJson,
    releasedMaskGeoJson,
    scheduledMaskGeoJson,
    selectedRfxId,
  ]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const rfxSource = map.getSource("rfx-points") as mapboxgl.GeoJSONSource | undefined;
    if (rfxSource) {
      rfxSource.setData(rfxGeoJson);
    }

    const releasedSource = map.getSource("territory-released") as mapboxgl.GeoJSONSource | undefined;
    if (releasedSource) {
      releasedSource.setData(releasedGeoJson);
    }

    const releasedMaskSource = map.getSource("territory-released-mask") as mapboxgl.GeoJSONSource | undefined;
    if (releasedMaskSource) {
      releasedMaskSource.setData(releasedMaskGeoJson);
    }

    const scheduledSource = map.getSource("territory-scheduled") as mapboxgl.GeoJSONSource | undefined;
    if (scheduledSource) {
      scheduledSource.setData(scheduledGeoJson);
    }

    const scheduledMaskSource = map.getSource("territory-scheduled-mask") as mapboxgl.GeoJSONSource | undefined;
    if (scheduledMaskSource) {
      scheduledMaskSource.setData(scheduledMaskGeoJson);
    }
  }, [rfxGeoJson, releasedGeoJson, scheduledGeoJson, releasedMaskGeoJson, scheduledMaskGeoJson]);

  const hasToken = Boolean(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN);

  if (!hasToken) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
        Add <code className="mx-1 rounded bg-slate-200 px-1 py-0.5 text-xs">NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</code>
        to enable the 3D marketplace map.
      </div>
    );
  }

  return <div ref={mapRef} className="h-full min-h-[420px] w-full rounded-2xl border border-slate-200" />;
}
