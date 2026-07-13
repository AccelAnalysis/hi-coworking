"use client";

import Link from "next/link";
import type { RfxDoc } from "@hi/shared";
import { CalendarDays, ExternalLink, MapPin, Tags } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatExchangeDate, titleCaseExchangeStatus } from "../utils/formatting";

export function ExchangeRfxCard({
  rfx,
  selected,
  manageable,
  compact = false,
  onSelect,
}: {
  rfx: RfxDoc;
  selected: boolean;
  manageable: boolean;
  compact?: boolean;
  onSelect: () => void;
}) {
  const destination = manageable ? `/rfx/evaluate?id=${encodeURIComponent(rfx.id)}` : `/rfx/detail?id=${encodeURIComponent(rfx.id)}`;
  return (
    <article
      data-exchange-entity="rfx"
      data-exchange-id={rfx.id}
      className={cn(
        "group rounded-2xl border bg-white shadow-sm transition",
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
          "w-full rounded-t-2xl p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500",
          compact && "p-3",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-600">RFx opportunity</p>
            <h3 className={cn("mt-1 font-bold leading-5 text-slate-950", compact ? "line-clamp-2 text-sm" : "text-[15px]")}>{rfx.title}</h3>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800">
            {titleCaseExchangeStatus(rfx.status)}
          </span>
        </div>

        {!compact ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{rfx.description}</p> : null}

        <dl className="mt-3 grid gap-1.5 text-[11px] text-slate-600">
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <dt className="sr-only">Location</dt>
            <dd className="truncate">{rfx.location || "Location flexible"}</dd>
          </div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <dt className="sr-only">Response due date</dt>
            <dd>Due {formatExchangeDate(rfx.dueDate)}</dd>
          </div>
          {rfx.naicsCodes?.length ? (
            <div className="flex items-center gap-2">
              <Tags className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">NAICS codes</dt>
              <dd className="truncate">{rfx.naicsCodes.slice(0, 3).join(" · ")}</dd>
            </div>
          ) : null}
        </dl>
      </button>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5">
        <span className="max-w-[65%] truncate text-[11px] text-slate-500">{rfx.createdByName || "Exchange issuer"}</span>
        <Link
          href={destination}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-bold text-indigo-700 outline-none hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          {manageable ? "Evaluate" : "Details"} <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
