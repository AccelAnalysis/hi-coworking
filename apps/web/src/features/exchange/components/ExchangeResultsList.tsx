"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TerritoryDoc } from "@hi/shared";
import type { PublicOrganizationProjection } from "@/lib/firestore";
import type { ExchangeDiscoveryRfx } from "../data/opportunityDiscoveryGateway";
import type { ExchangeSelection } from "../state/exchangeWorkspaceTypes";
import { ExchangeRfxCard } from "./ExchangeRfxCard";
import { ExchangeTerritoryCard } from "./ExchangeTerritoryCard";
import { ExchangeOrganizationCard } from "./ExchangeOrganizationCard";

const COMPACT_BATCH = 12;
const STANDARD_BATCH = 24;

export function ExchangeResultsList({
  rfx,
  territories,
  organizations,
  selection,
  manageableRfxIds,
  compact = false,
  hasMore = false,
  loadingMore = false,
  onSelect,
  onSave,
  onLoadMore,
}: {
  rfx: ExchangeDiscoveryRfx[];
  territories: TerritoryDoc[];
  organizations: PublicOrganizationProjection[];
  selection: ExchangeSelection;
  manageableRfxIds: Set<string>;
  compact?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onSelect: (selection: Exclude<ExchangeSelection, null>) => void;
  onSave?: (rfxId: string, saved: boolean) => Promise<void> | void;
  onLoadMore?: () => Promise<void> | void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const batchSize = compact ? COMPACT_BATCH : STANDARD_BATCH;
  const [visibleLimit, setVisibleLimit] = useState(batchSize);
  const selectedRfxIndex = selection?.entityType === "rfx"
    ? rfx.findIndex((record) => record.id === selection.entityId)
    : -1;
  const selectedTerritoryIndex = selection?.entityType === "territory"
    ? territories.findIndex((record) => record.fips === selection.entityId)
    : -1;
  const selectedOrganizationIndex = selection?.entityType === "organization"
    ? organizations.findIndex((record) => record.id === selection.entityId)
    : -1;
  const visibleRfx = rfx.slice(0, Math.max(visibleLimit, selectedRfxIndex + 1));
  const visibleTerritories = territories.slice(
    0,
    Math.max(visibleLimit, selectedTerritoryIndex + 1),
  );
  const visibleOrganizations = organizations.slice(
    0,
    Math.max(visibleLimit, selectedOrganizationIndex + 1),
  );
  const totalCount = rfx.length + territories.length + organizations.length;
  const visibleCount = visibleRfx.length + visibleTerritories.length + visibleOrganizations.length;
  const hasLocallyHiddenResults = visibleCount < totalCount;
  const canLoad = hasLocallyHiddenResults || hasMore;

  useEffect(() => {
    setVisibleLimit(batchSize);
  }, [batchSize, organizations.length, rfx.length, territories.length]);

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

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    if (hasLocallyHiddenResults) {
      setVisibleLimit((current) => Math.min(totalCount, current + batchSize));
      return;
    }
    await onLoadMore?.();
  }, [batchSize, hasLocallyHiddenResults, loadingMore, onLoadMore, totalCount]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = containerRef.current;
    if (!sentinel || !root || !canLoad || loadingMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { root, rootMargin: "240px 0px", threshold: 0.01 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [canLoad, loadMore, loadingMore]);

  return (
    <div ref={containerRef} className="h-full overflow-y-auto overscroll-contain px-3 py-3" aria-label="Exchange results" aria-busy={loadingMore}>
      {visibleRfx.length ? (
        <section aria-labelledby={compact ? undefined : "exchange-rfx-results-heading"}>
          {!compact ? (
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 id="exchange-rfx-results-heading" className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">RFx opportunities</h2>
              <span className="text-[11px] font-semibold text-slate-400">{rfx.length}{hasMore ? "+" : ""}</span>
            </div>
          ) : null}
          <div className="space-y-2.5">
            {visibleRfx.map((record) => (
              <ExchangeRfxCard
                key={record.id}
                rfx={record}
                selected={selection?.entityType === "rfx" && selection.entityId === record.id}
                manageable={manageableRfxIds.has(record.id) || Boolean(record.discovery?.relationship.managed)}
                compact={compact}
                onSelect={() => onSelect({ entityType: "rfx", entityId: record.id })}
                onSave={onSave ? (saved) => onSave(record.id, saved) : undefined}
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

      {visibleOrganizations.length ? (
        <section
          className={visibleRfx.length || visibleTerritories.length ? "mt-5" : ""}
          aria-labelledby={compact ? undefined : "exchange-organization-results-heading"}
        >
          {!compact ? (
            <div className="mb-2 flex items-center justify-between px-1">
              <h2 id="exchange-organization-results-heading" className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Organizations</h2>
              <span className="text-[11px] font-semibold text-slate-400">{organizations.length}</span>
            </div>
          ) : null}
          <div className="space-y-2.5">
            {visibleOrganizations.map((organization) => (
              <ExchangeOrganizationCard
                key={organization.id}
                organization={organization}
                selected={selection?.entityType === "organization" && selection.entityId === organization.id}
                compact={compact}
                onSelect={() => onSelect({ entityType: "organization", entityId: organization.id })}
              />
            ))}
          </div>
        </section>
      ) : null}

      {!totalCount ? (
        <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-white/80 bg-white/45 px-6 text-center text-sm font-semibold text-slate-600 backdrop-blur-xl">
          No results match the current search and filters.
        </div>
      ) : null}

      <div ref={sentinelRef} className="flex min-h-12 items-center justify-center" aria-live="polite">
        {canLoad ? (
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="min-h-10 rounded-xl border border-white/80 bg-white/65 px-4 text-xs font-black text-slate-700 shadow-sm backdrop-blur-xl outline-none hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
          >
            {loadingMore ? "Loading more results…" : "Load more results"}
          </button>
        ) : totalCount ? (
          <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">All results loaded</span>
        ) : null}
      </div>
    </div>
  );
}
