import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExchangeFilterUpdate } from "../state/exchangeWorkspaceActions";
import {
  EXCHANGE_CONNECTION_MODES,
  EXCHANGE_REFERRAL_STATUSES,
  type ExchangeConnectionMode,
  type ExchangeWorkspaceState,
} from "../state/exchangeWorkspaceTypes";

const MODE_LABELS: Record<ExchangeConnectionMode, string> = {
  sent: "Sent",
  received: "Received",
  draft: "Drafts",
  active: "Active",
  converted: "Converted",
  closed: "Closed",
  disputed: "Disputed",
};

const STATUS_LABELS: Record<(typeof EXCHANGE_REFERRAL_STATUSES)[number], string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  in_progress: "In progress",
  converted: "Converted",
  closed: "Closed",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

export function ConnectionModeTabs({
  mode,
  counts,
  onChange,
}: {
  mode: ExchangeConnectionMode;
  counts: Record<ExchangeConnectionMode, number>;
  onChange: (mode: ExchangeConnectionMode) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto p-2 [scrollbar-width:none]" role="group" aria-label="Referral direction and lifecycle">
      {EXCHANGE_CONNECTION_MODES.map((candidate) => (
        <button
          key={candidate}
          type="button"
          onClick={() => onChange(candidate)}
          aria-pressed={mode === candidate}
          className={cn(
            "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
            mode === candidate
              ? "bg-slate-950 text-white"
              : "bg-white text-slate-600 hover:bg-slate-100",
          )}
        >
          {MODE_LABELS[candidate]}
          <span className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px]",
            mode === candidate ? "bg-white/20 text-white" : "bg-slate-200 text-slate-600",
          )}>{counts[candidate]}</span>
        </button>
      ))}
    </div>
  );
}

export function ConnectionsFilters({
  state,
  industries,
  territories,
  onChange,
  onClear,
}: {
  state: ExchangeWorkspaceState;
  industries: string[];
  territories: Array<{ value: string; label: string }>;
  onChange: (update: ExchangeFilterUpdate) => void;
  onClear: () => void;
}) {
  const toggle = (values: string[], value: string) =>
    values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <h2 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-600">Referral filters</h2>
        </div>
        <button type="button" onClick={onClear} className="text-xs font-bold text-indigo-700 underline-offset-2 hover:underline">Clear</button>
      </div>

      <fieldset>
        <legend className="text-xs font-bold text-slate-700">Lifecycle status</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {EXCHANGE_REFERRAL_STATUSES.map((status) => (
            <label key={status} className="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={state.referralStatusFilters.includes(status)}
                onChange={() => onChange({
                  referralStatusFilters: toggle(state.referralStatusFilters, status) as typeof state.referralStatusFilters,
                })}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              {STATUS_LABELS[status]}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="connection-industry" className="text-xs font-bold text-slate-700">Industry or capability</label>
        <select
          id="connection-industry"
          value={state.connectionIndustryFilters[0] ?? ""}
          onChange={(event) => onChange({ connectionIndustryFilters: event.target.value ? [event.target.value] : [] })}
          className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All industries</option>
          {industries.map((industry) => <option key={industry} value={industry}>{industry}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="connection-territory" className="text-xs font-bold text-slate-700">Territory</label>
        <select
          id="connection-territory"
          value={state.connectionTerritoryFilters[0] ?? ""}
          onChange={(event) => onChange({ connectionTerritoryFilters: event.target.value ? [event.target.value] : [] })}
          className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All territories</option>
          {territories.map((territory) => <option key={territory.value} value={territory.value}>{territory.label}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="connection-compensation" className="text-xs font-bold text-slate-700">Compensation policy</label>
        <select
          id="connection-compensation"
          value={state.compensationFilter}
          onChange={(event) => onChange({ compensationFilter: event.target.value as ExchangeFilterUpdate["compensationFilter"] })}
          className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">All referrals</option>
          <option value="configured">Compensation configured</option>
          <option value="none">No compensation</option>
        </select>
      </div>

      <div>
        <label htmlFor="connection-relationship" className="text-xs font-bold text-slate-700">Relationship</label>
        <select
          id="connection-relationship"
          value={state.relationshipFilter}
          onChange={(event) => onChange({ relationshipFilter: event.target.value as ExchangeFilterUpdate["relationshipFilter"] })}
          className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="all">All relationships</option>
          <option value="new">New</option>
          <option value="active">Active</option>
          <option value="established">Established</option>
          <option value="trusted">Trusted</option>
          <option value="review_required">Review required</option>
        </select>
      </div>
    </div>
  );
}
