"use client";

import Link from "next/link";
import {
  Columns3,
  Download,
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
import type {
  ExchangeSurfaceMode,
  ExchangeView,
} from "../state/exchangeWorkspaceTypes";
import { ExchangeViewTabs } from "./ExchangeViewTabs";

const MODES: Array<{ mode: ExchangeSurfaceMode; label: string; icon: typeof Map }> = [
  { mode: "map", label: "Map", icon: Map },
  { mode: "list", label: "List", icon: List },
  { mode: "split", label: "Split", icon: Columns3 },
];

const SEARCH_PLACEHOLDERS = {
  intelligence: "Search industries, territories, relationships, or metrics",
  referrals: "Search referrals, partners, industries, or territories",
  opportunities: "Business name, opportunity, industry, or location",
  resources: "Search resources, providers, programs, or support",
} as const;

type CanonicalExchangeView = keyof typeof SEARCH_PLACEHOLDERS;

function canonicalView(view: ExchangeView): CanonicalExchangeView {
  if (view === "connections") return "referrals";
  if (view === "businesses" || view === "teaming") return "opportunities";
  return view as CanonicalExchangeView;
}

export function ExchangeCommandBar({
  view,
  searchQuery,
  surfaceMode,
  resultCount,
  activeFilterCount,
  filtersOpen,
  mapAvailable,
  refreshing,
  onViewChange,
  onSearchChange,
  onSurfaceModeChange,
  onOpenFilters,
  onClearFilters,
  onRefresh,
  onCreateReferral,
  onExportAnalytics,
}: {
  view: ExchangeView;
  searchQuery: string;
  surfaceMode: ExchangeSurfaceMode;
  resultCount: number;
  activeFilterCount: number;
  filtersOpen: boolean;
  mapAvailable: boolean;
  refreshing: boolean;
  onViewChange: (view: ExchangeView) => void;
  onSearchChange: (value: string) => void;
  onSurfaceModeChange: (mode: ExchangeSurfaceMode) => void;
  onOpenFilters: () => void;
  onClearFilters: () => void;
  onRefresh: () => void;
  onCreateReferral?: () => void;
  onExportAnalytics?: () => void;
}) {
  const currentView = canonicalView(view);
  const opportunityOverlay = currentView === "opportunities";

  return (
    <header className={cn(
      "relative z-30 shrink-0 border-b border-slate-700 bg-slate-950 px-3 py-2 text-white shadow-lg sm:px-4",
      opportunityOverlay && "max-lg:absolute max-lg:inset-x-0 max-lg:top-0 max-lg:border-0 max-lg:bg-transparent max-lg:py-3 max-lg:shadow-none",
      !opportunityOverlay && "max-lg:border-slate-200 max-lg:bg-white max-lg:text-slate-950",
    )}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-1 hidden min-w-fit items-center gap-2 lg:flex">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl rounded-bl-none bg-gradient-to-br from-emerald-300 to-cyan-400 text-slate-950 shadow-lg shadow-emerald-400/10">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-sm font-bold leading-4">Hi Exchange</h1>
            <p className="text-[10px] leading-4 text-slate-400">Regional business and opportunity workspace</p>
          </div>
        </div>

        <ExchangeViewTabs view={currentView} onChange={onViewChange} />

        <p className="ml-auto hidden whitespace-nowrap text-xs font-semibold text-slate-300 lg:block" aria-live="polite">
          {resultCount.toLocaleString("en-US")} result{resultCount === 1 ? "" : "s"}
        </p>

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-300 outline-none hover:bg-slate-800 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:opacity-50 lg:inline-flex"
          aria-label={refreshing ? "Refreshing Exchange data" : "Refresh Exchange data"}
          title="Refresh Exchange data"
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
        </button>

        {currentView === "opportunities" ? (
          <Link
            href="/rfx/new"
            className="hidden min-h-10 items-center gap-1.5 rounded-xl bg-emerald-300 px-3 text-xs font-bold text-slate-950 outline-none hover:bg-emerald-200 focus-visible:ring-2 focus-visible:ring-emerald-100 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 lg:inline-flex"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> Create opportunity
          </Link>
        ) : currentView === "referrals" ? (
          <button
            type="button"
            onClick={onCreateReferral}
            className="hidden min-h-10 items-center gap-1.5 rounded-xl bg-emerald-300 px-3 text-xs font-bold text-slate-950 outline-none hover:bg-emerald-200 focus-visible:ring-2 focus-visible:ring-emerald-100 lg:inline-flex"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> New referral
          </button>
        ) : currentView === "intelligence" ? (
          <button
            type="button"
            onClick={onExportAnalytics}
            className="hidden min-h-10 items-center gap-1.5 rounded-xl bg-emerald-300 px-3 text-xs font-bold text-slate-950 outline-none hover:bg-emerald-200 focus-visible:ring-2 focus-visible:ring-emerald-100 lg:inline-flex"
          >
            <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
          </button>
        ) : null}

        <Link
          href="/dashboard"
          className="hidden h-10 w-10 items-center justify-center rounded-xl text-slate-400 outline-none hover:bg-slate-800 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400 xl:inline-flex"
          aria-label="Exit Exchange to dashboard"
          title="Exit to dashboard"
        >
          <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
        </Link>

        <label className={cn(
          "order-first flex min-w-0 flex-1 basis-auto items-center rounded-xl border px-3 focus-within:ring-2 lg:order-none lg:basis-auto xl:max-w-2xl",
          "border-slate-200 bg-white shadow-lg focus-within:border-blue-500 focus-within:ring-blue-500/20",
          "lg:border-slate-700 lg:bg-slate-900 lg:shadow-none lg:focus-within:border-cyan-400 lg:focus-within:ring-cyan-400/20",
        )}>
          <Search className="mr-2 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="sr-only">Search current Exchange view</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={SEARCH_PLACEHOLDERS[currentView]}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-slate-950 outline-none placeholder:text-slate-400 lg:h-10 lg:text-white lg:placeholder:text-slate-500"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="rounded-lg p-2 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500 lg:hover:bg-slate-800 lg:hover:text-white lg:focus-visible:ring-cyan-400"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </label>

        {currentView === "opportunities" ? (
          <div className="hidden items-center rounded-xl border border-slate-700 bg-slate-900 p-1 lg:flex" role="group" aria-label="Workspace presentation">
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
                  title={disabled ? "Map service unavailable" : `${label} view`}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-cyan-400",
                    mode === "split" && "hidden xl:inline-flex",
                    surfaceMode === mode ? "bg-white text-slate-950" : "text-slate-300 hover:bg-slate-800",
                    disabled && "cursor-not-allowed opacity-40",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="hidden xl:inline">{label}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onOpenFilters}
          className={cn(
            "relative min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-lg outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-500 lg:hidden",
            opportunityOverlay ? "hidden" : "inline-flex",
          )}
          aria-label={activeFilterCount ? `Open filters, ${activeFilterCount} active` : "Open filters"}
          aria-expanded={filtersOpen}
          aria-controls="exchange-filter-drawer"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          <span className="hidden min-[380px]:inline">Filters</span>
          {activeFilterCount ? (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-700 px-1 text-[10px] font-bold text-white">{activeFilterCount}</span>
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
      </div>
    </header>
  );
}
