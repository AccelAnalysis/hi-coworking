"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarClock,
  CalendarDays,
  Clock3,
  CreditCard,
  DoorOpen,
  Hammer,
  LayoutDashboard,
  Loader2,
  Mail,
  Package,
  RefreshCw,
  Rocket,
  Sparkles,
  UserCog,
  Users,
  WalletCards,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { db, functions } from "@/lib/firebase";
import { getPublicSiteSettings, setPublicSiteSettings, type PublicSiteSettingsDoc } from "@/lib/firestore";

type Row = Record<string, unknown> & { id: string };
type NurtureOverview = { summary: { active: number; completed: number; failed: number; suppressed: number } };

const getNurtureOverview = httpsCallable<Record<string, never>, NurtureOverview>(functions, "nurture_adminOverview");

const MODULES = [
  { href: "/admin/members", label: "Members", description: "Profiles, plans, status, notes, credit, and booking actions", icon: Users },
  { href: "/admin/members/actions", label: "Booking operations", description: "Book, cancel, reschedule, and resolve member exceptions", icon: WalletCards },
  { href: "/admin/spaces", label: "Hours & closures", description: "Operating schedule, booking rules, and date exceptions", icon: Clock3 },
  { href: "/admin/spaces/catalog", label: "Published setups", description: "Customer arrangements, capacities, and upsell add-ons", icon: Sparkles },
  { href: "/admin/builder", label: "Visual designer", description: "Locations, floors, layouts, and publishing", icon: Hammer },
  { href: "/admin/access", label: "Door access", description: "Grant status, code delivery, unlock, resend, and revoke", icon: DoorOpen },
  { href: "/admin/nurture", label: "Nurture", description: "Acquisition, customer development, renewal, and retention", icon: Mail },
  { href: "/admin/events", label: "Events", description: "Registrations, holds, waitlist, and lifecycle", icon: CalendarDays },
  { href: "/admin/bookstore", label: "Bookstore", description: "Catalog, inventory, orders, fulfillment, and refunds", icon: BookOpen },
  { href: "/admin/payments", label: "Payments", description: "Unified ledger, provider status, and reconciliation", icon: CreditCard },
  { href: "/admin/leads", label: "Leads", description: "New inquiries, follow-up context, and conversion", icon: UserCog },
  { href: "/admin/products", label: "Pricing & memberships", description: "Canonical plans, prices, and purchase paths", icon: Package },
  { href: "/admin/roles", label: "Roles & permissions", description: "Staff authority and protected operations", icon: UserCog },
  { href: "/admin/analytics", label: "Analytics", description: "Trends, conversion, revenue, and utilization", icon: BarChart3 },
] as const;

