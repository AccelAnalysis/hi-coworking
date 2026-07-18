"use client";

import Link from "next/link";
import { ChevronUp, List, Map, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExchangeSurfaceMode } from "../state/exchangeWorkspaceTypes";

export function ExchangeMobileOpportunityTray({
  surfaceMode,
  onSurfaceModeChange,
}: {
  surfaceMode: ExchangeSurfaceMode;
  onSurfaceModeChange: (mode: ExchangeSurfaceMode) => void;
}) {
  const listVisible = surfaceMode === "list";

  return (
    <section
      className={cn(
        "absolute inset-x-0 bottom-[4.75rem] z-40 rounded-t-[1.5rem] border-t border-slate-200 bg-white shadow-[0_-14px_35px_rgba(15,23,42,0.18)] transition-all lg:hidden",
        listVisible ? "h-[7.8rem]" : "h-[10.5rem]",
      )}
      aria-label="Opportunity list controls"
    >
      <button
        type="button"
        onClick={() => onSurfaceModeChange(listVisible ? "map" : "list")}
        className="flex h-6 w-full items-center justify-center rounded-t-[1.5rem] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
        aria-label={listVisible ? "Return to map view" : "Open full list view"}
      >
        <span className="h-1.5 w-14 rounded-full bg-slate-400" />
      </button>

      <div className="flex items-center justify-between border-b border-slate-200 px-4 pb-2">
        <button
          type="button"
          className="inline-flex min-h-9 items-center gap-1 text-xs font-bold text-blue-700"
          title="Default Exchange ranking"
        >
          Sort: Default <ChevronUp className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onSurfaceModeChange(listVisible ? "map" : "list")}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-blue-700 outline-none hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {listVisible ? <Map className="h-4 w-4" aria-hidden="true" /> : <List className="h-4 w-4" aria-hidden="true" />}
          {listVisible ? "Map View" : "List View"}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1 px-3 py-2">
        <button
          type="button"
          onClick={() => onSurfaceModeChange("map")}
          className={cn(
            "min-h-10 rounded-lg border px-1 text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-blue-600",
            !listVisible ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600",
          )}
        >
          Search
        </button>
        <Link
          href="/rfx/new"
          className="flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-1 text-center text-[10px] font-bold text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          Post Opportunity
        </Link>
        <Link
          href="/rfx/manage"
          className="flex min-h-10 items-center justify-center rounded-lg border border-slate-200 px-1 text-center text-[10px] font-bold text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          My Opportunities
        </Link>
        <Link
          href="/profile"
          className="flex min-h-10 items-center justify-center gap-1 rounded-lg border border-slate-200 px-1 text-center text-[10px] font-bold text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          <Star className="h-3.5 w-3.5" aria-hidden="true" /> Starred
        </Link>
      </div>
    </section>
  );
}
