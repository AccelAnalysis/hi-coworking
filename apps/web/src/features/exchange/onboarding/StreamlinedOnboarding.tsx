"use client";

import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ChevronRight,
  Loader2,
  LocateFixed,
  MapPin,
  Search,
  ShieldCheck,
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
import {
  searchExchangeGeographies,
  searchManagedTerritories,
  type GeographySearchResult,
  type SearchableTerritory,
} from "./geographySearch";

type Geography = SearchableTerritory & { selectedAt?: number };
type MarkerVisibility = "exact" | "approximate" | "locality" | "private";
type Step = "geography" | "organization" | "claim" | "location";
type ActivationState = {
  contractVersion: number;
  registrationVersion: 1 | 2;
  guidedActivationRequired: boolean;
  currentStep: string;
  completedSteps: string[];
  organizationId: string | null;
  organizationName: string | null;
  claimState: string;
  safeResumeRoute: string;
  selectedGeography: Geography | null;
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
type MarkerActivationPayload = {
  address: BusinessAddress;
  requestId: string;
  candidate: GeocodeCandidate;
  visibility: MarkerVisibility;
};

type TerritoryResponse = {
  released: Geography[];
  scheduled: Geography[];
  unreleased: Geography[];
};

const getActivationState = httpsCallable<Record<string, never>, ActivationState>(
  functions,
  "exchange_getBusinessActivationState",
);
const recordProgress = httpsCallable<Record<string, unknown>, { success: true; organizationId?: string; establishmentId?: string }>(
  functions,
  "exchange_recordBusinessActivationProgress",
);
const searchGeocodes = httpsCallable<
  { organizationId: string; address: BusinessAddress },
  { requestId: string; candidates: GeocodeCandidate[]; expiresAt: number }
>(functions, "exchange_searchOrganizationGeocodes");
const upsertLocation = httpsCallable<Record<string, unknown>, { locationId: string; recordVersion: number }>(
  functions,
  "exchange_upsertOrganizationEstablishment",
);

const inputClass = "mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base text-slate-950 outline-none transition focus:border-[#D6A23A] focus:ring-2 focus:ring-amber-100";
const primaryButton = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#0B0B0D] px-6 py-3 font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 font-bold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function friendlyError(value: unknown, fallback: string): string {
  const error = value as { code?: string; message?: string };
  const code = String(error?.code ?? "");
  if (code.includes("unauthenticated")) return "Your session expired. Sign in again to continue.";
  if (code.includes("permission-denied")) return "You do not have permission to change this business.";
  if (code.includes("already-exists")) return "A matching business already exists. Search again and select the existing record.";
  if (code.includes("resource-exhausted")) return "Too many attempts were made. Try again in a moment.";
  if (code.includes("unavailable")) return "This service is temporarily unavailable. Your completed steps are saved.";
  if (code.includes("failed-precondition")) return error.message?.replace(/^FirebaseError:\s*/i, "") || fallback;
  return fallback;
}

function stepFromState(state: ActivationState): Step {
  if (state.currentStep === "organization_claim_pending") return "claim";
  if (["business_location", "map_activation"].includes(state.currentStep)) return "location";
  if (["organization_search", "organization_connection"].includes(state.currentStep)) return "organization";
  return "geography";
}

export function StreamlinedOnboarding() {
  return <RequireAuth><Onboarding /></RequireAuth>;
}

