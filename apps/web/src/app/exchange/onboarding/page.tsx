"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, Loader2, MapPin, Search, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { getUserOrgs, getOrg } from "@/lib/firestore";
import {
  exchangeOrganizationCreateFn,
  exchangeOrganizationRequestClaimFn,
  exchangeOrganizationListMyClaimsFn,
  exchangeOrganizationSearchFn,
  type ExchangeOrganizationClaim,
  type ExchangeOrganizationCandidate,
} from "@/lib/functions";
import type { OrgDoc } from "@hi/shared";

export default function ExchangeOnboardingPage() {
  return <RequireAuth><Onboarding /></RequireAuth>;
}

function Onboarding() {
  const { user } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("VA");
  const [website, setWebsite] = useState("");
  const [results, setResults] = useState<ExchangeOrganizationCandidate[]>([]);
  const [existingOrgs, setExistingOrgs] = useState<OrgDoc[]>([]);
  const [claims, setClaims] = useState<ExchangeOrganizationClaim[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!user) return;
    getUserOrgs(user.uid)
      .then((memberships) => Promise.all(memberships.map((membership) => getOrg(membership.orgId))))
      .then((orgs) => setExistingOrgs(orgs.filter((org): org is OrgDoc => Boolean(org))))
      .catch(() => setExistingOrgs([]));
    exchangeOrganizationListMyClaimsFn({})
      .then((result) => setClaims(result.data.claims))
      .catch(() => setClaims([]));
  }, [user]);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("search"); setError(""); setNotice("");
    try {
      const response = await exchangeOrganizationSearchFn({ name, city: city || undefined, state: state || undefined });
      setResults(response.data.candidates);
      setSearched(true);
    } catch {
      setError("Organization search is unavailable right now. Please try again.");
    } finally { setBusy(null); }
  };

  const requestClaim = async (candidate: ExchangeOrganizationCandidate) => {
    setBusy(candidate.id); setError("");
    try {
      await exchangeOrganizationRequestClaimFn({ organizationId: candidate.id, reason: "Requested during Exchange onboarding" });
      setNotice(`Claim request received for ${candidate.name}. An administrator will review your authority before profile changes or checkout are enabled.`);
      const refreshed = await exchangeOrganizationListMyClaimsFn({});
      setClaims(refreshed.data.claims);
    } catch {
      setError(candidate.external
        ? "This external listing must be reviewed before it can be claimed. You can create your organization if this is not the same legal entity."
        : "We could not submit that claim request.");
    } finally { setBusy(null); }
  };

  const create = async (forceCreate = false) => {
    setBusy("create"); setError("");
    try {
      const response = await exchangeOrganizationCreateFn({ name, city: city || undefined, state: state || undefined, website: website || undefined, forceCreate });
      if (response.data.created && response.data.organizationId) {
        router.push(`/exchange/membership?organizationId=${encodeURIComponent(response.data.organizationId)}`);
        return;
      }
      setResults(response.data.possibleMatches || []);
      setNotice("We found a likely duplicate. Select it below, or confirm that this is a different organization.");
    } catch { setError("We could not create the organization."); }
    finally { setBusy(null); }
  };

  return (
    <AppShell>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="mb-8 max-w-3xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" /> Organization onboarding</div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Find your organization first.</h1>
          <p className="mt-3 text-slate-600">Membership belongs to the organization. Search our Exchange, Isle of Wight, targeting, and USAspending sources before creating a new profile.</p>
        </div>

        {existingOrgs.length > 0 && (
          <section className="mb-8 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
            <h2 className="font-bold text-emerald-950">Your organizations</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {existingOrgs.map((org) => <button key={org.id} onClick={() => router.push(`/exchange/membership?organizationId=${org.id}`)} className="flex items-center gap-3 rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-emerald-100 hover:ring-emerald-300"><Building2 className="h-5 w-5 text-emerald-600" /><span><strong className="block text-sm text-slate-900">{org.name}</strong><span className="text-xs text-slate-500">Continue with this organization</span></span></button>)}
            </div>
          </section>
        )}

        {claims.length > 0 && (
          <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-bold text-slate-900">Your claim requests</h2>
            <div className="mt-3 space-y-3">
              {claims.map((claim) => (
                <div key={claim.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-slate-900">{claim.organizationName || claim.organizationId}</strong>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${claim.status === "approved" ? "bg-emerald-50 text-emerald-700" : claim.status === "rejected" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{claim.status}</span>
                  </div>
                  {claim.status === "pending" && <p className="mt-2 text-sm text-slate-600">An administrator is reviewing your authority. Organization management and checkout remain unavailable.</p>}
                  {claim.status === "approved" && <div className="mt-3"><p className="text-sm text-emerald-700">Approved. You can now manage membership for this organization.</p><button onClick={() => router.push(`/exchange/membership?organizationId=${encodeURIComponent(claim.organizationId)}`)} className="mt-3 rounded-full bg-emerald-600 px-4 py-2 text-sm font-bold text-white">Continue with this organization</button></div>}
                  {claim.status === "rejected" && <p className="mt-2 text-sm text-red-700">Not approved{claim.reviewNote ? `: ${claim.reviewNote}` : "."}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {(error || notice) && <div className={`mb-6 rounded-xl border p-4 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-800"}`}>{error || notice}</div>}

        <form onSubmit={search} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <div className="grid gap-4 sm:grid-cols-[1fr_0.6fr_100px]">
            <label className="text-sm font-semibold text-slate-700">Organization name<input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Acme Services LLC" /></label>
            <label className="text-sm font-semibold text-slate-700">City<input value={city} onChange={(event) => setCity(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Smithfield" /></label>
            <label className="text-sm font-semibold text-slate-700">State<input value={state} onChange={(event) => setState(event.target.value.toUpperCase())} maxLength={2} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-3 font-normal uppercase outline-none focus:ring-2 focus:ring-emerald-500" /></label>
          </div>
          <button disabled={busy !== null || name.trim().length < 2} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 sm:w-auto">{busy === "search" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search organizations</button>
        </form>

        {searched && (
          <section className="mt-8">
            <h2 className="text-lg font-bold text-slate-900">Likely matches</h2>
            <p className="mt-1 text-sm text-slate-500">Only public or privacy-minimized fields are shown. Source listings do not imply verification.</p>
            <div className="mt-4 space-y-3">
              {results.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">No likely match found. Create a new organization below.</div> : results.map((candidate) => (
                <article key={candidate.id} className="flex flex-col gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:flex-row sm:items-center sm:justify-between">
                  <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{candidate.name}</h3>{candidate.claimStatus === "unclaimed" && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">Unclaimed</span>}</div>{(candidate.city || candidate.state) && <p className="mt-1 flex items-center gap-1 text-sm text-slate-500"><MapPin className="h-3.5 w-3.5" /> {[candidate.city, candidate.state].filter(Boolean).join(", ")}</p>}<p className="mt-1 text-xs text-slate-400">{candidate.matchReason} · {candidate.sources.join(", ")}</p></div>
                  <button onClick={() => requestClaim(candidate)} disabled={busy !== null || !candidate.canRequestClaim} className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{busy === candidate.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Request claim</button>
                </article>
              ))}
            </div>

            <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-7">
              <h2 className="font-bold text-slate-900">No appropriate match?</h2>
              <p className="mt-1 text-sm text-slate-600">Create a new profile. We will warn you again if the name and location look duplicated.</p>
              <label className="mt-4 block max-w-xl text-sm font-semibold text-slate-700">Organization website (optional)<input type="url" value={website} onChange={(event) => setWebsite(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 font-normal outline-none focus:ring-2 focus:ring-emerald-500" placeholder="https://example.com" /></label>
              <div className="mt-4 flex flex-wrap gap-3"><button onClick={() => create(false)} disabled={busy !== null} className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">Create new organization</button>{notice.includes("likely duplicate") && <button onClick={() => create(true)} disabled={busy !== null} className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700">This is a different organization</button>}</div>
            </div>
          </section>
        )}
      </main>
    </AppShell>
  );
}
