"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import {
  getOrg,
  getOrgMembers,
  removeOrgMember,
  getOrgPayments,
} from "@/lib/firestore";
import type { OrgDoc, OrgMemberDoc, PaymentDoc } from "@hi/shared";
import Link from "next/link";
import Image from "next/image";
import {
  Building2,
  Users,
  CreditCard,
  Loader2,
  Settings,
  UserPlus,
  Trash2,
  ShieldCheck,
  Crown,
  BarChart3,
} from "lucide-react";

export default function OrgDashboardPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<AppShell><div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div></AppShell>}>
        <OrgDashboardContent />
      </Suspense>
    </RequireAuth>
  );
}

function OrgDashboardContent() {
  const searchParams = useSearchParams();
  const orgId = searchParams.get("id");
  const { user } = useAuth();

  const [org, setOrg] = useState<OrgDoc | null>(null);
  const [members, setMembers] = useState<OrgMemberDoc[]>([]);
  const [payments, setPayments] = useState<PaymentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!orgId || !user) return;
    setLoading(true);
    try {
      const [orgData, memberData, paymentData] = await Promise.all([
        getOrg(orgId),
        getOrgMembers(orgId),
        getOrgPayments(orgId),
      ]);
      setOrg(orgData);
      setMembers(memberData);
      setPayments(paymentData);

      const myMembership = memberData.find((m) => m.uid === user.uid);
      setMyRole(myMembership?.role || null);
    } catch (err) {
      console.error("Failed to fetch org data:", err);
    } finally {
      setLoading(false);
    }
  }, [orgId, user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRemoveMember = async (member: OrgMemberDoc) => {
    if (!org) return;
    setRemovingId(member.id);
    try {
      await removeOrgMember(member.id, org.id);
      fetchData();
    } catch (err) {
      console.error("Failed to remove member:", err);
    } finally {
      setRemovingId(null);
    }
  };

  const isAdmin = myRole === "owner" || myRole === "admin";

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  if (!org) {
    return (
      <AppShell>
        <div className="text-center py-24">
          <Building2 className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-700">Organization not found</h2>
          <p className="text-sm text-slate-500 mt-1">You may not have access to this organization.</p>
        </div>
      </AppShell>
    );
  }

  const seatPercent = org.seatsPurchased > 0
    ? Math.round((org.seatsUsed / org.seatsPurchased) * 100)
    : 0;

  const totalSpend = payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              {org.logoUrl ? (
                <div className="w-10 h-10 rounded-xl bg-indigo-50 overflow-hidden relative"><Image src={org.logoUrl} alt="" fill className="object-cover" /></div>
              ) : (
                <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-indigo-600" />
                </div>
              )}
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                {org.name}
              </h1>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                org.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                org.status === "suspended" ? "bg-amber-50 text-amber-700 border-amber-200" :
                "bg-red-50 text-red-600 border-red-200"
              }`}>
                {org.status}
              </span>
            </div>
            {org.website && (
              <a href={org.website} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 hover:text-indigo-700">
                {org.website}
              </a>
            )}
          </div>
          {isAdmin && (
            <Link
              href={`/org/settings?id=${org.id}`}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm"
            >
              <Settings className="h-4 w-4" />
              Settings
            </Link>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 uppercase mb-2">
              <Users className="h-3.5 w-3.5" /> Seats
            </div>
            <div className="text-2xl font-bold text-slate-900">
              {org.seatsUsed}<span className="text-slate-400">/{org.seatsPurchased}</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  seatPercent > 90 ? "bg-red-500" : seatPercent > 70 ? "bg-amber-500" : "bg-emerald-500"
                }`}
                style={{ width: `${Math.min(seatPercent, 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">{seatPercent}% utilized</span>
          </div>

          <div className="p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 uppercase mb-2">
              <BarChart3 className="h-3.5 w-3.5" /> Members
            </div>
            <div className="text-2xl font-bold text-slate-900">{members.length}</div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              {members.filter((m) => m.role === "admin" || m.role === "owner").length} admins
            </span>
          </div>

          <div className="p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-500 uppercase mb-2">
              <CreditCard className="h-3.5 w-3.5" /> Total Spend
            </div>
            <div className="text-2xl font-bold text-slate-900">
              ${(totalSpend / 100).toFixed(2)}
            </div>
            <span className="text-[10px] text-slate-400 mt-1 block">
              {payments.length} transaction{payments.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Member Roster */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-400" /> Member Roster
            </h2>
            {isAdmin && (
              <Link
                href={`/org/settings?id=${org.id}&tab=invite`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-medium hover:bg-slate-200 transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5" /> Invite Member
              </Link>
            )}
          </div>
          <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 divide-y divide-slate-100">
            {members.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">No members yet.</div>
            ) : (
              members.map((member) => {
                const RoleIcon = member.role === "owner" ? Crown : member.role === "admin" ? ShieldCheck : Users;
                const roleColor = member.role === "owner" ? "text-amber-600" : member.role === "admin" ? "text-indigo-600" : "text-slate-400";
                return (
                  <div key={member.id} className="flex items-center gap-4 px-5 py-3">
                    <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center">
                      <RoleIcon className={`h-4 w-4 ${roleColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-slate-900 truncate block font-mono">
                        {member.uid.slice(0, 16)}...
                      </span>
                      <span className="text-[10px] text-slate-400">
                        Joined {new Date(member.joinedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                      member.role === "owner" ? "bg-amber-50 text-amber-700 border-amber-200" :
                      member.role === "admin" ? "bg-indigo-50 text-indigo-600 border-indigo-200" :
                      "bg-slate-100 text-slate-600 border-slate-200"
                    }`}>
                      {member.role}
                    </span>
                    {isAdmin && member.role !== "owner" && member.uid !== user?.uid && (
                      <button
                        onClick={() => handleRemoveMember(member)}
                        disabled={removingId === member.id}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors disabled:opacity-50"
                        title="Remove member"
                      >
                        {removingId === member.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Payment History */}
        <div>
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2 mb-4">
            <CreditCard className="h-4 w-4 text-slate-400" /> Billing History
          </h2>
          <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 divide-y divide-slate-100">
            {payments.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">No payments yet.</div>
            ) : (
              payments.slice(0, 10).map((pmt) => (
                <div key={pmt.id} className="flex items-center gap-4 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-slate-900 truncate block">
                      {pmt.purpose}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(pmt.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                    pmt.status === "paid" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                    pmt.status === "pending" ? "bg-amber-50 text-amber-700 border-amber-200" :
                    "bg-red-50 text-red-600 border-red-200"
                  }`}>
                    {pmt.status}
                  </span>
                  <span className="text-sm font-bold text-slate-900">
                    ${((pmt.amount || 0) / 100).toFixed(2)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
