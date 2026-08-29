"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Check,
  Copy,
  CreditCard,
  KeyRound,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  UserCog,
  Users,
  WalletCards,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { auth, db } from "@/lib/firebase";
import {
  MEMBERSHIP_TIERS,
  type MembershipStatus,
  type PaymentDoc,
  type UserDoc,
} from "@hi/shared";

type MemberRecord = UserDoc & {
  accountCreditCents?: number;
};

type AdminBooking = {
  id: string;
  userId: string;
  userName?: string;
  resourceId: string;
  resourceName?: string;
  start: number;
  end: number;
  status: string;
  totalCents?: number;
  subtotalCents?: number;
  totalPrice?: number;
  paymentMethod?: string;
  includedHoursApplied?: number;
  createdAt?: number;
};

type DetailTab = "overview" | "membership" | "bookings" | "payments" | "activity";

const LOCATION_TIME_ZONE = "America/New_York";

function memberStatusLabel(status?: MembershipStatus) {
  switch (status) {
    case "pastDue": return "Payment attention";
    case "cancelled": return "Cancelled";
    case "expired": return "Expired";
    case "trial": return "Trial";
    case "active": return "Active";
    case "none":
    default: return "No membership";
  }
}

function statusClasses(status?: MembershipStatus) {
  if (status === "active") return "bg-emerald-50 text-emerald-800";
  if (status === "trial") return "bg-sky-50 text-sky-800";
  if (status === "pastDue") return "bg-amber-50 text-amber-900";
  if (status === "cancelled" || status === "expired") return "bg-slate-100 text-slate-600";
  return "bg-slate-50 text-slate-500";
}

function planFor(member: MemberRecord) {
  return MEMBERSHIP_TIERS.find((tier) => tier.id === member.plan);
}

function planLabel(member: MemberRecord) {
  return planFor(member)?.name || "No membership plan";
}

function formatDate(timestamp?: number) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LOCATION_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp));
}

