"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const position: [number, number] = [36.92904282704385, -76.52067450742162];

export function MapComponent() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current).setView(position, 15);
    mapInstanceRef.current = map;

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
      }
    ).addTo(map);

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
          <a href="https://www.google.com/maps/dir/?api=1&destination=${position[0]},${position[1]}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:6px;padding:4px 12px;background:#0f172a;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;">Get Directions</a>
        </div>`
      );

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  return (
    <div
      ref={mapRef}
      className="w-full h-64 md:h-80 rounded-2xl overflow-hidden shadow-xl shadow-slate-200/50 border border-white/20"
    />
  );
}
