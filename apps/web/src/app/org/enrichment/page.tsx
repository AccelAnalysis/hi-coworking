"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { ArrowLeft, Building2, CheckCircle2, Database, Loader2, Search, ShieldCheck, Sparkles } from "lucide-react";
import type { OrganizationEstablishment, OrganizationDocument, OrganizationMedia } from "@hi/shared/organization-establishments";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { functions } from "@/lib/firebase";
import { enrichmentSearchFn, type EnrichmentCandidate } from "@/lib/functions";

type OrganizationModel = {
  id: string;
  legalName: string;
  tradeNames: string[];
  identifiers: Record<string, string>;
  description: string;
  domain: string;
  website: string;
  industries: string[];
  capabilities: string[];
  certifications: string[];
  media: OrganizationMedia[];
  documents: OrganizationDocument[];
  publicationStatus: "draft" | "approved" | "suppressed";
  primaryLocationId: string | null;
  headquartersLocationId: string | null;
  recordVersion: number;
};

type ManagementModel = {
  organization: OrganizationModel;
  locations: OrganizationEstablishment[];
};

type AcceptedField = "legalName" | "uei" | "cage" | "duns";

const getManagement = httpsCallable<{ organizationId: string }, ManagementModel>(
  functions,
  "exchange_getOrganizationManagement",
);
const updateOrganization = httpsCallable<Record<string, unknown>, { recordVersion: number }>(
  functions,
  "exchange_updateOrganizationProfile",
);
const recordProgress = httpsCallable<Record<string, unknown>, { success: true }>(
  functions,
  "exchange_recordBusinessActivationProgress",
);

function fieldValue(candidate: EnrichmentCandidate, field: AcceptedField): string | undefined {
  if (field === "legalName") return candidate.legalName;
  if (field === "uei") return candidate.uei;
  if (field === "cage") return candidate.cage;
  return candidate.duns;
}

function fieldLabel(field: AcceptedField): string {
  return field === "legalName" ? "Legal business name" : field === "uei" ? "UEI" : field === "cage" ? "CAGE" : "DUNS";
}

