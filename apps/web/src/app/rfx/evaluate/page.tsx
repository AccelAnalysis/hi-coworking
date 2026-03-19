"use client";

import { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import {
  getRfxFromFirestore,
  subscribeToRfxResponses,
  updateRfxResponseStatus,
  updateRfxInFirestore,
} from "@/lib/firestore";
import { computeRfxScores } from "@hi/shared";
import type { RfxDoc, RfxResponseDoc, EvaluationCriterion } from "@hi/shared";
import {
  Loader2,
  ArrowLeft,
  Check,
  X,
  Trophy,
  FileText,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Award,
  Lock,
} from "lucide-react";

/** Map a response to its numeric criterion values for scoring */
function extractNumericValues(
  resp: RfxResponseDoc,
  criteria: EvaluationCriterion[]
): Record<string, number> {
  const vals: Record<string, number> = {};
  for (const c of criteria) {
    const id = c.id.toLowerCase();
    if (id === "price" && resp.bidAmount != null) vals[c.id] = resp.bidAmount;
    else if (
      (id === "experience" || id.includes("past performance")) &&
      resp.experience != null
    )
      vals[c.id] = resp.experience;
    else if (id === "timeline" && resp.timeline != null) vals[c.id] = resp.timeline;
    else if (
      (id === "skills" || id.includes("technical")) &&
      resp.skills
    )
      vals[c.id] = resp.skills.length > 0 ? Math.min(resp.skills.length / 10, 10) : 0;
    else if (
      (id === "credentials" || id.includes("certif") || id.includes("licen")) &&
      resp.credentials
    )
      vals[c.id] = resp.credentials.length;
    else if (id === "references" && resp.references)
      vals[c.id] = resp.references.length > 0 ? Math.min(resp.references.length / 20, 10) : 0;
  }
  return vals;
}

export default function RfxEvaluatePage() {
  return (
    <RequireAuth>
      <Suspense fallback={<AppShell><div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div></AppShell>}>
        <EvaluateContent />
      </Suspense>
    </RequireAuth>
  );
}

function EvaluateContent() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const rfxId = searchParams.get("id") ?? "";

  const [rfx, setRfx] = useState<RfxDoc | null>(null);
  const [responses, setResponses] = useState<RfxResponseDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rfxId) return;
    getRfxFromFirestore(rfxId).then((data) => {
      setRfx(data);
      setLoading(false);
    });
  }, [rfxId]);

  useEffect(() => {
    if (!rfxId) return;
    const unsub = subscribeToRfxResponses(rfxId, (data) => {
      setResponses(data);
    });
    return () => unsub();
  }, [rfxId]);

  const scoredResponses = useMemo(() => {
    if (!rfx || responses.length === 0) return [];

    const criteria = rfx.evaluationCriteria;
    const allValues = responses.map((r) => extractNumericValues(r, criteria));

    return responses
      .map((resp, i) => {
        const vals = allValues[i];
        const { criteriaScores, totalScore } = computeRfxScores(vals, allValues, criteria);
        return { ...resp, criteriaScores, totalScore };
      })
      .sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0));
  }, [rfx, responses]);

  const handleAccept = useCallback(
    async (resp: RfxResponseDoc & { criteriaScores?: Record<string, number>; totalScore?: number }) => {
      setActionLoading(resp.id);
      setError(null);
      try {
        await updateRfxResponseStatus(resp.id, "accepted", {
          criteriaScores: resp.criteriaScores ?? {},
          totalScore: resp.totalScore ?? 0,
        });
      } catch (err) {
        console.error("Failed to accept response:", err);
        setError("Failed to update response status.");
      } finally {
        setActionLoading(null);
      }
    },
    []
  );

  const handleDecline = useCallback(async (respId: string) => {
    setActionLoading(respId);
    setError(null);
    try {
      await updateRfxResponseStatus(respId, "declined");
    } catch (err) {
      console.error("Failed to decline response:", err);
      setError("Failed to update response status.");
    } finally {
      setActionLoading(null);
    }
  }, []);

  const handleAwardRfx = useCallback(async () => {
    if (!rfx) return;
    try {
      await updateRfxInFirestore(rfx.id, { status: "awarded" });
      setRfx((prev) => (prev ? { ...prev, status: "awarded" } : prev));
    } catch (err) {
      console.error("Failed to award RFx:", err);
      setError("Failed to update RFx status.");
    }
  }, [rfx]);

  const handleCloseRfx = useCallback(async () => {
    if (!rfx) return;
    try {
      await updateRfxInFirestore(rfx.id, { status: "closed" });
      setRfx((prev) => (prev ? { ...prev, status: "closed" } : prev));
    } catch (err) {
      console.error("Failed to close RFx:", err);
      setError("Failed to update RFx status.");
    }
  }, [rfx]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  if (!rfx) {
    return (
      <AppShell>
        <div className="text-center py-20">
          <h2 className="text-xl font-bold text-slate-900 mb-2">RFx Not Found</h2>
          <Link href="/rfx" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
            ← Back to RFx Marketplace
          </Link>
        </div>
      </AppShell>
    );
  }

  const isOwner = rfx.createdBy === user?.uid;
  const hasAccepted = scoredResponses.some((r) => r.status === "accepted");

  if (!isOwner) {
    return (
      <AppShell>
        <div className="text-center py-20">
          <Lock className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Access Restricted</h2>
          <p className="text-slate-500 mb-4">Only the RFx issuer can access the evaluation view.</p>
          <Link href={`/rfx/detail?id=${rfx.id}`} className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
            ← View RFx Details
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto">
        <Link
          href="/rfx"
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-6 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to RFx Marketplace
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-1">
              Evaluate Responses
            </h1>
            <p className="text-slate-500 text-sm">{rfx.title}</p>
            <div className="flex items-center gap-2 mt-2">
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wide ${
                  rfx.status === "open"
                    ? "bg-emerald-50 text-emerald-600"
                    : rfx.status === "awarded"
                    ? "bg-indigo-50 text-indigo-600"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {rfx.status}
              </span>
              <span className="text-xs text-slate-400">
                {scoredResponses.length} response{scoredResponses.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            {rfx.status === "open" && hasAccepted && (
              <button
                onClick={handleAwardRfx}
                className="rounded-full px-5 py-2.5 bg-emerald-600 text-white text-sm font-medium shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 transition-all flex items-center gap-1.5"
              >
                <Trophy className="h-4 w-4" />
                Award & Close
              </button>
            )}
            {rfx.status === "open" && (
              <button
                onClick={handleCloseRfx}
                className="rounded-full px-5 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition-all"
              >
                Close RFx
              </button>
            )}
          </div>
        </div>

        {rfx.evaluationCriteria.length > 0 && (
          <div className="p-4 rounded-xl bg-slate-50 ring-1 ring-slate-200 mb-6">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Scoring Weights
            </h3>
            <div className="flex flex-wrap gap-3">
              {rfx.evaluationCriteria.map((c) => (
                <div key={c.id} className="flex items-center gap-1.5 text-sm">
                  <span className="font-medium text-slate-700">{c.label}</span>
                  <span className="text-xs font-bold text-slate-900 bg-white px-1.5 py-0.5 rounded">
                    {c.weight}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 rounded-lg p-3 mb-6">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {scoredResponses.length === 0 ? (
          <div className="text-center py-20">
            <FileText className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-slate-900 mb-1">No responses yet</h3>
            <p className="text-sm text-slate-500">Responses will appear here as vendors submit bids.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {scoredResponses.map((resp, rank) => {
              const isExpanded = expandedRow === resp.id;
              const isAccepted = resp.status === "accepted";
              const isDeclined = resp.status === "declined";
              const isActing = actionLoading === resp.id;

              return (
                <div
                  key={resp.id}
                  className={`rounded-xl bg-white shadow-sm ring-1 transition-all ${
                    isAccepted
                      ? "ring-emerald-300 bg-emerald-50/30"
                      : isDeclined
                      ? "ring-slate-200 opacity-60"
                      : "ring-slate-200"
                  }`}
                >
                  <button
                    onClick={() => setExpandedRow(isExpanded ? null : resp.id)}
                    className="w-full p-4 flex items-center gap-4 text-left"
                  >
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                        rank === 0
                          ? "bg-amber-100 text-amber-700"
                          : rank === 1
                          ? "bg-slate-200 text-slate-600"
                          : rank === 2
                          ? "bg-orange-100 text-orange-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {rank + 1}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 truncate">
                          {resp.respondentBusinessName || resp.respondentName || "Unknown"}
                        </span>
                        {isAccepted && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 uppercase tracking-wide">
                            Accepted
                          </span>
                        )}
                        {isDeclined && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500 uppercase tracking-wide">
                            Declined
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                        {resp.bidAmount != null && (
                          <span className="font-medium text-slate-600">
                            ${resp.bidAmount.toLocaleString()}
                          </span>
                        )}
                        {resp.experience != null && (
                          <span>{resp.experience} yr exp</span>
                        )}
                        {resp.timeline != null && (
                          <span>{resp.timeline} wk</span>
                        )}
                        {resp.credentials && resp.credentials.length > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Award className="h-3 w-3" />
                            {resp.credentials.length}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-lg font-bold text-slate-900">
                        {resp.totalScore?.toFixed(1) ?? "—"}
                      </div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wide">Score</div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {resp.status === "pending" && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAccept(resp);
                            }}
                            disabled={isActing}
                            className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                            title="Accept"
                          >
                            {isActing ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Check className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDecline(resp.id);
                            }}
                            disabled={isActing}
                            className="p-1.5 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors disabled:opacity-50"
                            title="Decline"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </>
                      )}
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-slate-400 ml-1" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-slate-400 ml-1" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-slate-100 pt-4">
                      <div className="grid md:grid-cols-2 gap-6">
                        {resp.criteriaScores && Object.keys(resp.criteriaScores).length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                              Criterion Scores
                            </h4>
                            <div className="space-y-2">
                              {rfx.evaluationCriteria.map((c) => {
                                const score = resp.criteriaScores?.[c.id];
                                return (
                                  <div key={c.id} className="flex items-center gap-3">
                                    <span className="text-sm text-slate-600 w-40 truncate">{c.label}</span>
                                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${
                                          (score ?? 0) >= 75
                                            ? "bg-emerald-400"
                                            : (score ?? 0) >= 50
                                            ? "bg-amber-400"
                                            : "bg-red-400"
                                        }`}
                                        style={{ width: `${score ?? 0}%` }}
                                      />
                                    </div>
                                    <span className="text-xs font-bold text-slate-700 w-12 text-right">
                                      {score?.toFixed(1) ?? "—"}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div className="space-y-3">
                          {resp.skills && (
                            <div>
                              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                Skills & Approach
                              </h4>
                              <p className="text-sm text-slate-600">{resp.skills}</p>
                            </div>
                          )}
                          {resp.pastPerformance && (
                            <div>
                              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                Past Performance
                              </h4>
                              <p className="text-sm text-slate-600">{resp.pastPerformance}</p>
                            </div>
                          )}
                          {resp.credentials && resp.credentials.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                Credentials
                              </h4>
                              <div className="flex flex-wrap gap-1">
                                {resp.credentials.map((cred) => (
                                  <span
                                    key={cred}
                                    className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-600"
                                  >
                                    {cred}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {resp.references && (
                            <div>
                              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                References
                              </h4>
                              <p className="text-sm text-slate-600">{resp.references}</p>
                            </div>
                          )}
                          {resp.proposalText && (
                            <div>
                              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                                Proposal Summary
                              </h4>
                              <p className="text-sm text-slate-600">{resp.proposalText}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {((resp.proposalUrl) || (resp.uploadedDocuments && resp.uploadedDocuments.length > 0)) && (
                        <div className="mt-4 pt-4 border-t border-slate-100">
                          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                            Documents
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {resp.proposalUrl && (
                              <a
                                href={resp.proposalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                Proposal
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            {resp.uploadedDocuments?.map((doc) => (
                              <a
                                key={doc.requestedDocId}
                                href={doc.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                {doc.label}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
