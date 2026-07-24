"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronRight,
  Loader2,
  LocateFixed,
  MapPin,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { functions } from "@/lib/firebase";
import {
  exchangeOrganizationCreateFn,
  exchangeOrganizationListMyClaimsFn,
  exchangeOrganizationRequestClaimFn,
  exchangeOrganizationSearchFn,
  listReleasedTerritoriesFn,
  type ExchangeOrganizationCandidate,
  type ExchangeOrganizationClaim,
} from "@/lib/functions";
import {
  listActorOrganizations,
  type ExchangeActorOrganizationOption,
} from "@/features/exchange/data/organizationContextGateway";

const getActivationState = httpsCallable<Record<string, never>, ActivationState>(functions, "exchange_getBusinessActivationState");
const recordProgress = httpsCallable<Record<string, unknown>, { success: true; organizationId?: string; establishmentId?: string }>(functions, "exchange_recordBusinessActivationProgress");
const searchGeocodes = httpsCallable<
  { organizationId: string; address: BusinessAddress },
  { requestId: string; candidates: GeocodeCandidate[]; expiresAt: number }
>(functions, "exchange_searchOrganizationGeocodes");
const upsertLocation = httpsCallable<Record<string, unknown>, { locationId: string; recordVersion: number }>(functions, "exchange_upsertOrganizationEstablishment");

type TerritoryStatus = "released" | "scheduled" | "paused" | "archived";
type TerritoryOption = {
  fips: string;
  name: string;
  state: string;
  status: TerritoryStatus;
  type?: "county" | "city" | "custom_polygon";
  centroid?: { lat: number; lng: number };
};
type Geography = TerritoryOption & { selectedAt?: number };
type MarkerVisibility = "exact" | "approximate" | "locality" | "private";
type ActivationState = {
  contractVersion: number;
  currentStep: string;
  completedSteps: string[];
  organizationId: string | null;
  organizationName: string | null;
  claimState: string;
  safeResumeRoute: string;
  selectedGeography: Geography | null;
  mapReveal: null | {
    latitude: number;
    longitude: number;
    zoom: number;
    pitch: number;
    bearing: number;
    organizationId: string;
    locationId: string;
  };
};
type BusinessAddress = {
  line1: string;
  line2?: string;
  locality: string;
  administrativeArea: string;
  postalCode?: string;
  countryCode: string;
  county?: string;
};
type GeocodeCandidate = {
  id: string;
  normalizedAddress: string;
  latitude: number;
  longitude: number;
  precision: string;
  confidence: string;
  attribution: string;
};
type Step = "welcome" | "geography" | "organization" | "claim" | "location";

const inputClass = "mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-950 outline-none transition focus:border-[#D6A23A] focus:ring-2 focus:ring-amber-100";
const primaryButton = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#0B0B0D] px-6 py-3 font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 font-bold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function friendlyError(value: unknown, fallback: string): string {
  const error = value as { code?: string; message?: string };
  const code = String(error?.code ?? "");
  if (code.includes("unauthenticated")) return "Your session expired. Sign in again to continue.";
  if (code.includes("permission-denied")) return "You do not have permission to change this business.";
  if (code.includes("already-exists")) return "A matching business already exists. Search again and select the existing record.";
  if (code.includes("resource-exhausted")) return "Too many attempts were made. Wait a moment, then try again.";
  if (code.includes("unavailable")) return "This service is temporarily unavailable. Your completed steps are saved.";
  if (code.includes("failed-precondition")) return error.message?.replace(/^FirebaseError:\s*/i, "") || fallback;
  return fallback;
}

function stepFromState(state: ActivationState | null): Step {
  if (!state || state.currentStep === "welcome") return "welcome";
  if (state.currentStep === "geography") return "geography";
  if (["organization_search", "organization_connection"].includes(state.currentStep)) return "organization";
  if (state.currentStep === "organization_claim_pending") return "claim";
  if (["business_location", "map_activation"].includes(state.currentStep)) return "location";
  return "welcome";
}

export default function ExchangeOnboardingPage() {
  return <RequireAuth><Onboarding /></RequireAuth>;
}

