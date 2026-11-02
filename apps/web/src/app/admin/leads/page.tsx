"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import { AppShell } from "@/components/AppShell";
import { collection, query, orderBy, limit, where, getDocs, doc, updateDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/lib/firebase";
import { callableErrorMessage } from "@/lib/callableError";
import {
  INTAKE_LEAD_TYPES,
  LEAD_FILTER_OPTIONS,
  WEB_LEAD_TYPES,
  filterLeads,
  fromIntakeRow,
  fromLeadDoc,
  leadDisplayName,
  leadKindLabel,
  leadsCsv,
  leadsCsvFilename,
  mergeLeads,
  readableSurveyAnswers,
  type IntakeAdminRow,
  type LeadFilter,
  type LeadKind,
  type UnifiedLead,
} from "@/lib/adminLeads";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Mail,
  User,
  Calendar,
  Star,
  Filter,
  Loader2,
  MessageSquare,
  ClipboardList,
  Download,
  Presentation,
  Zap,
  StickyNote,
} from "lucide-react";

const PAGE_SIZE = 25;
const FETCH_LIMIT = 500;
const NOTES_MAX = 4000;

const listIntake = httpsCallable<Record<string, never>, { rows: IntakeAdminRow[]; truncated: boolean }>(
  functions,
  "leadsAdmin_listIntake",
);
const setIntakeNotes = httpsCallable<{ id: string; notes: string }, { ok: boolean }>(
  functions,
  "leadsAdmin_setIntakeNotes",
);

export default function AdminLeadsPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AppShell>
        <LeadsContent />
      </AppShell>
    </RequireAuth>
  );
}

