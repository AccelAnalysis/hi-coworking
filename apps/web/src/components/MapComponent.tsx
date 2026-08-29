"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const position: [number, number] = [36.92904282704385, -76.52067450742162];
const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${position[0]},${position[1]}`;

export function MapComponent() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const tileUrl = process.env.NEXT_PUBLIC_OPENSTREETMAP_TILE_URL?.trim();

  useEffect(() => {
    if (!tileUrl || !mapRef.current || mapInstanceRef.current) return;

    let map: L.Map | null = null;

    try {
      map = L.map(mapRef.current).setView(position, 15);
      mapInstanceRef.current = map;

      L.tileLayer(tileUrl, {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 20,
      }).addTo(map);

      const customIcon = L.icon({
        iconUrl: "/images/hi_map_marker.svg",
        iconSize: [32, 41],
        iconAnchor: [16, 41],
        popupAnchor: [0, -41],
      });

      L.marker(position, { icon: customIcon })
        .addTo(map)
        .bindPopup(
          `<div style="text-align:center;font-family:sans-serif;">
            <strong>Hi Coworking</strong><br/>Carrollton, VA<br/>
            <a href="${directionsUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:6px;padding:4px 12px;background:#0f172a;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;">Get Directions</a>
          </div>`
        );
    } catch (error) {
      console.error("Hi Coworking map could not be initialized", error);
      map?.remove();
      mapInstanceRef.current = null;
      setMapFailed(true);
    }

    return () => {
      map?.remove();
      mapInstanceRef.current = null;
    };
  }, [tileUrl]);

  if (!tileUrl || mapFailed) {
    return (
      <div className="flex h-64 w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 px-6 text-center shadow-xl shadow-slate-200/40 md:h-80">
        <div>
          <p className="text-sm font-semibold text-slate-900">Hi Coworking</p>
          <p className="mt-1 text-sm text-slate-500">Carrollton, Virginia</p>
          <a
            href={directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Get directions
          </a>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={mapRef}
      className="h-64 w-full overflow-hidden rounded-2xl border border-white/20 shadow-xl shadow-slate-200/50 md:h-80"
    />
  );
}
