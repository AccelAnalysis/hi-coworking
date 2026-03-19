"use client";

import { useState, useEffect, useCallback } from "react";
import { RequireAuth } from "@/components/RequireAuth";
import {
  collection,
  query,
  orderBy,
  limit,
  startAfter,
  where,
  getDocs,
  type QueryDocumentSnapshot,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
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
} from "lucide-react";

const PAGE_SIZE = 25;

type LeadType = "early_access" | "survey" | "all";

interface Lead {
  id: string;
  name: string;
  email: string;
  interests: string[];
  message: string;
  intent: string;
  source: string;
  version: string;
  interestScore: number;
  type: string;
  surveyAnswers: Record<string, unknown> | null;
  recaptchaScore?: number;
  createdAt: number;
}

export default function AdminLeadsPage() {
  return (
    <RequireAuth requiredRole="admin">
      <LeadsContent />
    </RequireAuth>
  );
}

function LeadsContent() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<LeadType>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const fetchLeads = useCallback(async (afterDoc?: QueryDocumentSnapshot<DocumentData> | null) => {
    setLoading(true);
    try {
      const leadsRef = collection(db, "leads");
      const constraints: Parameters<typeof query>[1][] = [
        orderBy("createdAt", "desc"),
        limit(PAGE_SIZE + 1),
      ];

      if (typeFilter !== "all") {
        constraints.unshift(where("type", "==", typeFilter));
      }

      if (afterDoc) {
        constraints.push(startAfter(afterDoc));
      }

      const q = query(leadsRef, ...constraints);
      const snapshot = await getDocs(q);

      const docs = snapshot.docs;
      const hasNext = docs.length > PAGE_SIZE;
      const pageDocs = hasNext ? docs.slice(0, PAGE_SIZE) : docs;

      setLeads(pageDocs.map((d) => d.data() as Lead));
      setLastDoc(pageDocs[pageDocs.length - 1] ?? null);
      setHasMore(hasNext);
    } catch (err) {
      console.error("Failed to fetch leads:", err);
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    setPage(1);
    fetchLeads();
  }, [fetchLeads]);

  const nextPage = () => {
    if (!hasMore || !lastDoc) return;
    setPage((p) => p + 1);
    fetchLeads(lastDoc);
  };

  const filteredLeads = searchTerm
    ? leads.filter(
        (l) =>
          l.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          l.email?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : leads;

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const scoreBadge = (score: number) => {
    if (score >= 5) return "bg-emerald-100 text-emerald-800";
    if (score >= 3) return "bg-amber-100 text-amber-800";
    return "bg-slate-100 text-slate-600";
  };

  const typeBadge = (type: string) => {
    if (type === "survey") return "bg-indigo-100 text-indigo-700";
    return "bg-slate-100 text-slate-700";
  };

  return (
    <div className="py-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Leads</h1>
          <p className="text-sm text-slate-500 mt-1">
            Early access signups and survey responses from the Coming Soon Page
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-slate-200 bg-white/50 focus:bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all text-sm"
            />
          </div>

          {/* Type filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as LeadType)}
              className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
            >
              <option value="all">All Types</option>
              <option value="early_access">Early Access</option>
              <option value="survey">Survey</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <Mail className="h-8 w-8 mx-auto mb-3 text-slate-300" />
            <p className="font-medium">No leads found</p>
            <p className="text-sm mt-1">Leads from the Coming Soon Page will appear here.</p>
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
                  {filteredLeads.map((lead) => (
                    <tr key={lead.id} className="group">
                      <td className="py-3 px-4 border-b border-slate-50">
                        <button
                          onClick={() => setExpandedRow(expandedRow === lead.id ? null : lead.id)}
                          className="flex items-center gap-2 text-left hover:text-slate-900 transition-colors"
                        >
                          <div className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 group-hover:bg-slate-200 transition-colors">
                            {lead.name ? lead.name[0].toUpperCase() : <User className="h-3 w-3" />}
                          </div>
                          <span className="font-medium text-slate-900">{lead.name}</span>
                        </button>
                      </td>
                      <td className="py-3 px-4 border-b border-slate-50 text-slate-600">{lead.email}</td>
                      <td className="py-3 px-4 border-b border-slate-50">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${typeBadge(lead.type)}`}>
                          {lead.type === "survey" ? (
                            <ClipboardList className="h-3 w-3" />
                          ) : (
                            <Mail className="h-3 w-3" />
                          )}
                          {lead.type === "early_access" ? "Early Access" : "Survey"}
                        </span>
                      </td>
                      <td className="py-3 px-4 border-b border-slate-50 text-slate-600 capitalize">
                        {lead.intent || "—"}
                      </td>
                      <td className="py-3 px-4 border-b border-slate-50">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${scoreBadge(lead.interestScore)}`}>
                          <Star className="h-3 w-3" />
                          {lead.interestScore}
                        </span>
                      </td>
                      <td className="py-3 px-4 border-b border-slate-50 text-slate-500">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatDate(lead.createdAt)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Expanded detail row rendered below the table for simplicity */}
            {expandedRow && (() => {
              const lead = filteredLeads.find((l) => l.id === expandedRow);
              if (!lead) return null;
              return (
                <div className="border-t border-slate-200 bg-slate-50/50 px-6 py-5">
                  <div className="grid md:grid-cols-3 gap-6">
                    {/* Interests */}
                    {lead.interests && lead.interests.length > 0 && (
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

                    {/* Message */}
                    {lead.message && (
                      <div>
                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Message</h4>
                        <p className="text-sm text-slate-700 bg-white rounded-lg p-3 border border-slate-200">
                          <MessageSquare className="h-3 w-3 inline mr-1 text-slate-400" />
                          {lead.message}
                        </p>
                      </div>
                    )}

                    {/* Meta */}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Metadata</h4>
                      <dl className="text-xs space-y-1">
                        <div className="flex gap-2">
                          <dt className="text-slate-500 font-medium">Source:</dt>
                          <dd className="text-slate-700">{lead.source}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="text-slate-500 font-medium">Version:</dt>
                          <dd className="text-slate-700">{lead.version}</dd>
                        </div>
                        {lead.recaptchaScore !== undefined && (
                          <div className="flex gap-2">
                            <dt className="text-slate-500 font-medium">reCAPTCHA:</dt>
                            <dd className="text-slate-700">{lead.recaptchaScore.toFixed(2)}</dd>
                          </div>
                        )}
                      </dl>
                    </div>

                    {/* Survey answers if present */}
                    {lead.surveyAnswers && (
                      <div className="md:col-span-3">
                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Survey Answers</h4>
                        <div className="bg-white rounded-lg p-3 border border-slate-200 text-xs text-slate-700 font-mono whitespace-pre-wrap">
                          {JSON.stringify(lead.surveyAnswers, null, 2)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Pagination */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
              <span className="text-xs text-slate-500">
                Page {page} · {filteredLeads.length} shown
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setPage(1);
                    fetchLeads();
                  }}
                  disabled={page === 1}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="h-3 w-3" /> First
                </button>
                <button
                  onClick={nextPage}
                  disabled={!hasMore}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
