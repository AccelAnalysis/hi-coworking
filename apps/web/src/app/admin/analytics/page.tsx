"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  BarChart3,
  Loader2,
  Users,
  Building2,
  Calendar,
  ClipboardList,
  TrendingUp,
  DollarSign,
  UserPlus,
} from "lucide-react";

interface PlatformMetrics {
  totalUsers: number;
  activeMembers: number;
  totalOrgs: number;
  totalRfx: number;
  openRfx: number;
  totalEvents: number;
  totalPayments: number;
  totalRevenue: number;
  totalReferrals: number;
  convertedReferrals: number;
}

export default function AdminAnalyticsPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminAnalyticsContent />
    </RequireAuth>
  );
}

function AdminAnalyticsContent() {
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const [
        usersSnap,
        activeMembersSnap,
        orgsSnap,
        rfxSnap,
        openRfxSnap,
        eventsSnap,
        paymentsSnap,
        paidPaymentsSnap,
        referralsSnap,
        convertedSnap,
      ] = await Promise.all([
        getDocs(collection(db, "users")),
        getDocs(query(collection(db, "users"), where("membershipStatus", "==", "active"))),
        getDocs(collection(db, "orgs")),
        getDocs(collection(db, "rfx")),
        getDocs(query(collection(db, "rfx"), where("status", "==", "open"))),
        getDocs(collection(db, "events")),
        getDocs(collection(db, "payments")),
        getDocs(query(collection(db, "payments"), where("status", "==", "paid"))),
        getDocs(collection(db, "referrals")),
        getDocs(query(collection(db, "referrals"), where("status", "==", "converted"))),
      ]);

      let totalRevenue = 0;
      paidPaymentsSnap.docs.forEach((d) => {
        totalRevenue += (d.data().amount || 0);
      });

      setMetrics({
        totalUsers: usersSnap.size,
        activeMembers: activeMembersSnap.size,
        totalOrgs: orgsSnap.size,
        totalRfx: rfxSnap.size,
        openRfx: openRfxSnap.size,
        totalEvents: eventsSnap.size,
        totalPayments: paymentsSnap.size,
        totalRevenue,
        totalReferrals: referralsSnap.size,
        convertedReferrals: convertedSnap.size,
      });
    } catch (err) {
      console.error("Failed to fetch metrics:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  if (loading || !metrics) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  const cards: { label: string; value: string | number; icon: typeof Users; color: string; sub?: string }[] = [
    { label: "Total Users", value: metrics.totalUsers, icon: Users, color: "text-slate-600 bg-slate-100", sub: `${metrics.activeMembers} active members` },
    { label: "Organizations", value: metrics.totalOrgs, icon: Building2, color: "text-indigo-600 bg-indigo-50" },
    { label: "Total Revenue", value: `$${(metrics.totalRevenue / 100).toFixed(2)}`, icon: DollarSign, color: "text-emerald-600 bg-emerald-50", sub: `${metrics.totalPayments} payments` },
    { label: "RFx Opportunities", value: metrics.totalRfx, icon: ClipboardList, color: "text-blue-600 bg-blue-50", sub: `${metrics.openRfx} open` },
    { label: "Events", value: metrics.totalEvents, icon: Calendar, color: "text-purple-600 bg-purple-50" },
    { label: "Referrals", value: metrics.totalReferrals, icon: UserPlus, color: "text-amber-600 bg-amber-50", sub: `${metrics.convertedReferrals} converted` },
  ];

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <BarChart3 className="h-8 w-8 text-slate-400" />
            Platform Analytics
          </h1>
          <p className="text-slate-500 mt-1">Real-time platform metrics and KPIs.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <div key={card.label} className="p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2.5 rounded-xl ${card.color}`}>
                  <card.icon className="h-5 w-5" />
                </div>
                <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                  {card.label}
                </span>
              </div>
              <div className="text-3xl font-bold text-slate-900">{card.value}</div>
              {card.sub && (
                <span className="text-xs text-slate-400 mt-1 block">{card.sub}</span>
              )}
            </div>
          ))}
        </div>

        {/* Revenue breakdown */}
        <div className="mt-8 p-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-slate-400" /> Key Ratios
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <span className="text-xs text-slate-500 block mb-1">Conversion Rate</span>
              <span className="text-lg font-bold text-slate-900">
                {metrics.totalUsers > 0
                  ? `${Math.round((metrics.activeMembers / metrics.totalUsers) * 100)}%`
                  : "—"}
              </span>
              <span className="text-[10px] text-slate-400 block">Users → Active Members</span>
            </div>
            <div>
              <span className="text-xs text-slate-500 block mb-1">Referral Conversion</span>
              <span className="text-lg font-bold text-slate-900">
                {metrics.totalReferrals > 0
                  ? `${Math.round((metrics.convertedReferrals / metrics.totalReferrals) * 100)}%`
                  : "—"}
              </span>
              <span className="text-[10px] text-slate-400 block">Sent → Converted</span>
            </div>
            <div>
              <span className="text-xs text-slate-500 block mb-1">Avg Revenue / User</span>
              <span className="text-lg font-bold text-slate-900">
                {metrics.totalUsers > 0
                  ? `$${(metrics.totalRevenue / 100 / metrics.totalUsers).toFixed(2)}`
                  : "—"}
              </span>
              <span className="text-[10px] text-slate-400 block">Total Revenue / Users</span>
            </div>
            <div>
              <span className="text-xs text-slate-500 block mb-1">RFx per User</span>
              <span className="text-lg font-bold text-slate-900">
                {metrics.totalUsers > 0
                  ? (metrics.totalRfx / metrics.totalUsers).toFixed(2)
                  : "—"}
              </span>
              <span className="text-[10px] text-slate-400 block">Network activity density</span>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