function createdAt(row: Row) {
  const value = row.createdAt;
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function status(row: Row) {
  return String(row.status || row.membershipStatus || "").toLowerCase();
}

function amount(row: Row) {
  const value = Number(row.amount || row.amountCents || 0);
  return Number.isFinite(value) ? value : 0;
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

async function rows(name: string) {
  const snap = await getDocs(collection(db, name));
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export default function AdminDashboardPage() {
  return <RequireAuth requiredRole="admin"><AdminDashboardContent /></RequireAuth>;
}

function AdminDashboardContent() {
  const { user } = useAuth();
  const [data, setData] = useState<{ users: Row[]; bookings: Row[]; payments: Row[]; events: Row[]; leads: Row[]; accessCodes: Row[]; nurtureFailed: number } | null>(null);
  const [siteSettings, setSiteSettings] = useState<PublicSiteSettingsDoc>({ id: "public", comingSoonEnabled: false, updatedAt: 0 });
  const [loading, setLoading] = useState(true);
  const [savingComingSoon, setSavingComingSoon] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [users, bookings, payments, events, leads, accessCodes, settings, nurture] = await Promise.all([
        rows("users"), rows("bookings"), rows("payments"), rows("events"), rows("leads"), rows("accessCodes"),
        getPublicSiteSettings(),
        getNurtureOverview({}).then((result) => result.data).catch(() => null),
      ]);
      setData({ users, bookings, payments, events, leads, accessCodes, nurtureFailed: nurture?.summary.failed || 0 });
      setSiteSettings(settings);
    } catch (caught) {
      console.error(caught);
      setError("The operational dashboard could not load all current records. Refresh or check your Admin access.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const view = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const periodStart = now - 30 * 24 * 60 * 60 * 1000;
    const confirmed = data.bookings.filter((row) => createdAt(row) >= periodStart && status(row) === "confirmed");
    const paid = data.payments.filter((row) => createdAt(row) >= periodStart && status(row) === "paid");
    const newLeads = data.leads.filter((row) => createdAt(row) >= periodStart);
    const failedPayments = data.payments.filter((row) => status(row) === "failed");
    const pendingPayments = data.payments.filter((row) => status(row) === "pending" && createdAt(row) > 0 && createdAt(row) < now - 30 * 60 * 1000);
    const pastDue = data.users.filter((row) => String(row.membershipStatus || "") === "pastDue");
    const accessFailures = data.accessCodes.filter((row) => ["failed", "error"].includes(status(row)));
    const upcoming = data.bookings.filter((row) => status(row) === "confirmed" && Number(row.start || 0) >= now).sort((a, b) => Number(a.start || 0) - Number(b.start || 0)).slice(0, 5);
    return {
      metrics: [
        ["Confirmed bookings", confirmed.length.toLocaleString()],
        ["Paid revenue", money(paid.reduce((sum, row) => sum + amount(row), 0))],
        ["New leads", newLeads.length.toLocaleString()],
        ["Active members", data.users.filter((row) => String(row.membershipStatus || "") === "active").length.toLocaleString()],
      ],
      actions: [
        failedPayments.length ? { label: "Failed payments", count: failedPayments.length, href: "/admin/payments" } : null,
        pendingPayments.length ? { label: "Payments still pending", count: pendingPayments.length, href: "/admin/payments" } : null,
        pastDue.length ? { label: "Past-due memberships", count: pastDue.length, href: "/admin/members" } : null,
        accessFailures.length ? { label: "Access code failures", count: accessFailures.length, href: "/admin/access" } : null,
        data.nurtureFailed ? { label: "Nurture enrollments failed", count: data.nurtureFailed, href: "/admin/nurture" } : null,
      ].filter((item): item is { label: string; count: number; href: string } => Boolean(item)),
      upcoming,
    };
  }, [data]);

  const toggleComingSoon = useCallback(async () => {
    if (!user || savingComingSoon) return;
    const nextEnabled = !siteSettings.comingSoonEnabled;
    setSavingComingSoon(true);
    try {
      await setPublicSiteSettings({ comingSoonEnabled: nextEnabled, updatedBy: user.uid });
      setSiteSettings((current) => ({ ...current, comingSoonEnabled: nextEnabled, updatedAt: Date.now(), updatedBy: user.uid }));
    } catch (caught) {
      console.error(caught);
      setError("The public site mode could not be changed.");
    } finally {
      setSavingComingSoon(false);
    }
  }, [savingComingSoon, siteSettings.comingSoonEnabled, user]);

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:py-12">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium text-slate-500">Admin</p><h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold tracking-tight text-slate-950"><LayoutDashboard className="h-7 w-7 text-slate-400" /> Operations overview</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Current-period performance, exceptions requiring action, and direct access to each authoritative operating workspace.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-800"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button></header>
        {error ? <div className="mt-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</div> : null}
        {loading && !view ? <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div> : null}
        {view ? <>
          <section className="mt-8 grid gap-px overflow-hidden rounded-3xl bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">{view.metrics.map(([label, value]) => <div key={label} className="bg-white p-5"><p className="text-[11px] font-semibold uppercase tracking-[.12em] text-slate-500">{label}</p><p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">Last 30 days unless noted</p></div>)}</section>
          <section className="mt-10 grid gap-8 lg:grid-cols-2"><div><div className="flex items-center gap-2"><AlertCircle className="h-5 w-5 text-slate-500" /><h2 className="text-xl font-semibold text-slate-950">Action required</h2></div>{view.actions.length ? <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">{view.actions.map((item) => <Link key={item.label} href={item.href} className="flex min-h-16 items-center gap-4 py-3"><span className="inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-amber-100 text-sm font-semibold text-amber-900">{item.count}</span><span className="flex-1 text-sm font-semibold text-slate-900">{item.label}</span><ArrowRight className="h-4 w-4 text-slate-400" /></Link>)}</div> : <p className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">No tracked payment, membership, access, or nurture exceptions currently require action.</p>}</div><div><div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-slate-500" /><h2 className="text-xl font-semibold text-slate-950">Next bookings</h2></div><div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">{view.upcoming.map((booking) => <div key={booking.id} className="flex items-center justify-between gap-4 py-3 text-sm"><span><span className="block font-medium text-slate-950">{String(booking.resourceName || booking.resourceId || "Space")}</span><span className="text-xs text-slate-500">{String(booking.userName || booking.guestEmail || "Member")}</span></span><span className="text-right text-xs text-slate-600">{new Date(Number(booking.start)).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })}</span></div>)}{view.upcoming.length === 0 ? <p className="py-5 text-sm text-slate-500">No confirmed future bookings.</p> : null}</div></div></section>
          <section className="mt-12 border-t border-slate-300 pt-8"><h2 className="text-xl font-semibold text-slate-950">Operating workspaces</h2><div className="mt-5 grid gap-px overflow-hidden rounded-3xl bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">{MODULES.map((module) => { const Icon = module.icon; return <Link key={module.href} href={module.href} className="group min-h-32 bg-white p-5 transition hover:bg-slate-50"><div className="flex items-start justify-between"><Icon className="h-5 w-5 text-slate-500" /><ArrowRight className="h-4 w-4 text-slate-300" /></div><h3 className="mt-4 font-semibold text-slate-950">{module.label}</h3><p className="mt-1 text-sm leading-5 text-slate-600">{module.description}</p></Link>; })}</div></section>
          <section className="mt-9 flex flex-col gap-4 border-t border-slate-200 pt-7 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950"><Rocket className="h-4 w-4 text-slate-500" /> Public site mode</h2><p className="mt-1 text-sm text-slate-600">Coming Soon can remain enabled while member and staff routes stay available.</p></div><button type="button" onClick={() => void toggleComingSoon()} disabled={savingComingSoon} className={`inline-flex min-h-11 items-center justify-center rounded-full px-5 text-sm font-semibold ${siteSettings.comingSoonEnabled ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}>{savingComingSoon ? "Saving…" : siteSettings.comingSoonEnabled ? "Coming Soon: ON" : "Coming Soon: OFF"}</button></section>
        </> : null}
      </main>
    </AppShell>
  );
}