function Onboarding() {
  const { user } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<ActivationState | null>(null);
  const [step, setStep] = useState<Step>("welcome");
  const [territories, setTerritories] = useState<TerritoryOption[]>([]);
  const [existingOrganizations, setExistingOrganizations] = useState<ExchangeActorOrganizationOption[]>([]);
  const [claims, setClaims] = useState<ExchangeOrganizationClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    const [activation, territoryResponse, actorResponse, claimResponse] = await Promise.all([
      getActivationState({}),
      listReleasedTerritoriesFn({}),
      listActorOrganizations().catch(() => ({ actors: [] })),
      exchangeOrganizationListMyClaimsFn({}).catch(() => ({ data: { claims: [] } })),
    ]);
    const territoryData = territoryResponse.data;
    const all = [...territoryData.released, ...territoryData.scheduled, ...territoryData.unreleased] as TerritoryOption[];
    setState(activation.data);
    setStep(stepFromState(activation.data));
    setTerritories(all);
    setExistingOrganizations(actorResponse.actors);
    setClaims(claimResponse.data.claims);
  };

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    void refresh()
      .catch((value) => active && setError(friendlyError(value, "We could not resume business setup. Refresh and try again.")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [user]);

  const run = async (key: string, operation: () => Promise<void>) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (value) {
      setError(friendlyError(value, "We could not save this step. Check the information and try again."));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <AppShell><main className="grid min-h-[70dvh] place-items-center bg-[#F7F3EA] px-4"><div role="status" className="text-center"><Loader2 className="mx-auto h-9 w-9 animate-spin text-[#D6A23A]" /><p className="mt-3 font-semibold text-slate-700">Resuming business setup…</p></div></main></AppShell>;
  }

  return (
    <AppShell>
      <main className="min-h-dvh bg-[#F7F3EA] px-3 py-5 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-5xl">
          <ProgressHeader step={step} />
          {error && <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{error}</div>}
          {notice && <div role="status" className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{notice}</div>}

          {step === "welcome" && <WelcomeStep
            resumable={Boolean(state?.completedSteps.length && !state.completedSteps.includes("onboarding_completed"))}
            busy={busy}
            onStart={() => void run("welcome", async () => {
              await recordProgress({ action: "welcome_acknowledged" });
              setStep("geography");
              await refresh();
            })}
            onResume={() => setStep(stepFromState(state))}
          />}

          {step === "geography" && <GeographyStep
            territories={territories}
            selected={state?.selectedGeography ?? null}
            busy={busy}
            onBack={() => setStep("welcome")}
            onSelect={(territory) => void run("geography", async () => {
              await recordProgress({ action: "geography_selected", fips: territory.fips });
              await refresh();
              if (territory.status === "released") setStep("organization");
              else setNotice(`${territory.name} is not open for full participation yet. Your selection is saved for preview and release updates.`);
            })}
          />}

          {step === "organization" && <OrganizationStep
            geography={state?.selectedGeography ?? null}
            existingOrganizations={existingOrganizations}
            claims={claims}
            busy={busy}
            onBack={() => setStep("geography")}
            onConnected={async (organizationId) => {
              await run("organization", async () => {
                await recordProgress({ action: "organization_selected", organizationId });
                await refresh();
                setStep("location");
              });
            }}
            onCreated={async (organizationId) => {
              await run("organization", async () => {
                await recordProgress({ action: "organization_created", organizationId });
                await refresh();
                setStep("location");
              });
            }}
            onClaimed={async (organizationId, claimId) => {
              await run("claim", async () => {
                await recordProgress({ action: "organization_claim_started", organizationId, ...(claimId ? { claimId } : {}) });
                await refresh();
                setStep("claim");
              });
            }}
          />}

          {step === "claim" && <ClaimPendingStep
            claim={claims.find((claim) => claim.status === "pending")}
            onBack={() => setStep("organization")}
            onRefresh={() => void run("claim-refresh", refresh)}
          />}

          {step === "location" && state?.organizationId && state.selectedGeography && <LocationStep
            organizationId={state.organizationId}
            organizationName={state.organizationName || "Your business"}
            geography={state.selectedGeography}
            busy={busy}
            onBack={() => setStep("organization")}
            onActivate={(payload) => void run("location", async () => {
              const location = await upsertLocation({
                organizationId: state.organizationId,
                name: `${payload.address.locality} business location`,
                locationType: payload.visibility === "locality" ? "service_location" : "headquarters",
                isHeadquarters: true,
                isPrimary: true,
                status: "active",
                physicalAddress: payload.address,
                addressPublicationApproved: false,
                coordinatePublicationApproved: false,
                serviceArea: {
                  city: payload.address.locality,
                  county: payload.address.county || undefined,
                  region: payload.address.administrativeArea,
                  countryCode: "US",
                  territoryFips: state.selectedGeography.fips,
                },
                publicContactAvailable: false,
                privateHome: payload.visibility === "private",
                preferredOrientation: true,
                geocodeSelection: { requestId: payload.requestId, candidateId: payload.candidate.id },
              });
              await recordProgress({ action: "address_confirmed", organizationId: state.organizationId, establishmentId: location.data.locationId });
              await recordProgress({ action: "geocoding_completed", organizationId: state.organizationId, establishmentId: location.data.locationId });
              await recordProgress({ action: "marker_activated", organizationId: state.organizationId, establishmentId: location.data.locationId, visibility: payload.visibility });
              const query = new URLSearchParams({
                actorOrg: state.organizationId,
                subjectOrg: state.organizationId,
                secondaryEntity: "establishment",
                secondarySelected: location.data.locationId,
                lng: String(payload.candidate.longitude),
                lat: String(payload.candidate.latitude),
                z: "17.2",
                b: "-12",
                p: "52",
                onboardingSuccess: "1",
              });
              router.replace(`/exchange?${query.toString()}`);
            })}
          />}
        </div>
      </main>
    </AppShell>
  );
}

