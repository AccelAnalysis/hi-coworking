"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { functions } from "@/lib/firebase";
import { getOrgMembers } from "@/lib/firestore";
import type { OrgMemberDoc } from "@hi/shared";
import type {
  OrganizationContactPoint,
  OrganizationEstablishment,
  OrganizationCommunicationRoute,
  OrganizationDocument,
  OrganizationMedia,
} from "@hi/shared/organization-establishments";
import { ArrowLeft, Building2, Check, Loader2, MapPin, Plus, Route, ShieldCheck } from "lucide-react";

type Tab = "enrichment" | "profile" | "establishments" | "contact" | "members" | "seats";
type OrganizationModel = {
  id: string; legalName: string; tradeNames: string[]; identifiers: Record<string, string>;
  description: string; domain: string; website: string; industries: string[]; capabilities: string[];
  certifications: string[]; media: OrganizationMedia[]; documents: OrganizationDocument[];
  publicationStatus: "draft" | "approved" | "suppressed";
  primaryLocationId: string | null; headquartersLocationId: string | null; recordVersion: number;
};
type ManagementModel = {
  organization: OrganizationModel;
  locations: OrganizationEstablishment[];
  contactPoints: OrganizationContactPoint[];
  communicationRoutes: OrganizationCommunicationRoute[];
  enrichmentProposals: EnrichmentProposal[];
  preferredOrientationEstablishmentId: string | null;
};
type EnrichmentProposal = {
  id: string; status: string; provider: string; proposedFields: Record<string, unknown>; createdAt: number;
  decisions: Record<string, { classification?: string; resultId?: string | null; publicationApproved?: boolean }>;
  proposedAddresses: Array<{ id: string; address: { line1: string; line2?: string; locality: string; administrativeArea: string; postalCode?: string; countryCode: string; county?: string }; geocode?: { latitude: number; longitude: number } }>;
  proposedContacts: Array<{ id: string; type: "email" | "phone"; value: string; label?: string }>;
};
type GeocodeCandidate = {
  id: string; normalizedAddress: string; latitude: number; longitude: number;
  precision: string; confidence: string; attribution: string;
};
type PublicationDiagnostic = {
  checkedAt: number;
  organization: {
    eligibleForPublicDirectory: boolean; reason: string; publicationStatus: string;
    publicOrganizationExists: boolean; searchTokensPresent: boolean; normalizedNamePresent: boolean;
  };
  establishment: null | {
    markerEligible: boolean; reason: string; physicalMarkerType: string;
    publicEstablishmentExists: boolean; publicCoordinatesValid: boolean;
  };
  discovery: {
    directoryCallableCanResolveOrganizationById: boolean;
    directoryQueryCanLocateOrganizationName: boolean;
    publicProjectionPassesFinalSanitizer: boolean;
  };
};

const getManagement = httpsCallable<{ organizationId: string }, ManagementModel>(functions, "exchange_getOrganizationManagement");
const getPublicationDiagnostic = httpsCallable<{ organizationId: string; establishmentId?: string }, PublicationDiagnostic>(functions, "exchange_getOrganizationPublicationDiagnostic");
const updateProfile = httpsCallable<Record<string, unknown>, { recordVersion: number }>(functions, "exchange_updateOrganizationProfile");
const searchGeocodes = httpsCallable<Record<string, unknown>, { requestId: string; candidates: GeocodeCandidate[] }>(functions, "exchange_searchOrganizationGeocodes");
const upsertLocation = httpsCallable<Record<string, unknown>, { locationId: string; recordVersion: number }>(functions, "exchange_upsertOrganizationEstablishment");
const upsertContact = httpsCallable<Record<string, unknown>, { contactPointId: string; recordVersion: number }>(functions, "exchange_upsertOrganizationContactPoint");
const upsertRoute = httpsCallable<Record<string, unknown>, { routeId: string; recordVersion: number }>(functions, "exchange_upsertOrganizationCommunicationRoute");
const reviewEnrichmentProposal = httpsCallable<Record<string, unknown>, { resultId: string | null; proposalStatus: string }>(functions, "exchange_reviewOrganizationEnrichmentProposal");
const recordActivationProgress = httpsCallable<Record<string, unknown>, { success: true }>(functions, "exchange_recordBusinessActivationProgress");
const purchaseSeats = httpsCallable<{ orgId: string; seats: number }, { success: boolean }>(functions, "org_purchaseSeats");

