"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OpportunityDiscoveryQuery,
  SavedOpportunitySearch,
} from "@hi/shared/opportunity-discovery";
import {
  Bell,
  BookmarkPlus,
  Check,
  Clock3,
  Loader2,
  Pencil,
  Play,
  Save,
  Trash2,
} from "lucide-react";
import {
  deleteSavedOpportunitySearch,
  listRecentOpportunitySearches,
  listSavedOpportunitySearches,
  upsertSavedOpportunitySearch,
  workspaceToOpportunityQuery,
  type RecentOpportunitySearch,
} from "../data/opportunityDiscoveryGateway";
import { summarizeOpportunityQuery } from "../data/opportunityDiscoveryState";
import { normalizeExchangeDataError } from "../data/exchangeRepository";
import type { ExchangeWorkspaceState } from "../state/exchangeWorkspaceTypes";
import { formatExchangeDate } from "../utils/formatting";

export function SavedOpportunitySearchManager({
  state,
  onRun,
}: {
  state: ExchangeWorkspaceState;
  onRun: (query: Omit<OpportunityDiscoveryQuery, "cursor">, id?: string) => void;
}) {
  const [saved, setSaved] = useState<SavedOpportunitySearch[]>([]);
  const [recent, setRecent] = useState<RecentOpportunitySearch[]>([]);
  const [name, setName] = useState("");
  const [alertFrequency, setAlertFrequency] = useState<SavedOpportunitySearch["alertFrequency"]>("disabled");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedConfirmation, setSavedConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++requestGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const [savedSearches, recentSearches] = await Promise.all([
        listSavedOpportunitySearches(state.actorOrganizationId),
        listRecentOpportunitySearches(state.actorOrganizationId),
      ]);
      if (generation !== requestGenerationRef.current) return;
      setSaved(savedSearches);
      setRecent(recentSearches);
    } catch (caught) {
      if (generation !== requestGenerationRef.current) return;
      setError(normalizeExchangeDataError(caught).message);
    } finally {
      if (generation === requestGenerationRef.current) setLoading(false);
    }
  }, [state.actorOrganizationId]);

  useEffect(() => {
    setSaved([]);
    setRecent([]);
    void refresh();
    return () => {
      requestGenerationRef.current += 1;
    };
  }, [refresh]);

  const saveCurrent = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const query = workspaceToOpportunityQuery(state);
      delete query.cursor;
      await upsertSavedOpportunitySearch({
        name: trimmed,
        query,
        alertFrequency,
      });
      setName("");
      setSavedConfirmation(true);
      window.setTimeout(() => setSavedConfirmation(false), 1800);
      await refresh();
    } catch (caught) {
      setError(normalizeExchangeDataError(caught).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="rounded-2xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-xs font-bold text-slate-800 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
        <BookmarkPlus className="h-4 w-4 text-slate-500" aria-hidden="true" /> Saved and recent searches
      </summary>
      <div className="space-y-4 border-t border-slate-100 p-3">
        <section aria-labelledby="save-current-search-heading">
          <h4 id="save-current-search-heading" className="text-[11px] font-black uppercase tracking-wide text-slate-500">Save current search</h4>
          <div className="mt-2 grid gap-2">
            <label>
              <span className="sr-only">Saved search name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Name this search"
                maxLength={120}
                className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold text-slate-500">Alert preference</span>
              <select
                value={alertFrequency}
                onChange={(event) => setAlertFrequency(event.target.value as SavedOpportunitySearch["alertFrequency"])}
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="disabled">Alerts disabled</option>
                <option value="immediate">Immediate</option>
                <option value="daily">Daily digest</option>
                <option value="weekly">Weekly digest</option>
              </select>
            </label>
            <button
              type="button"
              disabled={saving || !name.trim()}
              onClick={() => void saveCurrent()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-bold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : savedConfirmation ? <Check className="h-4 w-4 text-emerald-300" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {savedConfirmation ? "Search saved" : "Save search"}
            </button>
          </div>
          {alertFrequency !== "disabled" ? (
            <p className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-[10px] leading-4 text-amber-900">
              <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> Preference is stored, but external delivery remains disabled until consented notification channels are configured.
            </p>
          ) : null}
        </section>

        {loading ? (
          <div className="flex min-h-16 items-center justify-center gap-2 text-xs text-slate-500" role="status">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading searches…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900" role="status">
            <p>{error}</p>
            <button type="button" onClick={() => void refresh()} className="mt-2 min-h-9 rounded-lg border border-amber-300 px-3 font-bold outline-none focus-visible:ring-2 focus-visible:ring-amber-700">Retry</button>
          </div>
        ) : null}

        {saved.length ? (
          <section aria-labelledby="saved-searches-heading">
            <h4 id="saved-searches-heading" className="text-[11px] font-black uppercase tracking-wide text-slate-500">Saved searches</h4>
            <div className="mt-2 space-y-2">
              {saved.map((search) => (
                <article key={search.id} className={state.activeSavedSearchId === search.id
                  ? "rounded-xl border border-indigo-400 bg-indigo-50/50 p-3 ring-1 ring-indigo-200"
                  : "rounded-xl border border-slate-200 p-3"}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {search.name}
                        {state.activeSavedSearchId === search.id ? <span className="ml-2 text-[10px] font-black uppercase tracking-wide text-indigo-700">Active</span> : null}
                      </p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">{summarizeOpportunityQuery(search.query)}</p>
                      <p className="mt-1 text-[10px] font-semibold text-slate-400">{search.alertFrequency === "disabled" ? "No alerts" : `${search.alertFrequency} preference`}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => onRun(search.query, search.id)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700 outline-none hover:bg-indigo-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
                        aria-label={`Run saved search ${search.name}`}
                        title="Run saved search"
                      >
                        <Play className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const renamed = window.prompt("Rename saved search", search.name)?.trim();
                          if (!renamed || renamed === search.name) return;
                          await upsertSavedOpportunitySearch({
                            id: search.id,
                            name: renamed,
                            query: search.query,
                            alertFrequency: search.alertFrequency,
                          });
                          await refresh();
                        }}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
                        aria-label={`Rename saved search ${search.name}`}
                        title="Rename saved search"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await deleteSavedOpportunitySearch(search.id, state.actorOrganizationId);
                          await refresh();
                        }}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 outline-none hover:bg-rose-50 hover:text-rose-700 focus-visible:ring-2 focus-visible:ring-rose-500"
                        aria-label={`Delete saved search ${search.name}`}
                        title="Delete saved search"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {recent.length ? (
          <section aria-labelledby="recent-searches-heading">
            <h4 id="recent-searches-heading" className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide text-slate-500"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" /> Recent searches</h4>
            <div className="mt-2 space-y-1">
              {recent.slice(0, 6).map((search) => (
                <button
                  key={search.id}
                  type="button"
                  onClick={() => onRun(search.query)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-slate-800">{search.label}</span>
                    <span className="block truncate text-[10px] text-slate-500">{summarizeOpportunityQuery(search.query)}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-400">{formatExchangeDate(search.lastUsedAt)}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </details>
  );
}