function ProgressHeader({ step }: { step: Step }) {
  const stages: Array<{ id: Step; label: string }> = [
    { id: "welcome", label: "Welcome" },
    { id: "geography", label: "Community" },
    { id: "organization", label: "Business" },
    { id: "location", label: "Map" },
  ];
  const normalized = step === "claim" ? "organization" : step;
  const currentIndex = stages.findIndex((stage) => stage.id === normalized);
  return <header className="mb-5 rounded-2xl border border-black/10 bg-white/90 p-4 shadow-sm backdrop-blur sm:mb-7 sm:p-5">
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#D6A23A] font-black text-black">RF</span><div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">The RFxchange</p><p className="font-bold text-slate-950">Business setup</p></div></div>
      <span className="text-xs font-bold text-slate-500">Step {Math.max(currentIndex + 1, 1)} of 4</span>
    </div>
    <ol className="mt-4 grid grid-cols-4 gap-2" aria-label="Onboarding progress">
      {stages.map((stage, index) => <li key={stage.id}><div className={`h-1.5 rounded-full ${index <= currentIndex ? "bg-[#D6A23A]" : "bg-slate-200"}`} /><span className={`mt-1 hidden text-[11px] font-semibold sm:block ${index <= currentIndex ? "text-slate-900" : "text-slate-400"}`}>{stage.label}</span></li>)}
    </ol>
  </header>;
}

function StepCard({ children }: { children: React.ReactNode }) {
  return <section className="overflow-hidden rounded-3xl border border-black/10 bg-white shadow-xl shadow-black/5">{children}</section>;
}

function WelcomeStep({ resumable, busy, onStart, onResume }: { resumable: boolean; busy: string | null; onStart(): void; onResume(): void }) {
  return <StepCard><div className="grid lg:grid-cols-[1.05fr_0.95fr]">
    <div className="p-6 sm:p-10 lg:p-12">
      <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-amber-800"><Sparkles className="h-3.5 w-3.5" /> Let’s get started</span>
      <h1 className="mt-5 max-w-xl text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">Welcome to The RFxchange.</h1>
      <p className="mt-5 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">Let’s place your business on the Exchange so customers, partners, resources, and opportunities can find you.</p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <button disabled={busy !== null} onClick={onStart} className={primaryButton}>{busy === "welcome" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} Add My Business</button>
        {resumable && <button onClick={onResume} className={secondaryButton}>Resume Setup</button>}
      </div>
    </div>
    <div className="relative min-h-72 overflow-hidden bg-[#0B0B0D] p-8 text-white sm:p-10">
      <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "radial-gradient(circle at 20% 30%, #D6A23A 0 2px, transparent 3px), radial-gradient(circle at 70% 65%, #D6A23A 0 3px, transparent 4px), linear-gradient(135deg, transparent 45%, rgba(214,162,58,.5) 46%, transparent 47%)", backgroundSize: "110px 90px, 150px 120px, 100% 100%" }} />
      <div className="relative flex h-full flex-col justify-end"><LocateFixed className="h-12 w-12 text-[#D6A23A]" /><p className="mt-5 text-2xl font-black">Your success moment</p><p className="mt-2 max-w-sm text-sm leading-6 text-white/70">Your business marker appears on the map, stays after refresh, and follows the visibility you choose.</p></div>
    </div>
  </div></StepCard>;
}

