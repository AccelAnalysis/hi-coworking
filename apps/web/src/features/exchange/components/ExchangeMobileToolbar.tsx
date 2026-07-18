"use client";

import { LocateFixed } from "lucide-react";

export function ExchangeMobileToolbar({
  resultCount,
  mapVisible,
  onFitResults,
}: {
  resultCount: number;
  mapVisible: boolean;
  onFitResults: () => void;
  /** Retained temporarily for call-site compatibility; filters live in the shared command bar. */
  activeFilterCount?: number;
  filtersOpen?: boolean;
  onOpenFilters?: () => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-30 lg:hidden">
      <span className="pointer-events-auto inline-flex rounded-full border border-white/70 bg-white/78 px-3 py-1.5 text-[10px] font-bold text-slate-600 shadow-lg backdrop-blur-xl">
        {resultCount.toLocaleString("en-US")} visible result{resultCount === 1 ? "" : "s"}
      </span>
      {mapVisible ? (
        <button
          type="button"
          onClick={onFitResults}
          data-exchange-map-control="fit-results"
          className="pointer-events-auto absolute right-0 top-[5.75rem] flex h-11 w-11 items-center justify-center rounded-xl border border-white/70 bg-white/78 text-blue-700 shadow-lg outline-none backdrop-blur-xl hover:bg-white/95 focus-visible:ring-2 focus-visible:ring-blue-600"
          aria-label="Return map to visible results"
          title="Fit visible results"
        >
          <LocateFixed className="h-5 w-5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
