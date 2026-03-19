"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { backfillRfxGeoFn } from "@/lib/functions";
import {
  collection,
  getDocs,
  query,
  orderBy,
  updateDoc,
  doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { RfxDoc } from "@hi/shared";
import Link from "next/link";
import {
  ClipboardList,
  Loader2,
  Eye,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-slate-100 text-slate-600 border-slate-200" },
  under_review: { label: "Under Review", color: "bg-amber-50 text-amber-700 border-amber-200" },
  open: { label: "Open", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  closed: { label: "Closed", color: "bg-blue-50 text-blue-600 border-blue-200" },
  awarded: { label: "Awarded", color: "bg-indigo-50 text-indigo-600 border-indigo-200" },
  cancelled: { label: "Cancelled", color: "bg-red-50 text-red-600 border-red-200" },
};

export default function AdminRfxPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminRfxContent />
    </RequireAuth>
  );
}

function AdminRfxContent() {
  const [rfxList, setRfxList] = useState<RfxDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [backfillingGeo, setBackfillingGeo] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filter, setFilter] = useState<string>("all");

  const fetchRfx = useCallback(async () => {
    setLoading(true);
    try {
      const q = query(collection(db, "rfx"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      setRfxList(snap.docs.map((d) => d.data() as RfxDoc));
    } catch (err) {
      console.error("Failed to fetch RFx:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRfx();
  }, [fetchRfx]);

  const handleStatusChange = async (rfxId: string, status: string) => {
    try {
      await updateDoc(doc(db, "rfx", rfxId), { status, updatedAt: Date.now() });
      fetchRfx();
    } catch (err) {
      console.error("Failed to update RFx status:", err);
    }
  };

  const handleBackfillGeo = async () => {
    setBackfillingGeo(true);
    try {
      await backfillRfxGeoFn({ maxDocs: 500 });
      await fetchRfx();
    } catch (err) {
      console.error("Failed to backfill RFx geohash:", err);
    } finally {
      setBackfillingGeo(false);
    }
  };

  const filtered = rfxList.filter((r) => {
    if (filter !== "all" && r.status !== filter) return false;
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (r.title || "").toLowerCase().includes(term);
  });

  const reviewCount = rfxList.filter((r) => r.status === "under_review").length;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
                <ClipboardList className="h-8 w-8 text-slate-400" />
                RFx Moderation
              </h1>
              <p className="text-slate-500 mt-1">
                {rfxList.length} total · {reviewCount} pending review
              </p>
            </div>
            <button
              onClick={handleBackfillGeo}
              disabled={backfillingGeo}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {backfillingGeo ? "Backfilling..." : "Backfill geo/geohash"}
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search RFx..."
              className="w-full rounded-xl pl-10 pr-4 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
            />
          </div>
          <div className="flex gap-1">
            {["all", "under_review", "open", "closed", "awarded", "cancelled"].map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  filter === s
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.length === 0 ? (
              <div className="text-center py-16 text-sm text-slate-500">No RFx found.</div>
            ) : (
              filtered.map((rfx) => {
                const cfg = STATUS_CONFIG[rfx.status] || STATUS_CONFIG.draft;
                return (
                  <div key={rfx.id} className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-bold text-slate-900 truncate">{rfx.title}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${cfg.color}`}>
                            {cfg.label}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          Created {new Date(rfx.createdAt).toLocaleDateString()} · {rfx.responseCount || 0} responses
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Link
                          href={`/rfx/detail?id=${rfx.id}`}
                          className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                          title="View"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                        {rfx.status === "under_review" && (
                          <>
                            <button
                              onClick={() => handleStatusChange(rfx.id, "open")}
                              className="p-2 rounded-lg hover:bg-emerald-50 text-emerald-500 hover:text-emerald-600"
                              title="Approve"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleStatusChange(rfx.id, "cancelled")}
                              className="p-2 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600"
                              title="Reject"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {rfx.status === "open" && (
                          <button
                            onClick={() => handleStatusChange(rfx.id, "closed")}
                            className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                            title="Close"
                          >
                            <Clock className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