function typeBadge(kind: LeadKind): string {
  switch (kind) {
    case "survey":
      return "bg-indigo-100 text-indigo-700";
    case "contact":
      return "bg-sky-100 text-sky-700";
    case "expo":
      return "bg-amber-100 text-amber-800";
    case "power-now":
      return "bg-emerald-100 text-emerald-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function TypeIcon({ kind }: { kind: LeadKind }) {
  if (kind === "survey") return <ClipboardList className="h-3 w-3" aria-hidden="true" />;
  if (kind === "contact") return <MessageSquare className="h-3 w-3" aria-hidden="true" />;
  if (kind === "expo") return <Presentation className="h-3 w-3" aria-hidden="true" />;
  if (kind === "power-now") return <Zap className="h-3 w-3" aria-hidden="true" />;
  return <Mail className="h-3 w-3" aria-hidden="true" />;
}

function scoreBadge(score: number) {
  if (score >= 5) return "bg-emerald-100 text-emerald-800";
  if (score >= 3) return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

function formatDate(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function LeadsContent() {
  const [leads, setLeads] = useState<UnifiedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [intakeWarning, setIntakeWarning] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<LeadFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setIntakeWarning(null);
    const wantWeb = typeFilter === "all" || WEB_LEAD_TYPES.includes(typeFilter);
    const wantIntake = typeFilter === "all" || INTAKE_LEAD_TYPES.includes(typeFilter);

    const webPromise = wantWeb
      ? (async () => {
          const constraints: Parameters<typeof query>[1][] = [orderBy("createdAt", "desc"), limit(FETCH_LIMIT)];
          if (typeFilter !== "all") constraints.unshift(where("type", "==", typeFilter));
          const snapshot = await getDocs(query(collection(db, "leads"), ...constraints));
          return snapshot.docs.map((d) => fromLeadDoc(d.id, d.data()));
        })()
      : Promise.resolve([] as UnifiedLead[]);

    const intakePromise = wantIntake
      ? listIntake({}).then((result) => result.data.rows.map(fromIntakeRow))
      : Promise.resolve([] as UnifiedLead[]);

    const [web, intake] = await Promise.allSettled([webPromise, intakePromise]);
    if (web.status === "rejected") {
      console.error("Failed to fetch leads:", web.reason);
      setLoadError("Web leads couldn't be loaded. Check your connection and try again.");
    }
    if (intake.status === "rejected") {
      console.error("Failed to fetch intake leads:", intake.reason);
      setIntakeWarning(`Expo and Power NOW leads couldn't be loaded. ${callableErrorMessage(intake.reason, "Try again.")}`);
    }
    setLeads(
      mergeLeads(
        web.status === "fulfilled" ? web.value : [],
        intake.status === "fulfilled" ? intake.value : [],
      ),
    );
    setLoading(false);
  }, [typeFilter]);

  useEffect(() => {
    setPage(1);
    setExpandedRow(null);
    fetchLeads();
  }, [fetchLeads]);

  const filteredLeads = useMemo(() => filterLeads(leads, typeFilter, searchTerm), [leads, typeFilter, searchTerm]);
  const pageCount = Math.max(1, Math.ceil(filteredLeads.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageLeads = filteredLeads.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const expandedLead = expandedRow ? filteredLeads.find((l) => l.key === expandedRow) ?? null : null;

  const exportCsv = () => {
    const blob = new Blob([leadsCsv(filteredLeads)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = leadsCsvFilename(typeFilter);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const onNotesSaved = (key: string, notes: string) => {
    setLeads((current) => current.map((lead) => (lead.key === key ? { ...lead, adminNotes: notes } : lead)));
  };

  return (
    <div className="py-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Leads</h1>
          <p className="text-sm text-slate-500 mt-1">
            Early access, survey and contact leads from the website, plus expo booth and Power NOW leads
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={loading || filteredLeads.length === 0}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export CSV ({filteredLeads.length})
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <label htmlFor="lead-search" className="sr-only">Search leads</label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
            <input
              id="lead-search"
              type="search"
              placeholder="Search by name, email or organization"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setPage(1);
              }}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <select
              aria-label="Lead type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as LeadFilter)}
              className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
            >
              {LEAD_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="mb-6 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100">{loadError}</div>
      )}
      {intakeWarning && (
        <div role="status" className="mb-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-100">{intakeWarning}</div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
            <span className="sr-only">Loading leads</span>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Mail className="h-8 w-8 mx-auto mb-3 text-slate-300" aria-hidden="true" />
            <p className="font-medium">No leads found</p>
            <p className="text-sm mt-1">Website, expo booth and Power NOW leads will appear here.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="text-left py-3 px-4 font-medium text-slate-500">Name</th>
                    <th className="text-left py-3 px-4 font-medium text-slate-500">Email</th>
                    <th className="text-left py-3 px-4 font-medium text-slate-500">Type</th>
                    <th className="text-left py-3 px-4 font-medium text-slate-500">Intent</th>
                    <th className="text-left py-3 px-4 font-medium text-slate-500">Score</th>
                    <th className="text-left py-3 px-4 font-medium text-slate-500">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {pageLeads.map((lead) => {
                    const displayName = leadDisplayName(lead);
                    return (
                      <tr key={lead.key} className="group">
                        <td className="py-3 px-4 border-b border-slate-50">
                          <button
                            type="button"
                            aria-expanded={expandedRow === lead.key}
                            onClick={() => setExpandedRow(expandedRow === lead.key ? null : lead.key)}
                            className="flex items-center gap-2 text-left hover:text-slate-900 transition-colors"
                          >
                            <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 group-hover:bg-slate-200 transition-colors">
                              {lead.name ? lead.name[0].toUpperCase() : <User className="h-3 w-3" aria-hidden="true" />}
                            </div>
                            <span className={lead.name ? "font-medium text-slate-900" : "italic text-slate-500"}>{displayName}</span>
                            {lead.adminNotes && <StickyNote className="h-3 w-3 text-amber-500" aria-label="Has notes" />}
                          </button>
                        </td>
                        <td className="py-3 px-4 border-b border-slate-50 text-slate-600">{lead.email || "—"}</td>
                        <td className="py-3 px-4 border-b border-slate-50">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${typeBadge(lead.kind)}`}>
                            <TypeIcon kind={lead.kind} />
                            {leadKindLabel(lead.kind)}
                          </span>
                        </td>
                        <td className="py-3 px-4 border-b border-slate-50 text-slate-600 capitalize">{lead.intent || "—"}</td>
                        <td className="py-3 px-4 border-b border-slate-50">
                          {lead.interestScore === null ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${scoreBadge(lead.interestScore)}`}>
                              <Star className="h-3 w-3" aria-hidden="true" />
                              {lead.interestScore}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 border-b border-slate-50 text-slate-500">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" aria-hidden="true" />
                            {formatDate(lead.createdAtMs)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {expandedLead && <LeadDetail key={expandedLead.key} lead={expandedLead} onNotesSaved={onNotesSaved} />}

            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
              <span className="text-xs text-slate-500">
                Page {currentPage} of {pageCount} · {filteredLeads.length} leads
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="h-3 w-3" aria-hidden="true" /> Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={currentPage >= pageCount}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next <ChevronRight className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LeadDetail({ lead, onNotesSaved }: { lead: UnifiedLead; onNotesSaved: (key: string, notes: string) => void }) {
  const [notes, setNotes] = useState(lead.adminNotes);
  const [saving, setSaving] = useState(false);
  const [notesStatus, setNotesStatus] = useState<string | null>(null);
  const answers = readableSurveyAnswers(lead.surveyAnswers);
  const dirty = notes !== lead.adminNotes;

  const saveNotes = async () => {
    setSaving(true);
    setNotesStatus(null);
    try {
      if (lead.origin === "leads") {
        await updateDoc(doc(db, "leads", lead.id), { adminNotes: notes, adminNotesUpdatedAt: Date.now() });
      } else {
        await setIntakeNotes({ id: lead.id, notes });
      }
      onNotesSaved(lead.key, notes);
      setNotesStatus("Notes saved.");
    } catch (err) {
      console.error("Failed to save notes:", err);
      setNotesStatus(callableErrorMessage(err, "Notes couldn't be saved. Try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-slate-200 bg-slate-50/50 px-6 py-5">
      <h3 className="text-sm font-semibold text-slate-900 mb-4">{leadDisplayName(lead)}</h3>
      <div className="grid md:grid-cols-3 gap-6">
        {(lead.phone || lead.organization || lead.detail) && (
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Contact</h4>
            <dl className="text-xs space-y-1">
              {lead.phone && (
                <div className="flex gap-2">
                  <dt className="text-slate-500 font-medium">Phone:</dt>
                  <dd className="text-slate-700">{lead.phone}</dd>
                </div>
              )}
              {lead.organization && (
                <div className="flex gap-2">
                  <dt className="text-slate-500 font-medium">Organization:</dt>
                  <dd className="text-slate-700">{lead.organization}</dd>
                </div>
              )}
              {lead.detail && (
                <div className="flex gap-2">
                  <dt className="text-slate-500 font-medium">Details:</dt>
                  <dd className="text-slate-700">{lead.detail}</dd>
                </div>
              )}
            </dl>
          </div>
        )}

        {lead.interests.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Interests</h4>
            <div className="flex flex-wrap gap-1.5">
              {lead.interests.map((i) => (
                <span key={i} className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-xs text-slate-700">
                  {i}
                </span>
              ))}
            </div>
          </div>
        )}

        {lead.message && (
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Message</h4>
            <p className="text-sm text-slate-700 bg-white rounded-lg p-3 border border-slate-200 whitespace-pre-wrap">
              <MessageSquare className="h-3 w-3 inline mr-1 text-slate-400" aria-hidden="true" />
              {lead.message}
            </p>
          </div>
        )}

        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Metadata</h4>
          <dl className="text-xs space-y-1">
            <div className="flex gap-2">
              <dt className="text-slate-500 font-medium">Type:</dt>
              <dd className="text-slate-700">{leadKindLabel(lead.kind)}</dd>
            </div>
            {lead.source && (
              <div className="flex gap-2">
                <dt className="text-slate-500 font-medium">Source:</dt>
                <dd className="text-slate-700">{lead.source}</dd>
              </div>
            )}
            {lead.version && (
              <div className="flex gap-2">
                <dt className="text-slate-500 font-medium">Version:</dt>
                <dd className="text-slate-700">{lead.version}</dd>
              </div>
            )}
            {lead.recaptchaScore !== null && (
              <div className="flex gap-2">
                <dt className="text-slate-500 font-medium">reCAPTCHA:</dt>
                <dd className="text-slate-700">{lead.recaptchaScore.toFixed(2)}</dd>
              </div>
            )}
          </dl>
        </div>

        {answers.length > 0 && (
          <div className="md:col-span-3">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Survey answers</h4>
            <dl className="bg-white rounded-lg p-3 border border-slate-200 text-sm divide-y divide-slate-100">
              {answers.map((row) => (
                <div key={row.id} className="py-2 first:pt-0 last:pb-0">
                  <dt className="text-xs font-medium text-slate-500">{row.question}</dt>
                  <dd className="text-slate-800 mt-0.5 whitespace-pre-wrap">{row.answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <div className="md:col-span-3">
          <label htmlFor={`notes-${lead.key}`} className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">
            Notes (admins only)
          </label>
          <textarea
            id={`notes-${lead.key}`}
            value={notes}
            maxLength={NOTES_MAX}
            rows={3}
            onChange={(e) => {
              setNotes(e.target.value);
              setNotesStatus(null);
            }}
            className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
            placeholder="Follow-up status, who reached out, next step…"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={saveNotes}
              disabled={!dirty || saving}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
              Save notes
            </button>
            {notesStatus && (
              <span role="status" className="text-xs text-slate-600">
                {notesStatus}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
