"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { httpsCallable } from "firebase/functions";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db, functions } from "@/lib/firebase";
import type { MembershipStatus, UserDoc, UserRole } from "@hi/shared";
import {
  AlertTriangle,
  ChevronDown,
  Crown,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";

const setUserRoleFn = httpsCallable<
  { targetUid: string; role: UserRole },
  { success: boolean; uid: string; role: UserRole }
>(functions, "setUserRole");

const CURRENT_OPERATING_ROLES: UserRole[] = ["member", "staff", "admin"];

function memberStatusLabel(status?: MembershipStatus) {
  switch (status) {
    case "pastDue":
      return "Past due";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
    case "trial":
      return "Trial";
    case "active":
      return "Active";
    case "none":
    default:
      return "No membership";
  }
}

function planLabel(plan?: string) {
  if (!plan) return "No plan";
  return plan
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AdminMembersPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminMembersContent />
    </RequireAuth>
  );
}

function AdminMembersContent() {
  const { user, role: currentRole } = useAuth();
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      setUsers(
        snap.docs.map((memberDoc) => {
          const data = memberDoc.data() as UserDoc;
          return {
            ...data,
            uid: data.uid || memberDoc.id,
          };
        }),
      );
    } catch (err: unknown) {
      console.error("Failed to fetch users:", err);
      setError(
        "Member records could not be loaded. Confirm this account still has Admin access, then try again.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const handleRoleChange = async (uid: string, nextRole: UserRole) => {
    if (uid === user?.uid) {
      setError("For safety, change your own Admin role from another Master/Admin account.");
      return;
    }

    setActionLoading(uid);
    setError(null);
    try {
      await setUserRoleFn({ targetUid: uid, role: nextRole });
      await fetchUsers();
    } catch (err: unknown) {
      console.error("Failed to set role:", err);
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(`The role could not be updated. ${message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const filtered = users.filter((member) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      (member.displayName || "").toLowerCase().includes(term)
      || (member.email || "").toLowerCase().includes(term)
    );
  });

  const roleIcon = (role?: string) => {
    if (role === "admin" || role === "master") {
      return <Crown className="h-4 w-4 text-amber-600" />;
    }
    if (role === "staff") {
      return <ShieldCheck className="h-4 w-4 text-sky-700" />;
    }
    return <User className="h-4 w-4 text-slate-500" />;
  };

  const roleColor = (role?: string) => {
    if (role === "admin" || role === "master") {
      return "bg-amber-50 text-amber-800";
    }
    if (role === "staff") {
      return "bg-sky-50 text-sky-800";
    }
    return "bg-slate-100 text-slate-600";
  };

  const statusColor = (status?: MembershipStatus) => {
    if (status === "active") return "bg-emerald-50 text-emerald-800";
    if (status === "trial") return "bg-sky-50 text-sky-800";
    if (status === "pastDue") return "bg-amber-50 text-amber-800";
    if (status === "cancelled" || status === "expired") return "bg-slate-100 text-slate-600";
    return "bg-slate-50 text-slate-500";
  };

  const roleOptions = currentRole === "master"
    ? [...CURRENT_OPERATING_ROLES, "master" as UserRole]
    : CURRENT_OPERATING_ROLES;

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Admin</p>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold tracking-tight text-slate-950">
              <Users className="h-7 w-7 text-slate-400" />
              Member Management
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Review customer membership status and assign operating access for staff and administrators.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchUsers()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="font-medium text-red-700 hover:text-red-900"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="relative mb-6 max-w-xl">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search members by name or email"
            className="w-full rounded-full border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl bg-white px-6 py-12 text-center shadow-sm ring-1 ring-slate-200">
            <Users className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-4 text-sm font-medium text-slate-700">
              {searchTerm ? "No matching members found." : "No member accounts are available yet."}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="border-b border-slate-100 px-5 py-3 text-xs font-medium text-slate-500">
              {filtered.length} {filtered.length === 1 ? "account" : "accounts"}
            </div>
            <div className="divide-y divide-slate-100">
              {filtered.map((member) => {
                const isCurrentUser = member.uid === user?.uid;
                const isLegacyRole = !roleOptions.includes(member.role);
                return (
                  <div
                    key={member.uid}
                    className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100">
                        {roleIcon(member.role)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-slate-950">
                            {member.displayName || member.email || "Member"}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${roleColor(member.role)}`}>
                            {member.role === "master" ? "Master" : member.role === "admin" ? "Admin" : member.role === "staff" ? "Staff" : "Member"}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusColor(member.membershipStatus)}`}>
                            {memberStatusLabel(member.membershipStatus)}
                          </span>
                          {isCurrentUser && (
                            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                              You
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">{member.email}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          {planLabel(member.plan)}
                          {member.createdAt ? ` · Joined ${new Date(member.createdAt).toLocaleDateString()}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 sm:shrink-0">
                      <label className="text-xs font-medium text-slate-500" htmlFor={`role-${member.uid}`}>
                        Access
                      </label>
                      <div className="relative">
                        <select
                          id={`role-${member.uid}`}
                          value={member.role || "member"}
                          disabled={actionLoading === member.uid || isCurrentUser}
                          onChange={(event) => void handleRoleChange(member.uid, event.target.value as UserRole)}
                          className="appearance-none rounded-full border border-slate-200 bg-white py-2 pl-3 pr-8 text-xs font-medium text-slate-700 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                        >
                          {isLegacyRole && (
                            <option value={member.role}>{member.role} (legacy)</option>
                          )}
                          {roleOptions.map((role) => (
                            <option key={role} value={role}>
                              {role === "master" ? "Master" : role === "admin" ? "Admin" : role === "staff" ? "Staff" : "Member"}
                            </option>
                          ))}
                        </select>
                        {actionLoading === member.uid ? (
                          <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-400" />
                        ) : (
                          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="mt-5 max-w-3xl text-xs leading-5 text-slate-500">
          Membership status is shown here for oversight. Billing and membership lifecycle changes should be completed through the canonical membership/payment workflow rather than edited directly on a user record.
        </p>
      </main>
    </AppShell>
  );
}