function cleanPayload(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export default function OrganizationEnrichmentPage() {
  return <RequireAuth><Suspense fallback={<Loading />}><OrganizationEnrichment /></Suspense></RequireAuth>;
}

function Loading() {
  return <AppShell><main className="grid min-h-[55dvh] place-items-center bg-[#F7F3EA] px-4"><div role="status" className="text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-[#D6A23A]" /><p className="mt-3 text-sm font-semibold text-slate-700">Preparing business enrichment…</p></div></main></AppShell>;
}

function OrganizationEnrichment() {
  const params = useSearchParams();
  const organizationId = params.get("organizationId") || "";
  const [model, setModel] = useState<ManagementModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [candidates, setCandidates] = useState<EnrichmentCandidate[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [selectedFields, setSelectedFields] = useState<AcceptedField[]>([]);
  const [providerStatus, setProviderStatus] = useState<{ samGov: string; usaSpending: string } | null>(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    if (!organizationId) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    void getManagement({ organizationId })
      .then((result) => active && setModel(result.data))
      .catch(() => active && setError("We could not load this organization. Confirm that you have owner or administrator access."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [organizationId]);

  const organization = model?.organization;
  const location = useMemo(() => {
    if (!model) return null;
    return model.locations.find((item) => item.id === model.organization.primaryLocationId)
      ?? model.locations.find((item) => item.id === model.organization.headquartersLocationId)
      ?? model.locations.find((item) => item.status === "active")
      ?? null;
  }, [model]);
  const selected = candidates.find((candidate) => candidate.matchId === selectedMatchId) ?? null;
  const availableFields = useMemo(() => selected ? (["legalName", "uei", "cage", "duns"] as AcceptedField[])
    .filter((field) => Boolean(fieldValue(selected, field))) : [], [selected]);

  useEffect(() => {
    if (!selected) { setSelectedFields([]); return; }
    setSelectedFields((["legalName", "uei", "cage", "duns"] as AcceptedField[]).filter((field) => Boolean(fieldValue(selected, field))));
  }, [selectedMatchId]);

  const search = async () => {
    if (!organization) return;
    setSearching(true); setError(""); setNotice(""); setApplied(false);
    try {
      const address = location?.physicalAddress;
      const response = await enrichmentSearchFn({
        businessName: organization.legalName,
        ...(address?.locality ? { city: address.locality } : {}),
        ...(address?.administrativeArea ? { state: address.administrativeArea } : {}),
        ...(organization.domain ? { domain: organization.domain } : {}),
        ...(organization.identifiers.uei ? { uei: organization.identifiers.uei } : {}),
        ...(organization.identifiers.cage ? { cage: organization.identifiers.cage } : {}),
        ...(organization.identifiers.duns ? { duns: organization.identifiers.duns } : {}),
      });
      setCandidates(response.data.candidates || []);
      setProviderStatus(response.data.providerStatus);
      setSelectedMatchId(response.data.candidates[0]?.matchId || "");
      if (!response.data.candidates.length) {
        const providerAvailable = Object.values(response.data.providerStatus).some((status) => status === "ok");
        setNotice(providerAvailable
          ? "No strong trusted-source match was found. Continue to the profile and complete the remaining fields manually."
          : "Trusted-source matching is not configured or is temporarily unavailable. You can continue with manual profile completion.");
      }
    } catch {
      setError("Trusted-source search is temporarily unavailable. Your business remains active on the Exchange, and you can continue with manual profile completion.");
    } finally {
      setSearching(false);
    }
  };

  const apply = async () => {
    if (!organization || !selected || !selectedFields.length) return;
    setApplying(true); setError(""); setNotice("");
    try {
      const identifiers = { ...organization.identifiers };
      if (selectedFields.includes("uei") && selected.uei) identifiers.uei = selected.uei;
      if (selectedFields.includes("cage") && selected.cage) identifiers.cage = selected.cage;
      if (selectedFields.includes("duns") && selected.duns) identifiers.duns = selected.duns;
      await updateOrganization(cleanPayload({
        organizationId,
        expectedRecordVersion: organization.recordVersion,
        legalName: selectedFields.includes("legalName") ? selected.legalName : organization.legalName,
        tradeNames: organization.tradeNames,
        identifiers,
        description: organization.description || undefined,
        domain: organization.domain || undefined,
        website: organization.website || undefined,
        industries: organization.industries,
        capabilities: organization.capabilities,
        certifications: organization.certifications,
        media: organization.media,
        documents: organization.documents,
        publicationStatus: organization.publicationStatus,
      }));
      void recordProgress({ action: "enrichment_reviewed", organizationId }).catch(() => undefined);
      const refreshed = await getManagement({ organizationId });
      setModel(refreshed.data);
      setApplied(true);
      setNotice("Selected trusted-source suggestions were applied to the organization. Review the profile and complete anything that is still missing.");
    } catch (value) {
      const message = String((value as { message?: string }).message || "");
      setError(message.toLowerCase().includes("version")
        ? "The organization changed while you were reviewing this match. Refresh the page and review the latest profile before applying suggestions."
        : "We could not apply the selected suggestions. No verification status was changed.");
    } finally {
      setApplying(false);
    }
  };

  if (loading) return <Loading />;
  if (!organizationId || !organization) {
    return <AppShell><main className="mx-auto max-w-3xl px-4 py-16 text-center"><Building2 className="mx-auto h-12 w-12 text-slate-300" /><h1 className="mt-4 text-2xl font-black text-slate-950">Organization enrichment unavailable</h1><p className="mt-2 text-sm text-slate-600">{error || "Open enrichment from an organization you manage."}</p><Link href="/exchange" className="mt-6 inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white">Return to the Exchange</Link></main></AppShell>;
  }

  return (
    <AppShell>
      <main className="min-h-dvh bg-[#F7F3EA] px-4 py-8 sm:py-12">
        <div className="mx-auto max-w-5xl">
          <Link href={`/exchange?actorOrg=${encodeURIComponent(organizationId)}&subjectOrg=${encodeURIComponent(organizationId)}`} className="inline-flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-950"><ArrowLeft className="h-4 w-4" /> Back to the Exchange</Link>
          <section className="mt-5 overflow-hidden rounded-3xl border border-black/10 bg-white shadow-xl shadow-black/5">
            <div className="grid lg:grid-cols-[1.1fr_.9fr]">
              <div className="p-6 sm:p-9 lg:p-11">
                <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-amber-800"><Sparkles className="h-3.5 w-3.5" /> Enrich &amp; complete profile</span>
                <h1 className="mt-5 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">Start with trusted business data, then fill the gaps.</h1>
                <p className="mt-4 max-w-2xl leading-7 text-slate-600">We can search SAM.gov and USAspending using the business identity and location you already confirmed. Review every suggestion before it is saved. Enrichment does <strong>not</strong> verify your business or grant any additional permissions.</p>

                <div className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Current organization</p>
                  <p className="mt-2 text-xl font-black text-slate-950">{organization.legalName}</p>
                  <p className="mt-1 text-sm text-slate-600">{[location?.physicalAddress?.locality, location?.physicalAddress?.administrativeArea].filter(Boolean).join(", ") || "Confirmed Exchange location"}</p>
                  <button type="button" disabled={searching || applying} onClick={() => void search()} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{searching ? " Searching trusted sources…" : candidates.length ? "Search again" : "Search trusted sources"}</button>
                </div>

                {error && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{error}</div>}
                {notice && <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-900">{notice}</div>}

                {candidates.length > 0 && <div className="mt-8"><h2 className="text-xl font-black text-slate-950">Choose the right business record</h2><p className="mt-1 text-sm text-slate-500">Confidence is a matching aid, not verification.</p><div className="mt-4 space-y-3">{candidates.map((candidate) => <label key={candidate.matchId} className={`block cursor-pointer rounded-2xl border p-4 ${selectedMatchId === candidate.matchId ? "border-[#D6A23A] bg-amber-50" : "border-slate-200"}`}><div className="flex items-start gap-3"><input type="radio" name="enrichment-match" checked={selectedMatchId === candidate.matchId} onChange={() => setSelectedMatchId(candidate.matchId)} className="mt-1 accent-[#D6A23A]" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-slate-950">{candidate.legalName}</strong><span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-black uppercase text-slate-600">{candidate.confidenceScore}% match</span></div><p className="mt-1 text-sm text-slate-600">{[candidate.city, candidate.state].filter(Boolean).join(", ") || "Location not supplied"}</p><p className="mt-2 text-xs text-slate-500">{candidate.providers.map((provider) => provider === "sam_gov" ? "SAM.gov" : "USAspending").join(" + ")} · {candidate.matchReason}</p><div className="mt-2 flex flex-wrap gap-2 text-xs">{candidate.uei && <span className="rounded bg-white px-2 py-1">UEI {candidate.uei}</span>}{candidate.cage && <span className="rounded bg-white px-2 py-1">CAGE {candidate.cage}</span>}{candidate.duns && <span className="rounded bg-white px-2 py-1">DUNS {candidate.duns}</span>}</div></div></div></label>)}</div></div>}

                {selected && <div className="mt-8 rounded-2xl border border-slate-200 p-5"><h2 className="text-lg font-black text-slate-950">Select what to apply</h2><p className="mt-1 text-sm text-slate-600">Unchecked fields remain exactly as they are today.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{availableFields.map((field) => <label key={field} className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3"><input type="checkbox" checked={selectedFields.includes(field)} onChange={(event) => setSelectedFields((current) => event.target.checked ? [...current, field] : current.filter((item) => item !== field))} className="mt-1 accent-[#D6A23A]" /><span><strong className="block text-sm text-slate-950">{fieldLabel(field)}</strong><span className="mt-1 block break-all text-xs text-slate-500">{fieldValue(selected, field)}</span></span></label>)}</div><button type="button" disabled={applying || selectedFields.length === 0} onClick={() => void apply()} className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#D6A23A] px-5 py-2.5 text-sm font-black text-black disabled:opacity-50">{applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{applying ? " Applying selected data…" : "Apply selected business data"}</button></div>}
              </div>

              <aside className="bg-[#0B0B0D] p-6 text-white sm:p-9 lg:p-11">
                <Database className="h-10 w-10 text-[#D6A23A]" />
                <h2 className="mt-5 text-2xl font-black">What happens next</h2>
                <ol className="mt-5 space-y-4 text-sm leading-6 text-white/70"><li><strong className="text-white">1. Search.</strong> We use the organization name and confirmed location to find likely public-source records.</li><li><strong className="text-white">2. Review.</strong> You choose the record and individual identity fields you accept.</li><li><strong className="text-white">3. Complete.</strong> Continue to the organization profile for capabilities, industries, certifications, description, media, documents, and anything a source could not supply.</li></ol>
                <div className="mt-7 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/70"><div className="flex items-center gap-2 font-bold text-white"><ShieldCheck className="h-4 w-4 text-[#D6A23A]" /> Trust boundary</div><p className="mt-2">Public-source suggestions never create verification, ownership, Founding status, or premium permissions. Those remain separate server-authoritative workflows.</p></div>
                <div className="mt-8 grid gap-3"><Link href={`/org/settings?id=${encodeURIComponent(organizationId)}&tab=profile&onboarding=complete`} className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-4 py-2.5 text-sm font-black text-slate-950">{applied ? "Continue to profile" : "Continue without enrichment"}</Link><Link href={`/exchange?actorOrg=${encodeURIComponent(organizationId)}&subjectOrg=${encodeURIComponent(organizationId)}`} className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/20 px-4 py-2.5 text-sm font-bold text-white">Explore the Exchange</Link></div>
                {providerStatus && <p className="mt-6 text-xs leading-5 text-white/45">Provider status: SAM.gov {providerStatus.samGov.replaceAll("_", " ")} · USAspending {providerStatus.usaSpending.replaceAll("_", " ")}.</p>}
              </aside>
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
