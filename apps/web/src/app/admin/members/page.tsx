"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import {
  collection,
  getDocs,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { UserDoc } from "@hi/shared";
import {
  Users,
  Loader2,
  ShieldCheck,
  Crown,
  User,
  Search,
  ChevronDown,
} from "lucide-react";

const setUserRole = httpsCallable<
  { uid: string; role: string },
  { success: boolean }
>(functions, "admin_setUserRole");

const setMembershipStatus = httpsCallable<
  { uid: string; status: string },
  { success: boolean }
>(functions, "admin_setMembershipStatus");

export default function AdminMembersPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminMembersContent />
    </RequireAuth>
  );
}

function AdminMembersContent() {
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      setUsers(snap.docs.map((d) => d.data() as UserDoc));
    } catch (err) {
      console.error("Failed to fetch users:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (uid: string, role: string) => {
    setActionLoading(uid);
    try {
      await setUserRole({ uid, role });
      fetchUsers();
    } catch (err) {
      console.error("Failed to set role:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleStatusChange = async (uid: string, status: string) => {
    setActionLoading(uid);
    try {
      await setMembershipStatus({ uid, status });
      fetchUsers();
    } catch (err) {
      console.error("Failed to set status:", err);
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = users.filter((u) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (u.displayName || "").toLowerCase().includes(term) ||
      (u.email || "").toLowerCase().includes(term) ||
      u.uid.toLowerCase().includes(term)
    );
  });

  const roleIcon = (role?: string) => {
    if (role === "admin" || role === "master") return <Crown className="h-3.5 w-3.5 text-amber-600" />;
    if (role === "staff") return <ShieldCheck className="h-3.5 w-3.5 text-indigo-600" />;
    return <User className="h-3.5 w-3.5 text-slate-400" />;
  };

  const roleColor = (role?: string) => {
    if (role === "admin" || role === "master") return "bg-amber-50 text-amber-700 border-amber-200";
    if (role === "staff") return "bg-indigo-50 text-indigo-600 border-indigo-200";
    return "bg-slate-100 text-slate-600 border-slate-200";
  };

  const statusColor = (status?: string) => {
    if (status === "active") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (status === "pending") return "bg-amber-50 text-amber-700 border-amber-200";
    if (status === "suspended") return "bg-red-50 text-red-600 border-red-200";
    return "bg-slate-100 text-slate-500 border-slate-200";
  };

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              <Users className="h-8 w-8 text-slate-400" />
              Member Management
            </h1>
            <p className="text-slate-500 mt-1">
              {users.length} total member{users.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by name, email, or UID..."
            className="w-full rounded-xl pl-10 pr-4 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 divide-y divide-slate-100">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">No members found.</div>
            ) : (
              filtered.map((u) => (
                <div key={u.uid} className="flex items-center gap-4 px-5 py-3">
                  <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                    {roleIcon(u.role)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 truncate">
                        {u.displayName || "No name"}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${roleColor(u.role)}`}>
                        {u.role || "member"}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold border ${statusColor(u.membershipStatus)}`}>
                        {u.membershipStatus || "none"}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 block truncate">
                      {u.email} · {u.uid.slice(0, 12)}... · Joined {new Date(u.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  {actionLoading === u.uid ? (
                    <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="relative">
                        <select
                          value={u.role || "member"}
                          onChange={(e) => handleRoleChange(u.uid, e.target.value)}
                          className="appearance-none text-[10px] font-medium px-2 py-1 pr-5 rounded-lg border border-slate-200 bg-white cursor-pointer focus:ring-1 focus:ring-slate-900 outline-none"
                        >
                          <option value="member">member</option>
                          <option value="staff">staff</option>
                          <option value="admin">admin</option>
                        </select>
                        <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
                      </div>
                      <div className="relative">
                        <select
                          value={u.membershipStatus || "none"}
                          onChange={(e) => handleStatusChange(u.uid, e.target.value)}
                          className="appearance-none text-[10px] font-medium px-2 py-1 pr-5 rounded-lg border border-slate-200 bg-white cursor-pointer focus:ring-1 focus:ring-slate-900 outline-none"
                        >
                          <option value="none">none</option>
                          <option value="pending">pending</option>
                          <option value="active">active</option>
                          <option value="suspended">suspended</option>
                        </select>
                        <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
