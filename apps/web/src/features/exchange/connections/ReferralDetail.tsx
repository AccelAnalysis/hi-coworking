"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  Check,
  CircleDollarSign,
  FileCheck2,
  Link2,
  LockKeyhole,
  MessageSquareText,
  Send,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import type { ReferralWorkspaceRecord } from "../data/exchangeRun3Gateway";
import { ReferralTimeline } from "./ReferralTimeline";

function money(cents: number | undefined, currency = "USD"): string {
  if (cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function DetailSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Link2;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-indigo-600" aria-hidden="true" />
        <h3 className="text-sm font-bold text-slate-950">{title}</h3>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ReferralDetail({
  record,
  mutating,
  onSend,
  onRespond,
  onProgress,
  onReportTransaction,
  onConfirmTransaction,
}: {
  record: ReferralWorkspaceRecord;
  mutating: boolean;
  onSend: () => void;
  onRespond: (response: "accepted" | "declined") => void;
  onProgress: (status: "in_progress" | "converted" | "closed" | "withdrawn") => void;
  onReportTransaction: (collectedCents: number) => void;
  onConfirmTransaction: () => void;
}) {
  const [transactionAmount, setTransactionAmount] = useState("10000");
  const reportCents = Math.round(Number(transactionAmount) * 100);

  return (
    <article className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
      <header className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-indigo-700">{record.referralType.replaceAll("_", " ")}</p>
            <h2 className="mt-1 text-xl font-bold leading-7 text-slate-950 sm:text-2xl">{record.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{record.needSummary}</p>
          </div>
          <span className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-bold capitalize text-slate-700">
            {record.activeDispute ? "Disputed" : record.status.replaceAll("_", " ")}
          </span>
        </div>
        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div><dt className="text-xs text-slate-500">Referrer</dt><dd className="mt-0.5 font-semibold text-slate-900">{record.referrerLabel}</dd></div>
          <div><dt className="text-xs text-slate-500">Recipient</dt><dd className="mt-0.5 font-semibold text-slate-900">{record.recipientLabel}</dd></div>
          <div><dt className="text-xs text-slate-500">Industry</dt><dd className="mt-0.5 font-semibold text-slate-900">{record.category}</dd></div>
          <div><dt className="text-xs text-slate-500">Territory</dt><dd className="mt-0.5 font-semibold text-slate-900">{record.territoryLabel ?? "Not specified"}</dd></div>
        </dl>

        {record.activeDispute ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-950" role="status">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Additional verification is in progress. The dispute does not improve trust, confirmed impact, or payout state.</span>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {record.status === "draft" ? (
            <button type="button" onClick={onSend} disabled={mutating} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50">
              <Send className="h-4 w-4" aria-hidden="true" /> Send referral
            </button>
          ) : null}
          {record.direction === "received" && record.status === "sent" ? (
            <>
              <button type="button" onClick={() => onRespond("accepted")} disabled={mutating} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white outline-none hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50"><Check className="h-4 w-4" aria-hidden="true" /> Accept locked terms</button>
              <button type="button" onClick={() => onRespond("declined")} disabled={mutating} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"><X className="h-4 w-4" aria-hidden="true" /> Decline</button>
            </>
          ) : null}
          {record.status === "accepted" ? (
            <button type="button" onClick={() => onProgress("in_progress")} disabled={mutating} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"><ArrowRight className="h-4 w-4" aria-hidden="true" /> Start work</button>
          ) : null}
          {record.status === "in_progress" ? (
            <>
              <button type="button" onClick={() => onProgress("converted")} disabled={mutating} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white outline-none hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50"><BadgeCheck className="h-4 w-4" aria-hidden="true" /> Mark converted</button>
              <button type="button" onClick={() => onProgress("closed")} disabled={mutating} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50">Close without conversion</button>
            </>
          ) : null}
          {["sent", "accepted", "in_progress"].includes(record.status) && record.direction === "sent" ? (
            <button type="button" onClick={() => onProgress("withdrawn")} disabled={mutating} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-600 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50">Withdraw</button>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-2">
        <DetailSection title="Consent and contact disclosure" icon={ShieldCheck}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-500">Consent state</dt><dd className="mt-0.5 font-bold capitalize text-slate-900">{record.consentStatus.replaceAll("_", " ")}</dd></div>
            <div><dt className="text-xs text-slate-500">Contact disclosure</dt><dd className="mt-0.5 font-bold capitalize text-slate-900">{record.contactDisclosure.replaceAll("_", " ")}</dd></div>
          </dl>
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            {record.contactSummary ?? "No third-party contact data is required for this referral."}
          </p>
        </DetailSection>

        <DetailSection title="Compensation policy" icon={CircleDollarSign}>
          <p className="text-sm font-bold text-slate-950">{record.compensation.label}</p>
          <p className="mt-1 text-xs text-slate-600">
            {record.compensation.configured
              ? "Compensation is optional and does not define the referral. Accepted terms cannot be changed retroactively."
              : "This is a valid business referral with no compensation."}
          </p>
          {record.termsSnapshot ? (
            <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-indigo-800"><LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> Accepted terms snapshot</p>
              <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                <div><dt className="text-slate-500">Offer version</dt><dd className="font-bold text-slate-900">{record.termsSnapshot.serviceOfferVersion ?? "Direct terms"}</dd></div>
                <div><dt className="text-slate-500">Platform fee snapshot</dt><dd className="font-bold text-slate-900">{record.termsSnapshot.platformFeeBasisPoints} bps (1% of payout)</dd></div>
                <div><dt className="text-slate-500">Accepted by</dt><dd className="font-bold text-slate-900">{record.termsSnapshot.acceptedByLabel}</dd></div>
                <div><dt className="text-slate-500">Calculation version</dt><dd className="font-bold text-slate-900">v{record.termsSnapshot.calculationVersion}</dd></div>
              </dl>
            </div>
          ) : null}
        </DetailSection>
      </div>

      {record.compensation.configured && record.status === "converted" ? (
        <DetailSection title="Transaction and calculation" icon={FileCheck2}>
          <p className="text-xs leading-5 text-slate-600">Transaction reporting is separate from referral conversion. Reported values are not confirmed until the other party confirms them.</p>
          {record.commerceStatus === "awaiting_transaction" ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="text-xs font-bold text-slate-700">Collected transaction amount (USD)
                <input type="number" min="0" step="0.01" value={transactionAmount} onChange={(event) => setTransactionAmount(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500 sm:w-56" />
              </label>
              <button type="button" disabled={mutating || !Number.isSafeInteger(reportCents) || reportCents < 0} onClick={() => onReportTransaction(reportCents)} className="min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50">Report transaction</button>
            </div>
          ) : null}
          {record.commerceStatus === "awaiting_confirmation" ? (
            <button type="button" disabled={mutating || !record.latestTransactionReportId || record.latestTransactionReportVersion === undefined} onClick={onConfirmTransaction} className="mt-3 min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50">Confirm report and calculate</button>
          ) : null}
          {record.commerceStatus === "transaction_confirmed" ? (
            <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-950">Transaction confirmed. These accepted terms do not produce a cash calculation.</p>
          ) : null}
          {record.compensation.grossReferralPayoutCents !== undefined ? (
            <dl className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-slate-500">Gross referral payout</dt><dd className="mt-1 font-bold text-slate-950">{money(record.compensation.grossReferralPayoutCents, record.compensation.currency)}</dd></div>
              <div><dt className="text-xs text-slate-500">Platform fee · 100 bps</dt><dd className="mt-1 font-bold text-slate-950">{money(record.compensation.platformFeeCents, record.compensation.currency)}</dd></div>
              <div><dt className="text-xs text-slate-500">Net referrer payout</dt><dd className="mt-1 font-bold text-slate-950">{money(record.compensation.netReferrerPayoutCents, record.compensation.currency)}</dd></div>
            </dl>
          ) : null}
          {record.commerceStatus === "settlement_unavailable" ? (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-950">Calculation complete — platform settlement is not yet enabled.</p>
          ) : null}
        </DetailSection>
      ) : null}

      <DetailSection title="Linked Exchange records" icon={Link2}>
        {record.linkedEntities.length ? (
          <ul className="space-y-2">
            {record.linkedEntities.map((entity) => (
              <li key={`${entity.type}-${entity.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm">
                <span className="flex min-w-0 items-center gap-2 font-semibold text-slate-900">
                  {entity.type === "team" ? <Users className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" /> : <BriefcaseBusiness className="h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />}
                  <span className="truncate">{entity.label}</span>
                </span>
                {entity.type === "rfx" && entity.available ? (
                  <Link href={`/rfx/detail?id=${encodeURIComponent(entity.id)}`} className="shrink-0 text-xs font-bold text-indigo-700 underline-offset-2 hover:underline">View RFx</Link>
                ) : (
                  <span className="shrink-0 text-xs text-slate-500">{entity.available ? "Linked" : "Unavailable"}</span>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">No RFx, team, or program is linked.</p>}
      </DetailSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <DetailSection title="Timeline" icon={FileCheck2}><ReferralTimeline events={record.timeline} /></DetailSection>
        <div className="space-y-4">
          <DetailSection title="Notes" icon={MessageSquareText}>
            {record.notes.length ? (
              <ul className="space-y-2">{record.notes.map((note) => <li key={note.id} className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><p>{note.body}</p><p className="mt-1 text-[11px] text-slate-500">{note.authorLabel}</p></li>)}</ul>
            ) : <p className="text-sm text-slate-500">No private notes are attached.</p>}
          </DetailSection>
          <DetailSection title="Evidence" icon={FileCheck2}>
            <p className="text-sm text-slate-700">{record.evidenceCount} protected evidence item{record.evidenceCount === 1 ? "" : "s"}.</p>
            <p className="mt-1 text-xs text-slate-500">Evidence contents and paths never appear in analytics, suggestions, or timeline metadata.</p>
          </DetailSection>
        </div>
      </div>
    </article>
  );
}
