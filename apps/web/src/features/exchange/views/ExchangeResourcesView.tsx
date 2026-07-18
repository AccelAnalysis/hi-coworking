"use client";

import { useMemo, useState } from "react";
import {
  BadgeDollarSign,
  BookOpenText,
  BriefcaseBusiness,
  GraduationCap,
  Landmark,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ExchangeCommandBar } from "../components/ExchangeCommandBar";
import { ExchangeContextMap } from "../components/ExchangeContextMap";
import { ExchangeMobileDrawer } from "../components/ExchangeMobileDrawer";
import { exchangeWorkspaceActions } from "../state/exchangeWorkspaceActions";
import type { ExchangeViewProps } from "./exchangeViewTypes";

const RESOURCE_CATEGORIES = [
  {
    id: "business-support",
    title: "Business formation and operating support",
    description: "Registration, compliance, planning, technical assistance, and business-development guidance.",
    icon: BriefcaseBusiness,
  },
  {
    id: "procurement",
    title: "Procurement and supplier readiness",
    description: "Certification, capability development, contracting assistance, and buyer-readiness resources.",
    icon: Landmark,
  },
  {
    id: "workforce",
    title: "Workforce and training",
    description: "Recruiting, incumbent-worker training, apprenticeships, and employer-led talent programs.",
    icon: GraduationCap,
  },
  {
    id: "capital-sites",
    title: "Capital, incentives, and site support",
    description: "Financing preparation, incentive navigation, location support, and expansion assistance.",
    icon: BadgeDollarSign,
  },
] as const;

type ResourceCategoryId = (typeof RESOURCE_CATEGORIES)[number]["id"];

export function ExchangeResourcesView({
  state,
  applyAction,
  scheduleUrlReplace,
  onViewChange,
  demoMode,
}: ExchangeViewProps & { demoMode: boolean }) {
  const [selectedCategory, setSelectedCategory] = useState<ResourceCategoryId | "all">("all");
  const [refreshing, setRefreshing] = useState(false);
  const normalizedQuery = state.searchQuery.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () => RESOURCE_CATEGORIES.filter((record) => (
      (selectedCategory === "all" || record.id === selectedCategory)
      && (!normalizedQuery
        || record.title.toLocaleLowerCase().includes(normalizedQuery)
        || record.description.toLocaleLowerCase().includes(normalizedQuery))
    )),
    [normalizedQuery, selectedCategory],
  );
  const activeFilterCount = selectedCategory === "all" ? 0 : 1;

  const clearFilters = () => {
    setSelectedCategory("all");
    applyAction(exchangeWorkspaceActions.setSearch(""), "push");
  };

  const refresh = () => {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 350);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">
      <ExchangeCommandBar
        view="resources"
        searchQuery={state.searchQuery}
        surfaceMode={state.surfaceMode}
        resultCount={filtered.length}
        activeFilterCount={activeFilterCount}
        filtersOpen={state.mobileFilterOpen}
        mapAvailable
        refreshing={refreshing}
        onViewChange={onViewChange}
        onSearchChange={(value) => {
          applyAction(exchangeWorkspaceActions.setSearch(value));
          scheduleUrlReplace(200);
        }}
        onSurfaceModeChange={(mode) => applyAction(exchangeWorkspaceActions.setSurfaceMode(mode), "push")}
        onOpenFilters={() => applyAction(exchangeWorkspaceActions.openMobileFilter())}
        onClearFilters={clearFilters}
        onRefresh={refresh}
      />

      <div className="grid min-h-0 flex-1 lg:grid-cols-[22rem_minmax(0,1fr)_20rem]">
        <aside className="min-h-0 overflow-y-auto border-r border-slate-200 bg-white" aria-label="Resource categories">
          <div className="border-b border-slate-200 p-4">
            <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">
              <BookOpenText className="h-4 w-4" aria-hidden="true" /> Resource exchange
            </p>
            <h1 className="mt-2 text-xl font-black tracking-tight text-slate-950">Economic-development resources</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Browse support by need while verified provider and program records are connected to the launch-market map.
            </p>
          </div>
          <div className="grid gap-2 p-3">
            {filtered.length ? filtered.map((record) => {
              const Icon = record.icon;
              const active = selectedCategory === record.id;
              return (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => setSelectedCategory(active ? "all" : record.id)}
                  className={cn(
                    "rounded-2xl border p-4 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-blue-600",
                    active
                      ? "border-blue-600 bg-blue-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                  )}
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-blue-700">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="mt-3 block text-sm font-black text-slate-950">{record.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-slate-600">{record.description}</span>
                </button>
              );
            }) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-600">
                No resource categories match this search.
              </div>
            )}
          </div>
        </aside>

        <main className="hidden min-h-0 min-w-0 lg:block" aria-label="Resource geography">
          <ExchangeContextMap view="resources" demoMode={demoMode} />
        </main>

        <aside className="hidden min-h-0 overflow-y-auto border-l border-slate-200 bg-white p-5 lg:block" aria-label="Resource detail">
          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-700">Selected resource lens</p>
          <h2 className="mt-2 text-lg font-black text-slate-950">
            {selectedCategory === "all"
              ? "All resource categories"
              : RESOURCE_CATEGORIES.find((record) => record.id === selectedCategory)?.title}
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            The map is now a real geographic surface. It shows launch-market territory context immediately and will add provider or program markers only when records contain verified coordinates.
          </p>
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
            This view no longer represents a decorative map as live functionality. Records without verified geography remain list-only until enriched.
          </div>
        </aside>
      </div>

      <ExchangeMobileDrawer
        open={state.mobileFilterOpen}
        activeFilterCount={activeFilterCount}
        onClose={() => applyAction(exchangeWorkspaceActions.closeMobileFilter())}
        onClear={clearFilters}
      >
        <div className="space-y-2 p-4">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-600">Resource categories</p>
          <button
            type="button"
            onClick={() => setSelectedCategory("all")}
            className={cn("min-h-11 w-full rounded-xl border px-3 text-left text-sm font-bold", selectedCategory === "all" ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-700")}
          >
            All categories
          </button>
          {RESOURCE_CATEGORIES.map((record) => (
            <button
              key={record.id}
              type="button"
              onClick={() => setSelectedCategory(record.id)}
              className={cn("min-h-11 w-full rounded-xl border px-3 text-left text-sm font-bold", selectedCategory === record.id ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-700")}
            >
              {record.title}
            </button>
          ))}
        </div>
      </ExchangeMobileDrawer>
    </div>
  );
}
