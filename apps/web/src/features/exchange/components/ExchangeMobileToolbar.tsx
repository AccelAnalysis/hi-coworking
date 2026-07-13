"use client";

import { LocateFixed, SlidersHorizontal } from "lucide-react";

export function ExchangeMobileToolbar({
  resultCount,
  activeFilterCount,
  filtersOpen,
  mapVisible,
  onOpenFilters,
  onFitResults,
}: {
  resultCount: number;
  activeFilterCount: number;
  filtersOpen: boolean;
  mapVisible: boolean;
  onOpenFilters: () => void;
  onFitResults: () => void;
}) {
  return (
    <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-4.5rem)] items-center gap-2 lg:hidden">
      <span className="rounded-full border border-slate-200 bg-white/95 px-3 py-2 text-xs font-bold text-slate-700 shadow-lg backdrop-blur">
        {resultCount} result{resultCount === 1 ? "" : "s"}
      </span>
      <div className="flex gap-2">
        {mapVisible ? (
          <button
            type="button"
            onClick={onFitResults}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-200 bg-white/95 px-3 text-xs font-bold text-slate-700 shadow-lg outline-none backdrop-blur hover:bg-white focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <LocateFixed className="h-4 w-4" aria-hidden="true" /> Fit
          </button>
        ) : null}
        <button
          type="button"
            onClick={onOpenFilters}
            aria-expanded={filtersOpen}
            aria-controls="exchange-filter-drawer"
          className="relative inline-flex min-h-11 items-center gap-1.5 rounded-full bg-slate-950 px-3 text-xs font-bold text-white shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filters
          {activeFilterCount ? <span className="rounded-full bg-cyan-300 px-1.5 py-0.5 text-[10px] text-slate-950">{activeFilterCount}</span> : null}
        </button>
      </div>
    </div>
  );
}
