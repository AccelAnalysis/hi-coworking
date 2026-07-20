"use client";

import { useEffect, useMemo, useState } from "react";
import type { TerritoryDoc } from "@hi/shared";
import type { OpportunitySort } from "@hi/shared/opportunity-discovery";
import {
  BadgeCheck,
  BriefcaseBusiness,
  CalendarClock,
  DollarSign,
  MapPinned,
  RotateCcw,
  Search,
  Tags,
  Users,
} from "lucide-react";
import { NAICS_CATALOG_METADATA, searchNaicsCatalog } from "../data/naicsCatalog";
import type { ExchangeFilterUpdate } from "../state/exchangeWorkspaceActions";
import type { ExchangeWorkspaceState } from "../state/exchangeWorkspaceTypes";
import { parseExchangeNaicsDraft } from "../utils/filtering";
import { OpportunityLocationSearch } from "./OpportunityLocationSearch";

const SORT_OPTIONS: Array<{ value: OpportunitySort; label: string }> = [
  { value: "recommended", label: "Recommended" },
  { value: "relevance", label: "Relevance" },
  { value: "nearest", label: "Nearest" },
  { value: "newest", label: "Newest posted" },
  { value: "updated", label: "Recently updated" },
  { value: "deadline_soonest", label: "Deadline soonest" },
  { value: "deadline_latest", label: "Deadline latest" },
  { value: "local_first", label: "Local first" },
  { value: "capability_match", label: "Best capability match" },
  { value: "budget_high", label: "Budget high to low" },
  { value: "budget_low", label: "Budget low to high" },
];

const OPPORTUNITY_TYPES = [
  ["goods", "Goods"],
  ["services", "Services"],
  ["construction", "Construction"],
  ["professional_services", "Professional services"],
  ["mixed", "Mixed requirement"],
] as const;
const PROCUREMENT_TYPES = [
  ["RFP", "RFP"],
  ["RFQ", "RFQ"],
  ["RFI", "RFI"],
  ["IFB", "Invitation for bid"],
] as const;
const BUYER_TYPES = [
  ["government", "Government"],
  ["nonprofit", "Nonprofit"],
  ["private", "Private"],
  ["institutional", "Institutional"],
] as const;
const WORK_ARRANGEMENTS = [
  ["on_site", "On-site"],
  ["remote", "Remote"],
  ["hybrid", "Hybrid"],
  ["flexible", "Flexible"],
] as const;
const PERSONALIZED = [
  ["matches_organization", "Matches my organization"],
  ["matches_naics", "Matches my NAICS"],
  ["matches_capabilities", "Matches my capabilities"],
  ["matches_service_territory", "Matches my service territory"],
  ["saved", "Saved opportunities"],
  ["viewed", "Viewed opportunities"],
  ["responded", "Responded opportunities"],
  ["managed", "Managed opportunities"],
  ["new_since_last_visit", "New since last visit"],
  ["updated_since_viewed", "Updated since viewed"],
  ["exclude_issued_by_my_org", "Exclude my organization’s opportunities"],
] as const;

function toggleValue(values: readonly string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

function CheckboxGrid({
  values,
  options,
  onChange,
}: {
  values: readonly string[];
  options: readonly (readonly [string, string])[];
  onChange: (values: string[]) => void;
}) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {options.map(([value, label]) => (
        <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          <input
            type="checkbox"
            checked={values.includes(value)}
            onChange={() => onChange(toggleValue(values, value))}
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          {label}
        </label>
      ))}
    </div>
  );
}