const fieldClass = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200";
const labelClass = "block text-sm font-semibold text-slate-700";

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function cleanCallablePayload(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export default function OrgSettingsPage() {
  return <RequireAuth><Suspense fallback={<Loading />}><OrgSettingsContent /></Suspense></RequireAuth>;
}

function Loading() {
  return <AppShell><div className="flex items-center justify-center py-24" role="status"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /><span className="sr-only">Loading organization settings</span></div></AppShell>;
}

function OrgSettingsContent() {
  const search = useSearchParams();
  const organizationId = search.get("id") ?? "";
  const requestedTab = search.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(requestedTab && ["enrichment", "profile", "establishments", "contact", "members", "seats"].includes(requestedTab) ? requestedTab : "profile");
  const [model, setModel] = useState<ManagementModel | null>(null);
  const [visibilityDiagnostic, setVisibilityDiagnostic] = useState<PublicationDiagnostic | null>(null);
  const [members, setMembers] = useState<OrgMemberDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!organizationId) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const [management, organizationMembers] = await Promise.all([
        getManagement({ organizationId }), getOrgMembers(organizationId),
      ]);
      const establishmentId = management.data.preferredOrientationEstablishmentId
        ?? management.data.organization.primaryLocationId
        ?? management.data.organization.headquartersLocationId
        ?? undefined;
      const diagnostic = await getPublicationDiagnostic({ organizationId, establishmentId })
        .then((result) => result.data)
        .catch(() => null);
      setModel(management.data); setMembers(organizationMembers); setVisibilityDiagnostic(diagnostic);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Organization settings are unavailable.");
    } finally { setLoading(false); }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(""); setNotice("");
    try { await operation(); setNotice(success); await load(); }
    catch (value) { setError(value instanceof Error ? value.message : "The change could not be saved."); }
    finally { setBusy(false); }
  };

  if (loading) return <Loading />;
  if (!model) return <AppShell><div className="mx-auto max-w-3xl py-20 text-center"><Building2 className="mx-auto h-12 w-12 text-slate-300" /><h1 className="mt-4 text-xl font-bold">Organization settings unavailable</h1><p className="mt-2 text-sm text-slate-600">{error || "Add an organization ID and confirm active owner or administrator authority."}</p></div></AppShell>;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "enrichment", label: "1. Enrichment" }, { id: "profile", label: "2. Profile" }, { id: "establishments", label: "3. Establishments" },
    { id: "contact", label: "Contact & Routing" }, { id: "members", label: "Members" }, { id: "seats", label: "Seats" },
  ];

  return <AppShell><main className="mx-auto w-full max-w-5xl px-3 pb-16 sm:px-6">
    <Link href={`/org/dashboard?id=${organizationId}`} className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Dashboard</Link>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-2xl font-black text-slate-950"><Building2 className="h-7 w-7" />{model.organization.legalName}</h1><p className="mt-1 text-sm text-slate-600">Organization-owned identity, establishments, contacts, and private communication routes.</p></div>
      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{model.organization.publicationStatus}</span>
    </div>
    {error && <div ref={errorRef} tabIndex={-1} role="alert" className="mb-5 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-900"><p>Review this error:</p><p className="mt-1 font-normal">{error}</p></div>}
    {notice && <div role="status" className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900"><Check className="h-4 w-4" />{notice}</div>}
    <ExchangeVisibilityStatus diagnostic={visibilityDiagnostic} onRefresh={load} busy={loading || busy} />
    <div role="tablist" aria-label="Organization settings" className="mb-7 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
      {tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold ${tab === item.id ? "bg-white text-slate-950 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{item.label}</button>)}
    </div>
    {tab === "enrichment" && <div className="space-y-5"><EnrichmentProposalPanel organizationId={organizationId} proposals={model.enrichmentProposals ?? []} locations={model.locations} busy={busy} run={run} /><button type="button" disabled={busy} onClick={() => void run(() => recordActivationProgress({ action: "enrichment_reviewed", organizationId }), "Enrichment review completed. Continue to Organization Profile.")} className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Complete enrichment review</button></div>}
    {tab === "profile" && <OrganizationProfileForm organization={model.organization} busy={busy} onSave={(payload) => run(() => updateProfile(cleanCallablePayload({ organizationId, expectedRecordVersion: model.organization.recordVersion, ...payload })), "Organization profile saved. Continue to Establishments.")} />}
    {tab === "establishments" && <EstablishmentsPanel organizationId={organizationId} organizationPublished={model.organization.publicationStatus === "approved"} locations={model.locations} preferredOrientationEstablishmentId={model.preferredOrientationEstablishmentId} busy={busy} run={run} />}
    {tab === "contact" && <ContactRoutingPanel organizationId={organizationId} locations={model.locations} contacts={model.contactPoints} routes={model.communicationRoutes} preferredOrientationEstablishmentId={model.preferredOrientationEstablishmentId} busy={busy} run={run} />}
    {tab === "members" && <MembersPanel members={members} />}
    {tab === "seats" && <SeatsPanel organizationId={organizationId} busy={busy} run={run} />}
  </main></AppShell>;
}



function ExchangeVisibilityStatus({ diagnostic, onRefresh, busy }: { diagnostic: PublicationDiagnostic | null; onRefresh(): Promise<void>; busy: boolean }) {
  const directoryActive = diagnostic?.organization.eligibleForPublicDirectory === true;
  const markerActive = diagnostic?.establishment?.markerEligible === true;
  const heading = !diagnostic ? "Server visibility not confirmed"
    : directoryActive && markerActive ? "Public directory and marker active"
      : directoryActive ? "Public directory active; marker not published"
        : "Not publicly discoverable";
  const detail = !diagnostic ? "Refresh to request the server-authoritative publication diagnostic."
    : !directoryActive ? diagnostic.organization.reason
      : diagnostic.establishment ? diagnostic.establishment.reason
        : "The organization is searchable; no establishment was selected for marker validation.";
  return <section aria-labelledby="exchange-visibility-heading" className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Exchange visibility status</p><h2 id="exchange-visibility-heading" className="mt-1 text-base font-black text-slate-950">{heading}</h2><p className="mt-1 max-w-3xl text-sm text-slate-600">{detail}</p></div>
      <button type="button" disabled={busy} onClick={() => void onRefresh()} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Refresh status</button>
    </div>
    {diagnostic && <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
      <div className="rounded-lg bg-slate-50 p-3"><dt className="font-bold text-slate-500">Directory projection</dt><dd className="mt-1 font-semibold text-slate-900">{diagnostic.discovery.publicProjectionPassesFinalSanitizer ? "Verified" : "Not verified"}</dd></div>
      <div className="rounded-lg bg-slate-50 p-3"><dt className="font-bold text-slate-500">Name search</dt><dd className="mt-1 font-semibold text-slate-900">{diagnostic.discovery.directoryQueryCanLocateOrganizationName ? "Discoverable" : "Not discoverable"}</dd></div>
      <div className="rounded-lg bg-slate-50 p-3"><dt className="font-bold text-slate-500">Marker projection</dt><dd className="mt-1 font-semibold text-slate-900">{markerActive ? "Verified" : "Not active"}</dd></div>
    </dl>}
  </section>;
}

function OrganizationProfileForm({ organization, busy, onSave }: { organization: OrganizationModel; busy: boolean; onSave(payload: Record<string, unknown>): Promise<void> }) {
  const [legalName, setLegalName] = useState(organization.legalName); const [website, setWebsite] = useState(organization.website);
  const [description, setDescription] = useState(organization.description); const [domain, setDomain] = useState(organization.domain);
  const [tradeNames, setTradeNames] = useState(organization.tradeNames.join(", ")); const [industries, setIndustries] = useState(organization.industries.join(", "));
  const [capabilities, setCapabilities] = useState(organization.capabilities.join(", ")); const [certifications, setCertifications] = useState(organization.certifications.join(", "));
  const [uei, setUei] = useState(organization.identifiers.uei ?? ""); const [cage, setCage] = useState(organization.identifiers.cage ?? ""); const [duns, setDuns] = useState(organization.identifiers.duns ?? "");
  const [publicationStatus, setPublicationStatus] = useState(organization.publicationStatus);
  return <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void onSave({ legalName, description: description || undefined, domain: domain || undefined, website: website || undefined, tradeNames: splitList(tradeNames), identifiers: { ...organization.identifiers, ...(uei ? { uei } : {}), ...(cage ? { cage } : {}), ...(duns ? { duns } : {}) }, industries: splitList(industries), capabilities: splitList(capabilities), certifications: splitList(certifications), media: organization.media, documents: organization.documents, publicationStatus }); }}>
    <Section title="Organization profile" description="Business identity belongs here. Personal contact preferences remain in your person profile.">
      <Field label="Legal name" required value={legalName} onChange={setLegalName} />
      <Field label="Trade names" hint="Comma-separated" value={tradeNames} onChange={setTradeNames} />
      <TextArea label="Description" value={description} onChange={setDescription} />
      <Field label="Domain" value={domain} onChange={setDomain} />
      <Field label="Website" type="url" value={website} onChange={setWebsite} />
      <div className="grid gap-4 sm:grid-cols-3"><Field label="UEI" value={uei} onChange={setUei} /><Field label="CAGE" value={cage} onChange={setCage} /><Field label="DUNS (compatibility)" value={duns} onChange={setDuns} /></div>
      <Field label="Industries" hint="Comma-separated" value={industries} onChange={setIndustries} />
      <Field label="Capabilities" hint="Comma-separated" value={capabilities} onChange={setCapabilities} />
      <Field label="Certifications" hint="Comma-separated" value={certifications} onChange={setCertifications} />
      <div className="rounded-xl border border-slate-200 p-3 text-sm text-slate-700"><p className="font-bold">Organization media and documents</p><p className="mt-1">{organization.media.length} media item(s) · {organization.documents.length} document(s). Publication metadata remains organization-owned; uploads continue through the existing protected storage workflow.</p></div>
      <label className={labelClass}>Directory publication<select className={fieldClass} value={publicationStatus} onChange={(event) => setPublicationStatus(event.target.value as typeof publicationStatus)}><option value="draft">Private draft</option><option value="approved">Approved for directory</option><option value="suppressed">Suppressed</option></select></label>
    </Section>
    <SaveButton busy={busy} label="Save organization profile" />
  </form>;
}

