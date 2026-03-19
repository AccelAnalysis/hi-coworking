"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  collection,
  getDocs,
  query,
  orderBy,
  updateDoc,
  doc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { OrgDoc } from "@hi/shared";
import Link from "next/link";
import {
  Building2,
  Loader2,
  Eye,
  Users,
  CheckCircle2,
  XCircle,
} from "lucide-react";

export default function AdminOrgsPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminOrgsContent />
    </RequireAuth>
  );
}

function AdminOrgsContent() {
  const [orgs, setOrgs] = useState<OrgDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const q = query(collection(db, "orgs"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      setOrgs(snap.docs.map((d) => d.data() as OrgDoc));
    } catch (err) {
      console.error("Failed to fetch orgs:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrgs();
  }, [fetchOrgs]);

  const handleStatusChange = async (orgId: string, status: string) => {
    try {
      await updateDoc(doc(db, "orgs", orgId), { status, updatedAt: Date.now() });
      fetchOrgs();
    } catch (err) {
      console.error("Failed to update org status:", err);
    }
  };

  const statusColor = (status: string) => {
    if (status === "active") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (status === "suspended") return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-red-50 text-red-600 border-red-200";
  };

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <Building2 className="h-8 w-8 text-slate-400" />
            Organization Management
          </h1>
          <p className="text-slate-500 mt-1">{orgs.length} organization{orgs.length !== 1 ? "s" : ""}</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : orgs.length === 0 ? (
          <div className="text-center py-24">
            <Building2 className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <p className="text-sm text-slate-500">No organizations yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orgs.map((org) => (
              <div key={org.id} className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-slate-900 truncate">{org.name}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusColor(org.status)}`}>
                        {org.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-400">
                      <span>slug: {org.slug}</span>
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {org.seatsUsed}/{org.seatsPurchased} seats
                      </span>
                      <span>Created {new Date(org.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Link
                      href={`/org/dashboard?id=${org.id}`}
                      className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                      title="View"
                    >
                      <Eye className="h-4 w-4" />
                    </Link>
                    {org.status === "active" && (
                      <button
                        onClick={() => handleStatusChange(org.id, "suspended")}
                        className="p-2 rounded-lg hover:bg-amber-50 text-amber-400 hover:text-amber-600"
                        title="Suspend"
                      >
                        <XCircle className="h-4 w-4" />
                      </button>
                    )}
                    {org.status === "suspended" && (
                      <button
                        onClick={() => handleStatusChange(org.id, "active")}
                        className="p-2 rounded-lg hover:bg-emerald-50 text-emerald-500 hover:text-emerald-600"
                        title="Reactivate"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
