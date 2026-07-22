import { X } from "lucide-react";
import type { ExchangeWorkspaceState } from "../state/exchangeWorkspaceTypes";

export interface ActiveExchangeFilter {
  id: string;
  label: string;
}

export function getActiveExchangeFilters(
  state: ExchangeWorkspaceState,
): ActiveExchangeFilter[] {
  const location = state.opportunityLocation;
  return [
    ...(state.searchQuery ? [{ id: "search", label: `Search “${state.searchQuery.slice(0, 40)}”` }] : []),
    ...(location?.label ? [{ id: "location", label: `${location.label}${location.radiusMiles ? ` · ${location.radiusMiles} mi` : ""}` }] : []),
    ...state.naicsFilters.map((value) => ({ id: `naics:${value}`, label: `NAICS ${value}` })),
    ...state.industryFilters.map((value) => ({ id: `industry:${value}`, label: value })),
    ...state.capabilityFilters.map((value) => ({ id: `capability:${value}`, label: value })),
    ...state.territoryFilters.map((value) => ({ id: `territory:${value}`, label: `Territory ${value}` })),
    ...state.rfxStatusFilters.map((value) => ({ id: `rfxStatus:${value}`, label: `RFx ${value}` })),
    ...state.territoryStatusFilters.map((value) => ({ id: `territoryStatus:${value}`, label: `Territory ${value}` })),
    ...state.opportunityTypeFilters.map((value) => ({ id: `opportunityType:${value}`, label: value.replaceAll("_", " ") })),
    ...state.rfxTypeFilters.map((value) => ({ id: `rfxType:${value}`, label: value })),
    ...state.buyerTypeFilters.map((value) => ({ id: `buyerType:${value}`, label: `${value} buyer` })),
    ...state.workArrangementFilters.map((value) => ({ id: `work:${value}`, label: value.replaceAll("_", " ") })),
    ...state.visibilityFilters.map((value) => ({ id: `visibility:${value}`, label: value })),
    ...state.certificationFilters.map((value) => ({ id: `certification:${value}`, label: value })),
    ...state.setAsideFilters.map((value) => ({ id: `setAside:${value}`, label: value })),
    ...state.primeClassificationFilters.map((value) => ({ id: `prime:${value}`, label: value })),
    ...state.awardClassificationFilters.map((value) => ({ id: `award:${value}`, label: `${value} award` })),
    ...state.personalizedFilters.map((value) => ({ id: `personalized:${value}`, label: value.replaceAll("_", " ") })),
    ...(state.closingSoon ? [{ id: "closingSoon", label: "Closing soon" }] : []),
    ...(state.teamingSuitable ? [{ id: "teamingSuitable", label: "Teaming suitable" }] : []),
    ...(state.budgetMin !== undefined ? [{ id: "budgetMin", label: `From $${state.budgetMin.toLocaleString("en-US")}` }] : []),
    ...(state.budgetMax !== undefined ? [{ id: "budgetMax", label: `To $${state.budgetMax.toLocaleString("en-US")}` }] : []),
    ...(!state.localFirst ? [{ id: "localFirst", label: "Released-first off" }] : []),
  ];
}

export function getActiveExchangeFilterLabels(state: ExchangeWorkspaceState): string[] {
  return getActiveExchangeFilters(state).map(({ label }) => label);
}

export function ExchangeActiveFilters({
  state,
  onClear,
  onRemove,
}: {
  state: ExchangeWorkspaceState;
  onClear: () => void;
  onRemove?: (filter: ActiveExchangeFilter) => void;
}) {
  const filters = getActiveExchangeFilters(state);
  if (!filters.length) return null;
  const visible = filters.slice(0, 4);
  const hiddenCount = Math.max(0, filters.length - visible.length);
  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-slate-200 bg-white/92 px-3 py-1.5 backdrop-blur-xl" aria-label="Active Exchange filters">
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-600">Active</span>
      {visible.map((filter) => (
        <span key={filter.id} className="inline-flex min-h-8 shrink-0 items-center rounded-full bg-indigo-50 pl-2.5 text-[11px] font-semibold text-indigo-700">
          {filter.label}
          {onRemove ? (
            <button
              type="button"
              onClick={() => onRemove(filter)}
              className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full outline-none hover:bg-indigo-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
              aria-label={`Remove ${filter.label} filter`}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : <span className="pr-2.5" />}
        </span>
      ))}
      {hiddenCount ? (
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">+{hiddenCount} more</span>
      ) : null}
      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[11px] font-bold text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear all
      </button>
    </div>
  );
}
