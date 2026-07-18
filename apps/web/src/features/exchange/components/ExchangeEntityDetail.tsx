"use client";

import Link from "next/link";
import { useState } from "react";
import type { RfxDoc, TerritoryDoc } from "@hi/shared";
import {
  CalendarDays,
  Check,
  Copy,
  ExternalLink,
  MapPin,
  Tags,
  Users,
  X,
} from "lucide-react";
import { formatExchangeDate, titleCaseExchangeStatus } from "../utils/formatting";

export function ExchangeEntityDetail({
  rfx,
  territory,
  manageable = false,
}: {
  rfx?: RfxDoc;
  territory?: TerritoryDoc;
  manageable?: boolean;
}) {
  const [teamingOpen, setTeamingOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (rfx) {
    const destination = manageable ? `/rfx/evaluate?id=${encodeURIComponent(rfx.id)}` : `/rfx/detail?id=${encodeURIComponent(rfx.id)}`;
    const referralHref = `/exchange?view=referrals&q=${encodeURIComponent(rfx.title)}`;
    const copyOpportunityLink = async () => {
      const href = `${window.location.origin}/exchange?view=opportunities&entity=rfx&selected=${encodeURIComponent(rfx.id)}`;
      await navigator.clipboard.writeText(href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    };

    return (
      <>
        <div className="space-y-5 p-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-600">Opportunity</p>
            <h2 className="mt-2 text-xl font-bold leading-7 text-slate-950">{rfx.title}</h2>
            <p className="mt-1 text-sm text-slate-500">{rfx.createdByName || "Exchange issuer"}</p>
          </div>
          <dl className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <div className="flex items-center gap-3">
              <MapPin className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Location</dt><dd>{rfx.location || "Location flexible"}</dd>
            </div>
            <div className="flex items-center gap-3">
              <CalendarDays className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Due date</dt><dd>Due {formatExchangeDate(rfx.dueDate)}</dd>
            </div>
            <div className="flex items-center gap-3">
              <Tags className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <dt className="sr-only">Status</dt><dd>{titleCaseExchangeStatus(rfx.status)} · {rfx.budget || "Budget not listed"}</dd>
            </div>
          </dl>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Opportunity summary</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{rfx.description}</p>
          </div>
          {rfx.naicsCodes?.length ? (
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">NAICS</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {rfx.naicsCodes.map((code) => <span key={code} className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">{code}</span>)}
              </div>
            </div>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            {!manageable ? (
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
