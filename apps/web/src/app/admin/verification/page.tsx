"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { db } from "@/lib/firebase";
import {
  enrichmentSearchFn,
  type EnrichmentCandidate,
  verificationFlagFn,
  verificationReviewFn,
} from "@/lib/functions";
import type {
  ProfileDoc,
  VerificationAuditEntry,
  VerificationDocument,
  VerificationDocumentStatus,
} from "@hi/shared";
import { collection, getDocs, query, where } from "firebase/firestore";
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  Flag,
  Loader2,
  Search,
  ShieldCheck,
  XCircle,
} from "lucide-react";

type QueueItem = {
  uid: string;
  businessName: string;
  displayName: string;
  email: string;
  verificationStatus: ProfileDoc["verificationStatus"];
  pendingDocCount: number;
  rejectedDocCount: number;
  approvedDocCount: number;
  latestUploadAt: number;
};

type UserLite = {
  uid: string;
  displayName?: string;
  email?: string;
};

type ReviewQueueFilter = "all" | "pending" | "rejected" | "verified";

export default function AdminVerificationPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminVerificationContent />
    </RequireAuth>
  );
}

function AdminVerificationContent() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [queueFilter, setQueueFilter] = useState<ReviewQueueFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUid, setSelectedUid] = useState<string>("");

  const [profilesByUid, setProfilesByUid] = useState<Record<string, ProfileDoc>>({});
  const [docsByUid, setDocsByUid] = useState<Record<string, VerificationDocument[]>>({});
  const [usersByUid, setUsersByUid] = useState<Record<string, UserLite>>({});
  const [auditEntries, setAuditEntries] = useState<VerificationAuditEntry[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const [docNotes, setDocNotes] = useState<Record<string, string>>({});
  const [finalReviewNote, setFinalReviewNote] = useState("");
  const [flagReason, setFlagReason] = useState("");
  const [enrichmentCandidates, setEnrichmentCandidates] = useState<EnrichmentCandidate[]>([]);
  const [searchingEnrichment, setSearchingEnrichment] = useState(false);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profileSnap, docsSnap, usersSnap] = await Promise.all([
        getDocs(query(collection(db, "profiles"), where("verificationStatus", "in", ["pending", "rejected", "verified"]))),
        getDocs(collection(db, "verificationDocuments")),
        getDocs(collection(db, "users")),
      ]);

      const nextProfiles: Record<string, ProfileDoc> = {};
      profileSnap.docs.forEach((docSnap) => {
        const profile = docSnap.data() as ProfileDoc;
        nextProfiles[profile.uid] = profile;
      });

      const nextDocsByUid: Record<string, VerificationDocument[]> = {};
      docsSnap.docs.forEach((docSnap) => {
        const doc = docSnap.data() as VerificationDocument;
        if (!nextDocsByUid[doc.uid]) nextDocsByUid[doc.uid] = [];
        nextDocsByUid[doc.uid].push(doc);
      });

      Object.keys(nextDocsByUid).forEach((uid) => {
        nextDocsByUid[uid].sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
      });

      const nextUsers: Record<string, UserLite> = {};
      usersSnap.docs.forEach((docSnap) => {
        const user = docSnap.data() as UserLite;
        if (user.uid) {
          nextUsers[user.uid] = user;
        }
      });

      setProfilesByUid(nextProfiles);
      setDocsByUid(nextDocsByUid);
      setUsersByUid(nextUsers);

      const initialUid =
        selectedUid && nextProfiles[selectedUid]
          ? selectedUid
          : Object.keys(nextProfiles).sort((a, b) => {
              const aTs = nextProfiles[a].verificationSubmittedAt || nextProfiles[a].updatedAt || 0;
              const bTs = nextProfiles[b].verificationSubmittedAt || nextProfiles[b].updatedAt || 0;
              return bTs - aTs;
            })[0] || "";
      setSelectedUid(initialUid);
    } catch (err) {
      console.error("Failed to load verification queue", err);
      setError("Failed to load verification queue.");
    } finally {
      setLoading(false);
    }
  }, [selectedUid]);

  const loadAudit = useCallback(async (uid: string) => {
    if (!uid) {
      setAuditEntries([]);
      return;
    }
    setLoadingAudit(true);
    try {
      const snap = await getDocs(query(collection(db, "verificationAuditLog"), where("uid", "==", uid)));
      const entries = snap.docs.map((d) => d.data() as VerificationAuditEntry);
      entries.sort((a, b) => b.createdAt - a.createdAt);
      setAuditEntries(entries);
    } catch (err) {
      console.error("Failed to load verification audit", err);
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    loadAudit(selectedUid);
    setDocNotes({});
    setFinalReviewNote("");
    setFlagReason("");
    setEnrichmentCandidates([]);
  }, [selectedUid, loadAudit]);

  const queueItems = useMemo(() => {
    const items: QueueItem[] = Object.values(profilesByUid).map((profile) => {
      const docs = docsByUid[profile.uid] || [];
      const user = usersByUid[profile.uid];
      const pending = docs.filter((d) => d.status === "pending").length;
      const rejected = docs.filter((d) => d.status === "rejected").length;
      const approved = docs.filter((d) => d.status === "approved").length;
      const latestUploadAt = docs.reduce((acc, d) => Math.max(acc, d.uploadedAt || 0), profile.verificationSubmittedAt || 0);
      return {
        uid: profile.uid,
        businessName: profile.businessName || "Unnamed business",
        displayName: user?.displayName || "Unknown",
        email: user?.email || "",
        verificationStatus: profile.verificationStatus || "none",
        pendingDocCount: pending,
        rejectedDocCount: rejected,
        approvedDocCount: approved,
        latestUploadAt,
      };
    });

    const filtered = items.filter((item) => {
      if (queueFilter !== "all" && item.verificationStatus !== queueFilter) {
        return false;
      }
      if (!searchTerm.trim()) return true;
      const q = searchTerm.toLowerCase();
      return (
        item.businessName.toLowerCase().includes(q) ||
        item.email.toLowerCase().includes(q) ||
        item.uid.toLowerCase().includes(q)
      );
    });

    return filtered.sort((a, b) => b.latestUploadAt - a.latestUploadAt);
  }, [profilesByUid, docsByUid, usersByUid, queueFilter, searchTerm]);

  const selectedProfile = selectedUid ? profilesByUid[selectedUid] : undefined;
  const selectedDocs = selectedUid ? docsByUid[selectedUid] || [] : [];

  const updateDocumentStatus = async (document: VerificationDocument, status: "approved" | "rejected") => {
    if (!selectedUid) return;
    setSaving(true);
    setError(null);
    try {
      await verificationReviewFn({
        uid: selectedUid,
        documentId: document.id,
        status,
        reviewNote: docNotes[document.id] || "",
      });
      await Promise.all([loadQueue(), loadAudit(selectedUid)]);
    } catch (err) {
      console.error("Failed document review", err);
      setError("Failed to update document status.");
    } finally {
      setSaving(false);
    }
  };

  const updateFinalStatus = async (status: "pending" | "verified" | "rejected" | "none") => {
    if (!selectedUid) return;
    setSaving(true);
    setError(null);
    try {
      await verificationReviewFn({
        uid: selectedUid,
        finalStatus: status,
        reviewNote: finalReviewNote.trim(),
      });
      await Promise.all([loadQueue(), loadAudit(selectedUid)]);
    } catch (err) {
      console.error("Failed final status update", err);
      setError("Failed to update verification status.");
    } finally {
      setSaving(false);
    }
  };

  const flagAccount = async () => {
    if (!selectedUid || !flagReason.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await verificationFlagFn({ uid: selectedUid, reason: flagReason.trim() });
      setFlagReason("");
      await loadAudit(selectedUid);
    } catch (err) {
      console.error("Failed flag action", err);
      setError("Failed to flag account.");
    } finally {
      setSaving(false);
    }
  };

  const refreshEnrichmentCandidates = async () => {
    if (!selectedProfile?.businessName) return;
    setSearchingEnrichment(true);
    setError(null);
    try {
      const { data } = await enrichmentSearchFn({
        businessName: selectedProfile.businessName,
        uei: selectedProfile.uei,
        cage: selectedProfile.cageCode,
        duns: selectedProfile.duns,
      });
      setEnrichmentCandidates(data.candidates || []);
    } catch (err) {
      console.error("Failed to fetch enrichment candidates", err);
      setError("Failed to refresh enrichment candidates.");
    } finally {
      setSearchingEnrichment(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-[1500px] space-y-5">
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Verification Operations Panel</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review verification queues, inspect enrichment + docs side-by-side, apply approvals/rejections, and audit actions.
          </p>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
            <aside className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search business, email, uid"
                  className="w-full rounded-xl border border-slate-200 py-2 pl-10 pr-3 text-sm"
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {(["all", "pending", "rejected", "verified"] as ReviewQueueFilter[]).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setQueueFilter(filter)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                      queueFilter === filter
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-600"
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              <div className="mt-3 max-h-[70vh] space-y-2 overflow-auto pr-1">
                {queueItems.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                    No queue items.
                  </div>
                ) : (
                  queueItems.map((item) => {
                    const active = item.uid === selectedUid;
                    return (
                      <button
                        key={item.uid}
                        onClick={() => setSelectedUid(item.uid)}
                        className={`w-full rounded-lg border p-3 text-left transition ${
                          active
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-sm font-bold">{item.businessName}</div>
                          <StatusPill status={item.verificationStatus} inverted={active} />
                        </div>
                        <div className={`mt-1 text-[11px] ${active ? "text-slate-300" : "text-slate-500"}`}>{item.email || item.uid}</div>
                        <div className="mt-2 flex gap-1 text-[10px] font-semibold">
                          <MiniMetric label="Pending" value={item.pendingDocCount} active={active} />
                          <MiniMetric label="Rejected" value={item.rejectedDocCount} active={active} />
                          <MiniMetric label="Approved" value={item.approvedDocCount} active={active} />
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </aside>

            <main className="space-y-4">
              {!selectedProfile ? (
                <div className="rounded-2xl bg-white p-10 text-center text-sm text-slate-500 shadow-sm ring-1 ring-slate-200">
                  Select a queue item to review profile, enrichment data, documents, and audit log.
                </div>
              ) : (
                <>
                  <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-xl font-bold text-slate-900">{selectedProfile.businessName || "Unnamed business"}</h2>
                        <p className="text-xs text-slate-500">
                          UID: {selectedProfile.uid} · Submitted {selectedProfile.verificationSubmittedAt ? formatDate(selectedProfile.verificationSubmittedAt) : "—"}
                        </p>
                      </div>
                      <StatusPill status={selectedProfile.verificationStatus || "none"} />
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <InfoCell label="UEI" value={selectedProfile.uei || "—"} />
                      <InfoCell label="DUNS" value={selectedProfile.duns || "—"} />
                      <InfoCell label="CAGE" value={selectedProfile.cageCode || "—"} />
                      <InfoCell label="Readiness" value={selectedProfile.readinessTier || "—"} />
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-3">
                    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-bold text-slate-900">Profile + Enrichment</h3>
                        <button
                          onClick={refreshEnrichmentCandidates}
                          disabled={searchingEnrichment}
                          className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600"
                        >
                          {searchingEnrichment ? "Searching..." : "Refresh candidates"}
                        </button>
                      </div>

                      <div className="mt-3 space-y-2 text-xs text-slate-700">
                        <InfoCell label="Verification status" value={selectedProfile.verificationStatus || "none"} />
                        <InfoCell label="Enrichment source" value={selectedProfile.enrichmentSource || "—"} />
                        <InfoCell label="Enrichment match ID" value={selectedProfile.enrichmentMatchId || "—"} />
                        <InfoCell label="Linked at" value={selectedProfile.enrichmentLinkedAt ? formatDate(selectedProfile.enrichmentLinkedAt) : "—"} />
                        <InfoCell
                          label="Attestation"
                          value={selectedProfile.attestationTimestamp ? `Signed ${formatDate(selectedProfile.attestationTimestamp)}` : "Not signed"}
                        />
                      </div>

                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Top enrichment candidates</div>
                        {enrichmentCandidates.length === 0 ? (
                          <p className="mt-1 text-xs text-slate-500">No candidate refresh yet.</p>
                        ) : (
                          <div className="mt-1 space-y-1">
                            {enrichmentCandidates.slice(0, 4).map((candidate) => (
                              <div key={candidate.matchId} className="rounded-md border border-slate-200 bg-white p-2">
                                <p className="text-xs font-semibold text-slate-800">{candidate.legalName}</p>
                                <p className="text-[11px] text-slate-500">
                                  {candidate.city || "Unknown city"}, {candidate.state || "Unknown state"} · {candidate.source}
                                </p>
                                <p className="text-[11px] text-slate-500">Score {candidate.confidenceScore}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200 xl:col-span-2">
                      <h3 className="text-sm font-bold text-slate-900">Verification Documents</h3>
                      {selectedDocs.length === 0 ? (
                        <p className="mt-3 text-sm text-slate-500">No documents uploaded.</p>
                      ) : (
                        <div className="mt-3 space-y-3">
                          {selectedDocs.map((document) => (
                            <div key={document.id} className="rounded-lg border border-slate-200 p-3">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">{document.label}</p>
                                  <p className="text-[11px] text-slate-500">
                                    {document.type} · Uploaded {formatDate(document.uploadedAt)}
                                  </p>
                                </div>
                                <StatusPill status={document.status} />
                              </div>

                              <div className="mt-2 flex flex-wrap gap-2">
                                {document.downloadUrl ? (
                                  <a
                                    href={document.downloadUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" /> Open document
                                  </a>
                                ) : (
                                  <span className="text-[11px] text-slate-500">No download URL</span>
                                )}
                              </div>

                              <textarea
                                rows={2}
                                value={docNotes[document.id] || ""}
                                onChange={(e) => setDocNotes((prev) => ({ ...prev, [document.id]: e.target.value }))}
                                placeholder="Review note (required for meaningful audit context)"
                                className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                              />

                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  onClick={() => updateDocumentStatus(document, "approved")}
                                  disabled={saving}
                                  className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 disabled:opacity-60"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                                </button>
                                <button
                                  onClick={() => updateDocumentStatus(document, "rejected")}
                                  disabled={saving}
                                  className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-red-700 disabled:opacity-60"
                                >
                                  <XCircle className="h-3.5 w-3.5" /> Reject
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                      <h3 className="text-sm font-bold text-slate-900">Final Verification Decision</h3>
                      <textarea
                        rows={3}
                        value={finalReviewNote}
                        onChange={(e) => setFinalReviewNote(e.target.value)}
                        placeholder="Decision note (stored in status_changed audit)"
                        className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={() => updateFinalStatus("verified")}
                          disabled={saving}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700"
                        >
                          <ShieldCheck className="h-3.5 w-3.5" /> Mark verified
                        </button>
                        <button
                          onClick={() => updateFinalStatus("pending")}
                          disabled={saving}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700"
                        >
                          <Clock3 className="h-3.5 w-3.5" /> Keep pending
                        </button>
                        <button
                          onClick={() => updateFinalStatus("rejected")}
                          disabled={saving}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-red-700"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Mark rejected
                        </button>
                      </div>

                      <div className="mt-4 border-t border-slate-100 pt-3">
                        <label className="text-xs font-semibold text-slate-700">Flag suspicious account</label>
                        <textarea
                          rows={2}
                          value={flagReason}
                          onChange={(e) => setFlagReason(e.target.value)}
                          placeholder="Reason for compliance/security flag"
                          className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
                        />
                        <button
                          onClick={flagAccount}
                          disabled={saving || !flagReason.trim()}
                          className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 disabled:opacity-60"
                        >
                          <Flag className="h-3.5 w-3.5" /> Create flag
                        </button>
                      </div>
                    </section>

                    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                      <h3 className="text-sm font-bold text-slate-900">Audit Trail</h3>
                      {loadingAudit ? (
                        <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                          <Loader2 className="h-4 w-4 animate-spin" /> Loading audit entries...
                        </div>
                      ) : auditEntries.length === 0 ? (
                        <p className="mt-3 text-sm text-slate-500">No audit events yet.</p>
                      ) : (
                        <div className="mt-3 max-h-[320px] space-y-2 overflow-auto pr-1">
                          {auditEntries.map((entry) => (
                            <div key={entry.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-700">{entry.action}</div>
                              <div className="text-[11px] text-slate-500">{formatDate(entry.createdAt)} · by {entry.performedBy}</div>
                              {entry.details ? <p className="mt-1 text-xs text-slate-700">{entry.details}</p> : null}
                              {(entry.previousValue || entry.newValue) ? (
                                <p className="mt-1 text-[11px] text-slate-500">
                                  {entry.previousValue || "—"} → {entry.newValue || "—"}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </>
              )}
            </main>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StatusPill({
  status,
  inverted = false,
}: {
  status: ProfileDoc["verificationStatus"] | VerificationDocumentStatus;
  inverted?: boolean;
}) {
  const style =
    status === "verified" || status === "approved"
      ? inverted
        ? "bg-emerald-200 text-emerald-900"
        : "bg-emerald-50 text-emerald-700 border border-emerald-200"
      : status === "pending"
      ? inverted
        ? "bg-amber-200 text-amber-900"
        : "bg-amber-50 text-amber-700 border border-amber-200"
      : status === "rejected"
      ? inverted
        ? "bg-red-200 text-red-900"
        : "bg-red-50 text-red-700 border border-red-200"
      : inverted
      ? "bg-slate-300 text-slate-900"
      : "bg-slate-100 text-slate-600 border border-slate-200";

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style}`}>
      {status}
    </span>
  );
}

function MiniMetric({ label, value, active }: { label: string; value: number; active: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>
      {label}: {value}
    </span>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-xs text-slate-800">{value}</div>
    </div>
  );
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
