"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { computeProfileCompleteness, getOrg, getProfileFromFirestore, getSuggestedConnections, getUserOrgs } from "@/lib/firestore";
import { getExchangeOrganizationWalletFn, listManagedRfxFn } from "@/lib/functions";
import type { ProfileDoc, RfxDoc } from "@hi/shared";
import { ArrowRight, BadgeCheck, Building2, Coins, Compass, Handshake, Loader2, MapPinned, Network, ShieldCheck, Sparkles } from "lucide-react";

type Wallet = Awaited<ReturnType<typeof getExchangeOrganizationWalletFn>>["data"];

export default function DashboardPage() {
  return <RequireAuth><AppShell><ExchangeDashboard /></AppShell></RequireAuth>;
}
function ExchangeDashboard() {
  const { user } = useAuth();
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [profileScore, setProfileScore] = useState(0);
  const [opportunities, setOpportunities] = useState<RfxDoc[]>([]);
  const [connections, setConnections] = useState<ProfileDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [profile, memberships, managed] = await Promise.all([
          getProfileFromFirestore(user.uid),
          getUserOrgs(user.uid),
          listManagedRfxFn({ maxResults: 4, includeDashboardMetrics: true }),
        ]);
        setProfileScore(computeProfileCompleteness(profile));
        setOpportunities(managed.data.rfx);
        const codes = profile?.naicsCodes ?? [];
        setConnections(codes.length ? await getSuggestedConnections(codes, user.uid, 3) : []);
        const first = memberships[0];
        if (first) {
          const org = await getOrg(first.orgId);
          setOrganizationName(org?.name ?? "Your organization");
          const result = await getExchangeOrganizationWalletFn({ organizationId: first.orgId, limit: 10 });
          setWallet(result.data);
        }
      } catch (error) {
        console.error("Exchange dashboard data unavailable", error);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  if (!user) return null;
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <section className="overflow-hidden rounded-[2rem] bg-slate-950 text-white shadow-2xl shadow-slate-300/40">
        <div className="grid gap-8 px-6 py-9 sm:px-9 lg:grid-cols-[1.3fr_.7fr] lg:px-12 lg:py-12">
          <div><p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">Exchange first</p><h1 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">Welcome back, {user.displayName || user.email?.split("@")[0] || "member"}.</h1><p className="mt-4 max-w-2xl text-base leading-7 text-slate-300">Discover businesses, act on opportunities, build teams, manage referrals, and understand your network from one map-based Exchange.</p><Link href="/exchange" className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-black text-slate-950">Open Hi Exchange <ArrowRight className="h-4 w-4" /></Link></div>
          <div className="rounded-3xl border border-white/15 bg-white/5 p-6"><MapPinned className="h-7 w-7 text-emerald-300" /><p className="mt-4 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Founding launch market</p><p className="mt-2 text-xl font-black">Isle of Wight County, Virginia</p><p className="mt-3 text-sm leading-6 text-slate-300">Organizations may be located in the market, serve the market, or be seeded for future expansion.</p></div>
        </div>
      </section>

      {loading ? <div className="flex min-h-48 items-center justify-center gap-3 text-sm font-bold text-slate-600"><Loader2 className="h-5 w-5 animate-spin" /> Loading Exchange context…</div> : (
        <>
          <section className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric icon={Building2} label="Organization" value={organizationName ?? "Personal browsing"} detail={organizationName ? wallet?.entitlements.verificationStatus.replaceAll("_", " ") ?? "Verification pending" : "Claim or create a business"} />
            <Metric icon={BadgeCheck} label="Exchange membership" value={wallet?.entitlements.tier ?? "Free"} detail={wallet?.entitlements.isFoundingMember ? "Founding recognition recorded" : "Free access remains useful"} />
            <Metric icon={Coins} label="Usable credits" value={String(wallet?.account.usableCredits ?? 0)} detail={`${wallet?.expiringSoonCredits ?? 0} expiring soon`} />
            <Metric icon={ShieldCheck} label="Profile readiness" value={`${profileScore}%`} detail="Complete your profile for stronger discovery" />
          </section>

          {!organizationName && <section className="mt-6 flex flex-col gap-4 rounded-3xl border border-indigo-200 bg-indigo-50 p-6 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-black text-indigo-950">Personal browsing is ready</h2><p className="mt-1 text-sm text-indigo-900/80">Create or claim an organization before purchasing or spending business credits.</p></div><Link href="/profile" className="shrink-0 rounded-full bg-indigo-700 px-5 py-2.5 text-sm font-bold text-white">Start a claim</Link></section>}

          <section className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
            <article className="rounded-3xl border border-slate-200 bg-white p-6"><div className="flex items-center justify-between"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-indigo-700">Opportunity activity</p><h2 className="mt-1 text-xl font-black">Recommended and managed RFx</h2></div><Sparkles className="h-6 w-6 text-amber-500" /></div><div className="mt-5 space-y-3">{opportunities.length ? opportunities.map((item) => <Link key={item.id} href={`/exchange?view=opportunities&entity=rfx&selected=${encodeURIComponent(item.id)}`} className="block rounded-2xl border border-slate-200 p-4 hover:border-indigo-300"><p className="font-bold text-slate-950">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.location || "Launch-market opportunity"} · {item.status}</p></Link>) : <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">No managed opportunities yet. Browse the Exchange for public matches.</p>}</div><Link href="/exchange?view=opportunities" className="mt-5 inline-flex items-center gap-2 text-sm font-black text-indigo-700">Browse opportunities <ArrowRight className="h-4 w-4" /></Link></article>

            <aside className="space-y-6"><article className="rounded-3xl border border-slate-200 bg-white p-6"><Network className="h-6 w-6 text-indigo-600" /><h2 className="mt-4 text-xl font-black">Suggested relationships</h2><p className="mt-2 text-sm leading-6 text-slate-600">{connections.length ? `${connections.length} capability-aligned profiles are available for review.` : "Add capabilities and NAICS codes to improve relationship suggestions."}</p><Link href="/exchange?view=teaming" className="mt-5 inline-flex items-center gap-2 text-sm font-black text-indigo-700">Explore teaming <ArrowRight className="h-4 w-4" /></Link></article><article className="rounded-3xl border border-slate-200 bg-white p-6"><Handshake className="h-6 w-6 text-emerald-600" /><h2 className="mt-4 text-xl font-black">Referral activity</h2><p className="mt-2 text-sm leading-6 text-slate-600">Voluntary referrals remain supported. Compensated referral payments and automated payouts are disabled until the protected launch gates are satisfied.</p><Link href="/exchange?view=referrals" className="mt-5 inline-flex items-center gap-2 text-sm font-black text-indigo-700">Open referrals <ArrowRight className="h-4 w-4" /></Link></article></aside>
          </section>

          <section className="mt-8 grid gap-4 sm:grid-cols-3"><LaunchLink icon={Compass} title="Business map" body="Claimable and verified profiles" href="/exchange?view=businesses" /><LaunchLink icon={Coins} title="Membership & credits" body="Organization wallet and billing readiness" href="/exchange/wallet" /><LaunchLink icon={Sparkles} title="Founding campaign" body="Benefits, terms, and launch status" href="/exchange/founding" /></section>

          <section className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-6"><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Planned later</p><h2 className="mt-2 text-lg font-black">Physical workspace</h2><p className="mt-2 text-sm leading-6 text-slate-600">Desk and meeting-room functionality remains in the platform but is subordinate to the Exchange and disabled by the protected <code>physicalWorkspaceEnabled</code> feature flag. Founding Exchange Membership does not include desk hours.</p></section>
        </>
      )}
    </main>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Building2; label: string; value: string; detail: string }) {
  return <article className="rounded-3xl border border-slate-200 bg-white p-5"><Icon className="h-6 w-6 text-indigo-600" /><p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 truncate text-xl font-black capitalize text-slate-950">{value}</p><p className="mt-2 text-xs capitalize text-slate-500">{detail}</p></article>;
}

function LaunchLink({ icon: Icon, title, body, href }: { icon: typeof Compass; title: string; body: string; href: string }) {
  return <Link href={href} className="rounded-3xl border border-slate-200 bg-white p-5 hover:border-indigo-300"><Icon className="h-6 w-6 text-indigo-600" /><h2 className="mt-4 font-black">{title}</h2><p className="mt-1 text-sm text-slate-500">{body}</p></Link>;
}
