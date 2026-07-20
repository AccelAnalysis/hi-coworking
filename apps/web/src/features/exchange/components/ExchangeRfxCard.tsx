"use client";

import Link from "next/link";
import { useState } from "react";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Clock3,
  DollarSign,
  ExternalLink,
  MapPin,
  Share2,
  Star,
  Tags,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExchangeDiscoveryRfx } from "../data/opportunityDiscoveryGateway";
import { labelForNaics } from "../data/naicsCatalog";
import { formatExchangeDate, titleCaseExchangeStatus } from "../utils/formatting";

function daysRemaining(deadline?: number): number | undefined {
  if (!deadline) return undefined;
  return Math.ceil((deadline - Date.now()) / (24 * 60 * 60 * 1000));
}

function confidenceLabel(value?: string): string | undefined {
  switch (value) {
    case "exact": return "Exact location";
    case "approximate": return "Approximate location";
    case "place_of_performance": return "Place of performance";
    case "issuer_address": return "Issuer address";
    case "eligible_territory": return "Eligible territory";
    case "territory_centroid": return "Territory-level location";
    case "withheld": return "Location withheld";
    case "remote": return "Remote";
    case "not_geocoded": return "Location unavailable";
    default: return undefined;
  }
}

export function ExchangeRfxCard({
  rfx,
  selected,
  manageable,
  compact = false,
  onSelect,
  onSave,
}: {
  rfx: ExchangeDiscoveryRfx;
  selected: boolean;
  manageable: boolean;
  compact?: boolean;
  onSelect: () => void;
  onSave?: (saved: boolean) => Promise<void> | void;
}) {
  const [saving, setSaving] = useState(false);
  const [shared, setShared] = useState(false);
  const discovery = rfx.discovery;
  const saved = discovery?.relationship.saved ?? false;
  const remaining = daysRemaining(rfx.dueDate);
  const closingSoon = remaining !== undefined && remaining >= 0 && remaining <= 7;
  const destination = manageable ? `/rfx/evaluate?id=${encodeURIComponent(rfx.id)}` : `/rfx/detail?id=${encodeURIComponent(rfx.id)}`;
  const exchangeLink = `/exchange?view=opportunities&entity=rfx&selected=${encodeURIComponent(rfx.id)}`;
  const industryLabels = discovery?.industryLabels.length
    ? discovery.industryLabels
    : (rfx.naicsCodes ?? []).map(labelForNaics).filter((value): value is string => Boolean(value));
  const location = discovery?.placeOfPerformance || rfx.location || (
    discovery?.workArrangement === "remote" ? "Remote" : "Location unavailable"
  );
  const confidence = confidenceLabel(
    discovery?.locationConfidence ?? discovery?.geo?.confidence,
  );

  const share = async () => {
    const url = new URL(exchangeLink, window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title: rfx.title, url });
      else await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(() => setShared(false), 1800);
    } catch {
      // Share cancellation leaves the card unchanged.
    }
  };
  return (
    <article
      data-exchange-entity="rfx"
      data-exchange-id={rfx.id}
      className={cn(
        "group relative rounded-2xl border bg-white shadow-sm transition",
        selected
          ? "border-indigo-500 ring-2 ring-indigo-500/20"
          : "border-slate-200 hover:border-slate-300 hover:shadow-md",
      )}
    >
      <button
        type="button"
        disabled={!onSave || saving}
        onClick={async () => {
          if (!onSave) return;
          setSaving(true);
          try {
            await onSave(!saved);
          } finally {
            setSaving(false);
          }
        }}
        className={cn(
          "absolute right-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-xl border outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500",
          saved
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
          (!onSave || saving) && "opacity-50",
        )}
        aria-label={saved ? "Remove saved opportunity" : "Save opportunity"}
        aria-pressed={saved}
      >
        <Star className={cn("h-4 w-4", saved && "fill-current")} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={cn(
          "w-full rounded-t-2xl p-4 pr-16 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500",
          compact && "p-3",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-600">
              {discovery?.rfxType || "RFx opportunity"}
              {discovery?.issuerVerified ? (
                <span className="inline-flex items-center gap-0.5 normal-case tracking-normal text-emerald-700">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verified
                </span>
              ) : null}
            </p>
            <h3 className={cn("mt-1 font-bold leading-5 text-slate-950", compact ? "line-clamp-2 text-sm" : "text-[15px]")}>{rfx.title}</h3>
            <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">
              {discovery?.issuerDisplayName || rfx.createdByName || "Exchange issuer"}
            </p>
          </div>
        </div>

        {!compact ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{rfx.description}</p> : null}

        <dl className="mt-3 grid gap-1.5 text-[11px] text-slate-600">
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <dt className="sr-only">Place of performance</dt>
            <dd className="truncate">
              {location}
              {discovery?.distanceMiles !== undefined ? ` · ${discovery.distanceMiles.toFixed(1)} mi` : ""}
              {confidence && confidence !== location ? <span className="text-slate-400"> · {confidence}</span> : null}
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <dt className="sr-only">Response due date</dt>
            <dd>
              Due {formatExchangeDate(rfx.dueDate)}
              {remaining !== undefined ? ` · ${remaining < 0 ? "Closed" : `${remaining} day${remaining === 1 ? "" : "s"} left`}` : ""}
            </dd>
          </div>
          {rfx.budget ? (
            <div className="flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Budget or estimated value</dt>
              <dd className="truncate">{rfx.budget}</dd>
            </div>
          ) : null}
          {industryLabels.length ? (
            <div className="flex items-center gap-2">
              <Tags className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Industries</dt>
              <dd className="truncate">{industryLabels.slice(0, 2).join(" · ")}</dd>
            </div>
          ) : null}
        </dl>
        {(closingSoon || discovery?.relationship.viewed || discovery?.relationship.responded) ? (
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Opportunity indicators">
            {closingSoon ? <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800"><Clock3 className="mr-1 h-3 w-3" aria-hidden="true" /> Closing soon</span> : null}
            {discovery?.relationship.viewed ? <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-700">Viewed</span> : null}
            {discovery?.relationship.responded ? <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800"><Check className="mr-1 h-3 w-3" aria-hidden="true" /> Responded</span> : null}
          </div>
        ) : null}
      </button>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5">
        <span className="max-w-[45%] truncate text-[11px] text-slate-500">{titleCaseExchangeStatus(rfx.status)}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void share()}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-bold text-slate-600 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {shared ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Share2 className="h-3.5 w-3.5" aria-hidden="true" />}
            {shared ? "Copied" : "Share"}
          </button>
          {discovery?.teamingSuitable ? (
            <Link href={`/rfx/team?rfxId=${encodeURIComponent(rfx.id)}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-bold text-blue-700 outline-none hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-indigo-500">
              <Users className="h-3.5 w-3.5" aria-hidden="true" /> Team up
            </Link>
          ) : null}
          <Link
            href={destination}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-bold text-indigo-700 outline-none hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            {manageable ? "Evaluate" : "Details"} <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