function EstablishmentsPanel({ organizationId, organizationPublished, locations, preferredOrientationEstablishmentId, busy, run }: { organizationId: string; organizationPublished: boolean; locations: OrganizationEstablishment[]; preferredOrientationEstablishmentId: string | null; busy: boolean; run(operation: () => Promise<unknown>, success: string): Promise<void> }) {
  const [editing, setEditing] = useState<OrganizationEstablishment | null>(null);
  return <div className="space-y-6"><Section title="Establishments" description="One firm may have multiple physical locations. Exactly one active establishment is primary; headquarters is explicit.">
    {locations.length ? <ul className="grid gap-3">{locations.map((location) => <li key={location.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold text-slate-950">{location.name}</p><p className="text-sm text-slate-600">{location.locationType.replaceAll("_", " ")} · {location.status}</p><div className="mt-2 flex flex-wrap gap-2">{location.isPrimary && <Badge>Primary</Badge>}{location.isHeadquarters && <Badge>Headquarters</Badge>}{location.id === preferredOrientationEstablishmentId && <Badge>Exchange orientation</Badge>}<Badge>{location.addressPublicationApproved ? "Address public" : "Address private"}</Badge><Badge>{location.coordinatePublicationApproved && organizationPublished ? "Marker public" : "Marker private"}</Badge></div></div><button type="button" onClick={() => setEditing(location)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Edit</button></div></li>)}</ul> : <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-950">No establishment yet. Add the primary or headquarters location to complete onboarding.</p>}
    <button type="button" onClick={() => setEditing(null)} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white"><Plus className="h-4 w-4" />Add establishment</button>
  </Section><EstablishmentForm key={editing?.id ?? `new-${locations.length}`} organizationId={organizationId} organizationPublished={organizationPublished} location={editing} preferredOrientation={editing?.id === preferredOrientationEstablishmentId} hasActiveLocations={locations.some((item) => item.status === "active" && item.id !== editing?.id)} busy={busy} run={run} /></div>;
}

function EstablishmentForm({ organizationId, organizationPublished, location, preferredOrientation: initialPreferredOrientation, hasActiveLocations, busy, run }: { organizationId: string; organizationPublished: boolean; location: OrganizationEstablishment | null; preferredOrientation: boolean; hasActiveLocations: boolean; busy: boolean; run(operation: () => Promise<unknown>, success: string): Promise<void> }) {
  const address = location?.physicalAddress;
  const [name, setName] = useState(location?.name ?? "Headquarters"); const [type, setType] = useState(location?.locationType ?? "headquarters");
  const [line1, setLine1] = useState(address?.line1 ?? ""); const [line2, setLine2] = useState(address?.line2 ?? "");
  const [city, setCity] = useState(address?.locality ?? ""); const [region, setRegion] = useState(address?.administrativeArea ?? "VA"); const [postalCode, setPostalCode] = useState(address?.postalCode ?? "");
  const [countryCode, setCountryCode] = useState(address?.countryCode ?? "US"); const [county, setCounty] = useState(address?.county ?? "");
  const [isPrimary, setPrimary] = useState(location?.isPrimary ?? !hasActiveLocations); const [isHeadquarters, setHeadquarters] = useState(location?.isHeadquarters ?? !hasActiveLocations);
  const [addressPublic, setAddressPublic] = useState(location?.addressPublicationApproved ?? false); const [coordinatePublic, setCoordinatePublic] = useState(location?.coordinatePublicationApproved ?? false);
  const [privateHome, setPrivateHome] = useState(location?.privateHome ?? false); const [geocodeRequestId, setGeocodeRequestId] = useState("");
  const [preferredOrientation, setPreferredOrientation] = useState(initialPreferredOrientation || !hasActiveLocations);
  const [markerState, setMarkerState] = useState("");
  const [publicMarkerState, setPublicMarkerState] = useState("");
  const [savedLocationId, setSavedLocationId] = useState(location?.id ?? "");
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]); const [candidateId, setCandidateId] = useState(""); const [searching, setSearching] = useState(false);
  const locationTypeExcludesMarker = type === "mailing_only" || type === "virtual";
  const addressEntered = type !== "virtual" && Boolean(line1.trim() && city.trim() && region.trim());
  const publicMarkerActive = ["public_visible", "private_and_public_visible"].includes(publicMarkerState);
  const physicalAddress = type === "virtual" ? undefined : { line1, line2: line2 || undefined, locality: city, administrativeArea: region, postalCode: postalCode || undefined, countryCode, county: county || undefined };
  const searchAddress = async () => { setSearching(true); try { const result = await searchGeocodes(cleanCallablePayload({ organizationId, address: physicalAddress })); setGeocodeRequestId(result.data.requestId); setCandidates(result.data.candidates); setCandidateId(result.data.candidates[0]?.id ?? ""); } finally { setSearching(false); } };
  const selected = candidates.find((candidate) => candidate.id === candidateId);
  return <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void run(async () => { const response = await upsertLocation(cleanCallablePayload({
    organizationId, locationId: location?.id, expectedRecordVersion: location?.recordVersion,
    name, locationType: type, isHeadquarters, isPrimary, status: "active", physicalAddress,
    addressPublicationApproved: privateHome ? false : addressPublic,
    coordinatePublicationApproved: privateHome || locationTypeExcludesMarker ? false : coordinatePublic,
    publicContactAvailable: false, privateHome, preferredOrientation,
    serviceArea: { city, county: county || undefined, region, countryCode },
    ...(selected ? { geocodeSelection: { requestId: geocodeRequestId, candidateId: selected.id } } : {}),
  })); const data = response.data as { locationId: string; markerState?: string; publicMarkerState?: string }; setSavedLocationId(data.locationId); setMarkerState(data.markerState ?? ""); setPublicMarkerState(data.publicMarkerState ?? ""); return response; }, location ? "Establishment updated." : "Establishment added."); }}>
    <Section title={location ? `Edit ${location.name}` : "New establishment"} description="Confirm a standardized result before saving a new map coordinate. Geocoding never grants publication approval.">
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Location label" required value={name} onChange={setName} /><label className={labelClass}>Location type<select className={fieldClass} value={type} onChange={(event) => { const value = event.target.value as typeof type; setType(value); if (value === "mailing_only" || value === "virtual") setCoordinatePublic(false); }}><option value="headquarters">Headquarters</option><option value="branch">Branch</option><option value="office">Office</option><option value="retail">Retail</option><option value="production">Production</option><option value="warehouse">Warehouse</option><option value="service_location">Service location</option><option value="coworking">Coworking</option><option value="virtual">Virtual</option><option value="mailing_only">Mailing only</option><option value="other">Other</option></select></label></div>
      {type !== "virtual" && <div className="grid gap-4 sm:grid-cols-2"><Field label="Address line 1" required value={line1} onChange={setLine1} /><Field label="Address line 2" value={line2} onChange={setLine2} /><Field label="City" required value={city} onChange={setCity} /><Field label="State / region" required value={region} onChange={setRegion} /><Field label="Postal code" value={postalCode} onChange={setPostalCode} /><Field label="County" value={county} onChange={setCounty} /><Field label="Country code" required value={countryCode} onChange={(value) => setCountryCode(value.toUpperCase())} /></div>}
      {!locationTypeExcludesMarker && <div><button type="button" disabled={searching || !line1 || !city || !region} onClick={() => void searchAddress()} className="inline-flex items-center gap-2 rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-900 disabled:opacity-50"><MapPin className="h-4 w-4" />{searching ? "Searching…" : "Search standardized addresses"}</button>{candidates.length > 0 && <fieldset className="mt-4"><legend className="text-sm font-bold">Choose and confirm a result</legend><div className="mt-2 grid gap-2">{candidates.map((candidate) => <label key={candidate.id} className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 focus-within:ring-2 focus-within:ring-blue-500"><input type="radio" name="geocode" checked={candidateId === candidate.id} onChange={() => setCandidateId(candidate.id)} /><span><span className="block text-sm font-semibold">{candidate.normalizedAddress}</span><span className="block text-xs text-slate-600">{candidate.precision} · {candidate.confidence} confidence · {candidate.attribution}</span></span></label>)}</div></fieldset>}{selected && <div role="img" aria-label={`Map coordinate preview at latitude ${selected.latitude} and longitude ${selected.longitude}`} className="relative mt-3 h-36 overflow-hidden rounded-xl border border-slate-300 bg-[radial-gradient(circle_at_center,_#dbeafe_0_5px,_#e2e8f0_6px_100%)]"><MapPin className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-full text-blue-700" /><span className="absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-xs font-semibold">{selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</span></div>}</div>}
      <fieldset><legend className="text-sm font-bold text-slate-800">Role and privacy</legend><div className="mt-2 grid gap-2"><CheckRow checked={isPrimary} onChange={setPrimary} label="Primary active establishment" /><CheckRow checked={isHeadquarters} onChange={setHeadquarters} label="Headquarters" /><CheckRow checked={preferredOrientation} disabled={locationTypeExcludesMarker} onChange={setPreferredOrientation} label="Use this establishment for Exchange orientation" /><CheckRow checked={privateHome} onChange={(value) => { setPrivateHome(value); if (value) { setAddressPublic(false); setCoordinatePublic(false); } }} label="Private home location (always suppress precise public data)" /><CheckRow checked={addressPublic} disabled={privateHome} onChange={setAddressPublic} label="Publish street address" /><CheckRow checked={coordinatePublic} disabled={privateHome || locationTypeExcludesMarker} onChange={setCoordinatePublic} label="Publish exact map coordinate" /></div></fieldset>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm"><p className="font-bold">Public marker checklist</p><ul className="mt-2 grid gap-1 text-slate-700"><li>{organizationPublished ? "✓" : "○"} Organization approved for directory {!organizationPublished && <Link className="ml-1 font-bold text-blue-700 underline" href={`/org/settings?id=${encodeURIComponent(organizationId)}&tab=profile`}>Review profile publication</Link>}</li><li>✓ Establishment active</li><li>{addressEntered ? "✓" : "○"} Address entered</li><li>{selected || location?.geocode?.confirmedAt ? "✓" : "○"} Location confirmed</li><li>{coordinatePublic ? "✓" : "○"} Coordinate publication approved</li><li>{publicMarkerActive ? "✓" : "○"} Public marker active</li></ul></div>
      {markerState ? <div role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"><p className="font-black uppercase">{markerState.replaceAll("_", " ")}</p><p className="mt-1">{markerState.includes("private") ? "Your organization can see this confirmed location on the Exchange. Public visibility remains a separate decision." : markerState.includes("public") ? "This establishment is available as a public company marker." : "Review the checklist above to resolve this marker state."}</p></div> : null}
      {publicMarkerState && publicMarkerState !== markerState ? <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">Public marker: {publicMarkerState.replaceAll("_", " ")}. Use the checklist above for the direct next action.</p> : null}
      {savedLocationId && (selected || location?.geocode) ? <Link href={`/exchange?actorOrg=${encodeURIComponent(organizationId)}&subjectOrg=${encodeURIComponent(organizationId)}&secondaryEntity=establishment&secondarySelected=${encodeURIComponent(savedLocationId)}&drawer=organization&lng=${selected?.longitude ?? location?.geocode?.longitude}&lat=${selected?.latitude ?? location?.geocode?.latitude}&z=16.5&p=55&b=-20`} className="inline-flex rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white">View this establishment in the Exchange</Link> : null}
    </Section><SaveButton busy={busy} label={location ? "Save establishment" : "Add establishment"} />
  </form>;
}

function ContactRoutingPanel({ organizationId, locations, contacts, routes, preferredOrientationEstablishmentId, busy, run }: { organizationId: string; locations: OrganizationEstablishment[]; contacts: OrganizationContactPoint[]; routes: OrganizationCommunicationRoute[]; preferredOrientationEstablishmentId: string | null; busy: boolean; run(operation: () => Promise<unknown>, success: string): Promise<void> }) {
  const [type, setType] = useState<"email" | "phone" | "website" | "contact_form">("email"); const [value, setValue] = useState("");
  const [purpose, setPurpose] = useState<OrganizationContactPoint["purposes"][number]>("general"); const [visibility, setVisibility] = useState<OrganizationContactPoint["visibility"]>("private_operational"); const [locationId, setLocationId] = useState("");
  const [editingContactId, setEditingContactId] = useState("");
  const [routePurpose, setRoutePurpose] = useState<OrganizationCommunicationRoute["purpose"]>("referrals"); const [routeContactId, setRouteContactId] = useState(contacts.find((item) => item.status === "active")?.id ?? ""); const [routeLocationId, setRouteLocationId] = useState("");
  const [editingRouteId, setEditingRouteId] = useState("");
  const editingContact = contacts.find((item) => item.id === editingContactId);
  const editingRoute = routes.find((item) => item.id === editingRouteId);
  const eligibleActivationLocations = locations.filter((item) => (
    item.status === "active"
    && item.privateHome !== true
    && item.locationType !== "mailing_only"
    && item.locationType !== "virtual"
    && item.geocode?.confirmedAt
  ));
  const activationLocation = eligibleActivationLocations.find((item) => item.id === preferredOrientationEstablishmentId)
    ?? eligibleActivationLocations.find((item) => item.isHeadquarters)
    ?? eligibleActivationLocations.find((item) => item.isPrimary)
    ?? eligibleActivationLocations[0];
  const hasReferralRoute = routes.some((item) => item.status === "active" && item.purpose === "referrals");
  const hasOpportunityRoute = routes.some((item) => item.status === "active" && item.purpose === "opportunities");
  const activationReady = Boolean(activationLocation && contacts.some((item) => item.status === "active") && hasReferralRoute && hasOpportunityRoute);
  const editContact = (contact: OrganizationContactPoint) => {
    if (contact.type === "member_route") return;
    setEditingContactId(contact.id); setType(contact.type); setValue(contact.displayValue ?? contact.normalizedValue);
    setPurpose(contact.purposes[0] ?? "general"); setVisibility(contact.visibility); setLocationId(contact.locationId ?? "");
  };
  const editRoute = (route: OrganizationCommunicationRoute) => {
    setEditingRouteId(route.id); setRoutePurpose(route.purpose); setRouteContactId(route.primaryContactPointIds[0] ?? ""); setRouteLocationId(route.locationId ?? "");
  };
  return <div className="space-y-6"><Section title="Contact points" description="Reachability and public disclosure are separate. Private operational values never appear in external route responses.">
    {contacts.length ? <ul className="mb-5 grid gap-2">{contacts.map((contact) => <li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3"><span className="text-sm"><strong>{contact.displayValue}</strong><span className="ml-2 text-slate-600">{contact.purposes.join(", ")}</span></span><span className="flex items-center gap-2"><Badge>{contact.visibility.replaceAll("_", " ")}</Badge>{contact.type !== "member_route" && <button type="button" onClick={() => editContact(contact)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Edit</button>}</span></li>)}</ul> : <p className="mb-4 text-sm text-slate-600">No organization contact points yet.</p>}
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => upsertContact(cleanCallablePayload({ organizationId, contactPointId: editingContact?.id, expectedRecordVersion: editingContact?.recordVersion, locationId: locationId || undefined, type, purposes: [purpose], value, displayValue: value, verificationStatus: editingContact?.verificationStatus ?? "unverified", visibility, publicationStatus: visibility === "public" ? "approved" : "draft", consentAuthorityBasis: "organization_owner_or_admin_entry", status: "active" })), editingContact ? "Contact point updated." : "Contact point added."); }}><label className={labelClass}>Contact type<select className={fieldClass} value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="email">Email</option><option value="phone">Telephone</option><option value="website">Website</option><option value="contact_form">Contact form</option></select></label><Field label="Contact value" required value={value} onChange={setValue} type={type === "email" ? "email" : type === "phone" ? "tel" : "text"} /><PurposeSelect label="Purpose" value={purpose} onChange={setPurpose} /><label className={labelClass}>Visibility<select className={fieldClass} value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="private_operational">Private operational</option><option value="organization_members">Organization members</option><option value="relationship_safe">Relationship-safe relay</option><option value="public">Public</option></select></label><LocationSelect locations={locations} value={locationId} onChange={setLocationId} /><div className="flex items-end gap-2"><SaveButton busy={busy} label={editingContact ? "Save contact" : "Add contact"} />{editingContact && <button type="button" onClick={() => { setEditingContactId(""); setValue(""); }} className="min-h-10 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold">Cancel</button>}</div></form>
  </Section><Section title="Communication routes" description="Referral, opportunity, general, and billing traffic resolves server-side through purpose-specific routes and safe fallbacks.">
    {routes.length > 0 && <ul className="mb-5 grid gap-2">{routes.map((route) => <li key={route.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 text-sm"><span><strong>{route.purpose.replaceAll("_", " ")}</strong><span className="ml-2 text-slate-600">{route.locationId ? "location-specific" : "organization default"} · {[route.inAppEnabled && "in-app", route.emailEnabled && "email", route.phoneEnabled && "phone"].filter(Boolean).join(", ")}</span></span><button type="button" onClick={() => editRoute(route)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-bold">Edit</button></li>)}</ul>}
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void run(() => upsertRoute(cleanCallablePayload({ organizationId, routeId: editingRoute?.id, expectedRecordVersion: editingRoute?.recordVersion, locationId: routeLocationId || undefined, purpose: routePurpose, primaryContactPointIds: routeContactId ? [routeContactId] : [], fallbackContactPointIds: [], fallbackMemberRoles: routePurpose === "referrals" ? ["referral_manager", "owner", "admin"] : routePurpose === "opportunities" ? ["response_team", "owner", "admin"] : ["owner", "admin"], inAppEnabled: true, emailEnabled: contacts.find((item) => item.id === routeContactId)?.type === "email", phoneEnabled: contacts.find((item) => item.id === routeContactId)?.type === "phone", status: "active" })), "Communication route saved."); }}><PurposeSelect label="Route purpose" value={routePurpose} onChange={setRoutePurpose} /><label className={labelClass}>Primary contact<select className={fieldClass} value={routeContactId} onChange={(event) => setRouteContactId(event.target.value)}><option value="">In-app member fallback</option>{contacts.filter((item) => item.status === "active").map((contact) => <option key={contact.id} value={contact.id}>{contact.displayValue}</option>)}</select></label><LocationSelect locations={locations} value={routeLocationId} onChange={setRouteLocationId} /><div className="flex items-end gap-2"><SaveButton busy={busy} label={editingRoute ? "Save route" : "Add route"} icon="route" />{editingRoute && <button type="button" onClick={() => setEditingRouteId("")} className="min-h-10 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold">Cancel</button>}</div></form>
    <p className="mt-4 flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-xs text-blue-950"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />Billing routes remain private. External senders receive delivery state and an audit ID, never the destination email or telephone.</p>
  </Section>
  <Section title="Complete business activation" description="A contact point plus referral and opportunity routes are required before the first organization-home map activation. Private operational destinations remain hidden from external users.">
    <ul className="grid gap-1 text-sm text-slate-700">
      <li>{contacts.some((item) => item.status === "active") ? "✓" : "○"} Organization contact point configured</li>
      <li>{hasReferralRoute ? "✓" : "○"} Referral route configured</li>
      <li>{hasOpportunityRoute ? "✓" : "○"} Opportunity route configured</li>
      <li>{activationLocation ? "✓" : "○"} Confirmed orientation establishment available</li>
    </ul>
    {activationReady && activationLocation?.geocode ? (
      <Link
        href={`/exchange?actorOrg=${encodeURIComponent(organizationId)}&subjectOrg=${encodeURIComponent(organizationId)}&secondaryEntity=establishment&secondarySelected=${encodeURIComponent(activationLocation.id)}&drawer=organization&lng=${activationLocation.geocode.longitude}&lat=${activationLocation.geocode.latitude}&z=16.5&p=55&b=-20`}
        className="mt-4 inline-flex rounded-xl bg-blue-700 px-4 py-3 text-sm font-bold text-white"
      >
        Complete onboarding in the Exchange
      </Link>
    ) : (
      <p className="mt-3 text-sm font-semibold text-amber-800">Complete the unchecked requirements to activate the organization map view.</p>
    )}
  </Section></div>;
}

function EnrichmentProposalPanel({ organizationId, proposals, locations, busy, run }: { organizationId: string; proposals: EnrichmentProposal[]; locations: OrganizationEstablishment[]; busy: boolean; run(operation: () => Promise<unknown>, success: string): Promise<void> }) {
  return <Section title="Enrichment proposals" description="External addresses and contacts remain proposals until you classify each item. Review never changes the authoritative organization name, primary location, owner-entered contacts, or publication settings silently.">
    {proposals.length === 0 ? <p className="text-sm text-slate-600">No external address or contact proposals await review.</p> : <div className="grid gap-5">{proposals.map((proposal) => <article key={proposal.id} className="rounded-xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-slate-950">{proposal.provider} proposal</p><Badge>{proposal.status.replaceAll("_", " ")}</Badge></div><p className="mt-1 text-xs text-slate-500">Proposal {proposal.id}</p><div className="mt-4 grid gap-4">{proposal.proposedAddresses.map((item) => <EnrichmentAddressReview key={item.id} organizationId={organizationId} proposal={proposal} item={item} busy={busy} run={run} />)}{proposal.proposedContacts.map((item) => <EnrichmentContactReview key={item.id} organizationId={organizationId} proposal={proposal} item={item} locations={locations} busy={busy} run={run} />)}</div></article>)}</div>}
  </Section>;
}

function EnrichmentAddressReview({ organizationId, proposal, item, busy, run }: { organizationId: string; proposal: EnrichmentProposal; item: EnrichmentProposal["proposedAddresses"][number]; busy: boolean; run(operation: () => Promise<unknown>, success: string): Promise<void> }) {
  const [classification, setClassification] = useState("branch"); const [label, setLabel] = useState("Proposed branch");
  const [makePrimary, setMakePrimary] = useState(false); const [addressPublic, setAddressPublic] = useState(false); const [coordinatePublic, setCoordinatePublic] = useState(false);
  const decision = proposal.decisions[`address:${item.id}`];
  const address = [item.address.line1, item.address.line2, item.address.locality, item.address.administrativeArea, item.address.postalCode, item.address.countryCode].filter(Boolean).join(", ");
  if (decision) return <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold">{address}</p><p className="mt-1 text-slate-600">Decision: {decision.classification?.replaceAll("_", " ")}</p></div>;
  return <form className="rounded-lg border border-slate-200 p-3" onSubmit={(event) => { event.preventDefault(); void run(() => reviewEnrichmentProposal(cleanCallablePayload({ organizationId, proposalId: proposal.id, itemType: "address", itemId: item.id, classification, label: label || undefined, makePrimary, addressPublicationApproved: addressPublic, coordinatePublicationApproved: coordinatePublic })), "Enrichment address decision recorded."); }}><p className="text-sm font-semibold text-slate-950">{address}</p><p className="mt-1 text-xs text-slate-600">Provider coordinates: {item.geocode ? "available for explicit review" : "not supplied"}. Nothing is public yet.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className={labelClass}>Address classification<select aria-label={`Classify proposed address ${item.id}`} className={fieldClass} value={classification} onChange={(event) => { const next = event.target.value; setClassification(next); if (["mailing_only", "private_home", "historical", "duplicate", "not_associated", "unresolved"].includes(next)) { setMakePrimary(false); setCoordinatePublic(false); } if (next === "private_home") setAddressPublic(false); }}><option value="headquarters">Headquarters</option><option value="branch">Branch</option><option value="mailing_only">Mailing only</option><option value="historical">Historical</option><option value="private_home">Private home</option><option value="duplicate">Duplicate</option><option value="not_associated">Not associated</option><option value="unresolved">Unresolved</option></select></label><Field label="Location label" value={label} onChange={setLabel} /><CheckRow checked={makePrimary} disabled={["mailing_only", "historical", "duplicate", "not_associated", "unresolved"].includes(classification)} onChange={setMakePrimary} label="Explicitly make this the primary establishment" /><CheckRow checked={addressPublic} disabled={classification === "private_home"} onChange={setAddressPublic} label="Approve street-address publication" /><CheckRow checked={coordinatePublic} disabled={!item.geocode || ["mailing_only", "private_home", "historical", "duplicate", "not_associated", "unresolved"].includes(classification)} onChange={setCoordinatePublic} label="Approve exact-coordinate publication" /></div><div className="mt-3"><SaveButton busy={busy} label="Record address decision" /></div></form>;
}

function EnrichmentContactReview({ organizationId, proposal, item, locations, busy, run }: { organizationId: string; proposal: EnrichmentProposal; item: EnrichmentProposal["proposedContacts"][number]; locations: OrganizationEstablishment[]; busy: boolean; run(operation: () => Promise<unknown>, success: string): Promise<void> }) {
  const [classification, setClassification] = useState("private_operational"); const [locationId, setLocationId] = useState("");
  const decision = proposal.decisions[`contact:${item.id}`];
  if (decision) return <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-semibold">{item.label ? `${item.label}: ` : ""}{item.value}</p><p className="mt-1 text-slate-600">Decision: {decision.classification?.replaceAll("_", " ")}</p></div>;
  return <form className="rounded-lg border border-slate-200 p-3" onSubmit={(event) => { event.preventDefault(); void run(() => reviewEnrichmentProposal({ organizationId, proposalId: proposal.id, itemType: "contact", itemId: item.id, classification, ...(classification === "location_specific" && locationId ? { locationId } : {}) }), "Enrichment contact decision recorded."); }}><p className="text-sm font-semibold text-slate-950">{item.label ? `${item.label}: ` : ""}{item.value}</p><p className="mt-1 text-xs text-slate-600">Proposed {item.type}; private unless you explicitly classify it as public.</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className={labelClass}>Contact classification<select aria-label={`Classify proposed contact ${item.id}`} className={fieldClass} value={classification} onChange={(event) => setClassification(event.target.value)}><option value="organization_general">Organization general</option><option value="referral_intake">Referral intake</option><option value="procurement">Procurement / opportunity</option><option value="location_specific">Location-specific</option><option value="private_operational">Private operational</option><option value="public">Public (explicit approval)</option><option value="historical">Historical</option><option value="incorrect">Incorrect</option></select></label>{classification === "location_specific" && <LocationSelect locations={locations} value={locationId} onChange={setLocationId} />}</div><div className="mt-3"><SaveButton busy={busy} label="Record contact decision" /></div></form>;
}

function MembersPanel({ members }: { members: OrgMemberDoc[] }) {
  return <Section title="Members" description="Only exact-active members have organization authority. Removed and inactive memberships lose private access immediately."><ul className="grid gap-2">{members.map((member) => <li key={member.id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-sm"><span className="font-mono text-xs">{member.uid}</span><span><Badge>{member.role}</Badge><span className="ml-2 text-slate-600">{member.status}</span></span></li>)}</ul><p className="mt-4 text-xs text-slate-500">Membership lifecycle changes remain server-authoritative through the existing organization administration workflow.</p></Section>;
}

function SeatsPanel({ organizationId, busy, run }: { organizationId: string; busy: boolean; run(operation: () => Promise<unknown>, success: string): Promise<void> }) {
  const [seats, setSeats] = useState("5");
  return <form onSubmit={(event) => { event.preventDefault(); void run(() => purchaseSeats({ orgId: organizationId, seats: Math.max(1, Number.parseInt(seats, 10) || 1) }), "Seat purchase request completed."); }}><Section title="Seats" description="Seat purchasing remains separate from Exchange organization contact routing."><Field label="Seat quantity" type="number" required value={seats} onChange={setSeats} /></Section><div className="mt-5"><SaveButton busy={busy} label="Purchase seats" /></div></form>;
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><h2 className="text-lg font-black text-slate-950">{title}</h2><p className="mb-5 mt-1 text-sm text-slate-600">{description}</p><div className="space-y-4">{children}</div></section>;
}
function Field({ label, hint, value, onChange, required, type = "text" }: { label: string; hint?: string; value: string; onChange(value: string): void; required?: boolean; type?: string }) {
  return <label className={labelClass}>{label}{hint && <span className="ml-2 text-xs font-normal text-slate-500">{hint}</span>}<input className={fieldClass} type={type} value={value} required={required} onChange={(event) => onChange(event.target.value)} /></label>;
}
function TextArea({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) { return <label className={labelClass}>{label}<textarea className={`${fieldClass} min-h-28 resize-y`} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function CheckRow({ checked, onChange, label, disabled }: { checked: boolean; onChange(value: boolean): void; label: string; disabled?: boolean }) {
  return <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm font-semibold text-slate-800"><input className="mt-0.5 h-4 w-4" type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}
function Badge({ children }: { children: React.ReactNode }) { return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold capitalize text-slate-700">{children}</span>; }
function SaveButton({ busy, label, icon }: { busy: boolean; label: string; icon?: "route" }) { return <button type="submit" disabled={busy} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon === "route" ? <Route className="h-4 w-4" /> : <Check className="h-4 w-4" />}{label}</button>; }
function LocationSelect({ locations, value, onChange }: { locations: OrganizationEstablishment[]; value: string; onChange(value: string): void }) { return <label className={labelClass}>Location scope<select className={fieldClass} value={value} onChange={(event) => onChange(event.target.value)}><option value="">Organization-wide</option>{locations.filter((item) => item.status === "active").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>; }
function PurposeSelect({ label, value, onChange }: { label: string; value: OrganizationContactPurposeValue; onChange(value: OrganizationContactPurposeValue): void }) { return <label className={labelClass}>{label}<select className={fieldClass} value={value} onChange={(event) => onChange(event.target.value as OrganizationContactPurposeValue)}><option value="general">General</option><option value="referrals">Referrals</option><option value="opportunities">Opportunities</option><option value="rfx_responses">RFx responses</option><option value="teaming">Teaming</option><option value="resource_inquiries">Resource inquiries</option><option value="billing">Billing</option><option value="location_inquiries">Location inquiries</option><option value="administration">Administration</option></select></label>; }
type OrganizationContactPurposeValue = OrganizationContactPoint["purposes"][number];
