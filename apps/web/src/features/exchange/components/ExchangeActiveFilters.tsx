import { X } from "lucide-react";
import type { ExchangeWorkspaceState } from "../state/exchangeWorkspaceTypes";

export function getActiveExchangeFilterLabels(state: ExchangeWorkspaceState): string[] {
  return [
    ...(state.searchQuery ? [`Search “${state.searchQuery.slice(0, 40)}”`] : []),
    ...state.naicsFilters.map((value) => `NAICS ${value}`),
    ...state.territoryFilters.map((value) => `Territory ${value}`),
    ...state.rfxStatusFilters.map((value) => `RFx ${value}`),
    ...state.territoryStatusFilters.map((value) => `Territory ${value}`),
    ...(!state.localFirst ? ["Released-first ranking off"] : []),
  ];
}

export function ExchangeActiveFilters({ state, onClear }: { state: ExchangeWorkspaceState; onClear: () => void }) {
  const labels = getActiveExchangeFilterLabels(state);
  if (!labels.length) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-1.5" aria-label="Active Exchange filters">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">Active</span>
      {labels.map((label) => (
        <span key={label} className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700">{label}</span>
      ))}
      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-bold text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
      </button>
    </div>
  );
}