function formatDateTime(timestamp?: number) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LOCATION_TIME_ZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function monthKey(timestamp: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function money(cents = 0) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function bookingAmountCents(booking: AdminBooking) {
  if (Number.isFinite(Number(booking.totalCents))) return Math.max(0, Number(booking.totalCents));
  return Math.max(0, Math.round(Number(booking.totalPrice || 0) * 100));
}

function currentMonthUsage(bookings: AdminBooking[], uid: string) {
  const currentKey = monthKey(Date.now());
  return bookings.reduce((sum, booking) => {
    if (booking.userId !== uid || booking.status === "CANCELLED") return sum;
    if (!booking.resourceId.startsWith("seat-") || monthKey(booking.start) !== currentKey) return sum;
    const applied = Number(booking.includedHoursApplied);
    if (Number.isFinite(applied)) return sum + Math.max(0, applied);
    return sum + Math.max(0, (booking.end - booking.start) / 3_600_000);
  }, 0);
}

function upcomingBooking(bookings: AdminBooking[], uid: string) {
  const now = Date.now();
  return bookings
    .filter((booking) => booking.userId === uid && booking.status === "CONFIRMED" && booking.end > now)
    .sort((a, b) => a.start - b.start)[0];
}

function purposeLabel(purpose: PaymentDoc["purpose"]) {
  if (purpose === "membership") return "Membership";
  if (purpose === "booking") return "Booking";
  if (purpose === "event") return "Event";
  if (purpose === "bookstore") return "Bookstore";
  return purpose.charAt(0).toUpperCase() + purpose.slice(1);
}

export default function AdminMembersPage() {
  return <RequireAuth requiredRole="admin"><AdminMembersContent /></RequireAuth>;
}

function AdminMembersContent() {
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [payments, setPayments] = useState<PaymentDoc[]>([]);
  const [selected, setSelected] = useState<MemberRecord | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchDirectory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [userSnap, bookingSnap] = await Promise.all([
        getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"))),
        getDocs(collection(db, "bookings")),
      ]);
      setMembers(userSnap.docs.map((memberDoc) => ({
        ...(memberDoc.data() as MemberRecord),
        uid: (memberDoc.data() as MemberRecord).uid || memberDoc.id,
      })));
      setBookings(bookingSnap.docs.map((bookingDoc) => ({
        ...(bookingDoc.data() as Omit<AdminBooking, "id">),
        id: (bookingDoc.data() as AdminBooking).id || bookingDoc.id,
      })));
    } catch (caught) {
      console.error("Failed to load member operations directory:", caught);
      setError("Member operations could not be loaded. Confirm this account still has Admin access, then try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchDirectory(); }, [fetchDirectory]);

  const openMember = useCallback(async (member: MemberRecord) => {
    setSelected(member);
    setActiveTab("overview");
    setPayments([]);
    setActionMessage(null);
    setError(null);
    setDetailLoading(true);
    try {
      const paymentSnap = await getDocs(query(collection(db, "payments"), where("uid", "==", member.uid)));
      setPayments(paymentSnap.docs.map((paymentDoc) => ({
        ...(paymentDoc.data() as PaymentDoc),
        id: (paymentDoc.data() as PaymentDoc).id || paymentDoc.id,
      })).sort((a, b) => b.createdAt - a.createdAt));
    } catch (caught) {
      console.error("Failed to load member payments:", caught);
      setError("This member opened, but payment history could not be loaded. Try Refresh or open the Payment Ledger.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return members;
    return members.filter((member) => (
      (member.displayName || "").toLowerCase().includes(term)
      || (member.email || "").toLowerCase().includes(term)
      || planLabel(member).toLowerCase().includes(term)
      || memberStatusLabel(member.membershipStatus).toLowerCase().includes(term)
    ));
  }, [members, searchTerm]);

  async function sendReset(member: MemberRecord) {
    setResetLoading(true);
    setActionMessage(null);
    setError(null);
    try {
      await sendPasswordResetEmail(auth, member.email);
      setActionMessage(`Password reset email sent to ${member.email}.`);
    } catch (caught) {
      console.error("Failed to send password reset:", caught);
      setError("The password reset email could not be sent. Confirm the account email and try again.");
    } finally {
      setResetLoading(false);
    }
  }

  async function copyEmail(member: MemberRecord) {
    try {
      await navigator.clipboard.writeText(member.email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("The email address could not be copied automatically.");
    }
  }

  if (selected) {
    const tier = planFor(selected);
    const memberBookings = bookings.filter((booking) => booking.userId === selected.uid).sort((a, b) => b.start - a.start);
    const nextBooking = upcomingBooking(bookings, selected.uid);
    const usedHours = currentMonthUsage(bookings, selected.uid);
    const allowance = tier?.includedHoursPerMonth || 0;
    const remainingHours = Math.max(0, allowance - usedHours);
    const latestMembershipPayment = payments.find((payment) => payment.purpose === "membership");
    const activity = [
      ...(selected.createdAt ? [{ key: "account-created", at: selected.createdAt, label: "Account created", detail: selected.email }] : []),
      ...(selected.updatedAt ? [{ key: "account-updated", at: selected.updatedAt, label: "Account or membership updated", detail: `${planLabel(selected)} · ${memberStatusLabel(selected.membershipStatus)}` }] : []),
      ...memberBookings.map((booking) => ({ key: `booking-${booking.id}`, at: booking.createdAt || booking.start, label: `${booking.status === "CANCELLED" ? "Booking cancelled" : "Booking"} · ${booking.resourceName || booking.resourceId}`, detail: formatDateTime(booking.start) })),
      ...payments.map((payment) => ({ key: `payment-${payment.id}`, at: payment.createdAt, label: `${purposeLabel(payment.purpose)} payment · ${payment.status}`, detail: money(payment.amount) })),
    ].sort((a, b) => b.at - a.at).slice(0, 30);
    const tabs: Array<{ id: DetailTab; label: string }> = [
      { id: "overview", label: "Overview" },
      { id: "membership", label: "Membership" },
      { id: "bookings", label: "Bookings" },
      { id: "payments", label: "Payments" },
      { id: "activity", label: "Activity" },
    ];

    return (
      <AppShell>
        <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <button type="button" onClick={() => { setSelected(null); setPayments([]); setError(null); setActionMessage(null); }} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"><ArrowLeft className="h-4 w-4" /> Back to members</button>
          <div className="mt-7 flex flex-col gap-5 border-b border-slate-200 pb-7 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Member</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{selected.displayName || selected.email}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500"><span>{selected.email}</span><span>·</span><span>{planLabel(selected)}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusClasses(selected.membershipStatus)}`}>{memberStatusLabel(selected.membershipStatus)}</span></div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void copyEmail(selected)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy email"}</button>
              <button type="button" disabled={resetLoading} onClick={() => void sendReset(selected)} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{resetLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}Password reset</button>
              <Link href="/admin/roles" className="inline-flex min-h-10 items-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"><UserCog className="h-4 w-4" /> Staff & roles</Link>
            </div>
          </div>
          {(error || actionMessage) && <div className={`mt-5 flex items-start gap-3 rounded-2xl px-4 py-3 text-sm ${error ? "bg-red-50 text-red-800 ring-1 ring-red-100" : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"}`}>{error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}<span>{error || actionMessage}</span></div>}
          <nav className="mt-7 flex gap-6 overflow-x-auto border-b border-slate-200" aria-label="Member details">{tabs.map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-semibold ${activeTab === tab.id ? "border-slate-950 text-slate-950" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{tab.label}</button>)}</nav>
          {detailLoading ? <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div> : (
            <div className="py-8">
              {activeTab === "overview" && <div className="grid gap-8 lg:grid-cols-[1.35fr_0.65fr]">
                <section><h2 className="text-xl font-semibold text-slate-950">At a glance</h2><div className="mt-5 grid gap-x-8 gap-y-6 sm:grid-cols-2">
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">This month</p>{allowance > 0 ? <><p className="mt-1 text-2xl font-semibold text-slate-950">{usedHours.toFixed(1)} of {allowance} hours used</p><p className="mt-1 text-sm text-slate-500">{remainingHours.toFixed(1)} included hours remaining</p></> : <><p className="mt-1 text-2xl font-semibold text-slate-950">No included desk hours</p><p className="mt-1 text-sm text-slate-500">Desk use follows the plan’s hourly rate.</p></>}</div>
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Next booking</p>{nextBooking ? <><p className="mt-1 text-lg font-semibold text-slate-950">{nextBooking.resourceName || nextBooking.resourceId}</p><p className="mt-1 text-sm text-slate-500">{formatDateTime(nextBooking.start)}</p></> : <p className="mt-1 text-lg font-semibold text-slate-950">No upcoming booking</p>}</div>
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Billing</p><p className="mt-1 text-lg font-semibold text-slate-950">{memberStatusLabel(selected.membershipStatus)}</p><p className="mt-1 text-sm text-slate-500">{latestMembershipPayment ? `Latest membership payment ${latestMembershipPayment.status} · ${formatDate(latestMembershipPayment.createdAt)}` : "No membership payment is recorded in the unified ledger."}</p></div>
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Account credit</p><p className="mt-1 text-lg font-semibold text-slate-950">{money(selected.accountCreditCents || 0)}</p><p className="mt-1 text-sm text-slate-500">Available Hi Coworking account credit</p></div>
                </div></section>
                <aside className="border-t border-slate-200 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0"><h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Quick actions</h2><div className="mt-4 space-y-2">
                  <Link href="/admin/access" className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100"><span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-slate-400" /> Access control</span><span>→</span></Link>
                  <Link href="/admin/payments" className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100"><span className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-slate-400" /> Payment ledger</span><span>→</span></Link>
                  <Link href="/admin/roles" className="flex items-center justify-between rounded-xl px-3 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100"><span className="flex items-center gap-2"><UserCog className="h-4 w-4 text-slate-400" /> Staff & roles</span><span>→</span></Link>
                </div></aside>
              </div>}
              {activeTab === "membership" && <section className="max-w-3xl">
                <div className="flex items-start justify-between gap-6"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Current plan</p><h2 className="mt-2 text-2xl font-semibold text-slate-950">{planLabel(selected)}</h2><span className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses(selected.membershipStatus)}`}>{memberStatusLabel(selected.membershipStatus)}</span></div>{tier && <p className="text-lg font-semibold text-slate-950">{money(tier.amountCents)}<span className="text-sm font-normal text-slate-500">/month</span></p>}</div>
                <dl className="mt-8 grid gap-6 border-y border-slate-200 py-6 sm:grid-cols-2"><div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Included desk hours</dt><dd className="mt-1 text-lg font-semibold text-slate-950">{tier?.includedHoursPerMonth ?? 0} / month</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Additional desk time</dt><dd className="mt-1 text-lg font-semibold text-slate-950">{tier ? `${money(tier.extraHourlyRateCents)}/hr` : "Public rate"}</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Used this month</dt><dd className="mt-1 text-lg font-semibold text-slate-950">{usedHours.toFixed(1)} hours</dd></div><div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Entitlement through</dt><dd className="mt-1 text-lg font-semibold text-slate-950">{formatDate(selected.expiresAt)}</dd></div></dl>
                <div className="mt-7 rounded-2xl bg-sky-50 px-5 py-4 text-sm leading-6 text-sky-950"><strong>Membership lifecycle protection:</strong> plan changes, cancellations and reactivation are not edited directly on the member record. The current backend does not yet expose an authoritative Admin subscription-change API, so this screen keeps those financial lifecycle actions read-only rather than risking Stripe and entitlement drift.</div>
                <Link href="/admin/products" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-900 underline underline-offset-4">Review canonical pricing & membership products →</Link>
              </section>}
              {activeTab === "bookings" && <section><div className="flex items-end justify-between gap-4"><div><h2 className="text-xl font-semibold text-slate-950">Bookings</h2><p className="mt-1 text-sm text-slate-500">Upcoming and recent space use for this member.</p></div><span className="text-sm text-slate-500">{memberBookings.length} total</span></div>{memberBookings.length === 0 ? <p className="mt-8 text-sm text-slate-500">No bookings are recorded for this member.</p> : <div className="mt-5 divide-y divide-slate-200 border-y border-slate-200">{memberBookings.slice(0, 20).map((booking) => <div key={booking.id} className="grid gap-2 py-4 sm:grid-cols-[1.2fr_1fr_auto] sm:items-center"><div><p className="font-semibold text-slate-950">{booking.resourceName || booking.resourceId}</p><p className="mt-1 text-sm text-slate-500">{formatDateTime(booking.start)} · {((booking.end - booking.start) / 3_600_000).toFixed(1)} hr</p></div><div><p className="text-sm font-medium text-slate-700">{booking.status}</p><p className="mt-1 text-xs text-slate-500">{booking.paymentMethod ? booking.paymentMethod.replaceAll("_", " ") : "—"}</p></div><p className="text-sm font-semibold text-slate-950">{money(bookingAmountCents(booking))}</p></div>)}</div>}<p className="mt-5 text-xs leading-5 text-slate-500">Booking cancellation/reschedule actions remain in the authoritative booking lifecycle. This member view does not directly edit booking records.</p></section>}
              {activeTab === "payments" && <section><div className="flex items-end justify-between gap-4"><div><h2 className="text-xl font-semibold text-slate-950">Payments</h2><p className="mt-1 text-sm text-slate-500">Unified payment history associated with this account.</p></div><Link href="/admin/payments" className="text-sm font-semibold text-slate-900 underline underline-offset-4">Open full ledger</Link></div>{payments.length === 0 ? <p className="mt-8 text-sm text-slate-500">No payments are recorded for this member.</p> : <div className="mt-5 divide-y divide-slate-200 border-y border-slate-200">{payments.slice(0, 20).map((payment) => <div key={payment.id} className="grid gap-2 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-center"><div><p className="font-semibold text-slate-950">{purposeLabel(payment.purpose)}</p><p className="mt-1 text-sm text-slate-500">{formatDate(payment.createdAt)}</p></div><p className={`text-sm font-semibold ${payment.status === "failed" ? "text-red-700" : payment.status === "pending" ? "text-amber-800" : payment.status === "paid" ? "text-emerald-700" : "text-slate-600"}`}>{payment.status.charAt(0).toUpperCase() + payment.status.slice(1)}</p><p className="text-sm font-semibold text-slate-950">{money(payment.amount)}</p></div>)}</div>}</section>}
              {activeTab === "activity" && <section className="max-w-3xl"><div className="flex items-center gap-2"><Activity className="h-5 w-5 text-slate-400" /><h2 className="text-xl font-semibold text-slate-950">Activity</h2></div><div className="mt-6 space-y-0">{activity.map((item) => <div key={item.key} className="grid grid-cols-[110px_1fr] gap-4 border-l border-slate-200 pb-6 pl-5 text-sm last:pb-0"><p className="text-slate-400">{formatDate(item.at)}</p><div><p className="font-semibold text-slate-900">{item.label}</p><p className="mt-1 text-slate-500">{item.detail}</p></div></div>)}</div></section>}
            </div>
          )}
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Admin</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Members</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Membership, usage, bookings, billing and customer-service history in one place. Staff/Admin role assignment is managed separately.</p></div><div className="flex flex-wrap gap-2"><Link href="/admin/roles" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"><UserCog className="h-4 w-4" /> Staff & roles</Link><button type="button" onClick={() => void fetchDirectory()} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button></div></div>
        {error && <div className="mt-5 flex items-start gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
        <div className="relative mt-7 max-w-2xl"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search by member, email, plan or status" className="w-full rounded-full border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-sky-300 focus:ring-4 focus:ring-sky-100" /></div>
        {loading ? <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div> : filtered.length === 0 ? <div className="py-20 text-center"><Users className="mx-auto h-9 w-9 text-slate-300" /><p className="mt-4 text-sm text-slate-500">{searchTerm ? "No matching members found." : "No member accounts are available yet."}</p></div> : <div className="mt-7 divide-y divide-slate-200 border-y border-slate-200">{filtered.map((member) => { const tier = planFor(member); const used = currentMonthUsage(bookings, member.uid); const allowance = tier?.includedHoursPerMonth || 0; const next = upcomingBooking(bookings, member.uid); return <button key={member.uid} type="button" onClick={() => void openMember(member)} className="grid w-full gap-3 py-5 text-left transition hover:bg-slate-50 sm:grid-cols-[1.3fr_0.8fr_1fr_auto] sm:items-center sm:px-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="truncate font-semibold text-slate-950">{member.displayName || member.email}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClasses(member.membershipStatus)}`}>{memberStatusLabel(member.membershipStatus)}</span></div><p className="mt-1 truncate text-sm text-slate-500">{member.email}</p></div><div><p className="text-sm font-semibold text-slate-800">{planLabel(member)}</p><p className="mt-1 text-xs text-slate-400">Joined {formatDate(member.createdAt)}</p></div><div>{allowance > 0 ? <><p className="text-sm font-semibold text-slate-800">{Math.max(0, allowance - used).toFixed(1)} of {allowance} hours left</p><p className="mt-1 text-xs text-slate-400">{used.toFixed(1)} used this month</p></> : <><p className="text-sm font-semibold text-slate-800">{next ? formatDateTime(next.start) : "No upcoming booking"}</p><p className="mt-1 text-xs text-slate-400">{next ? next.resourceName || next.resourceId : ""}</p></>}</div><span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">View <span aria-hidden="true">→</span></span></button>; })}</div>}
        <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-xs text-slate-500"><span className="inline-flex items-center gap-2"><WalletCards className="h-4 w-4" /> Membership and account credit</span><span className="inline-flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Booking history and included-hour usage</span><span className="inline-flex items-center gap-2"><CreditCard className="h-4 w-4" /> Payment history</span></div>
      </main>
    </AppShell>
  );
}