function Onboarding() {
  const { user } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<ActivationState | null>(null);
  const [step, setStep] = useState<Step>("geography");
  const [territories, setTerritories] = useState<Geography[]>([]);
  const [organizations, setOrganizations] = useState<ExchangeActorOrganizationOption[]>([]);
  const [claims, setClaims] = useState<ExchangeOrganizationClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [supportLoading, setSupportLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const welcomeAck = useRef<Promise<void> | null>(null);

  const ensureWelcomeAcknowledged = () => {
    if (state?.completedSteps.includes("welcome_acknowledged")) return Promise.resolve();
    welcomeAck.current ??= recordProgress({ action: "welcome_acknowledged" }).then(() => undefined);
    return welcomeAck.current;
  };

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    void Promise.all([getActivationState({}), listReleasedTerritoriesFn({})])
      .then(([activation, territoryResponse]) => {
        if (!active) return;
        const activationState = activation.data;
        if (activationState.currentStep === "completed") {
          router.replace(activationState.safeResumeRoute || "/exchange");
          return;
        }
        const territoryData = territoryResponse.data as TerritoryResponse;
        setState(activationState);
        setStep(stepFromState(activationState));
        setTerritories([
          ...territoryData.released,
          ...territoryData.scheduled,
          ...territoryData.unreleased,
        ]);
        if (activationState.currentStep === "welcome") {
          welcomeAck.current = recordProgress({ action: "welcome_acknowledged" }).then(() => undefined).catch(() => undefined);
        }
      })
      .catch((value) => active && setError(friendlyError(value, "We could not open business setup. Refresh and try again.")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [router, user]);

  const loadBusinessSupport = async () => {
    setSupportLoading(true);
    try {
      const [actorResponse, claimResponse] = await Promise.all([
        listActorOrganizations().catch(() => ({ actors: [] })),
        exchangeOrganizationListMyClaimsFn({}).catch(() => ({ data: { claims: [] } })),
      ]);
      setOrganizations(actorResponse.actors);
      setClaims(claimResponse.data.claims);
    } finally {
      setSupportLoading(false);
    }
  };

  useEffect(() => {
    if (!user || (step !== "organization" && step !== "claim")) return;
    void loadBusinessSupport();
  }, [step, user]);

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

  const chooseGeography = (territory: Geography) => void run("geography", async () => {
    await ensureWelcomeAcknowledged();
    await recordProgress({ action: "geography_selected", fips: territory.fips });
    const nextState: ActivationState = {
      ...(state as ActivationState),
      currentStep: "organization_search",
      selectedGeography: { ...territory, selectedAt: Date.now() },
      completedSteps: Array.from(new Set([...(state?.completedSteps ?? []), "welcome_acknowledged", "geography_selected"])),
    };
    setState(nextState);
    setStep("organization");
    if (territory.status === "scheduled") {
      setNotice(`${territory.name} is scheduled for release. You can identify your business now, but a marker cannot be activated until the community opens.`);
    }
  });

  const connectOrganization = (id: string, name: string) => run("organization", async () => {
    await recordProgress({ action: "organization_selected", organizationId: id });
    setState((current) => current ? { ...current, organizationId: id, organizationName: name, currentStep: "business_location" } : current);
    setStep("location");
  });

  const createOrganization = (id: string, name: string) => run("organization", async () => {
    await recordProgress({ action: "organization_created", organizationId: id });
    setState((current) => current ? { ...current, organizationId: id, organizationName: name, currentStep: "business_location" } : current);
    setStep("location");
  });

  const startClaim = (id: string, name: string, claimId?: string) => run("claim", async () => {
    await recordProgress({ action: "organization_claim_started", organizationId: id, ...(claimId ? { claimId } : {}) });
    setState((current) => current ? { ...current, organizationId: id, organizationName: name, currentStep: "organization_claim_pending", claimState: "pending" } : current);
    setStep("claim");
    await loadBusinessSupport();
  });

  const refreshClaim = () => void run("claim-refresh", async () => {
    const [activation] = await Promise.all([getActivationState({}), loadBusinessSupport()]);
    setState(activation.data);
    const next = stepFromState(activation.data);
    setStep(next);
    if (next === "claim") setNotice("The claim is still under review. You can continue exploring public Exchange information while you wait.");
  });

  const activateMarker = async (organizationId: string, geography: Geography, payload: MarkerActivationPayload) => {
    await run("location", async () => {
      const location = await upsertLocation({
        organizationId,
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
          territoryFips: geography.fips,
        },
        publicContactAvailable: false,
        privateHome: payload.visibility === "private",
        preferredOrientation: payload.visibility !== "private",
        geocodeSelection: { requestId: payload.requestId, candidateId: payload.candidate.id },
      });
      const establishmentId = location.data.locationId;
      // Marker activation is the authoritative completion transaction. It also records
      // address/geocode milestones, so the browser does not serialize redundant calls.
      await recordProgress({
        action: "marker_activated",
        organizationId,
        establishmentId,
        visibility: payload.visibility,
      });
      const query = new URLSearchParams({
        actorOrg: organizationId,
        subjectOrg: organizationId,
        secondaryEntity: "establishment",
        secondarySelected: establishmentId,
        lng: String(payload.candidate.longitude),
        lat: String(payload.candidate.latitude),
        z: "17.2",
        b: "-12",
        p: "52",
        onboardingSuccess: "1",
      });
      router.replace(`/exchange?${query.toString()}`);
    });
  };

  if (loading) {
    return <AppShell><main className="grid min-h-[55dvh] place-items-center bg-[#F7F3EA] px-4"><div role="status" className="text-center"><Loader2 className="mx-auto h-8 w-8 animate-spin text-[#D6A23A]" /><p className="mt-3 text-sm font-semibold text-slate-700">Opening business setup…</p></div></main></AppShell>;
  }

  const organizationId = state?.organizationId ?? null;
  const geography = state?.selectedGeography ?? null;

  return (
    <AppShell>
      <main className="min-h-dvh bg-[#F7F3EA] px-3 py-5 sm:px-6 sm:py-10">
        <div className="mx-auto max-w-5xl">
          <ProgressHeader step={step} />
          {error && <div role="alert" className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{error}</div>}
          {notice && <div role="status" className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800">{notice}</div>}

          {step === "geography" && <GeographyStep territories={territories} selected={geography} busy={busy} onSelect={chooseGeography} />}

          {step === "organization" && <OrganizationStep
            geography={geography}
            organizations={organizations}
            claims={claims}
            supportLoading={supportLoading}
            parentBusy={busy}
            onBack={() => setStep("geography")}
            onError={setError}
            onConnected={connectOrganization}
            onCreated={createOrganization}
            onClaimed={startClaim}
          />}

          {step === "claim" && <ClaimPendingStep
            claim={claims.find((claim) => claim.status === "pending")}
            busy={busy}
            onBack={() => setStep("organization")}
            onRefresh={refreshClaim}
          />}

          {step === "location" && organizationId && geography && <LocationStep
            organizationId={organizationId}
            organizationName={state?.organizationName || "Your business"}
            geography={geography}
            busy={busy}
            onBack={() => setStep("organization")}
            onActivate={(payload) => void activateMarker(organizationId, geography, payload)}
          />}
        </div>
      </main>
    </AppShell>
  );
}

function ProgressHeader({ step }: { step: Step }) {
  const stages: Array<{ id: Exclude<Step, "claim">; label: string }> = [
    { id: "geography", label: "Community" },
    { id: "organization", label: "Business" },
    { id: "location", label: "Map" },
  ];
  const normalized = step === "claim" ? "organization" : step;
  const currentIndex = stages.findIndex((stage) => stage.id === normalized);
  return <header className="mb-5 rounded-2xl border border-black/10 bg-white/90 p-4 shadow-sm backdrop-blur sm:mb-7 sm:p-5"><div className="flex items-center justify-between gap-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#D6A23A] font-black text-black">RF</span><div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">The RFxchange</p><p className="font-bold text-slate-950">Place your business</p></div></div><span className="text-xs font-bold text-slate-500">Step {Math.max(currentIndex + 1, 1)} of 3</span></div><ol className="mt-4 grid grid-cols-3 gap-2" aria-label="Onboarding progress">{stages.map((stage, index) => <li key={stage.id}><div className={`h-1.5 rounded-full ${index <= currentIndex ? "bg-[#D6A23A]" : "bg-slate-200"}`} /><span className={`mt-1 hidden text-[11px] font-semibold sm:block ${index <= currentIndex ? "text-slate-900" : "text-slate-400"}`}>{stage.label}</span></li>)}</ol></header>;
}

function StepCard({ children }: { children: ReactNode }) {
  return <section className="overflow-hidden rounded-3xl border border-black/10 bg-white shadow-xl shadow-black/5">{children}</section>;
}

function GeographyStep({ territories, selected, busy, onSelect }: {
  territories: Geography[];
  selected: Geography | null;
  busy: string | null;
  onSelect(territory: Geography): void;
}) {
  const [query, setQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<GeographySearchResult<Geography>[] | null>(null);
  const [searching, setSearching] = useState(false);
  const localResults = useMemo(() => searchManagedTerritories(query, territories), [query, territories]);
  const results = remoteResults ?? localResults;

  useEffect(() => {
    const trimmed = query.trim();
    setRemoteResults(null);
    if (trimmed.length < 3) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchExchangeGeographies(trimmed, territories)
        .then((next) => active && setRemoteResults(next))
        .finally(() => active && setSearching(false));
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, territories]);

  return <StepCard><div className="p-6 sm:p-9"><StepIntro eyebrow="Welcome to The RFxchange" title="Where does your business operate?">Search any U.S. city, county, ZIP code, or locality. We will identify the RFxchange community that governs participation and tell you whether it is open, scheduled, or not yet available.</StepIntro><label className="relative mt-7 block max-w-2xl"><span className="sr-only">Search communities</span><Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} className={`${inputClass} mt-0 pl-12 pr-12`} placeholder="City, county, ZIP code, or locality" />{searching && <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#D6A23A]" />}</label><p className="mt-2 text-xs text-slate-500">Your search can find places beyond currently released communities. Participation is still enforced by the server-managed community record.</p><div className="mt-5 grid gap-3 sm:grid-cols-2">{results.map((result) => { const territory = result.territory; const active = result.availability === "released"; const scheduled = result.availability === "scheduled"; const disabled = busy !== null || !territory || result.availability === "unavailable"; return <button key={result.key} type="button" disabled={disabled} onClick={() => territory && onSelect(territory)} className={`rounded-2xl border p-4 text-left transition ${territory && selected?.fips === territory.fips ? "border-[#D6A23A] bg-amber-50" : "border-slate-200 bg-white hover:border-slate-400"} disabled:cursor-not-allowed disabled:opacity-65`}><div className="flex items-start justify-between gap-3"><div><strong className="block text-slate-950">{result.label}</strong>{territory && <span className="mt-1 block text-sm text-slate-500">FIPS {territory.fips}</span>}</div><span className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${active ? "bg-emerald-50 text-emerald-700" : scheduled ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{active ? "Open" : scheduled ? "Scheduled" : "Not open"}</span></div><p className="mt-3 text-xs leading-5 text-slate-500">{result.detail}</p></button>; })}</div>{!results.length && <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No matching geography was found. Try a city, county, ZIP code, or state-qualified locality.</div>}</div></StepCard>;
}

function OrganizationStep({ geography, organizations, claims, supportLoading, parentBusy, onBack, onError, onConnected, onCreated, onClaimed }: {
  geography: Geography | null;
  organizations: ExchangeActorOrganizationOption[];
  claims: ExchangeOrganizationClaim[];
  supportLoading: boolean;
  parentBusy: string | null;
  onBack(): void;
  onError(message: string): void;
  onConnected(id: string, name: string): Promise<void>;
  onCreated(id: string, name: string): Promise<void>;
  onClaimed(id: string, name: string, claimId?: string): Promise<void>;
}) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [results, setResults] = useState<ExchangeOrganizationCandidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [claimReasons, setClaimReasons] = useState<Record<string, string>>({});
  const [duplicateNotice, setDuplicateNotice] = useState(false);
  const [localBusy, setLocalBusy] = useState<string | null>(null);

  const search = async (event: FormEvent) => {
    event.preventDefault(); setLocalBusy("search"); onError("");
    try {
      const response = await exchangeOrganizationSearchFn({ name, ...(geography?.type === "city" ? { city: geography.name } : {}), state: geography?.state, website: website || undefined });
      await recordProgress({ action: "organization_search_completed" });
      setResults(response.data.candidates); setSearched(true);
    } catch (value) { onError(friendlyError(value, "We could not search business records. Try again.")); }
    finally { setLocalBusy(null); }
  };

  const create = async (forceCreate = false) => {
    setLocalBusy("create"); onError("");
    try {
      const response = await exchangeOrganizationCreateFn({ name, ...(geography?.type === "city" ? { city: geography.name } : {}), state: geography?.state, website: website || undefined, forceCreate, idempotencyKey: crypto.randomUUID() });
      if (response.data.created && response.data.organizationId) await onCreated(response.data.organizationId, name.trim());
      else { setResults(response.data.possibleMatches || []); setSearched(true); setDuplicateNotice(true); }
    } catch (value) { onError(friendlyError(value, "We could not create the business record. Review the information and try again.")); }
    finally { setLocalBusy(null); }
  };

  const claim = async (candidate: ExchangeOrganizationCandidate) => {
    const reason = (claimReasons[candidate.id] || "").trim();
    if (reason.length < 10) { onError("Explain your connection to this business in at least 10 characters."); return; }
    setLocalBusy(`claim-${candidate.id}`); onError("");
    try { const response = await exchangeOrganizationRequestClaimFn({ organizationId: candidate.id, reason }); await onClaimed(candidate.id, candidate.name, response.data.claimId); }
    catch (value) { onError(friendlyError(value, "We could not submit this claim. Check the information and try again.")); }
    finally { setLocalBusy(null); }
  };

  const busy = parentBusy !== null || localBusy !== null;
  const pendingClaim = claims.find((claim) => claim.status === "pending");
  return <StepCard><div className="p-6 sm:p-9"><BackButton onClick={onBack} /><StepIntro eyebrow="Find your business" title="Which business are you placing on the Exchange?">We check connected, seeded, and public-source records before creating anything new, so you do not have to duplicate a business that already exists.</StepIntro>{supportLoading && <p className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking businesses already connected to your account…</p>}{organizations.length > 0 && <div className="mt-7 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-sm font-black text-emerald-900">Already connected</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{organizations.map((organization) => <button key={organization.organizationId} disabled={busy} onClick={() => void onConnected(organization.organizationId, organization.name)} className="flex items-center justify-between rounded-xl bg-white p-3 text-left font-bold text-slate-900 shadow-sm ring-1 ring-emerald-100"><span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-emerald-600" />{organization.name}</span><ChevronRight className="h-4 w-4" /></button>)}</div></div>}{pendingClaim && <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Claim under review:</strong> {pendingClaim.organizationName}. Ownership permissions are not granted until approval.</div>}<form onSubmit={(event) => void search(event)} className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5"><div className="grid gap-4 sm:grid-cols-[1fr_0.7fr]"><label className="text-sm font-bold text-slate-700">Business name<input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} placeholder="Acme Services LLC" /></label><label className="text-sm font-bold text-slate-700">Website <span className="font-normal text-slate-400">(optional)</span><input type="url" value={website} onChange={(event) => setWebsite(event.target.value)} className={inputClass} placeholder="https://example.com" /></label></div><button disabled={busy || name.trim().length < 2} className={`${primaryButton} mt-4 w-full sm:w-auto`}>{localBusy === "search" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search businesses</button></form>{searched && <div className="mt-7"><h2 className="text-lg font-black text-slate-950">Likely matches</h2><div className="mt-4 space-y-3">{results.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-7 text-center text-sm text-slate-500">No likely match was found.</div> : results.map((candidate) => <article key={candidate.id} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-slate-950">{candidate.name}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{candidate.claimStatus === "unclaimed" ? "Available to claim" : candidate.claimStatus.replace("_", " ")}</span></div><p className="mt-1 text-sm text-slate-500">{[candidate.city, candidate.state].filter(Boolean).join(", ") || geography?.name}</p></div><div className="w-full sm:max-w-sm">{candidate.authorizedActor ? <button disabled={busy} onClick={() => void onConnected(candidate.id, candidate.name)} className={`${primaryButton} w-full`}>Use this business</button> : candidate.external ? <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">This public-source match needs review before a claim can grant authority. Create a separate record only when it is genuinely different.</p> : <><label className="block text-xs font-black uppercase tracking-wide text-slate-500">How are you connected to this business?<textarea value={claimReasons[candidate.id] || ""} onChange={(event) => setClaimReasons((current) => ({ ...current, [candidate.id]: event.target.value }))} className={`${inputClass} min-h-24 text-sm font-normal normal-case tracking-normal`} placeholder="I am the owner and can verify the business." /></label><button disabled={busy || !candidate.canRequestClaim || (claimReasons[candidate.id] || "").trim().length < 10} onClick={() => void claim(candidate)} className={`${secondaryButton} mt-2 w-full`}>{localBusy === `claim-${candidate.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Request claim</button></>}</div></div></article>)}</div><div className="mt-6 rounded-2xl border border-[#D6A23A]/40 bg-amber-50 p-5"><h2 className="font-black text-slate-950">No appropriate match?</h2><p className="mt-1 text-sm leading-6 text-slate-600">Create the business with only the essentials. Enrichment and profile completion happen after your marker is live.</p>{duplicateNotice && <p className="mt-3 rounded-xl bg-white p-3 text-sm font-semibold text-amber-900">A likely duplicate was found. Review the matches above before confirming a separate business.</p>}<div className="mt-4 flex flex-col gap-3 sm:flex-row"><button disabled={busy || name.trim().length < 2} onClick={() => void create(false)} className={primaryButton}>{localBusy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create this business</button>{duplicateNotice && <button disabled={busy} onClick={() => void create(true)} className={secondaryButton}>This is a different business</button>}</div></div></div>}</div></StepCard>;
}

function ClaimPendingStep({ claim, busy, onBack, onRefresh }: { claim?: ExchangeOrganizationClaim; busy: string | null; onBack(): void; onRefresh(): void }) {
  return <StepCard><div className="p-6 text-center sm:p-12"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-50 text-amber-700"><ShieldCheck className="h-8 w-8" /></div><h1 className="mt-5 text-3xl font-black text-slate-950">Your claim is being reviewed.</h1><p className="mx-auto mt-3 max-w-xl leading-7 text-slate-600">{claim?.organizationName || "This business"} remains visible as an existing organization record. You may explore public information, but ownership and location-editing permissions remain locked until approval.</p><div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row"><button disabled={busy !== null} onClick={onRefresh} className={primaryButton}>{busy === "claim-refresh" ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Check claim status</button><Link href="/exchange?claimPreview=1" className={secondaryButton}>Explore the Exchange</Link><button onClick={onBack} className="px-4 py-3 text-sm font-bold text-slate-600">Choose another business</button></div></div></StepCard>;
}

function LocationStep({ organizationId, organizationName, geography, busy, onBack, onActivate }: { organizationId: string; organizationName: string; geography: Geography; busy: string | null; onBack(): void; onActivate(payload: MarkerActivationPayload): void }) {
  const [address, setAddress] = useState<BusinessAddress>({ line1: "", locality: "", administrativeArea: geography.state || "VA", postalCode: "", countryCode: "US", county: geography.type === "county" ? geography.name.replace(/\s+County$/i, "") : "" });
  const [visibility, setVisibility] = useState<MarkerVisibility>("approximate");
  const [requestId, setRequestId] = useState("");
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [localError, setLocalError] = useState("");
  const [searching, setSearching] = useState(false);

  const findAddress = async (event: FormEvent) => {
    event.preventDefault(); setLocalError(""); setSearching(true);
    try {
      const result = await searchGeocodes({ organizationId, address });
      setRequestId(result.data.requestId); setCandidates(result.data.candidates); setSelectedId(result.data.candidates[0]?.id || "");
      if (!result.data.candidates.length) setLocalError("We could not confirm that address. Check the street, city, state, and ZIP code, then try again.");
    } catch {
      void recordProgress({ action: "geocoding_failed", organizationId }).catch(() => undefined);
      setLocalError("We could not confirm that address. Check the street, city, state, and ZIP code, then try again.");
    } finally { setSearching(false); }
  };

  const selected = candidates.find((candidate) => candidate.id === selectedId);
  const modes: Array<[MarkerVisibility, string, string]> = [
    ["exact", "Exact address visible", "Show the street address and exact marker."],
    ["approximate", "Approximate location visible", "Hide the street address and shift the public marker nearby."],
    ["locality", "Locality only", "Show the city or county area without the exact business point."],
    ["private", "Private location", "Only authorized members can see the persisted marker."],
  ];

  return <StepCard><div className="p-6 sm:p-9"><BackButton onClick={onBack} /><StepIntro eyebrow="Confirm your location" title={`Where should ${organizationName} appear on the Exchange?`}>Confirm the operational address once, then choose what the public can see. Your private address and the public map projection are stored separately.</StepIntro>{geography.status !== "released" && <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-5 text-sm leading-6 text-blue-900"><strong>{geography.name} is scheduled but not open yet.</strong> Your business selection is saved, but marker activation is disabled until the community is released.</div>}<form onSubmit={(event) => void findAddress(event)} className="mt-7 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold text-slate-700 sm:col-span-2">Street address<input required autoComplete="street-address" value={address.line1} onChange={(event) => setAddress((current) => ({ ...current, line1: event.target.value }))} className={inputClass} /></label><label className="text-sm font-bold text-slate-700">Address line 2 <span className="font-normal text-slate-400">(optional)</span><input value={address.line2 || ""} onChange={(event) => setAddress((current) => ({ ...current, line2: event.target.value || undefined }))} className={inputClass} /></label><label className="text-sm font-bold text-slate-700">City or locality<input required autoComplete="address-level2" value={address.locality} onChange={(event) => setAddress((current) => ({ ...current, locality: event.target.value }))} className={inputClass} /></label><label className="text-sm font-bold text-slate-700">State<input required autoComplete="address-level1" maxLength={2} value={address.administrativeArea} onChange={(event) => setAddress((current) => ({ ...current, administrativeArea: event.target.value.toUpperCase() }))} className={inputClass} /></label><label className="text-sm font-bold text-slate-700">ZIP code<input required autoComplete="postal-code" value={address.postalCode || ""} onChange={(event) => setAddress((current) => ({ ...current, postalCode: event.target.value }))} className={inputClass} /></label></div>{localError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{localError}</div>}<button disabled={searching || geography.status !== "released"} className={primaryButton}>{searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />} Confirm address on map</button></form>{candidates.length > 0 && <div className="mt-8"><h2 className="text-lg font-black text-slate-950">Choose the correct map location</h2><div className="mt-3 space-y-2">{candidates.map((candidate) => <label key={candidate.id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${selectedId === candidate.id ? "border-[#D6A23A] bg-amber-50" : "border-slate-200"}`}><input type="radio" name="geocode" checked={selectedId === candidate.id} onChange={() => setSelectedId(candidate.id)} className="mt-1 accent-[#D6A23A]" /><span><strong className="block text-sm text-slate-950">{candidate.normalizedAddress}</strong><span className="mt-1 block text-xs text-slate-500">{candidate.precision} · {candidate.confidence} confidence · {candidate.attribution}</span></span></label>)}</div><fieldset className="mt-7"><legend className="text-lg font-black text-slate-950">Choose public location visibility</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">{modes.map(([value, label, detail]) => <label key={value} className={`cursor-pointer rounded-2xl border p-4 ${visibility === value ? "border-[#D6A23A] bg-amber-50" : "border-slate-200"}`}><span className="flex items-start gap-3"><input type="radio" name="visibility" checked={visibility === value} onChange={() => setVisibility(value)} className="mt-1 accent-[#D6A23A]" /><span><strong className="block text-sm text-slate-950">{label}</strong><span className="mt-1 block text-xs leading-5 text-slate-500">{detail}</span></span></span></label>)}</div></fieldset><div className="sticky bottom-3 z-10 mt-7 rounded-2xl border border-black/10 bg-white/95 p-3 shadow-xl backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none"><button disabled={busy !== null || !selected} onClick={() => selected && onActivate({ address, requestId, candidate: selected, visibility })} className={`${primaryButton} w-full sm:w-auto`}>{busy === "location" ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} Place My Business on the Exchange</button></div></div>}</div></StepCard>;
}

function BackButton({ onClick }: { onClick(): void }) {
  return <button onClick={onClick} className="inline-flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-950"><ArrowLeft className="h-4 w-4" /> Back</button>;
}

function StepIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <div className="mt-5 max-w-2xl"><p className="text-xs font-black uppercase tracking-[0.14em] text-[#9A6D16]">{eyebrow}</p><h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">{title}</h1><p className="mt-3 leading-6 text-slate-600">{children}</p></div>;
}
