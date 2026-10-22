"use client";
import { useEffect, useState } from "react";
import type { FloorplanElement, FloorDoc, LayoutVariant } from "@hi/shared";
import { getLocations, getFloors, getShell, getPublishedLayouts } from "@/lib/firestore";
import { layoutForBooking } from "@/lib/bookingCatalog";

type MapData = { floor: FloorDoc; shell: FloorplanElement[]; layouts: LayoutVariant[] };
export function PublishedBookingMap({ timestamp, resourceType, selectedResource, availability, onSelect }: {
  timestamp: number; resourceType: "SEAT" | "MODE_ZONE"; selectedResource: string | null;
  availability: Array<{ resourceId: string; available: boolean }>;
  onSelect: (resourceId: string) => void;
}) {
  const [maps, setMaps] = useState<MapData[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void (async () => {
      const locations = await getLocations();
      const results = await Promise.all(locations.map(async (location) => {
        const floors = await getFloors(location.id);
        return Promise.all(floors.map(async (floor) => {
          const [shell, layouts] = await Promise.all([getShell(location.id, floor.id), getPublishedLayouts(location.id, floor.id)]);
          return { floor, shell: shell?.elements ?? [], layouts };
        }));
      }));
      if (active) setMaps(results.flat());
    })().catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  if (loading) return <p className="mt-4 text-sm text-slate-500">Loading published floor plans…</p>;
  if (error) return <p className="mt-4 text-sm text-amber-800">Floor plan unavailable. You can still choose from the live availability list below.</p>;
  const visible = maps.map((map) => ({ ...map, layout: layoutForBooking(map.layouts, timestamp) })).filter((map) => map.layout?.elements.some((item) => item.type === resourceType && item.resourceId));
  if (!visible.length) return <p className="mt-4 text-sm text-slate-500">No published floor plan applies to this start time. Use the live availability list; no sample floor plan is substituted.</p>;
  return <div className="mt-5 space-y-4">{visible.map(({ floor, shell, layout }) => <div key={`${floor.locationId}:${floor.id}`} className="rounded-xl border border-slate-200 p-3">
    <p className="text-sm font-semibold">{floor.name} · {layout!.name}</p>
    <p className="mt-1 text-xs text-slate-500">Layout for the selected start time. Choose a preference, then check availability for your entire stay. This is not a reservation.</p>
    <svg viewBox={`0 0 ${floor.canvasWidth} ${floor.canvasHeight}`} className="mt-3 max-h-96 w-full" aria-label={`${floor.name} published floor plan`}>
      {[...shell, ...layout!.elements].filter((element) => element.visible !== false).map((element) => {
        const selectable = element.type === resourceType && Boolean(element.resourceId);
        const option = availability.find((item) => item.resourceId === element.resourceId);
        const unavailable = option?.available === false;
        const selected = element.resourceId === selectedResource;
        const label = `${element.label || element.resourceId || element.type}${unavailable ? " — unavailable" : selected ? " — selected preference" : ""}`;
        return <g key={element.id} transform={`translate(${element.x} ${element.y}) rotate(${element.rotation || 0})`} role={selectable ? "button" : undefined} tabIndex={selectable && !unavailable ? 0 : undefined} aria-label={selectable ? label : undefined} aria-disabled={selectable ? unavailable : undefined} onClick={() => { if (selectable && !unavailable) onSelect(element.resourceId!); }} onKeyDown={(event) => { if (selectable && !unavailable && ["Enter", " "].includes(event.key)) { event.preventDefault(); onSelect(element.resourceId!); } }} style={{ cursor: selectable && !unavailable ? "pointer" : undefined }}>
          {element.shape === "LINE" || element.shape === "POLY" ? <polyline points={(element.points ?? []).reduce<string[]>((points, value, index, all) => index % 2 ? points : [...points, `${value},${all[index + 1] ?? 0}`], []).join(" ")} fill={element.shape === "POLY" ? element.fill || "#f1f5f9" : "none"} stroke={element.stroke || "#cbd5e1"} strokeWidth={element.strokeWidth || 2} /> : element.shape === "TEXT" ? null : <rect width={element.width} height={element.height} rx={selectable ? 5 : 0} fill={selected ? "#0f172a" : unavailable ? "#e2e8f0" : selectable ? "#d1fae5" : element.fill || "#f1f5f9"} stroke={selectable ? "#64748b" : "#cbd5e1"} />}
          {element.label && <text x={element.width / 2} y={element.height / 2} textAnchor="middle" dominantBaseline="middle" fontSize={12} fill={selected ? "white" : "#334155"}>{element.label}</text>}
        </g>;
      })}
    </svg>
  </div>)}</div>;
}
