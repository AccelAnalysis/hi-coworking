"use client";

import { useEffect, useRef, useState } from "react";
import type { RfxDoc, TerritoryDoc } from "@hi/shared";
import type { ExchangeSelection } from "../state/exchangeWorkspaceTypes";
import { ExchangeRfxCard } from "./ExchangeRfxCard";
import { ExchangeTerritoryCard } from "./ExchangeTerritoryCard";

export function ExchangeResultsList({
  rfx,
  territories,
  selection,
  manageableRfxIds,
  compact = false,
  onSelect,
}: {
  rfx: RfxDoc[];
  territories: TerritoryDoc[];
  selection: ExchangeSelection;
  manageableRfxIds: Set<string>;
  compact?: boolean;
  onSelect: (selection: Exclude<ExchangeSelection, null>) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleLimit, setVisibleLimit] = useState(compact ? 40 : 60);
  const selectedRfxIndex = selection?.entityType === "rfx"
    ? rfx.findIndex((record) => record.id === selection.entityId)
    : -1;
  const selectedTerritoryIndex = selection?.entityType === "territory"
    ? territories.findIndex((record) => record.fips === selection.entityId)
    : -1;
  const visibleRfx = rfx.slice(0, Math.max(visibleLimit, selectedRfxIndex + 1));
  const visibleTerritories = territories.slice(
    0,
    Math.max(visibleLimit, selectedTerritoryIndex + 1),
  );
  const totalCount = rfx.length + territories.length;
  const visibleCount = visibleRfx.length + visibleTerritories.length;

  useEffect(() => {
    if (!selection || !containerRef.current) return;
    const elements = containerRef.current.querySelectorAll<HTMLElement>("[data-exchange-entity][data-exchange-id]");
    const selected = [...elements].find((element) =>
      element.dataset.exchangeEntity === selection.entityType
      && element.dataset.exchangeId === selection.entityId,
    );
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    selected?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [selection]);

  return (
    <div ref={containerRef} className="h-full overflow-y-auto overscroll-contain px-3 py-3" aria-label="Exchange results">
      {visibleRfx.length ? (
        <section aria-labelledby={compact ? undefined : "exchange-rfx-results-heading"}>
          {!compact ? (
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 id="exchange-rfx-results-heading" className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">RFx opportunities</h2>
              <span className="text-[11px] font-semibold text-slate-400">{rfx.length}</span>
            </div>
          ) : null}
          <div className="space-y-2.5">
            {visibleRfx.map((record) => (
              <ExchangeRfxCard
                key={record.id}
                rfx={record}
                selected={selection?.entityType === "rfx" && selection.entityId === record.id}
                manageable={manageableRfxIds.has(record.id)}
                compact={compact}
                onSelect={() => onSelect({ entityType: "rfx", entityId: record.id })}
              />
            ))}
          </div>
        </section>
      ) : null}

      {visibleTerritories.length ? (
        <section className={visibleRfx.length ? "mt-5" : ""} aria-labelledby={compact ? undefined : "exchange-territory-results-heading"}>
          {!compact ? (
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 id="exchange-territory-results-heading" className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Territories</h2>
              <span className="text-[11px] font-semibold text-slate-400">{territories.length}</span>
            </div>
          ) : null}
          <div className="space-y-2.5">
            {visibleTerritories.map((territory) => (
              <ExchangeTerritoryCard
                key={territory.fips}
                territory={territory}
                selected={selection?.entityType === "territory" && selection.entityId === territory.fips}
                compact={compact}
                onSelect={() => onSelect({ entityType: "territory", entityId: territory.fips })}
              />
            ))}
          </div>
        </section>
      ) : null}

      {visibleCount < totalCount ? (
        <button
          type="button"
          onClick={() => setVisibleLimit((current) => Math.min(totalCount, current + 60))}
          className="mt-4 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Show more results ({totalCount - visibleCount} remaining)
        </button>
      ) : null}
    </div>
  );
}
