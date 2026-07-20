"use client";

import Link from "next/link";
import { useState } from "react";
import type { TerritoryDoc } from "@hi/shared";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  Clock3,
  Copy,
  DollarSign,
  ExternalLink,
  MapPin,
  Star,
  Users,
  X,
} from "lucide-react";
import type { ExchangeDiscoveryRfx } from "../data/opportunityDiscoveryGateway";
import { labelForNaics } from "../data/naicsCatalog";
import { formatExchangeDate, titleCaseExchangeStatus } from "../utils/formatting";
import { OpportunityGovernancePanel } from "./OpportunityGovernancePanel";

function relationshipSummary(rfx: ExchangeDiscoveryRfx): string {
  const relationship = rfx.discovery?.relationship;
  if (!relationship) return "Eligibility is confirmed in the secured response workflow.";
  if (relationship.managed) return "You manage this opportunity for the issuing organization.";
  if (relationship.responded) return "Your organization has already responded.";
  if (relationship.eligibleToRespond === false) {
    return relationship.eligibilityReason || "Your organization is not currently eligible to respond.";
  }
  if (relationship.eligibleToRespond) return "Your organization is eligible to respond.";
  if (rfx.dueDate && rfx.dueDate < Date.now()) return "The response deadline has passed.";
  return "Eligibility will be confirmed before a response can be submitted.";
}

