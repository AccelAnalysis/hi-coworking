"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Clock3,
  DollarSign,
  Ellipsis,
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
    case "eligible_territory": return "Eligible territory";
    case "territory_centroid": return "Territory-level location";
    case "withheld": return "Location withheld";
    case "remote": return "Remote";
    case "not_geocoded": return "Not yet geocoded";
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
  const destination = manageable
    ? `/rfx/evaluate?id=${encodeURIComponent(rfx.id)}`
    : `/rfx/detail?id=${encodeURIComponent(rfx.id)}`;
  const exchangeLink = `/exchange?view=opportunities&entity=rfx&selected=${encodeURIComponent(rfx.id)}`;
  const industryLabels = discovery?.industryLabels.length
    ? discovery.industryLabels
    : (rfx.naicsCodes ?? []).map(labelForNaics).filter((value): value is string => Boolean(value));
  const location = discovery?.placeOfPerformance || rfx.location || (
    discovery?.workArrangement === "remote" ? "Remote" : "Location flexible"
  );
  const confidence = confidenceLabel(discovery?.geo?.confidence);
  const highValueStates = [
    ...(discovery?.relationship.updatedSinceViewed ? ["Updated"] : []),
    ...(discovery?.relationship.newSinceLastVisit ? ["New"] : []),
    ...(closingSoon ? ["Closing soon"] : []),
    ...(discovery?.teamingSuitable ? ["Teaming suitable"] : []),
  ].slice(0, 2);

  const share = async () => {
    const url = new URL(exchangeLink, window.location.origin).toString();
    try {
      if (navigator.share) await navigator.share({ title: rfx.title, url });
      else await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(() => setShared(false), 1800);
    } catch {
      // Share cancellation is not an error state for the discovery card.
    }
  };

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
      <div className={cn("p-4", compact && "p-3")}>
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={onSelect}
            aria-pressed={selected}
            className="min-w-0 flex-1 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-600">
              <span>{discovery?.rfxType || "RFx opportunity"}</span>
              {discovery?.issuerVerified ? (
                <span className="inline-flex items-center gap-0.5 normal-case tracking-normal text-emerald-700" title="Verified issuer">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verified
                </span>
              ) : null}
            </div>
            <h3 className={cn("mt-1 font-bold leading-5 text-slate-950", compact ? "line-clamp-2 text-sm" : "text-[15px]")}>{rfx.title}</h3>
            <p className="mt-1 truncate text-[11px] font-semibold text-slate-500">{discovery?.issuerDisplayName || rfx.createdByName || "Exchange issuer"}</p>
          </button>
          <button
            type="button"
            disabled={!onSave || saving}
            onClick={async () => {
              if (!onSave) return;
              setSaving(true);
              try { await onSave(!saved); } finally { setSaving(false); }
            }}
            className={cn(
              "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-500",
              saved ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-500 hover:bg-slate-50",
              (!onSave || saving) && "opacity-50",
            )}
            aria-label={saved ? "Remove saved opportunity" : "Save opportunity"}
            aria-pressed={saved}
            title={saved ? "Saved" : "Save opportunity"}
          >
            <Star className={cn("h-4 w-4", saved && "fill-current")} aria-hidden="true" />
          </button>
        </div>

        {!compact ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{rfx.description}</p> : null}

        <dl className="mt-3 grid gap-1.5 text-[11px] text-slate-600">
          <div className="flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <dt className="sr-only">Place of performance</dt>
            <dd className="min-w-0 truncate">
              {location}
              {discovery?.distanceMiles !== undefined ? ` · ${discovery.distanceMiles.toFixed(discovery.distanceMiles < 10 ? 1 : 0)} mi` : ""}
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
              <dd className="truncate">
                {industryLabels.slice(0, 2).join(" · ")}
                {industryLabels.length > 2 ? ` · +${industryLabels.length - 2}` : ""}
              </dd>
            </div>
          ) : null}
        </dl>

        {(highValueStates.length || discovery?.capabilityKeywords.length) ? (
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Opportunity indicators">
            {highValueStates.map((state) => (
              <span key={state} className={cn(
                "inline-flex min-h-6 items-center rounded-full px-2 text-[10px] font-bold",
                state === "Closing soon" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700",
              )}>
                {state === "Closing soon" ? <Clock3 className="mr-1 h-3 w-3" aria-hidden="true" /> : null}
                {state === "Teaming suitable" ? <Users className="mr-1 h-3 w-3" aria-hidden="true" /> : null}
                {state}
              </span>
            ))}
            {discovery?.capabilityKeywords.slice(0, 1).map((capability) => (
              <span key={capability} className="inline-flex min-h-6 max-w-[12rem] items-center truncate rounded-full bg-indigo-50 px-2 text-[10px] font-bold text-indigo-700">{capability}</span>
            ))}
            {(discovery?.capabilityKeywords.length ?? 0) > 1 ? (
              <span className="inline-flex min-h-6 items-center rounded-full bg-indigo-50 px-2 text-[10px] font-bold text-indigo-700">+{(discovery?.capabilityKeywords.length ?? 1) - 1} capabilities</span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2.5">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[10px] font-semibold text-slate-500">
          {discovery?.relationship.responded ? <><Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> Responded</> : titleCaseExchangeStatus(rfx.status)}
        </span>
        <div className="flex items-center gap-1">
          <details className="relative">
            <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg text-slate-500 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label="More opportunity actions" title="More actions">
              <Ellipsis className="h-4 w-4" aria-hidden="true" />
            </summary>
            <div className="absolute bottom-[calc(100%+0.35rem)] right-0 z-40 min-w-40 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
              <button type="button" onClick={() => void share()} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500">
                {shared ? <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <Share2 className="h-4 w-4" aria-hidden="true" />}
                {shared ? "Link copied" : "Share"}
              </button>
              {discovery?.teamingSuitable ? (
                <Link href={`/rfx/team?rfxId=${encodeURIComponent(rfx.id)}`} className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500">
                  <Users className="h-4 w-4" aria-hidden="true" /> Team up
                </Link>
              ) : null}
            </div>
          </details>
          <button
            type="button"
            onClick={onSelect}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white outline-none hover:bg-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            Review <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </button>
          <Link href={destination} className="sr-only">Open full opportunity details</Link>
        </div>
      </div>
    </article>
  );
}
