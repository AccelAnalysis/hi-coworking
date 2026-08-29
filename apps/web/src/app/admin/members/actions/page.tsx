"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Copy,
  CreditCard,
  Loader2,
  RefreshCw,
  UserRound,
  WalletCards,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { db, functions } from "@/lib/firebase";
import { normalizeMember, type AdminMemberRecord } from "@/lib/adminMemberData";
import { MEMBERSHIP_TIERS } from "@hi/shared";

type MemberRecord = AdminMemberRecord;
type MembershipState = {
  hasSubscription: boolean;
  subscriptionId: string | null;
  stripeStatus: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number | null;
  planId: string | null;
  membershipStatus: string;
};
type SpaceOption = { resourceId: string; name: string; type: "SEAT" | "MODE"; available: boolean };
type BookingQuote = {
  resourceId: string;
  resourceName: string;
  durationHours: number;
  membershipName: string | null;
  includedHoursRemaining: number;
  includedHoursApplied: number;
  billableHours: number;
  hourlyRateCents: number;
  subtotalCents: number;
  accountCreditAvailableCents: number;
  accountCreditAppliedCents: number;
  totalCents: number;
  dailyCapApplied: boolean;
};

type ActionTab = "membership" | "booking" | "credit";

const getMembershipState = httpsCallable<{ uid: string }, MembershipState>(functions, "admin_membershipGetState");
const changeMembershipPlan = httpsCallable<{ uid: string; tierId: string }, { success: boolean }>(functions, "admin_membershipChangePlan");
const cancelMembership = httpsCallable<{ uid: string }, { success: boolean }>(functions, "admin_membershipCancel");
const reactivateMembership = httpsCallable<
  { uid: string; tierId?: string; returnOrigin: string },
  { success: boolean; kind: "reactivated" | "checkout"; checkoutUrl?: string }
>(functions, "admin_membershipReactivate");
const getAvailability = httpsCallable<
  { uid: string; start: number; end: number },
  { options: SpaceOption[] }
>(functions, "admin_bookingForMemberGetAvailability");
const getBookingQuote = httpsCallable<
  { uid: string; resourceId: string; start: number; end: number },
  BookingQuote
>(functions, "admin_bookingForMemberQuote");
const beginBooking = httpsCallable<
  { uid: string; resourceId: string; start: number; end: number; returnOrigin: string },
  { kind: "confirmed" | "checkout"; bookingId?: string; checkoutUrl?: string; quote: BookingQuote }
>(functions, "admin_bookingForMemberBeginCheckout");
const adjustCredit = httpsCallable<
  { uid: string; deltaCents: number; reason: string; note?: string; requestId: string },
  { success: boolean; adjustment: { beforeCents: number; afterCents: number; deltaCents: number } }
>(functions, "admin_accountCreditAdjust");

const timeOptions = Array.from({ length: 25 }, (_, index) => {
  const totalMinutes = 8 * 60 + index * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const label = new Date(2026, 0, 1, hour, minute).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return { value, label };
});

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function planName(plan?: string | null) {
  return MEMBERSHIP_TIERS.find((tier) => tier.id === plan)?.name || "No plan";
}

function memberName(member: MemberRecord) {
  return member.displayName || member.email || "Member";
}

function easternEpoch(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = targetAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const observedAsUtc = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute));
    guess += targetAsUtc - observedAsUtc;
  }
  return guess;
}

function todayEastern() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export default function AdminMemberActionsPage() {
  return <RequireAuth requiredRole="admin"><AdminMemberActionsContent /></RequireAuth>;
}

