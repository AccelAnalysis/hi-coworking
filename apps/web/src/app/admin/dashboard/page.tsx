"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import {
  getPublicSiteSettings,
  setPublicSiteSettings,
  type PublicSiteSettingsDoc,
} from "@/lib/firestore";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import Link from "next/link";
import {
  LayoutDashboard,
  Loader2,
  Users,
  Building2,
  CreditCard,
  Calendar,
  ClipboardList,
  BarChart3,
  UserPlus,
  Bell,
  DollarSign,
  ArrowRight,
  Rocket,
  Hammer,
  MapPin,
  ShieldCheck,
  KeyRound,
} from "lucide-react";

export default function AdminDashboardPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminDashboardContent />
    </RequireAuth>
  );
}

function AdminDashboardContent() {
  const { user } = useAuth();

  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettingsDoc>({
    id: "public",
    comingSoonEnabled: false,
    updatedAt: 0,
  });
  const [savingComingSoon, setSavingComingSoon] = useState(false);
  const [comingSoonError, setComingSoonError] = useState<string | null>(null);

  // TODO: Replace with a server-side admin_getStats callable once data volume grows.
  // These full-collection reads are fine for a micro-coworking space but won't scale.
  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const [users, activeMembers, orgs, rfx, events, payments, paidPayments, referrals] = await Promise.all([
        getDocs(collection(db, "users")),
        getDocs(query(collection(db, "users"), where("membershipStatus", "==", "active"))),
        getDocs(collection(db, "orgs")),
        getDocs(collection(db, "rfx")),
        getDocs(collection(db, "events")),
        getDocs(collection(db, "payments")),
        getDocs(query(collection(db, "payments"), where("status", "==", "paid"))),
        getDocs(collection(db, "referrals")),
      ]);

      let revenue = 0;
      paidPayments.docs.forEach((d) => { revenue += (d.data().amount || 0); });

      setStats({
        users: users.size,
        activeMembers: activeMembers.size,
        orgs: orgs.size,
        rfx: rfx.size,
        events: events.size,
        payments: payments.size,
        revenue,
        referrals: referrals.size,
      });
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      await Promise.all([
        fetchStats(),
        (async () => {
          try {
            const settings = await getPublicSiteSettings();
            setSiteSettings(settings);
          } catch (err) {
            console.error("Failed to fetch public site settings:", err);
          }
        })(),
      ]);
    };

    load();
  }, [fetchStats]);

  const toggleComingSoon = useCallback(async () => {
    if (!user || savingComingSoon) return;
    const nextEnabled = !siteSettings.comingSoonEnabled;
    setSavingComingSoon(true);
    setComingSoonError(null);
    try {
      await setPublicSiteSettings({
        comingSoonEnabled: nextEnabled,
        updatedBy: user.uid,
      });
      setSiteSettings((prev) => ({
        ...prev,
        comingSoonEnabled: nextEnabled,
        updatedAt: Date.now(),
        updatedBy: user.uid,
      }));
    } catch (err: unknown) {
      console.error("Failed to update coming soon setting:", err);
      const fbErr = err as { code?: string; message?: string };
      setComingSoonError(
        fbErr.code === "permission-denied"
          ? "Permission denied. Ensure your account has admin/master custom claims (re-run set-admin.js and sign out/in)."
          : `Failed to save: ${fbErr.message ?? "Unknown error"}`
      );
    } finally {
      setSavingComingSoon(false);
    }
  }, [savingComingSoon, siteSettings.comingSoonEnabled, user]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  const cards = [
    { label: "Total Users", value: stats.users || 0, icon: Users, color: "text-slate-600 bg-slate-100" },
    { label: "Active Members", value: stats.activeMembers || 0, icon: Users, color: "text-emerald-600 bg-emerald-50" },
    { label: "Revenue", value: `$${((stats.revenue || 0) / 100).toFixed(0)}`, icon: DollarSign, color: "text-emerald-600 bg-emerald-50" },
    { label: "Organizations", value: stats.orgs || 0, icon: Building2, color: "text-indigo-600 bg-indigo-50" },
    { label: "RFx Opportunities", value: stats.rfx || 0, icon: ClipboardList, color: "text-blue-600 bg-blue-50" },
    { label: "Events", value: stats.events || 0, icon: Calendar, color: "text-purple-600 bg-purple-50" },
    { label: "Payments", value: stats.payments || 0, icon: CreditCard, color: "text-amber-600 bg-amber-50" },
    { label: "Referrals", value: stats.referrals || 0, icon: UserPlus, color: "text-pink-600 bg-pink-50" },
  ];

  const quickLinks = [
    { href: "/admin/members", label: "Member Management", icon: Users },
    { href: "/admin/rfx", label: "RFx Moderation", icon: ClipboardList },
    { href: "/admin/territories", label: "Territory Manager", icon: MapPin },
    { href: "/admin/verification", label: "Verification Ops", icon: ShieldCheck },
    { href: "/admin/events", label: "Event Management", icon: Calendar },
    { href: "/admin/events/campaigns", label: "Event Campaigns", icon: Bell },
    { href: "/admin/events/social", label: "Event Social", icon: Rocket },
    { href: "/admin/orgs", label: "Org Management", icon: Building2 },
    { href: "/admin/payments", label: "Payments Ledger", icon: CreditCard },
    { href: "/admin/analytics", label: "Platform Analytics", icon: BarChart3 },
    { href: "/admin/leads", label: "Leads", icon: Bell },
    { href: "/admin/products", label: "Products", icon: DollarSign },
    { href: "/admin/builder", label: "Space Builder", icon: Hammer },
    { href: "/admin/access", label: "Access Control", icon: KeyRound },
  ];

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <LayoutDashboard className="h-8 w-8 text-slate-400" />
            Admin Overview
          </h1>
          <p className="text-slate-500 mt-1">Real-time platform snapshot.</p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {cards.map((card) => (
            <div key={card.label} className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg ${card.color}`}>
                  <card.icon className="h-4 w-4" />
                </div>
                <span className="text-[10px] font-medium text-slate-500 uppercase">{card.label}</span>
              </div>
              <div className="text-2xl font-bold text-slate-900">{card.value}</div>
            </div>
          ))}
        </div>

        {/* Quick links */}
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-4">Quick Links</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 hover:ring-slate-300 hover:shadow-md transition-all flex items-center gap-3 group"
            >
              <link.icon className="h-5 w-5 text-slate-400 group-hover:text-slate-600 transition-colors" />
              <span className="text-sm font-medium text-slate-700 flex-1">{link.label}</span>
              <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-slate-500 transition-colors" />
            </Link>
          ))}
        </div>

        {/* Public site control */}
        <div className="mt-8 p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <Rocket className="h-4 w-4 text-slate-400" /> Public Site Mode
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Toggle marketing pages between normal mode and Coming Soon mode while keeping ecosystem routes live.
              </p>
              {siteSettings.updatedAt > 0 && (
                <p className="text-xs text-slate-400 mt-2">
                  Last updated {new Date(siteSettings.updatedAt).toLocaleString("en-US")}
                  {siteSettings.updatedBy ? ` · by ${siteSettings.updatedBy}` : ""}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={toggleComingSoon}
              disabled={savingComingSoon}
              className={`inline-flex items-center justify-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors disabled:opacity-60 ${
                siteSettings.comingSoonEnabled
                  ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
                  : "bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
              }`}
            >
              {savingComingSoon ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                </>
              ) : siteSettings.comingSoonEnabled ? (
                "Coming Soon: ON"
              ) : (
                "Coming Soon: OFF"
              )}
            </button>
          </div>

          {comingSoonError && (
            <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {comingSoonError}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
