"use client";

import { useEffect, useState } from "react";
import type { TerritoryDoc } from "@hi/shared";
import { MapPinned, RotateCcw, Tags } from "lucide-react";
import type { ExchangeTerritoryStatus } from "../state/exchangeWorkspaceTypes";
import { parseExchangeNaicsDraft } from "../utils/filtering";

export function ExchangeFilters({
  territories,
  naicsFilters,
  territoryFilters,
  territoryStatusFilters,
  localFirst,
  activeFilterCount,
  onNaicsChange,
  onTerritoryChange,
  onTerritoryStatusChange,
  onLocalFirstChange,
  onClear,
}: {
  territories: TerritoryDoc[];
  naicsFilters: string[];
  territoryFilters: string[];
  territoryStatusFilters: ExchangeTerritoryStatus[];
  localFirst: boolean;
  activeFilterCount: number;
  onNaicsChange: (values: string[]) => void;
  onTerritoryChange: (values: string[]) => void;
  onTerritoryStatusChange: (values: ExchangeTerritoryStatus[]) => void;
  onLocalFirstChange: (value: boolean) => void;
  onClear: () => void;
}) {
  const [naicsDraft, setNaicsDraft] = useState(() => naicsFilters.join(", "));

  useEffect(() => {
    setNaicsDraft(naicsFilters.join(", "));
  }, [naicsFilters]);

  const commitNaicsDraft = () => {
    const codes = parseExchangeNaicsDraft(naicsDraft);
    setNaicsDraft(codes.join(", "));
    onNaicsChange(codes);
  };

  const toggleTerritoryStatus = (status: ExchangeTerritoryStatus) => {
    onTerritoryStatusChange(
      territoryStatusFilters.includes(status)
        ? territoryStatusFilters.filter((value) => value !== status)
        : [...territoryStatusFilters, status],
    );
  };

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-950">Discovery filters</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">{activeFilterCount ? `${activeFilterCount} active` : "Showing all current records"}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={activeFilterCount === 0}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Clear
        </button>
      </div>

      <label className="block">
        <span className="mb-1.5 flex items-center gap-2 text-xs font-bold text-slate-700">
          <Tags className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> NAICS codes
        </span>
        <input
          type="text"
          value={naicsDraft}
          onChange={(event) => setNaicsDraft(event.target.value)}
          onBlur={commitNaicsDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitNaicsDraft();
            }
          }}
          placeholder="e.g. 541330, 236220"
          aria-describedby="exchange-naics-help"
          className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        />
        <span id="exchange-naics-help" className="mt-1 block text-[10px] leading-4 text-slate-500">
          Separate 2–6 digit codes with commas or spaces, then press Enter.
        </span>
      </label>

      <label className="block">
        <span className="mb-1.5 flex items-center gap-2 text-xs font-bold text-slate-700">
          <MapPinned className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" /> Territory
        </span>
        <select
          value={territoryFilters[0] || ""}
          onChange={(event) => onTerritoryChange(event.target.value ? [event.target.value] : [])}
          className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        >
          <option value="">All territories</option>
          {territories.map((territory) => (
            <option key={territory.fips} value={territory.fips}>{territory.name} ({territory.status})</option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend className="text-xs font-bold text-slate-700">Territory status</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["released", "scheduled"] as const).map((status) => (
            <label key={status} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold capitalize text-slate-700 hover:bg-slate-50">
              <input
                type="checkbox"
                checked={territoryStatusFilters.includes(status)}
                onChange={() => toggleTerritoryStatus(status)}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              {status}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <input
          type="checkbox"
          checked={localFirst}
          onChange={(event) => onLocalFirstChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        <span>
          <span className="block text-xs font-bold text-slate-800">Released territories first</span>
          <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">Prioritize RFx associated with currently released territories. This is ranking only, not member locality or an eligibility decision.</span>
        </span>
      </label>
    </div>
  );
}