function AdminMemberActionsContent() {
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [selectedUid, setSelectedUid] = useState("");
  const [member, setMember] = useState<MemberRecord | null>(null);
  const [membership, setMembership] = useState<MembershipState | null>(null);
  const [tab, setTab] = useState<ActionTab>("membership");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);

  const [dateValue, setDateValue] = useState(todayEastern());
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [quote, setQuote] = useState<BookingQuote | null>(null);

  const [creditDirection, setCreditDirection] = useState<"add" | "deduct">("add");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("service_adjustment");
  const [creditNote, setCreditNote] = useState("");

  const loadMembers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(collection(db, "users"));
      const records = snap.docs
        .map((memberDoc) => normalizeMember(memberDoc.data(), memberDoc.id))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setMembers(records);
      const params = new URLSearchParams(window.location.search);
      const requested = params.get("uid");
      const initial = records.find((record) => record.uid === requested)?.uid || records[0]?.uid || "";
      setSelectedUid((current) => current || initial);
    } catch (caught) {
      console.error(caught);
      setError("Member accounts could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  const loadMember = useCallback(async (uid: string) => {
    if (!uid) { setMember(null); return; }
    setActionLoading(true);
    setError(null);
    setSuccess(null);
    setCheckoutUrl(null);
    try {
      const snap = await getDoc(doc(db, "users", uid));
      if (!snap.exists()) throw new Error("Member not found");
      setMember(normalizeMember(snap.data(), snap.id));
      try {
        setMembership((await getMembershipState({ uid })).data);
      } catch (membershipError) {
        console.error(membershipError);
        setMembership(null);
      }
    } catch (caught) {
      console.error(caught);
      setError("This member could not be loaded.");
    } finally {
      setActionLoading(false);
    }
  }, []);

  useEffect(() => { if (selectedUid) void loadMember(selectedUid); }, [selectedUid, loadMember]);

  async function refreshSelected() {
    if (selectedUid) await loadMember(selectedUid);
  }

  async function doChangePlan(tierId: string) {
    if (!member) return;
    const tier = MEMBERSHIP_TIERS.find((item) => item.id === tierId);
    if (!tier || !window.confirm(`Change ${memberName(member)} to ${tier.name}? Stripe will apply the plan change and proration before Hi Coworking updates the entitlement.`)) return;
    setActionLoading(true); setError(null); setSuccess(null); setCheckoutUrl(null);
    try {
      await changeMembershipPlan({ uid: member.uid, tierId });
      setSuccess(`Membership changed to ${tier.name}.`);
      await refreshSelected();
    } catch (caught) {
      console.error(caught);
      setError("The plan change was not completed. Stripe and the Hi Coworking membership record were left unchanged if payment could not be completed.");
    } finally { setActionLoading(false); }
  }

  async function doCancelMembership() {
    if (!member || !window.confirm(`Cancel ${memberName(member)}'s membership at the end of the current Stripe billing period? Access and entitlements remain active through that date.`)) return;
    setActionLoading(true); setError(null); setSuccess(null); setCheckoutUrl(null);
    try {
      await cancelMembership({ uid: member.uid });
      setSuccess("Cancellation scheduled for the end of the current billing period.");
      await refreshSelected();
    } catch (caught) { console.error(caught); setError("The membership cancellation could not be scheduled."); }
    finally { setActionLoading(false); }
  }

  async function doReactivateMembership(tierId?: string) {
    if (!member) return;
    setActionLoading(true); setError(null); setSuccess(null); setCheckoutUrl(null);
    try {
      const result = await reactivateMembership({ uid: member.uid, tierId, returnOrigin: window.location.origin });
      if (result.data.kind === "checkout" && result.data.checkoutUrl) {
        setCheckoutUrl(result.data.checkoutUrl);
        setSuccess("A Stripe reactivation checkout link is ready. Send or open it for the member; the membership is reactivated only after Stripe confirms payment.");
      } else {
        setSuccess("Pending cancellation removed. The existing membership remains active.");
        await refreshSelected();
      }
    } catch (caught) { console.error(caught); setError("The membership could not be reactivated."); }
    finally { setActionLoading(false); }
  }

  async function checkAvailability() {
    if (!member) return;
    const start = easternEpoch(dateValue, startTime);
    const end = easternEpoch(dateValue, endTime);
    setActionLoading(true); setError(null); setSuccess(null); setQuote(null); setResourceId(""); setSpaces([]); setCheckoutUrl(null);
    try {
      const result = await getAvailability({ uid: member.uid, start, end });
      setSpaces(result.data.options);
      if (!result.data.options.some((option) => option.available)) setError("No spaces are available for that time range.");
    } catch (caught) { console.error(caught); setError("Availability could not be checked. Confirm the date/time is within the member's booking window and operating hours."); }
    finally { setActionLoading(false); }
  }

  async function selectSpace(id: string) {
    if (!member) return;
    setResourceId(id); setQuote(null); setError(null); setSuccess(null); setCheckoutUrl(null);
    const start = easternEpoch(dateValue, startTime);
    const end = easternEpoch(dateValue, endTime);
    setActionLoading(true);
    try { setQuote((await getBookingQuote({ uid: member.uid, resourceId: id, start, end })).data); }
    catch (caught) { console.error(caught); setError("The quote could not be created; the selected space may no longer be available."); }
    finally { setActionLoading(false); }
  }

  async function createBooking() {
    if (!member || !resourceId || !quote) return;
    if (!window.confirm(`Create this ${quote.resourceName} booking for ${memberName(member)}? The server will reserve included hours/account credit and require Stripe payment for any remaining balance.`)) return;
    setActionLoading(true); setError(null); setSuccess(null); setCheckoutUrl(null);
    try {
      const result = await beginBooking({
        uid: member.uid, resourceId,
        start: easternEpoch(dateValue, startTime), end: easternEpoch(dateValue, endTime),
        returnOrigin: window.location.origin,
      });
      if (result.data.kind === "confirmed") {
        setSuccess(`Booking confirmed${result.data.bookingId ? ` · ${result.data.bookingId}` : ""}. Included hours/account credit were consumed authoritatively.`);
        setSpaces([]); setQuote(null); setResourceId("");
      } else if (result.data.checkoutUrl) {
        setCheckoutUrl(result.data.checkoutUrl);
        setSuccess("The space is held for 15 minutes. A Stripe payment link is ready for the member; the booking confirms only after payment is reported paid.");
      }
    } catch (caught) { console.error(caught); setError("The member booking could not be created safely. No direct booking record was forced through."); }
    finally { setActionLoading(false); }
  }

  async function doCreditAdjustment() {
    if (!member) return;
    const amount = Math.round(Number(creditAmount) * 100);
    if (!Number.isFinite(amount) || amount <= 0) { setError("Enter a positive dollar amount."); return; }
    const deltaCents = creditDirection === "add" ? amount : -amount;
    if (!window.confirm(`${creditDirection === "add" ? "Add" : "Deduct"} ${money(amount)} ${creditDirection === "add" ? "to" : "from"} ${memberName(member)}'s Hi Coworking account credit? This creates a permanent audit record.`)) return;
    setActionLoading(true); setError(null); setSuccess(null);
    try {
      const requestId = `credit_${Date.now()}_${crypto.randomUUID().replaceAll("-", "")}`;
      const result = await adjustCredit({ uid: member.uid, deltaCents, reason: creditReason, note: creditNote, requestId });
      setSuccess(`Account credit updated from ${money(result.data.adjustment.beforeCents)} to ${money(result.data.adjustment.afterCents)}.`);
      setCreditAmount(""); setCreditNote("");
      await refreshSelected();
    } catch (caught) { console.error(caught); setError("The account-credit adjustment was rejected. A deduction cannot reduce the balance below credit reserved by an active booking checkout."); }
    finally { setActionLoading(false); }
  }

  async function copyCheckout() {
    if (!checkoutUrl) return;
    try { await navigator.clipboard.writeText(checkoutUrl); setSuccess("Payment link copied. The transaction remains pending until Stripe confirms payment."); }
    catch { setError("The payment link could not be copied automatically."); }
  }

  const tabs: Array<{ id: ActionTab; label: string; icon: React.ElementType }> = [
    { id: "membership", label: "Membership", icon: CreditCard },
    { id: "booking", label: "Book for member", icon: CalendarClock },
    { id: "credit", label: "Account credit", icon: WalletCards },
  ];

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Admin · Members</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Member Actions</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Run membership, booking and account-credit changes through server-authoritative transaction workflows.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/members" className="inline-flex min-h-10 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700">Member directory</Link>
            <button type="button" onClick={() => void loadMembers()} disabled={loading} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
          </div>
        </div>

        <div className="mt-7 max-w-2xl">
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">Member</label>
          <div className="relative">
            <select value={selectedUid} onChange={(event) => setSelectedUid(event.target.value)} className="w-full appearance-none rounded-2xl border border-slate-200 bg-white px-4 py-3 pr-10 text-sm font-semibold text-slate-900 outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100">
              {members.map((record) => <option key={record.uid} value={record.uid}>{memberName(record)}{record.email ? ` · ${record.email}` : ""}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {member && <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500"><span className="inline-flex items-center gap-2 font-semibold text-slate-900"><UserRound className="h-4 w-4 text-slate-400" /> {memberName(member)}</span><span>{planName(membership?.planId || member.plan)}</span><span>Credit {money(member.accountCreditCents || 0)}</span></div>}

        {(error || success) && <div className={`mt-6 flex items-start gap-3 rounded-2xl px-4 py-3 text-sm ${error ? "bg-red-50 text-red-800 ring-1 ring-red-100" : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"}`}>{error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span>{error || success}</span></div>}

        {checkoutUrl && <div className="mt-4 rounded-2xl bg-sky-50 p-4 text-sm text-sky-950"><p className="font-semibold">Stripe payment link ready</p><p className="mt-1 break-all text-xs text-sky-800">{checkoutUrl}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void copyCheckout()} className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 font-semibold ring-1 ring-sky-200"><Copy className="h-4 w-4" /> Copy link</button><a href={checkoutUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-full bg-slate-900 px-4 py-2 font-semibold text-white">Open checkout</a></div></div>}

        <nav className="mt-8 flex gap-6 overflow-x-auto border-b border-slate-200">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => { setTab(id); setError(null); setSuccess(null); setCheckoutUrl(null); }} className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-semibold ${tab === id ? "border-slate-950 text-slate-950" : "border-transparent text-slate-500"}`}><Icon className="h-4 w-4" /> {label}</button>)}</nav>

        {loading || actionLoading && !member ? <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div> : member && <div className="py-8">
          {tab === "membership" && <section>
            <div className="grid gap-6 md:grid-cols-[1fr_1.4fr]">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Stripe membership</p><h2 className="mt-2 text-2xl font-semibold text-slate-950">{planName(membership?.planId || member.plan)}</h2><p className="mt-2 text-sm text-slate-500">Hi status: {member.membershipStatus} · Stripe: {membership?.stripeStatus || "not linked"}</p>{membership?.currentPeriodEnd && <p className="mt-1 text-sm text-slate-500">Current period ends {new Date(membership.currentPeriodEnd).toLocaleDateString()}</p>}{membership?.cancelAtPeriodEnd && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Cancellation is scheduled at period end.</p>}</div>
              <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Change plan</p><div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">{MEMBERSHIP_TIERS.map((tier) => <div key={tier.id} className="flex items-center justify-between gap-4 py-4"><div><p className="font-semibold text-slate-950">{tier.name}</p><p className="mt-1 text-sm text-slate-500">{money(tier.amountCents)}/mo · {tier.includedHoursPerMonth} included desk hours</p></div><button type="button" disabled={actionLoading || membership?.planId === tier.id || membership?.cancelAtPeriodEnd} onClick={() => void doChangePlan(tier.id)} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-40">{membership?.planId === tier.id ? "Current" : "Change"}</button></div>)}</div></div>
            </div>
            <div className="mt-8 flex flex-wrap gap-3 border-t border-slate-200 pt-6">{membership?.cancelAtPeriodEnd ? <button type="button" disabled={actionLoading} onClick={() => void doReactivateMembership()} className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">Reactivate membership</button> : membership?.hasSubscription ? <button type="button" disabled={actionLoading} onClick={() => void doCancelMembership()} className="rounded-full border border-red-200 bg-white px-5 py-2.5 text-sm font-semibold text-red-700">Cancel at period end</button> : <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-slate-500">No active Stripe subscription. Restart with:</span>{MEMBERSHIP_TIERS.map((tier) => <button key={tier.id} type="button" disabled={actionLoading} onClick={() => void doReactivateMembership(tier.id)} className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-800">{tier.name}</button>)}</div>}</div>
            <p className="mt-5 text-xs leading-5 text-slate-500">Plan changes are applied in Stripe with immediate proration and must complete successfully before the Hi Coworking entitlement changes. Cancellation is scheduled at period end; no automatic mid-period membership refund is invented.</p>
          </section>}

          {tab === "booking" && <section>
            <h2 className="text-xl font-semibold text-slate-950">Book for {memberName(member)}</h2><p className="mt-1 text-sm text-slate-500">The member&apos;s plan, included hours, account credit, availability and booking window are applied on the server.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3"><input type="date" value={dateValue} min={todayEastern()} onChange={(event) => setDateValue(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-3" /><select value={startTime} onChange={(event) => setStartTime(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-3">{timeOptions.slice(0, -1).map((time) => <option key={time.value} value={time.value}>{time.label}</option>)}</select><select value={endTime} onChange={(event) => setEndTime(event.target.value)} className="rounded-xl border border-slate-200 bg-white px-3 py-3">{timeOptions.slice(1).map((time) => <option key={time.value} value={time.value}>{time.label}</option>)}</select></div>
            <button type="button" disabled={actionLoading} onClick={() => void checkAvailability()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-semibold text-white disabled:opacity-50">{actionLoading && <Loader2 className="h-4 w-4 animate-spin" />} Check availability</button>
            {spaces.length > 0 && <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{spaces.map((space) => <button key={space.resourceId} type="button" disabled={!space.available || actionLoading} onClick={() => void selectSpace(space.resourceId)} className={`rounded-2xl border p-4 text-left ${resourceId === space.resourceId ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"} disabled:bg-slate-50 disabled:text-slate-400`}><p className="font-semibold">{space.name}</p><p className="mt-1 text-xs">{space.available ? "Available" : "Unavailable"}</p></button>)}</div>}
            {quote && <div className="mt-6 rounded-2xl bg-slate-50 p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-lg font-semibold text-slate-950">{quote.resourceName}</p><p className="mt-1 text-sm text-slate-500">{quote.durationHours} hr · {quote.membershipName || "Public pricing"}</p></div><p className="text-xl font-semibold text-slate-950">{money(quote.totalCents)}</p></div><dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">Included hours applied</dt><dd className="font-semibold text-slate-900">{quote.includedHoursApplied}</dd></div><div><dt className="text-slate-500">Account credit applied</dt><dd className="font-semibold text-slate-900">{money(quote.accountCreditAppliedCents)}</dd></div><div><dt className="text-slate-500">Subtotal</dt><dd className="font-semibold text-slate-900">{money(quote.subtotalCents)}</dd></div><div><dt className="text-slate-500">Stripe balance due</dt><dd className="font-semibold text-slate-900">{money(quote.totalCents)}</dd></div></dl><button type="button" disabled={actionLoading} onClick={() => void createBooking()} className="mt-5 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{quote.totalCents === 0 ? "Confirm booking" : "Hold space & create payment link"}</button></div>}
          </section>}

          {tab === "credit" && <section className="max-w-2xl"><div className="flex items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Available balance</p><h2 className="mt-2 text-3xl font-semibold text-slate-950">{money(member.accountCreditCents || 0)}</h2></div></div><div className="mt-7 grid gap-4 sm:grid-cols-2"><div><label className="mb-2 block text-sm font-semibold text-slate-700">Adjustment</label><select value={creditDirection} onChange={(event) => setCreditDirection(event.target.value as "add" | "deduct")} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3"><option value="add">Add credit</option><option value="deduct">Deduct credit</option></select></div><div><label className="mb-2 block text-sm font-semibold text-slate-700">Amount</label><input type="number" min="0.01" step="0.01" value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} placeholder="0.00" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3" /></div><div><label className="mb-2 block text-sm font-semibold text-slate-700">Reason</label><select value={creditReason} onChange={(event) => setCreditReason(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3"><option value="service_adjustment">Service adjustment</option><option value="booking_correction">Booking correction</option><option value="billing_correction">Billing correction</option><option value="promotional_credit">Promotional credit</option><option value="other">Other</option></select></div><div><label className="mb-2 block text-sm font-semibold text-slate-700">Note</label><input type="text" value={creditNote} onChange={(event) => setCreditNote(event.target.value)} placeholder="Why is this adjustment needed?" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3" /></div></div><button type="button" disabled={actionLoading} onClick={() => void doCreditAdjustment()} className="mt-5 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Apply audited adjustment</button><p className="mt-5 text-xs leading-5 text-slate-500">Every adjustment is idempotent and permanently audited with before/after balances, reason and Admin identity. Deductions cannot consume credit already reserved by an active booking checkout.</p></section>}
        </div>}
      </main>
    </AppShell>
  );
}