export function ExchangeFilters({
  state,
  territories,
  activeFilterCount,
  onChange,
  onClear,
}: {
  state: ExchangeWorkspaceState;
  territories: TerritoryDoc[];
  activeFilterCount: number;
  onChange: (filters: ExchangeFilterUpdate) => void;
  onClear: () => void;
}) {
  const [naicsDraft, setNaicsDraft] = useState(() => state.naicsFilters.join(", "));
  const [industryQuery, setIndustryQuery] = useState("");
  const [capabilityDraft, setCapabilityDraft] = useState("");
  const industryResults = useMemo(
    () => searchNaicsCatalog(industryQuery, 18),
    [industryQuery],
  );

  useEffect(() => {
    setNaicsDraft(state.naicsFilters.join(", "));
  }, [state.naicsFilters]);

  const commitNaicsDraft = () => {
    const codes = parseExchangeNaicsDraft(naicsDraft);
    setNaicsDraft(codes.join(", "));
    onChange({ naicsFilters: codes });
  };

  const addCapability = () => {
    const incoming = capabilityDraft
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!incoming.length) return;
    onChange({
      capabilityFilters: [...new Set([
        ...state.capabilityFilters,
        ...incoming,
      ])].slice(0, 60),
    });
    setCapabilityDraft("");
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

      <label className="block lg:hidden">
        <span className="mb-1.5 block text-xs font-bold text-slate-700">Sort results</span>
        <select
          value={state.opportunitySort}
          onChange={(event) => onChange({ opportunitySort: event.target.value as OpportunitySort })}
          className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>

      <section aria-labelledby="opportunity-location-filter-heading" className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
        <h3 id="opportunity-location-filter-heading" className="mb-2 flex items-center gap-2 text-xs font-bold text-slate-800">
          <MapPinned className="h-4 w-4 text-slate-400" aria-hidden="true" /> Location
        </h3>
        <OpportunityLocationSearch
          value={state.opportunityLocation}
          onChange={(location) => onChange(location
            ? { opportunityLocation: location }
            : { clearOpportunityLocation: true })}
        />
        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] font-bold text-slate-600">Territory</span>
          <select
            value={state.territoryFilters[0] || ""}
            onChange={(event) => onChange({ territoryFilters: event.target.value ? [event.target.value] : [] })}
            className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="">All territories</option>
            {territories.map((territory) => (
              <option key={territory.fips} value={territory.fips}>{territory.name} ({territory.status})</option>
            ))}
          </select>
        </label>
        <fieldset className="mt-3">
          <legend className="text-[11px] font-bold text-slate-600">Territory status</legend>
          <CheckboxGrid
            values={state.territoryStatusFilters}
            options={[["released", "Released"], ["scheduled", "Scheduled"]]}
            onChange={(values) => onChange({
              territoryStatusFilters: values as ExchangeWorkspaceState["territoryStatusFilters"],
            })}
          />
        </fieldset>
      </section>

      <section aria-labelledby="opportunity-industry-filter-heading" className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3">
        <h3 id="opportunity-industry-filter-heading" className="flex items-center gap-2 text-xs font-bold text-slate-800">
          <Tags className="h-4 w-4 text-slate-400" aria-hidden="true" /> Industry and capabilities
        </h3>
        <label className="mt-2 block">
          <span className="sr-only">Search industries or NAICS codes</span>
          <span className="flex h-11 items-center rounded-xl border border-slate-300 bg-white px-3 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20">
            <Search className="mr-2 h-4 w-4 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={industryQuery}
              onChange={(event) => setIndustryQuery(event.target.value)}
              placeholder="Construction, electrical, 236220…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </span>
        </label>
        <div className="mt-2 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5" aria-label="Industry choices">
          {industryResults.map((entry) => {
            const checked = state.naicsFilters.includes(entry.code);
            return (
              <label key={entry.code} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-xs hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange({
                    naicsFilters: toggleValue(state.naicsFilters, entry.code),
                    industryFilters: checked
                      ? state.industryFilters.filter((value) => value !== entry.label)
                      : [...new Set([...state.industryFilters, entry.label])],
                  })}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="min-w-0">
                  <span className="block font-bold text-slate-800">{entry.label}</span>
                  <span className="text-[10px] text-slate-500">{entry.code}{entry.parentCode ? ` · under ${entry.parentCode}` : ""}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="mt-1 text-[10px] text-slate-500">NAICS {NAICS_CATALOG_METADATA.version} · {NAICS_CATALOG_METADATA.sourceDataset}</p>

        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] font-bold text-slate-600">NAICS codes</span>
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

        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] font-bold text-slate-600">Capability keywords</span>
          <div className="flex gap-2">
            <input
              type="text"
              value={capabilityDraft}
              onChange={(event) => setCapabilityDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCapability();
                }
              }}
              placeholder="e.g. grant writing, cybersecurity"
              className="h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
            <button type="button" onClick={addCapability} className="min-h-11 rounded-xl bg-slate-900 px-3 text-xs font-bold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500">Add</button>
          </div>
        </label>
        {state.capabilityFilters.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {state.capabilityFilters.map((capability) => (
              <button
                key={capability}
                type="button"
                onClick={() => onChange({ capabilityFilters: state.capabilityFilters.filter((value) => value !== capability) })}
                className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 outline-none hover:bg-indigo-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-label={`Remove ${capability} capability`}
              >
                {capability} ×
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="opportunity-type-filter-heading">
        <h3 id="opportunity-type-filter-heading" className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <BriefcaseBusiness className="h-4 w-4 text-slate-400" aria-hidden="true" /> Procurement
        </h3>
        <CheckboxGrid
          values={state.opportunityTypeFilters}
          options={OPPORTUNITY_TYPES}
          onChange={(opportunityTypeFilters) => onChange({ opportunityTypeFilters })}
        />
        <CheckboxGrid
          values={state.rfxTypeFilters}
          options={PROCUREMENT_TYPES}
          onChange={(rfxTypeFilters) => onChange({ rfxTypeFilters })}
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={state.teamingSuitable} onChange={(event) => onChange({ teamingSuitable: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /> Teaming suitable
          </label>
          <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
            <input type="checkbox" checked={state.closingSoon} onChange={(event) => onChange({ closingSoon: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /> Closing soon
          </label>
        </div>
      </section>

      <details className="rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-3 py-3 text-xs font-bold text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
          Dates, budget, and award details
        </summary>
        <div className="space-y-4 border-t border-slate-100 p-3">
          <fieldset>
            <legend className="flex items-center gap-2 text-xs font-bold text-slate-700"><CalendarClock className="h-4 w-4 text-slate-400" aria-hidden="true" /> Deadline</legend>
            <label className="mt-2 flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
              <input type="checkbox" checked={state.closingSoon} onChange={(event) => onChange({ closingSoon: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /> Closing within seven days
            </label>
          </fieldset>
          <fieldset>
            <legend className="flex items-center gap-2 text-xs font-bold text-slate-700"><DollarSign className="h-4 w-4 text-slate-400" aria-hidden="true" /> Budget or estimated value</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label><span className="sr-only">Minimum budget</span><input type="number" min="0" value={state.budgetMin ?? ""} onChange={(event) => onChange({ budgetMin: event.target.value ? Number(event.target.value) : undefined })} placeholder="Minimum" className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" /></label>
              <label><span className="sr-only">Maximum budget</span><input type="number" min="0" value={state.budgetMax ?? ""} onChange={(event) => onChange({ budgetMax: event.target.value ? Number(event.target.value) : undefined })} placeholder="Maximum" className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" /></label>
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-xs font-bold text-slate-700">Contract structure</legend>
            <CheckboxGrid values={state.primeClassificationFilters} options={[["prime", "Prime"], ["subcontract", "Subcontract"]]} onChange={(primeClassificationFilters) => onChange({ primeClassificationFilters })} />
            <CheckboxGrid values={state.awardClassificationFilters} options={[["single", "Single award"], ["multiple", "Multiple award"]]} onChange={(awardClassificationFilters) => onChange({ awardClassificationFilters })} />
          </fieldset>
        </div>
      </details>

      <details className="rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-3 py-3 text-xs font-bold text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
          Buyer, eligibility, and work arrangement
        </summary>
        <div className="space-y-4 border-t border-slate-100 p-3">
          <fieldset>
            <legend className="flex items-center gap-2 text-xs font-bold text-slate-700"><BadgeCheck className="h-4 w-4 text-slate-400" aria-hidden="true" /> Buyer type</legend>
            <CheckboxGrid values={state.buyerTypeFilters} options={BUYER_TYPES} onChange={(buyerTypeFilters) => onChange({ buyerTypeFilters })} />
          </fieldset>
          <fieldset>
            <legend className="text-xs font-bold text-slate-700">Work arrangement</legend>
            <CheckboxGrid values={state.workArrangementFilters} options={WORK_ARRANGEMENTS} onChange={(workArrangementFilters) => onChange({ workArrangementFilters })} />
          </fieldset>
          <fieldset>
            <legend className="text-xs font-bold text-slate-700">Visibility</legend>
            <CheckboxGrid values={state.visibilityFilters} options={[["public", "Public"], ["members", "Member-only"], ["restricted", "Restricted"]]} onChange={(visibilityFilters) => onChange({ visibilityFilters })} />
          </fieldset>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-700">Required certifications</span>
            <input
              type="text"
              defaultValue={state.certificationFilters.join(", ")}
              onBlur={(event) => onChange({ certificationFilters: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })}
              placeholder="e.g. SWaM, DBE"
              className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-700">Set-aside designations</span>
            <input
              type="text"
              defaultValue={state.setAsideFilters.join(", ")}
              onBlur={(event) => onChange({ setAsideFilters: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })}
              placeholder="e.g. small business"
              className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>
        </div>
      </details>

      <details className="rounded-2xl border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-3 py-3 text-xs font-bold text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
          Personalization
        </summary>
        <div className="border-t border-slate-100 p-3">
          <fieldset>
            <legend className="flex items-center gap-2 text-xs font-bold text-slate-700"><Users className="h-4 w-4 text-slate-400" aria-hidden="true" /> My discovery</legend>
            <div className="mt-2 space-y-2">
              {PERSONALIZED.map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={state.personalizedFilters.includes(value)}
                    onChange={() => onChange({ personalizedFilters: toggleValue(state.personalizedFilters, value) as ExchangeWorkspaceState["personalizedFilters"] })}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </details>

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <input
          type="checkbox"
          checked={state.localFirst}
          onChange={(event) => onChange({ localFirst: event.target.checked })}
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