function GeographyStep({ territories, selected, busy, onBack, onSelect }: { territories: TerritoryOption[]; selected: Geography | null; busy: string | null; onBack(): void; onSelect(territory: TerritoryOption): void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const sorted = [...territories].sort((a, b) => (a.status === "released" ? -1 : 1) - (b.status === "released" ? -1 : 1) || a.name.localeCompare(b.name));
    if (!normalized) return sorted.slice(0, 30);
    return sorted.filter((territory) => `${territory.name} ${territory.state} ${territory.fips}`.toLowerCase().includes(normalized)).slice(0, 30);
  }, [query, territories]);
  return <StepCard><div className="p-6 sm:p-9">
    <button onClick={onBack} className="inline-flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-950"><ArrowLeft className="h-4 w-4" /> Back</button>
    <div className="mt-5 max-w-2xl"><p className="text-xs font-black uppercase tracking-[0.14em] text-[#9A6D16]">Your Exchange community</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Where does your business operate?</h1><p className="mt-3 leading-6 text-slate-600">Search by city, county, ZIP code, or locality name. You will confirm the selection before the map is activated.</p></div>
    <label className="relative mt-7 block max-w-2xl"><span className="sr-only">Search communities</span><Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} className={`${inputClass} mt-0 pl-12`} placeholder="City, county, ZIP code, or locality" /></label>
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      {filtered.map((territory) => {
        const active = territory.status === "released";
        const unavailable = territory.status === "paused" || territory.status === "archived";
        return <button key={territory.fips} disabled={busy !== null || unavailable} onClick={() => onSelect(territory)} className={`rounded-2xl border p-4 text-left transition ${selected?.fips === territory.fips ? "border-[#D6A23A] bg-amber-50" : "border-slate-200 bg-white hover:border-slate-400"} disabled:cursor-not-allowed disabled:opacity-55`}>
          <div className="flex items-start justify-between gap-3"><div><strong className="block text-slate-950">{territory.name}</strong><span className="mt-1 block text-sm text-slate-500">{territory.state} · {territory.fips}</span></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${active ? "bg-emerald-50 text-emerald-700" : territory.status === "scheduled" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{active ? "Open" : territory.status === "scheduled" ? "Preview" : "Unavailable"}</span></div>
          <p className="mt-3 text-xs leading-5 text-slate-500">{active ? "Full Exchange participation is available." : territory.status === "scheduled" ? "Save this community and preview the Exchange while release is pending." : "Full participation is not currently available in this community."}</p>
        </button>;
      })}
    </div>
    {!filtered.length && <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No matching Exchange community was found.</div>}
  </div></StepCard>;
}