export function ExchangeEntityDetail({
  rfx,
  territory,
  manageable = false,
  onSave,
}: {
  rfx?: ExchangeDiscoveryRfx;
  territory?: TerritoryDoc;
  manageable?: boolean;
  onSave?: (saved: boolean) => Promise<void> | void;
}) {
  const [teamingOpen, setTeamingOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);

  if (rfx) {
    const discovery = rfx.discovery;
    const saved = discovery?.relationship.saved ?? false;
    const destination = manageable ? `/rfx/evaluate?id=${encodeURIComponent(rfx.id)}` : `/rfx/detail?id=${encodeURIComponent(rfx.id)}`;
    const referralHref = `/exchange?view=referrals&q=${encodeURIComponent(rfx.title)}`;
    const teamHref = `/rfx/team?rfxId=${encodeURIComponent(rfx.id)}`;
    const copyOpportunityLink = async () => {
      const href = `${window.location.origin}/exchange?view=opportunities&entity=rfx&selected=${encodeURIComponent(rfx.id)}`;
      await navigator.clipboard.writeText(href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    };
    const industryLabels = discovery?.industryLabels.length
      ? discovery.industryLabels
      : (rfx.naicsCodes ?? []).map(labelForNaics).filter((value): value is string => Boolean(value));
    const confidence = (discovery?.locationConfidence ?? discovery?.geo?.confidence)
      ?.replaceAll("_", " ");

    return (
      <>
        <div className="space-y-5 p-5">
          <div>
            <p className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-600">
              {discovery?.rfxType || "Opportunity"}
              {discovery?.issuerVerified ? (
                <span className="inline-flex items-center gap-1 normal-case tracking-normal text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Verified issuer</span>
              ) : null}
            </p>
            <h2 className="mt-2 text-xl font-bold leading-7 text-slate-950">{rfx.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{discovery?.issuerDisplayName || rfx.createdByName || "Exchange issuer"}</p>
            {discovery?.rfxNumber ? <p className="mt-1 text-xs font-semibold text-slate-400">RFx {discovery.rfxNumber}</p> : null}
          </div>
          <dl className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Place of performance</dt>
              <dd>
                <span className="block">{discovery?.placeOfPerformance || rfx.location || (discovery?.workArrangement === "remote" ? "Remote" : "Location unavailable")}</span>
                {confidence ? <span className="mt-0.5 block text-xs capitalize text-slate-500">{confidence}{discovery?.distanceMiles !== undefined ? ` · ${discovery.distanceMiles.toFixed(1)} miles away` : ""}</span> : null}
              </dd>
            </div>
            <div className="flex items-start gap-3">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Due date</dt>
              <dd>
                <span className="block">Due {formatExchangeDate(rfx.dueDate)}{discovery?.deadlineTimezone ? ` (${discovery.deadlineTimezone})` : ""}</span>
                <span className="mt-0.5 block text-xs text-slate-500">Posted {formatExchangeDate(discovery?.postedAt ?? rfx.createdAt)} · Updated {formatExchangeDate(discovery?.updatedAt ?? rfx.updatedAt)}</span>
              </dd>
            </div>
            <div className="flex items-start gap-3">
              <DollarSign className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Budget</dt><dd>{rfx.budget || "Budget not disclosed"}</dd>
            </div>
            <div className="flex items-start gap-3">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Status</dt><dd>{titleCaseExchangeStatus(rfx.status)} · {relationshipSummary(rfx)}</dd>
            </div>
          </dl>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Opportunity summary</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{rfx.description}</p>
          </div>
          {(industryLabels.length || discovery?.capabilityKeywords.length) ? (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Industries and capabilities</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {industryLabels.map((label, index) => <span key={`${label}-${index}`} className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">{label}</span>)}
                {discovery?.capabilityKeywords.map((capability) => <span key={capability} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{capability}</span>)}
              </div>
              {rfx.naicsCodes?.length ? <p className="mt-2 text-[11px] text-slate-500">NAICS {rfx.naicsCodes.join(" · ")}</p> : null}
            </div>
          ) : null}
          <details open className="rounded-2xl border border-slate-200 bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">Requirements and eligibility</summary>
            <div className="space-y-3 border-t border-slate-100 p-4 text-sm text-slate-700">
              <p>{relationshipSummary(rfx)}</p>
              {discovery?.requiredCertifications.length ? <p><strong>Required certifications:</strong> {discovery.requiredCertifications.join(" · ")}</p> : null}
              {discovery?.setAsideDesignations.length ? <p><strong>Set-asides:</strong> {discovery.setAsideDesignations.join(" · ")}</p> : null}
              {discovery ? <p><strong>Contract structure:</strong> {discovery.primeClassification} · {discovery.awardClassification} award · {discovery.workArrangement.replaceAll("_", " ")}</p> : null}
            </div>
          </details>
          <OpportunityGovernancePanel rfxId={rfx.id} />
          <div className="grid gap-2 sm:grid-cols-2">
            {onSave ? (
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onSave(!saved);
                  } finally {
                    setSaving(false);
                  }
                }}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-800 outline-none hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 disabled:opacity-50"
                aria-pressed={saved}
              >
                <Star className={saved ? "h-4 w-4 fill-current" : "h-4 w-4"} aria-hidden="true" /> {saved ? "Saved" : "Save opportunity"}
              </button>
            ) : null}
            {!manageable && discovery?.teamingSuitable ? (
              <button
                type="button"
                onClick={() => setTeamingOpen(true)}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-sm font-bold text-white outline-none hover:bg-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                <Users className="h-4 w-4" aria-hidden="true" /> Team up
              </button>
            ) : null}
            <Link
              href={destination}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              {manageable ? "Open opportunity evaluation" : "View full details"} <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          {!manageable && discovery?.teamingSuitable ? (
            <Link href={teamHref} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-800 outline-none hover:bg-blue-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
              <Users className="h-4 w-4" aria-hidden="true" /> Open teaming workspace
            </Link>
          ) : null}
        </div>

        {teamingOpen ? (
          <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="presentation">
            <button type="button" className="absolute inset-0" onClick={() => setTeamingOpen(false)} aria-label="Close teaming options" />
            <section role="dialog" aria-modal="true" aria-labelledby="opportunity-teaming-title" className="relative z-10 w-full max-w-lg rounded-t-[2rem] bg-white p-5 shadow-2xl sm:rounded-[2rem] sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.16em] text-blue-700">Opportunity teaming</p>
                  <h2 id="opportunity-teaming-title" className="mt-1 text-xl font-black text-slate-950">Build a team for this opportunity</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">Keep the opportunity in context while you seek a capable partner, request an introduction, or share the opportunity directly.</p>
                </div>
                <button type="button" onClick={() => setTeamingOpen(false)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-blue-600" aria-label="Close teaming modal">
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-5 grid gap-3">
                <Link href={referralHref} onClick={() => setTeamingOpen(false)} className="flex min-h-14 items-center gap-3 rounded-2xl bg-blue-700 px-4 text-sm font-bold text-white outline-none hover:bg-blue-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2">
                  <Users className="h-5 w-5" aria-hidden="true" /> Request a partner introduction
                </Link>
                <button type="button" onClick={() => void copyOpportunityLink()} className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-200 px-4 text-left text-sm font-bold text-slate-800 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-600">
                  {copied ? <Check className="h-5 w-5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-5 w-5 text-blue-700" aria-hidden="true" />}
                  {copied ? "Opportunity link copied" : "Copy opportunity link to invite a company"}
                </button>
                <Link href={destination} onClick={() => setTeamingOpen(false)} className="flex min-h-14 items-center gap-3 rounded-2xl border border-slate-200 px-4 text-sm font-bold text-slate-800 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-600">
                  <ExternalLink className="h-5 w-5 text-blue-700" aria-hidden="true" /> Review full opportunity requirements
                </Link>
              </div>
            </section>
          </div>
        ) : null}
      </>
    );
  }

  if (territory) {
    const scheduled = territory.status === "scheduled";
    return (
      <div className="space-y-5 p-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-700">Territory</p>
          <h2 className="mt-2 text-xl font-bold text-slate-950">{territory.name}</h2>
          <p className="mt-1 text-sm text-slate-500">{territory.state} · FIPS {territory.fips}</p>
        </div>
        <div className={scheduled ? "rounded-2xl border border-amber-200 bg-amber-50 p-4" : "rounded-2xl border border-emerald-200 bg-emerald-50 p-4"}>
          <p className={scheduled ? "text-sm font-bold text-amber-900" : "text-sm font-bold text-emerald-900"}>{titleCaseExchangeStatus(territory.status)}</p>
          <p className={scheduled ? "mt-1 text-sm leading-6 text-amber-800" : "mt-1 text-sm leading-6 text-emerald-800"}>
            {scheduled
              ? `Scheduled for ${formatExchangeDate(territory.releaseDate)}. This status does not enable current transactions.`
              : "This territory is released for current Exchange discovery. Individual eligibility still depends on the relevant secured workflow."}
          </p>
        </div>
        {territory.notes ? <p className="text-sm leading-6 text-slate-700">{territory.notes}</p> : null}
        <Link
          href="/contact"
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          {scheduled ? "Ask about this release" : "Contact Hi Coworking"} <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return <p className="p-5 text-sm text-slate-500">Select an opportunity or territory to inspect its details.</p>;
}
