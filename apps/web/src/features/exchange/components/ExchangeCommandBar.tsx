"use client";

import Link from "next/link";
import {
  Columns3,
  LayoutDashboard,
  List,
  Map,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExchangeSurfaceMode } from "../state/exchangeWorkspaceTypes";

const MODES: Array<{ mode: ExchangeSurfaceMode; label: string; icon: typeof Map }> = [
  { mode: "map", label: "Map", icon: Map },
  { mode: "list", label: "List", icon: List },
  { mode: "split", label: "Split", icon: Columns3 },
];

export function ExchangeCommandBar({
  searchQuery,
  surfaceMode,
  resultCount,
  activeFilterCount,
  filtersOpen,
  mapAvailable,
  refreshing,
  onSearchChange,
  onSurfaceModeChange,
  onOpenFilters,
  onClearFilters,
  onRefresh,
}: {
  searchQuery: string;
  surfaceMode: ExchangeSurfaceMode;
  resultCount: number;
  activeFilterCount: number;
  filtersOpen: boolean;
  mapAvailable: boolean;
  refreshing: boolean;
  onSearchChange: (value: string) => void;
  onSurfaceModeChange: (mode: ExchangeSurfaceMode) => void;
  onOpenFilters: () => void;
  onClearFilters: () => void;
  onRefresh: () => void;
}) {
  return (
    <header className="relative z-30 shrink-0 border-b border-slate-700 bg-slate-950 px-3 py-2 text-white shadow-lg sm:px-4">
      <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
        <div className="mr-1 flex min-w-fit items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl rounded-bl-none bg-gradient-to-br from-emerald-300 to-cyan-400 text-slate-950 shadow-lg shadow-emerald-400/10">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h1 className="sr-only font-bold sm:not-sr-only sm:text-sm sm:leading-4">Hi Exchange</h1>
            <p className="hidden text-[10px] leading-4 text-slate-400 sm:block">Regional business and opportunity workspace</p>
          </div>
        </div>

        <label className="order-3 flex min-w-0 basis-full items-center rounded-xl border border-slate-700 bg-slate-900 px-3 focus-within:border-cyan-400 focus-within:ring-2 focus-within:ring-cyan-400/20 sm:order-none sm:basis-auto sm:flex-1 xl:max-w-2xl">
          <Search className="mr-2 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Search Exchange records</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search RFx, NAICS, or territory"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="rounded-lg p-2 text-slate-400 outline-none hover:bg-slate-800 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </label>

        <p className="ml-auto whitespace-nowrap text-xs font-semibold text-slate-300" aria-live="polite">
          {resultCount.toLocaleString("en-US")} result{resultCount === 1 ? "" : "s"}
        </p>

        <div className="flex items-center rounded-xl border border-slate-700 bg-slate-900 p-1" role="group" aria-label="Workspace presentation">
          {MODES.map(({ mode, label, icon: Icon }) => {
            const disabled = !mapAvailable && mode !== "list";
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onSurfaceModeChange(mode)}
                disabled={disabled}
                aria-pressed={surfaceMode === mode}
                aria-label={`${label} view`}
                title={disabled ? "Mapbox token required" : `${label} view`}
                className={cn(
                  "inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-400 sm:min-h-9",
                  mode === "split" && "hidden lg:inline-flex",
                  surfaceMode === mode ? "bg-white text-slate-950" : "text-slate-300 hover:bg-slate-800",
                  disabled && "cursor-not-allowed opacity-40",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden md:inline">{label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onOpenFilters}
          className="relative inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-slate-200 outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-cyan-400 lg:hidden"
          aria-label={activeFilterCount ? `Open filters, ${activeFilterCount} active` : "Open filters"}
          aria-expanded={filtersOpen}
          aria-controls="exchange-filter-drawer"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filters
          {activeFilterCount ? (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan-300 px-1 text-[10px] font-bold text-slate-950">{activeFilterCount}</span>
          ) : null}
        </button>

        {activeFilterCount ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="hidden min-h-10 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-slate-300 outline-none hover:bg-slate-800 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400 xl:inline-flex"
          >
            Clear
          </button>
        ) : null}

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 outline-none hover:bg-slate-800 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50 sm:h-10 sm:w-10"
          aria-label={refreshing ? "Refreshing Exchange data" : "Refresh Exchange data"}
          title="Refresh Exchange data"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
        </button>

        <Link
          href="/rfx/new"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-emerald-300 px-3 text-xs font-bold text-slate-950 outline-none hover:bg-emerald-200 focus-visible:ring-2 focus-visible:ring-emerald-100 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Create RFx</span>
          <span className="sm:hidden">Create</span>
        </Link>

        <Link
          href="/dashboard"
          className="hidden h-10 w-10 items-center justify-center rounded-xl text-slate-400 outline-none hover:bg-slate-800 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400 xl:inline-flex"
          aria-label="Exit Exchange to dashboard"
          title="Exit to dashboard"
        >
          <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