function OrganizationStep({ geography, existingOrganizations, claims, busy, onBack, onConnected, onCreated, onClaimed }: {
  geography: Geography | null;
  existingOrganizations: ExchangeActorOrganizationOption[];
  claims: ExchangeOrganizationClaim[];
  busy: string | null;
  onBack(): void;
  onConnected(organizationId: string): Promise<void>;
  onCreated(organizationId: string): Promise<void>;
  onClaimed(organizationId: string, claimId?: string): Promise<void>;
}) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [results, setResults] = useState<ExchangeOrganizationCandidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [claimReasons, setClaimReasons] = useState<Record<string, string>>({});
  const [duplicateNotice, setDuplicateNotice] = useState(false);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await exchangeOrganizationSearchFn({ name, city: geography?.name, state: geography?.state, website: website || undefined });
    await recordProgress({ action: "organization_search_completed" });
    setResults(response.data.candidates);
    setSearched(true);
  };

  const create = async (forceCreate = false) => {
    const response = await exchangeOrganizationCreateFn({ name, city: geography?.name, state: geography?.state, website: website || undefined, forceCreate, idempotencyKey: crypto.randomUUID() });
    if (response.data.created && response.data.organizationId) {
      await onCreated(response.data.organizationId);
      return;
    }
    setResults(response.data.possibleMatches || []);
    setSearched(true);
    setDuplicateNotice(true);
  };

  const claim = async (candidate: ExchangeOrganizationCandidate) => {
    const reason = (claimReasons[candidate.id] || "").trim();
    if (reason.length < 10) throw new Error("Explain your connection to this business in at least 10 characters.");
    const result = await exchangeOrganizationRequestClaimFn({ organizationId: candidate.id, reason });
    await onClaimed(candidate.id, result.data.claimId);
  };

  return <StepCard><div className="p-6 sm:p-9">
    <button onClick={onBack} className="inline-flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-950"><ArrowLeft className="h-4 w-4" /> Back</button>
    <div className="mt-5 max-w-2xl"><p className="text-xs font-black uppercase tracking-[0.14em] text-[#9A6D16]">Find your business</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">What is the name of your business?</h1><p className="mt-3 leading-6 text-slate-600">We will check existing and seeded records first so the Exchange does not create a duplicate.</p></div>

    {existingOrganizations.length > 0 && <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-sm font-black text-emerald-900">Businesses already connected to your account</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{existingOrganizations.map((organization) => <button key={organization.organizationId} disabled={busy !== null} onClick={() => void onConnected(organization.organizationId)} className="flex items-center justify-between rounded-xl bg-white p-3 text-left font-bold text-slate-900 shadow-sm ring-1 ring-emerald-100"><span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-emerald-600" />{organization.name}</span><ChevronRight className="h-4 w-4" /></button>)}</div></div>}

    {claims.some((claim) => claim.status === "pending") && <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Claim under review:</strong> {claims.find((claim) => claim.status === "pending")?.organizationName}. You may view public Exchange information, but ownership permissions are not granted until approval.</div>}

    <form onSubmit={(event) => void search(event)} className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_0.7fr]"><label className="text-sm font-bold text-slate-700">Business name<input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="Acme Services LLC" /></label><label className="text-sm font-bold text-slate-700">Website <span className="font-normal text-slate-400">(optional)</span><input type="url" value={website} onChange={(event) => setWebsite(event.target.value)} className={inputClass} placeholder="https://example.com" /></label></div>
      <button disabled={busy !== null || name.trim().length < 2} className={`${primaryButton} mt-4 w-full sm:w-auto`}>{busy === "search" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search businesses</button>
    </form>

    {searched && <div className="mt-7"><h2 className="text-lg font-black text-slate-950">Likely matches</h2><p className="mt-1 text-sm text-slate-500">Choose an existing record when it represents your business.</p><div className="mt-4 space-y-3">{results.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-7 text-center text-sm text-slate-500">No likely match was found.</div> : results.map((candidate) => <article key={candidate.id} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-slate-950">{candidate.name}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{candidate.claimStatus === "unclaimed" ? "Available to claim" : candidate.claimStatus.replace("_", " ")}</span></div><p className="mt-1 text-sm text-slate-500">{[candidate.city, candidate.state].filter(Boolean).join(", ") || geography?.name}</p></div><div className="w-full sm:max-w-sm">{candidate.authorizedActor ? <button onClick={() => void onConnected(candidate.id)} className={`${primaryButton} w-full`}>Connect this business</button> : candidate.external ? <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">This public source match must be reviewed before it can be claimed. Create a new record only when it is not the same business.</p> : <><label className="block text-xs font-black uppercase tracking-wide text-slate-500">How are you connected to this business?<textarea value={claimReasons[candidate.id] || ""} onChange={(event) => setClaimReasons((current) => ({ ...current, [candidate.id]: event.target.value }))} className={`${inputClass} min-h-24 text-sm font-normal normal-case tracking-normal`} placeholder="I am the owner and can verify the business." /></label><button disabled={!candidate.canRequestClaim || (claimReasons[candidate.id] || "").trim().length < 10} onClick={() => void claim(candidate)} className={`${secondaryButton} mt-2 w-full`}><ShieldCheck className="h-4 w-4" /> Request claim</button></>}</div></div></article>)}</div>
      <div className="mt-6 rounded-2xl border border-[#D6A23A]/40 bg-amber-50 p-5"><h2 className="font-black text-slate-950">No appropriate match?</h2><p className="mt-1 text-sm leading-6 text-slate-600">Create a new business record with only the essentials. Profile details and enrichment come after your marker is live.</p>{duplicateNotice && <p className="mt-3 rounded-xl bg-white p-3 text-sm font-semibold text-amber-900">A likely duplicate was found. Review the matches above before confirming a separate business.</p>}<div className="mt-4 flex flex-col gap-3 sm:flex-row"><button disabled={busy !== null || name.trim().length < 2} onClick={() => void create(false)} className={primaryButton}>Create this business</button>{duplicateNotice && <button disabled={busy !== null} onClick={() => void create(true)} className={secondaryButton}>This is a different business</button>}</div></div>
    </div>}
  </div></StepCard>;
}

function ClaimPendingStep({ claim, onBack, onRefresh }: { claim?: ExchangeOrganizationClaim; onBack(): void; onRefresh(): void }) {
  return <StepCard><div className="p-6 text-center sm:p-12"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-amber-700"><ShieldCheck className="h-8 w-8" /></div><h1 className="mt-5 text-3xl font-black text-slate-950">Your claim is being reviewed.</h1><p className="mx-auto mt-3 max-w-xl leading-7 text-slate-600">{claim?.organizationName || "This business"} remains visible as an existing organization record. You may continue exploring public information, but the Exchange will not grant ownership or address-editing permissions until the claim is approved.</p><div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><button onClick={onRefresh} className={primaryButton}>Check claim status</button><Link href="/exchange?claimPreview=1" className={secondaryButton}>Explore the Exchange</Link><button onClick={onBack} className="px-4 py-3 text-sm font-bold text-slate-600">Choose another business</button></div></div></StepCard>;
}

function LocationStep({ organizationId, organizationName, geography, busy, onBack, onActivate }: {
  organizationId: string;
  organizationName: string;
  geography: Geography;
  busy: string | null;
  onBack(): void;
  onActivate(payload: { address: BusinessAddress; requestId: string; candidate: GeocodeCandidate; visibility: MarkerVisibility }): void;
}) {
  const [address, setAddress] = useState<BusinessAddress>({ line1: "", locality: "", administrativeArea: geography.state || "VA", postalCode: "", countryCode: "US", county: geography.type === "county" ? geography.name.replace(/\s+County$/i, "") : "" });
  const [visibility, setVisibility] = useState<MarkerVisibility>("approximate");
  const [requestId, setRequestId] = useState("");
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [localError, setLocalError] = useState("");
  const [searching, setSearching] = useState(false);

  const findAddress = async (event: React.FormEvent) => {
    event.preventDefault();
    setLocalError("");
    setSearching(true);
    try {
      const result = await searchGeocodes({ organizationId, address });
      setRequestId(result.data.requestId);
      setCandidates(result.data.candidates);
      setSelectedId(result.data.candidates[0]?.id || "");
      if (!result.data.candidates.length) setLocalError("We could not confirm that address. Check the street, city, state, and ZIP code, then try again.");
    } catch (value) {
      console.warn("Business address confirmation failed", { code: (value as { code?: string }).code || "unknown" });
      setLocalError("We could not confirm that address. Check the street, city, state, and ZIP code, then try again.");
    } finally { setSearching(false); }
  };

  const selected = candidates.find((candidate) => candidate.id === selectedId);
  return <StepCard><div className="p-6 sm:p-9">
    <button onClick={onBack} className="inline-flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-950"><ArrowLeft className="h-4 w-4" /> Back</button>
    <div className="mt-5 max-w-2xl"><p className="text-xs font-black uppercase tracking-[0.14em] text-[#9A6D16]">Activate your marker</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Where should {organizationName} appear on the Exchange?</h1><p className="mt-3 leading-6 text-slate-600">We store the operational address securely. You decide whether the public sees the exact address, an approximate point, only the locality, or no location.</p></div>

    {geography.status !== "released" && <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-900"><strong>{geography.name} is currently preview-only.</strong> Your community selection is saved, but a public business marker cannot be activated until the territory is released.</div>}

    <form onSubmit={(event) => void findAddress(event)} className="mt-7 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-slate-700 sm:col-span-2">Street address<input required autoComplete="street-address" value={address.line1} onChange={(event) => setAddress((current) => ({ ...current, line1: event.target.value }))} className={inputClass} /></label><label className="text-sm font-bold text-slate-700">Address line 2 <span className="font-normal text-slate-400">(optional)</span><input value={address.line2 || ""} onChange={(event) => setAddress((current) => ({ ...current, line2: event.target.value || undefined }))} className={inputClass} /></label><label className="text-sm font-bold text-slate-700">City or locality<input required autoComplete="address-level2" value={address.locality} onChange={(event) => setAddress((current) => ({ ...current, locality: event.target.value }))} className={inputClass} /></label><label className="text-sm font-bold text-slate-700">State<input required autoComplete="address-level1" maxLength={2} value={address.administrativeArea} onChange={(event) => setAddress((current) => ({ ...current, administrativeArea: event.target.value.toUpperCase() }))} className={inputClass} /></label><label className="text-sm font-bold text-slate-700">ZIP code<input required autoComplete="postal-code" value={address.postalCode || ""} onChange={(event) => setAddress((current) => ({ ...current, postalCode: event.target.value }))} className={inputClass} /></label></div>
      {localError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{localError}</div>}
      <button disabled={searching || geography.status !== "released"} className={primaryButton}>{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />} Confirm address on map</button>
    </form>

    {candidates.length > 0 && <div className="mt-8"><h2 className="text-lg font-black text-slate-950">Choose the correct map location</h2><div className="mt-3 space-y-2">{candidates.map((candidate) => <label key={candidate.id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${selectedId === candidate.id ? "border-[#D6A23A] bg-amber-50" : "border-slate-200"}`}><input type="radio" name="geocode" checked={selectedId === candidate.id} onChange={() => setSelectedId(candidate.id)} className="mt-1 accent-[#D6A23A]" /><span><strong className="block text-sm text-slate-950">{candidate.normalizedAddress}</strong><span className="mt-1 block text-xs text-slate-500">{candidate.precision} · {candidate.confidence} confidence · {candidate.attribution}</span></span></label>)}</div>

      <fieldset className="mt-7"><legend className="text-lg font-black text-slate-950">Choose public location visibility</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">{([
        ["exact", "Exact address visible", "Show the street address and exact marker."],
        ["approximate", "Approximate location visible", "Hide the street address and shift the public marker nearby."],
        ["locality", "Locality only", "Show the city or county area without the exact business point."],
        ["private", "Private location", "Only authorized members can see the persisted marker."],
      ] as Array<[MarkerVisibility, string, string]>).map(([value, label, detail]) => <label key={value} className={`cursor-pointer rounded-2xl border p-4 ${visibility === value ? "border-[#D6A23A] bg-amber-50" : "border-slate-200"}`}><span className="flex items-start gap-3"><input type="radio" name="visibility" checked={visibility === value} onChange={() => setVisibility(value)} className="mt-1 accent-[#D6A23A]" /><span><strong className="block text-sm text-slate-950">{label}</strong><span className="mt-1 block text-xs leading-5 text-slate-500">{detail}</span></span></span></label>)}</div></fieldset>

      <div className="sticky bottom-3 z-10 mt-7 rounded-2xl border border-black/10 bg-white/95 p-3 shadow-xl backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none"><button disabled={busy !== null || !selected} onClick={() => selected && onActivate({ address, requestId, candidate: selected, visibility })} className={`${primaryButton} w-full sm:w-auto`}>{busy === "location" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} Place My Business on the Exchange</button></div>
    </div>}
  </div></StepCard>;
}
