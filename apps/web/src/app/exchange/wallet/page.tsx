"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { getOrg, getUserOrgs } from "@/lib/firestore";
import {
  createExchangeBillingPortalSessionFn,
  createExchangeCreditPackCheckoutFn,
  getExchangeOrganizationWalletFn,
  getExchangePublicCommercialPolicyFn,
  type ExchangePublicCommercialConfiguration,
} from "@/lib/functions";
import { AlertTriangle, ArrowRight, Building2, CalendarClock, CheckCircle2, Coins, CreditCard, Loader2, ShieldCheck } from "lucide-react";

type Wallet = Awaited<ReturnType<typeof getExchangeOrganizationWalletFn>>["data"];
type OrgOption = { id: string; name: string };

function formatDate(value: unknown) {
  return typeof value === "number" ? new Date(value).toLocaleDateString() : "No expiration recorded";
}
export default function ExchangeWalletPage() {
  return <RequireAuth><WalletContent /></RequireAuth>;
}

function WalletContent() {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<OrgOption[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [configuration, setConfiguration] = useState<ExchangePublicCommercialConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    Promise.all([getUserOrgs(user.uid), getExchangePublicCommercialPolicyFn({})])
      .then(async ([memberships, policy]) => {
        const options = (await Promise.all(memberships.map(async (membership) => {
          const org = await getOrg(membership.orgId);
          return org ? { id: org.id, name: org.name } : null;
        }))).filter((value): value is OrgOption => Boolean(value));
        setOrganizations(options);
        setOrganizationId((current) => current || options[0]?.id || "");
        setConfiguration(policy.data.configuration);
        if (!options.length) setLoading(false);
      })
      .catch(() => { setError("Organization context could not be loaded."); setLoading(false); });
  }, [user]);

  const loadWallet = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getExchangeOrganizationWalletFn({ organizationId, limit: 50 });
      setWallet(result.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Wallet could not be loaded.");
      setWallet(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void loadWallet(); }, [loadWallet]);

  const openCheckout = async (kind: "pack" | "portal", key?: string) => {
    if (!organizationId) return;
    setAction(`${kind}:${key ?? ""}`);
    setError(null);
    try {
      const result = kind === "pack"
        ? await createExchangeCreditPackCheckoutFn({ organizationId, key: key!, returnPath: "/exchange/wallet" })
        : await createExchangeBillingPortalSessionFn({ organizationId, returnPath: "/exchange/wallet" });
      window.location.assign(result.data.url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The billing action is unavailable.");
      setAction(null);
    }
  };

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">Organization account</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Exchange membership & credits</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Credits and paid Exchange rights belong to the selected organization—not to an individual account.</p></div>
          {organizations.length > 0 && <label className="text-xs font-bold text-slate-600">Selected organization<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className="mt-2 block min-w-64 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
        </div>

        {error && <div role="alert" className="mt-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><span>{error}</span></div>}
        {loading && <div className="mt-12 flex items-center justify-center gap-3 text-sm font-bold text-slate-600" role="status"><Loader2 className="h-5 w-5 animate-spin" /> Loading organization wallet…</div>}
        {!loading && organizations.length === 0 && <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 text-center"><Building2 className="mx-auto h-9 w-9 text-slate-400" /><h2 className="mt-4 text-xl font-black">No organization relationship yet</h2><p className="mt-2 text-sm text-slate-600">Connect, claim, or create a business through RFxchange onboarding before purchasing or spending organization credits.</p><Link href="/exchange/onboarding" className="mt-5 inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white">Place a business on the Exchange <ArrowRight className="h-4 w-4" /></Link></section>}

        {!loading && wallet && configuration && (
          <>
            <section className="mt-8 grid gap-4 md:grid-cols-3">
              <article className="rounded-3xl border border-slate-200 bg-slate-950 p-6 text-white"><Coins className="h-7 w-7 text-amber-300" /><p className="mt-5 text-sm text-slate-400">Usable Exchange credits</p><p className="mt-1 text-4xl font-black">{wallet.account.usableCredits}</p><p className="mt-3 text-xs text-slate-400">{wallet.expiringSoonCredits} expire within one calendar month</p></article>
              <article className="rounded-3xl border border-slate-200 bg-white p-6"><ShieldCheck className="h-7 w-7 text-emerald-600" /><p className="mt-5 text-sm text-slate-500">Verification</p><p className="mt-1 text-2xl font-black capitalize">{wallet.entitlements.verificationStatus.replaceAll("_", " ")}</p><p className="mt-3 text-xs text-slate-500">Credit purchase and spend require verified-business status. Founding Membership enrollment does not.</p></article>
              <article className="rounded-3xl border border-slate-200 bg-white p-6"><CheckCircle2 className="h-7 w-7 text-indigo-600" /><p className="mt-5 text-sm text-slate-500">Exchange tier</p><p className="mt-1 text-2xl font-black capitalize">{wallet.entitlements.tier}</p><p className="mt-3 text-xs text-slate-500">Billing status: {wallet.entitlements.membershipStatus.replaceAll("_", " ")}</p></article>
            </section>

            {wallet.account.hasDeficit && <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950">This account has a credit deficit or payment reversal requiring manual review. No artificial zero-balance correction was created.</div>}

            <section className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
              <div className="rounded-3xl border border-slate-200 bg-white p-6">
                <div className="flex items-center justify-between gap-4"><div><h2 className="text-xl font-black">Credit grants</h2><p className="text-sm text-slate-500">Purchased and subscription credits use the same earliest-expiration-first ledger.</p></div><CalendarClock className="h-6 w-6 text-indigo-600" /></div>
                <div className="mt-5 divide-y divide-slate-100">
                  {wallet.grants.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No Exchange credit grants yet.</p> : wallet.grants.map((grant) => <div key={String(grant.id)} className="grid grid-cols-[1fr_auto] gap-4 py-4"><div><p className="text-sm font-bold capitalize">{String(grant.source ?? "credit").replaceAll("_", " ")}</p><p className="mt-1 text-xs text-slate-500">Granted {formatDate(grant.grantedAt)} · Expires {formatDate(grant.expiresAt)}</p></div><div className="text-right"><p className="font-black">{String(grant.remainingCredits ?? 0)} / {String(grant.originalCredits ?? 0)}</p><p className="text-xs capitalize text-slate-500">{String(grant.status ?? "active")}</p></div></div>)}
                </div>
              </div>

              <aside className="rounded-3xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-black">Membership</h2><p className="mt-2 text-sm leading-6 text-slate-600">Founding recognition and active paid entitlements are tracked separately. Physical coworking access is not included.</p>{wallet.entitlements.tier === "founding" ? <button disabled={!wallet.entitlements.permissions.includes("manage_billing") || action !== null} onClick={() => openCheckout("portal")} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"><CreditCard className="h-4 w-4" /> {action?.startsWith("portal") ? "Opening…" : "Manage billing"}</button> : <Link href={`/exchange/founding?organizationId=${encodeURIComponent(organizationId)}`} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white">Review Founding Membership <ArrowRight className="h-4 w-4" /></Link>}<p className="mt-3 text-center text-xs leading-5 text-slate-500">Founding enrollment is completed through the governed post-marker handoff so eligibility and current pricing are checked before Stripe opens.</p></aside>
            </section>

            <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-black">Credit packs</h2><div className="mt-5 grid gap-4 sm:grid-cols-3">{wallet.packs.map((pack) => <article key={pack.key} className="rounded-2xl border border-slate-200 p-5"><p className="text-3xl font-black">{pack.credits}</p><p className="text-sm text-slate-500">Exchange credits</p><p className="mt-4 text-lg font-black">${(pack.amountCents / 100).toFixed(2)}</p><button disabled={!pack.checkoutReady || wallet.entitlements.verificationStatus !== "verified" || !wallet.entitlements.permissions.includes("purchase_credits") || action !== null} onClick={() => openCheckout("pack", pack.key)} className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400">{action === `pack:${pack.key}` ? "Opening…" : pack.checkoutReady ? "Purchase" : "Purchasing not open"}</button></article>)}</div></section>

            <section className="mt-8 rounded-3xl border border-indigo-200 bg-indigo-50 p-6"><h2 className="font-black text-indigo-950">Exchange credit terms</h2><p className="mt-2 text-sm leading-6 text-indigo-950/80">One Exchange credit has a nominal value of one dollar and may be used only by an eligible verified business or organization for configured actions inside the Hi-Coworking Exchange. Credits have no cash-redemption value, are nontransferable, generally nonrefundable, and expire 12 calendar months after issuance.</p></section>
          </>
        )}
      </main>
    </AppShell>
  );
}
