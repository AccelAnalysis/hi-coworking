"use client";

import { Layers3, LocateFixed } from "lucide-react";

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
    <div className="pointer-events-none absolute inset-x-3 top-[4.65rem] z-20 flex items-start justify-between lg:hidden">
      <span className="pointer-events-auto rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-[10px] font-bold text-slate-600 shadow-lg backdrop-blur">
        {resultCount.toLocaleString("en-US")} visible result{resultCount === 1 ? "" : "s"}
      </span>
      <div className="pointer-events-auto flex flex-col gap-2">
        <button
          type="button"
          onClick={onOpenFilters}
          aria-expanded={filtersOpen}
          aria-controls="exchange-filter-drawer"
          className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-blue-700 shadow-lg outline-none backdrop-blur hover:bg-white focus-visible:ring-2 focus-visible:ring-blue-600"
          aria-label={activeFilterCount ? `Map layers and filters, ${activeFilterCount} active` : "Map layers and filters"}
          title="Layers and filters"
        >
          <Layers3 className="h-5 w-5" aria-hidden="true" />
          {activeFilterCount ? <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-700 px-1 text-[9px] font-black text-white">{activeFilterCount}</span> : null}
        </button>
        {mapVisible ? (
          <button
            type="button"
            onClick={onFitResults}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-blue-700 shadow-lg outline-none backdrop-blur hover:bg-white focus-visible:ring-2 focus-visible:ring-blue-600"
            aria-label="Return map to visible results"
            title="Fit visible results"
          >
            <LocateFixed className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
