"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { OpportunityLocationFilter } from "@hi/shared/opportunity-discovery";
import { LocateFixed, MapPin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getOpportunityLocationSearchProvider,
  type OpportunityLocationSearchProvider,
  type OpportunityLocationSuggestion,
} from "../data/opportunityLocationSearchProvider";

const RADIUS_OPTIONS = [10, 25, 50, 100, 250] as const;

export function OpportunityLocationSearch({
  value,
  compact = false,
  provider = getOpportunityLocationSearchProvider(),
  onChange,
}: {
  value?: OpportunityLocationFilter;
  compact?: boolean;
  provider?: OpportunityLocationSearchProvider;
  onChange: (location?: OpportunityLocationFilter) => void;
}) {
  const inputId = useId();
  const listboxId = `${inputId}-suggestions`;
  const [draft, setDraft] = useState(value?.label ?? "");
  const [suggestions, setSuggestions] = useState<OpportunityLocationSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasCoordinates = value?.latitude !== undefined && value.longitude !== undefined;
  const open = draft.trim().length >= 2 && (loading || Boolean(error) || suggestions.length > 0);

  useEffect(() => {
    setDraft(value?.label ?? "");
  }, [value?.label]);

  useEffect(() => {
    abortRef.current?.abort();
    const query = draft.trim();
    if (query.length < 2 || query === value?.label) {
      setSuggestions([]);
      setActiveIndex(-1);
      setLoading(false);
      setError(null);
      return;
    }
    if (!provider.available) {
      setSuggestions([]);
      setLoading(false);
      setError("Location search needs Mapbox configuration");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      void provider.suggest(query, controller.signal).then((items) => {
        if (controller.signal.aborted) return;
        setSuggestions(items);
        setActiveIndex(items.length ? 0 : -1);
        setLoading(false);
        if (!items.length) setError("No matching places found");
      }).catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setSuggestions([]);
        setActiveIndex(-1);
        setLoading(false);
        setError(caught instanceof Error ? caught.message : "Location search unavailable");
      });
    }, 320);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [draft, provider, value?.label]);

  const selectedRadius = value?.radiusMiles ?? 25;
  const activeDescendant = activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined;
  const selectionLabel = useMemo(() => {
    if (!value?.label) return "Location";
    return value.radiusMiles ? `${value.label} · ${value.radiusMiles} mi` : value.label;
  }, [value]);

  const selectSuggestion = (suggestion: OpportunityLocationSuggestion) => {
    onChange({
      label: suggestion.label,
      latitude: suggestion.latitude,
      longitude: suggestion.longitude,
      radiusMiles: selectedRadius,
      includeRemote: value?.includeRemote !== false,
    });
    setDraft(suggestion.label);
    setSuggestions([]);
    setActiveIndex(-1);
    setError(null);
  };

  return (
    <div className={cn("relative", compact ? "min-w-0 flex-1" : "w-full")}>
      <label
        className={cn(
          "flex min-w-0 items-center rounded-xl border bg-white px-3 shadow-lg backdrop-blur-xl focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/25",
          compact
            ? "h-11 border-white/65 bg-white/88 lg:h-10 lg:border-white/15 lg:bg-slate-900/72"
            : "h-11 border-slate-300 shadow-none",
        )}
      >
        {hasCoordinates ? (
          <LocateFixed className="mr-2 h-4 w-4 shrink-0 text-blue-600 lg:text-cyan-300" aria-hidden="true" />
        ) : (
          <MapPin className="mr-2 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        )}
        <span className="sr-only">Opportunity location</span>
        <input
          id={inputId}
          type="search"
          role="combobox"
          autoComplete="off"
          value={draft}
          placeholder="City, ZIP, address, or place"
          aria-label="Search opportunity location"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={activeDescendant}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length) {
              event.preventDefault();
              setActiveIndex((current) => Math.min(suggestions.length - 1, current + 1));
            } else if (event.key === "ArrowUp" && suggestions.length) {
              event.preventDefault();
              setActiveIndex((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter" && activeIndex >= 0 && suggestions[activeIndex]) {
              event.preventDefault();
              selectSuggestion(suggestions[activeIndex]);
            } else if (event.key === "Escape") {
              setSuggestions([]);
              setError(null);
              setActiveIndex(-1);
            }
          }}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400",
            compact && "text-slate-950 lg:text-white",
          )}
        />
        {value?.label || draft ? (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              setSuggestions([]);
              setError(null);
              onChange(undefined);
            }}
            className="rounded-lg p-2 text-slate-400 outline-none hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-500 lg:hover:bg-slate-800 lg:hover:text-white"
            aria-label="Clear location search"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </label>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-[1300] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="border-b border-slate-100 px-3 py-2 text-[10px] font-semibold text-slate-500" aria-live="polite">
            {loading ? "Searching places…" : error ?? `${suggestions.length} place suggestions`}
          </div>
          {suggestions.length ? (
            <ul id={listboxId} role="listbox" aria-label="Location suggestions" className="max-h-64 overflow-y-auto p-1.5">
              {suggestions.map((suggestion, index) => (
                <li
                  id={`${listboxId}-${index}`}
                  key={suggestion.id}
                  role="option"
                  aria-selected={index === activeIndex}
                >
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectSuggestion(suggestion)}
                    className={cn(
                      "w-full rounded-xl px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                      index === activeIndex ? "bg-blue-50" : "hover:bg-slate-50",
                    )}
                  >
                    <span className="block text-sm font-bold text-slate-900">{suggestion.label}</span>
                    {suggestion.context ? <span className="mt-0.5 block text-xs text-slate-500">{suggestion.context}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {!compact && value?.label ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-600">Within</span>
          <select
            value={selectedRadius}
            onChange={(event) => onChange({
              ...value,
              radiusMiles: Number(event.target.value),
              includeRemote: value.includeRemote !== false,
            })}
            aria-label="Location radius"
            className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          >
            {RADIUS_OPTIONS.map((radius) => <option key={radius} value={radius}>{radius} miles</option>)}
          </select>
          <label className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={value.includeRemote !== false}
              onChange={(event) => onChange({ ...value, includeRemote: event.target.checked })}
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Include remote
          </label>
          <span className="sr-only" aria-live="polite">{selectionLabel}</span>
        </div>
      ) : null}
    </div>
  );
}
