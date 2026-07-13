import Link from "next/link";
import type { RfxDoc, TerritoryDoc } from "@hi/shared";
import { CalendarDays, ExternalLink, MapPin, Tags } from "lucide-react";
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
  if (rfx) {
    const destination = manageable ? `/rfx/evaluate?id=${encodeURIComponent(rfx.id)}` : `/rfx/detail?id=${encodeURIComponent(rfx.id)}`;
    return (
      <div className="space-y-5 p-5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-indigo-600">RFx opportunity</p>
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
        <Link
          href={destination}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          {manageable ? "Open RFx evaluation" : "View full RFx details"} <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
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

  return <p className="p-5 text-sm text-slate-500">Select an RFx or territory to inspect its details.</p>;
}
