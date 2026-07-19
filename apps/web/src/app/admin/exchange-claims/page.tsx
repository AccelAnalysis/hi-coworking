"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  exchangeAdminListOrganizationClaimsFn,
  exchangeAdminReviewOrganizationClaimFn,
  type ExchangeOrganizationClaim,
} from "@/lib/functions";

export default function ExchangeClaimReviewPage() {
  return <RequireAuth requiredRole="admin"><ClaimReview /></RequireAuth>;
}

function ClaimReview() {
  const [claims, setClaims] = useState<ExchangeOrganizationClaim[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const result = await exchangeAdminListOrganizationClaimsFn({ status: "all" });
    setClaims(result.data.claims);
  }, []);
  useEffect(() => { load().catch(() => setError("Unable to load organization claims.")); }, [load]);

  const review = async (claim: ExchangeOrganizationClaim, decision: "approve" | "reject") => {
    const reviewNote = (notes[claim.id] || "").trim();
    if (!reviewNote) { setError("Add a review note before deciding a claim."); return; }
    setBusy(claim.id); setError("");
    try {
      await exchangeAdminReviewOrganizationClaimFn({ claimId: claim.id, decision, reviewNote });
      await load();
    } catch { setError("The claim could not be decided. It may already have been reviewed."); }
    finally { setBusy(null); }
  };

  const pendingClaims = claims.filter((claim) => claim.status === "pending");
  const history = claims.filter((claim) => claim.status !== "pending");
  return <AppShell><main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
    <h1 className="text-3xl font-bold text-slate-950">Organization claim review</h1>
    <p className="mt-2 text-slate-600">Approval atomically grants organization ownership and rejects competing pending claims.</p>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    <div className="mt-7 space-y-4">
      {pendingClaims.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500">No pending claims.</div>}
      {pendingClaims.map((claim) => <article key={claim.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap justify-between gap-3"><div><h2 className="font-bold text-slate-900">{claim.organizationName || claim.organizationId}</h2><p className="mt-1 text-sm text-slate-500">{claim.requesterEmail || claim.requestedBy}</p></div><span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">Pending</span></div>
        <p className="mt-3 text-sm text-slate-500">{[claim.organizationCity, claim.organizationState].filter(Boolean).join(", ")}{claim.organizationWebsite ? ` · ${claim.organizationWebsite}` : ""}{claim.organizationSources.length ? ` · ${claim.organizationSources.join(", ")}` : ""}</p><p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{claim.reason || "No claimant reason supplied."}</p>
        <label className="mt-4 block text-sm font-semibold text-slate-700">Review note<textarea value={notes[claim.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [claim.id]: event.target.value }))} maxLength={1000} className="mt-1.5 min-h-24 w-full rounded-xl border border-slate-300 p-3 font-normal" /></label>
        <div className="mt-4 flex gap-3"><button disabled={busy !== null} onClick={() => review(claim, "approve")} className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy === claim.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve</button><button disabled={busy !== null} onClick={() => review(claim, "reject")} className="inline-flex items-center gap-2 rounded-full border border-red-200 px-4 py-2 text-sm font-bold text-red-700 disabled:opacity-50"><X className="h-4 w-4" /> Reject</button></div>
      </article>)}
    </div>
    <section className="mt-10"><h2 className="text-xl font-bold text-slate-900">Review history</h2><div className="mt-4 space-y-3">{history.length === 0 ? <p className="text-sm text-slate-500">No decisions recorded.</p> : history.map((claim) => <div key={claim.id} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex justify-between gap-3"><strong className="text-sm">{claim.organizationName}</strong><span className={`text-xs font-bold ${claim.status === "approved" ? "text-emerald-700" : "text-red-700"}`}>{claim.status}</span></div><p className="mt-2 text-sm text-slate-600">{claim.reviewNote}</p><p className="mt-1 text-xs text-slate-400">Reviewed by {claim.reviewedBy}{claim.reviewedAt ? ` · ${new Date(claim.reviewedAt).toLocaleString()}` : ""}</p></div>)}</div></section>
  </main></AppShell>;
}
