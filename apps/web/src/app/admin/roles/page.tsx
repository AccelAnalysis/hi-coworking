"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  AlertTriangle,
  ChevronDown,
  Crown,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
  UserCog,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { db, functions } from "@/lib/firebase";
import type { UserDoc, UserRole } from "@hi/shared";

const setUserRoleFn = httpsCallable<
  { targetUid: string; role: UserRole },
  { success: boolean; uid: string; role: UserRole }
>(functions, "setUserRole");

const OPERATING_ROLES: UserRole[] = ["member", "staff", "admin"];

function roleLabel(role?: UserRole) {
  if (role === "master") return "Master";
  if (role === "admin") return "Admin";
  if (role === "staff") return "Staff";
  if (role === "member") return "Member";
  return role || "Member";
}

function roleDescription(role?: UserRole) {
  if (role === "master") return "Owner/system authority with Admin and Staff access.";
  if (role === "admin") return "Coworking administration plus Staff operating tools.";
  if (role === "staff") return "Day-to-day facility and event operating tools.";
  return "Customer account; no Staff or Admin operating authority.";
}

function roleIcon(role?: UserRole) {
  if (role === "master" || role === "admin") return <Crown className="h-4 w-4 text-amber-600" />;
  if (role === "staff") return <ShieldCheck className="h-4 w-4 text-sky-700" />;
  return <User className="h-4 w-4 text-slate-500" />;
}

function roleClasses(role?: UserRole) {
  if (role === "master" || role === "admin") return "bg-amber-50 text-amber-800";
  if (role === "staff") return "bg-sky-50 text-sky-800";
  return "bg-slate-100 text-slate-600";
}

export default function AdminRolesPage() {
  return <RequireAuth requiredRole="admin"><AdminRolesContent /></RequireAuth>;
}

function AdminRolesContent() {
  const { user, role: currentRole } = useAuth();
  const [users, setUsers] = useState<UserDoc[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc")));
      setUsers(snap.docs.map((userDoc) => ({
        ...(userDoc.data() as UserDoc),
        uid: (userDoc.data() as UserDoc).uid || userDoc.id,
      })));
    } catch (caught) {
      console.error("Failed to load staff and role directory:", caught);
      setError("Staff and role assignments could not be loaded. Confirm this account still has Admin access, then try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchUsers(); }, [fetchUsers]);

  const roleOptions = currentRole === "master"
    ? [...OPERATING_ROLES, "master" as UserRole]
    : OPERATING_ROLES;

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return users;
    return users.filter((account) => (
      (account.displayName || "").toLowerCase().includes(term)
      || (account.email || "").toLowerCase().includes(term)
      || roleLabel(account.role).toLowerCase().includes(term)
    ));
  }, [searchTerm, users]);

  async function changeRole(account: UserDoc, nextRole: UserRole) {
    if (account.uid === user?.uid) {
      setError("For safety, your own Admin/Master role must be changed by another authorized account.");
      return;
    }
    if (!window.confirm(`Change ${account.displayName || account.email} from ${roleLabel(account.role)} to ${roleLabel(nextRole)}?`)) return;
    setActionLoading(account.uid);
    setError(null);
    try {
      await setUserRoleFn({ targetUid: account.uid, role: nextRole });
      await fetchUsers();
    } catch (caught) {
      console.error("Role change failed:", caught);
      const message = caught instanceof Error ? caught.message : "Unknown error";
      setError(`The role change could not be completed. ${message}`);
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Admin</p>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold tracking-tight text-slate-950"><UserCog className="h-7 w-7 text-slate-400" /> Staff & Roles</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Control operating authority separately from paid coworking membership. Role claims determine access to Staff and Admin workspaces.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/members" className="inline-flex min-h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Members</Link>
            <button type="button" onClick={() => void fetchUsers()} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
          </div>
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-3">
          <div className="border-l-2 border-slate-300 pl-4"><p className="font-semibold text-slate-950">Staff</p><p className="mt-1 text-sm leading-5 text-slate-500">Facility operations and event check-in.</p></div>
          <div className="border-l-2 border-amber-300 pl-4"><p className="font-semibold text-slate-950">Admin</p><p className="mt-1 text-sm leading-5 text-slate-500">Administrative workspaces plus Staff access.</p></div>
          <div className="border-l-2 border-amber-500 pl-4"><p className="font-semibold text-slate-950">Master</p><p className="mt-1 text-sm leading-5 text-slate-500">Highest authority; assign only from another Master account.</p></div>
        </div>

        {error && <div className="mt-6 flex items-start gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}

        <div className="relative mt-7 max-w-xl"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search by name, email or role" className="w-full rounded-full border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100" /></div>

        {loading ? <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div> : (
          <div className="mt-7 divide-y divide-slate-200 border-y border-slate-200">
            {filtered.map((account) => {
              const isCurrentUser = account.uid === user?.uid;
              const isLegacyRole = !roleOptions.includes(account.role);
              return (
                <div key={account.uid} className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:px-3">
                  <div className="flex min-w-0 flex-1 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100">{roleIcon(account.role)}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-semibold text-slate-950">{account.displayName || account.email}</p><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${roleClasses(account.role)}`}>{roleLabel(account.role)}</span>{isCurrentUser && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">You</span>}</div><p className="mt-1 truncate text-sm text-slate-500">{account.email}</p><p className="mt-1 text-xs text-slate-400">{roleDescription(account.role)}</p></div></div>
                  <div className="relative shrink-0"><select value={account.role || "member"} disabled={actionLoading === account.uid || isCurrentUser} onChange={(event) => void changeRole(account, event.target.value as UserRole)} className="appearance-none rounded-full border border-slate-200 bg-white py-2.5 pl-4 pr-9 text-sm font-semibold text-slate-700 outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400">{isLegacyRole && <option value={account.role}>{roleLabel(account.role)} (legacy)</option>}{roleOptions.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select>{actionLoading === account.uid ? <Loader2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" /> : <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />}</div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-6 text-xs leading-5 text-slate-500">Role changes update the authoritative Firebase Authentication custom claim and the mirrored user record. Membership plan/status is intentionally not changed here.</p>
      </main>
    </AppShell>
  );
}
