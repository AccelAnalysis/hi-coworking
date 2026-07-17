"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Check, Crown, Loader2, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { getOrg } from "@/lib/firestore";
import { exchangeCreateFoundingCheckoutFn, exchangeGetOrganizationMembershipFn, type ExchangeOrganizationMembershipResult } from "@/lib/functions";
import type { OrgDoc } from "@hi/shared";

export default function ExchangeMembershipPage() {
  return <RequireAuth><Suspense fallback={<Loading />}><Membership /></Suspense></RequireAuth>;
}

function Loading() { return <AppShell><div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div></AppShell>; }

function Membership() {
  const organizationId = useSearchParams().get("organizationId") || "";
  const [org, setOrg] = useState<OrgDoc | null>(null);
  const [membership, setMembership] = useState<ExchangeOrganizationMembershipResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!organizationId) { setLoading(false); return; }
    Promise.all([getOrg(organizationId), exchangeGetOrganizationMembershipFn({ organizationId })])
      .then(([organization, result]) => { setOrg(organization); setMembership(result.data); })
      .catch(() => setError("You do not have permission to manage this organization."))
      .finally(() => setLoading(false));
  }, [organizationId]);

  const checkout = async () => {
    setCheckoutBusy(true); setError("");
    try {
      const result = await exchangeCreateFoundingCheckoutFn({ organizationId });
      window.location.assign(result.data.url);
    } catch (caught: unknown) {
      const code = (caught as { code?: string }).code || "";
      if (code.includes("resource-exhausted")) setError("All Founding Memberships are claimed or temporarily reserved.");
      else if (code.includes("already-exists")) setError("This organization already has an active or pending Founding Membership.");
      else if (code.includes("failed-precondition")) setError("Stripe test checkout is not configured yet. An administrator must set the Founding price ID.");
      else setError("Checkout could not be started. Confirm that you are an organization owner or administrator.");
    } finally { setCheckoutBusy(false); }
  };

  if (loading) return <Loading />;
  if (!organizationId || !org) return <AppShell><div className="mx-auto max-w-xl px-6 py-24 text-center"><h1 className="text-2xl font-bold">Organization unavailable</h1><p className="mt-2 text-slate-500">Choose an organization before selecting membership.</p><Link href="/exchange/onboarding" className="mt-6 inline-block rounded-full bg-slate-900 px-5 py-3 text-sm font-bold text-white">Find your organization</Link></div></AppShell>;

  const activeFounder = membership?.membership.plan === "founding" && ["active", "trialing"].includes(membership.membership.status);
  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="mx-auto max-w-3xl text-center"><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-indigo-700"><ShieldCheck className="h-3.5 w-3.5" /> {org.name}</div><h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">Choose the organization&apos;s Exchange membership.</h1><p className="mt-4 text-slate-600">Free membership stays useful. Founding Membership adds protected founder status, visibility hooks, and monthly business-use credits.</p></div>
        {error && <div className="mx-auto mt-8 max-w-2xl rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <Plan title="Free Exchange Member" price="$0" subtitle="Organization profile and core Exchange access" features={["Maintain an eligible organization profile", "Browse the directory, map, RFx, resources, referrals, and teaming activity", "Receive and respond to permitted organization activity", "Upgrade when a Founding slot is available"]} footer={<Link href={`/org/dashboard?id=${org.id}`} className="block w-full rounded-full border border-slate-300 px-5 py-3 text-center font-bold text-slate-800 hover:bg-slate-50">Continue free</Link>} />
          <Plan featured title="Founding Member" price="$49/month" subtitle="For the first 250 verified organizations" features={["25 credits after each successfully paid monthly invoice", "Unique founder number and Founding Member badge after activation", "Protected $49 monthly rate while the subscription remains continuously active", "Founder analytics and enhanced visibility hooks as they become available"]} footer={activeFounder ? <div className="rounded-xl bg-emerald-50 p-4 text-center font-bold text-emerald-700">Active Founding Member #{membership?.membership.founderNumber}<div className="mt-1 text-sm font-medium">{membership?.creditBalance || 0} usable credits</div></div> : <button onClick={checkout} disabled={checkoutBusy || membership?.membership.status === "checkout_pending"} className="flex w-full items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 py-3 font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 disabled:opacity-50">{checkoutBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}{membership?.membership.status === "checkout_pending" ? "Checkout pending" : "Become a Founding Member"}</button>} />
        </div>
        <p className="mx-auto mt-8 max-w-3xl text-center text-xs leading-relaxed text-slate-500">Founding Membership belongs to {org.name}, not an individual account. Payment does not by itself verify the organization. Credits are restricted to organizational use, expire 12 months after grant, are non-transferable, and have no cash value.</p>
      </main>
    </AppShell>
  );
}

function Plan({ title, price, subtitle, features, footer, featured = false }: { title: string; price: string; subtitle: string; features: string[]; footer: React.ReactNode; featured?: boolean }) {
  return <section className={`relative flex flex-col rounded-3xl bg-white p-7 shadow-sm ${featured ? "ring-2 ring-emerald-500" : "ring-1 ring-slate-200"}`}>{featured && <span className="absolute -top-3 left-6 rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">First 250</span>}<h2 className="text-xl font-bold text-slate-900">{title}</h2><div className="mt-3 text-4xl font-black tracking-tight text-slate-950">{price}</div><p className="mt-2 text-sm text-slate-500">{subtitle}</p><ul className="my-7 flex-1 space-y-3">{features.map((feature) => <li key={feature} className="flex gap-3 text-sm leading-relaxed text-slate-600"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{feature}</li>)}</ul>{footer}</section>;
}
