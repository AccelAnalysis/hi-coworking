"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  getOrg,
  updateOrg,
  addOrgMember,
  getOrgMembers,
} from "@/lib/firestore";
import type { OrgDoc, OrgMemberDoc } from "@hi/shared";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import Link from "next/link";
import {
  Building2,
  Loader2,
  Check,
  ArrowLeft,
  UserPlus,
  Send,
} from "lucide-react";

const purchaseSeats = httpsCallable<
  { orgId: string; seats: number },
  { success: boolean; paymentId?: string }
>(functions, "org_purchaseSeats");

export default function OrgSettingsPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<AppShell><div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div></AppShell>}>
        <OrgSettingsContent />
      </Suspense>
    </RequireAuth>
  );
}

function OrgSettingsContent() {
  const searchParams = useSearchParams();
  const orgId = searchParams.get("id");
  const tab = searchParams.get("tab");

  const [org, setOrg] = useState<OrgDoc | null>(null);
  const [members, setMembers] = useState<OrgMemberDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [billingEmail, setBillingEmail] = useState("");

  // Invite state
  const [inviteUid, setInviteUid] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);

  // Seat purchase state
  const [seatQty, setSeatQty] = useState("5");
  const [purchasing, setPurchasing] = useState(false);

  const [activeTab, setActiveTab] = useState<"general" | "invite" | "seats">(
    tab === "invite" ? "invite" : tab === "seats" ? "seats" : "general"
  );

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    try {
      const [orgData, memberData] = await Promise.all([
        getOrg(orgId),
        getOrgMembers(orgId),
      ]);
      setOrg(orgData);
      setMembers(memberData);
      if (orgData) {
        setName(orgData.name);
        setWebsite(orgData.website || "");
        setAddress(orgData.address || "");
        setBillingEmail(orgData.billingEmail || "");
      }
    } catch (err) {
      console.error("Failed to fetch org:", err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setSaving(true);
    try {
      await updateOrg(org.id, {
        name: name.trim(),
        website: website.trim() || undefined,
        address: address.trim() || undefined,
        billingEmail: billingEmail.trim() || undefined,
      });
      fetchData();
    } catch (err) {
      console.error("Failed to update org:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org || !inviteUid.trim()) return;
    setInviting(true);
    try {
      const memberId = `${org.id}_${inviteUid.trim()}`;
      await addOrgMember({
        id: memberId,
        orgId: org.id,
        uid: inviteUid.trim(),
        role: inviteRole,
        joinedAt: Date.now(),
      });
      setInviteUid("");
      fetchData();
    } catch (err) {
      console.error("Failed to invite member:", err);
    } finally {
      setInviting(false);
    }
  };

  const handlePurchaseSeats = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setPurchasing(true);
    try {
      await purchaseSeats({ orgId: org.id, seats: parseInt(seatQty) || 5 });
      fetchData();
    } catch (err) {
      console.error("Seat purchase failed:", err);
    } finally {
      setPurchasing(false);
    }
  };

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
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        <Link
          href={`/org/dashboard?id=${org.id}`}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>

        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-3 mb-8">
          <Building2 className="h-7 w-7 text-slate-400" />
          {org.name} — Settings
        </h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-slate-100 rounded-xl p-1">
          {([
            { key: "general", label: "General" },
            { key: "invite", label: "Invite Members" },
            { key: "seats", label: "Purchase Seats" },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === t.key
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* General Tab */}
        {activeTab === "general" && (
          <form onSubmit={handleSaveGeneral} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Organization Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Website</label>
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                placeholder="https://..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Billing Email</label>
              <input
                type="email"
                value={billingEmail}
                onChange={(e) => setBillingEmail(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                placeholder="billing@company.com"
              />
            </div>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save Changes
            </button>
          </form>
        )}

        {/* Invite Tab */}
        {activeTab === "invite" && (
          <div>
            <form onSubmit={handleInvite} className="p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 space-y-4 mb-6">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-slate-400" /> Invite a Member
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">User ID *</label>
                  <input
                    type="text"
                    value={inviteUid}
                    onChange={(e) => setInviteUid(e.target.value)}
                    required
                    className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                    placeholder="Firebase UID"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as "admin" | "member")}
                    className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
              <button
                type="submit"
                disabled={inviting || !inviteUid.trim()}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
              >
                {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Add Member
              </button>
            </form>

            <div className="text-xs text-slate-500">
              <strong>{members.length}</strong> member{members.length !== 1 ? "s" : ""} currently in this organization.
              <strong className="ml-1">{org.seatsUsed}/{org.seatsPurchased}</strong> seats used.
            </div>
          </div>
        )}

        {/* Seats Tab */}
        {activeTab === "seats" && (
          <form onSubmit={handlePurchaseSeats} className="p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Purchase Additional Seats</h3>
            <p className="text-xs text-slate-500">
              Current plan: <strong>{org.seatsPurchased}</strong> seats purchased, <strong>{org.seatsUsed}</strong> in use.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Number of Seats</label>
              <input
                type="number"
                value={seatQty}
                onChange={(e) => setSeatQty(e.target.value)}
                min="1"
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none max-w-xs"
              />
            </div>
            <button
              type="submit"
              disabled={purchasing}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
            >
              {purchasing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Purchase Seats
            </button>
          </form>
        )}
      </div>
    </AppShell>
  );
}
