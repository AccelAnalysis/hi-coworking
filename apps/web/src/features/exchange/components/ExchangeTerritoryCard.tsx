"use client";

import type { TerritoryDoc } from "@hi/shared";
import { CalendarClock, MapPinned } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatExchangeDate, titleCaseExchangeStatus } from "../utils/formatting";

export function ExchangeTerritoryCard({
  territory,
  selected,
  compact = false,
  onSelect,
}: {
  territory: TerritoryDoc;
  selected: boolean;
  compact?: boolean;
  onSelect: () => void;
}) {
  const scheduled = territory.status === "scheduled";
  return (
    <article
      data-exchange-entity="territory"
      data-exchange-id={territory.fips}
      className={cn(
        "rounded-2xl border bg-white shadow-sm transition",
        selected
          ? "border-indigo-500 ring-2 ring-indigo-500/20"
          : "border-slate-200 hover:border-slate-300 hover:shadow-md",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          "w-full rounded-2xl p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500",
          compact && "p-3",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-700">Territory</p>
            <h3 className="mt-1 truncate text-[15px] font-bold text-slate-950">{territory.name}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{territory.state} · FIPS {territory.fips}</p>
          </div>
          <span className={cn(
            "shrink-0 rounded-full px-2 py-1 text-[10px] font-bold",
            scheduled ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800",
          )}>
            {titleCaseExchangeStatus(territory.status)}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-600">
          {scheduled ? <CalendarClock className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" /> : <MapPinned className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />}
          <span>
            {scheduled
              ? `Scheduled release: ${formatExchangeDate(territory.releaseDate)}`
              : "Released for current territory discovery"}
          </span>
        </div>
        {scheduled && !compact ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-4 text-amber-900">
            Scheduled does not mean currently transaction-enabled.
          </p>
        ) : null}
      </button>
    </article>
  );
}
