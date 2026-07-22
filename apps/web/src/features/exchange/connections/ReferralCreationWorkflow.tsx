"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  LockKeyhole,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  CreateReferralDraftInput,
  RecipientSuggestion,
  ReferralCompensationType,
  ReferralServiceOfferSummary,
  ReferralWorkspaceRecord,
} from "../data/exchangeRun3Gateway";
import { useDialogFocus } from "../utils/useDialogFocus";
import { RecipientSuggestions } from "./RecipientSuggestions";
import { ServiceOfferSummary } from "./ServiceOfferSummary";

const STEPS = [
  "Business need",
  "Recipient",
  "Service",
  "Consent",
  "Links",
  "Terms",
  "Review",
] as const;

const REFERRAL_TYPES: Array<{
  value: ReferralWorkspaceRecord["referralType"];
  label: string;
}> = [
  { value: "customer_introduction", label: "Customer introduction" },
  { value: "business_lead", label: "Business lead" },
  { value: "project_opportunity", label: "Project opportunity" },
  { value: "service_need", label: "Service need" },
  { value: "partner_introduction", label: "Partner introduction" },
  { value: "other", label: "Other business referral" },
];

interface DraftFormState {
  referralType: ReferralWorkspaceRecord["referralType"];
  title: string;
  needSummary: string;
  category: string;
  naicsCode: string;
  territoryFips: string;
  recipientId: string;
  serviceOfferId: string;
  includeContact: boolean;
  contactType: "person" | "business";
  contactName: string;
  companyName: string;
  email: string;
  phone: string;
  consentStatus: "not_required" | "pending" | "confirmed";
  relatedRfxId: string;
  relatedTeamId: string;
  compensationType: ReferralCompensationType;
  fixedAmount: string;
  percentage: string;
  customTerms: string;
  benefitDescription: string;
}

function initialForm(): DraftFormState {
  return {
    referralType: "business_lead",
    title: "",
    needSummary: "",
    category: "",
    naicsCode: "",
    territoryFips: "",
    recipientId: "",
    serviceOfferId: "",
    includeContact: false,
    contactType: "business",
    contactName: "",
    companyName: "",
    email: "",
    phone: "",
    consentStatus: "not_required",
    relatedRfxId: "",
    relatedTeamId: "",
    compensationType: "none",
    fixedAmount: "",
    percentage: "",
    customTerms: "",
    benefitDescription: "",
  };
}

function referralCompensationLabel(type: ReferralCompensationType): string {
  switch (type) {
    case "fixed": return "Fixed cash amount";
    case "percentage": return "Percentage of first collected invoice";
    case "custom": return "Custom explanatory terms";
    case "benefit": return "Non-cash benefit";
    default: return "No compensation";
  }
}

export function ReferralCreationWorkflow({
  open,
  suggestions,
  offers,
  gatewayMode,
  actorOrganizationId,
  actorOrganizationName,
  onClose,
  onSuggest,
  onCreate,
}: {
  open: boolean;
  suggestions: RecipientSuggestion[];
  offers: ReferralServiceOfferSummary[];
  gatewayMode: "live" | "demo";
  actorOrganizationId?: string;
  actorOrganizationName?: string;
  onClose: () => void;
  onSuggest: (input: {
    serviceCategory?: string;
    naicsCodes: string[];
    territoryFips?: string;
  }) => Promise<RecipientSuggestion[]>;
  onCreate: (input: CreateReferralDraftInput) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<DraftFormState>(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [loadedSuggestions, setLoadedSuggestions] = useState<RecipientSuggestion[] | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const draftActorRef = useRef<string | undefined>(undefined);
  const actorKey = actorOrganizationId ?? (gatewayMode === "demo" ? "demo-actor" : undefined);
  const authorityChanged = Boolean(
    draftActorRef.current && draftActorRef.current !== actorKey,
  );
  useDialogFocus(open, dialogRef, onClose);

  useEffect(() => {
    if (open && !draftActorRef.current && actorKey) {
      draftActorRef.current = actorKey;
    }
  }, [actorKey, open]);

  const availableSuggestions = loadedSuggestions ?? suggestions;
  const selectedSuggestion = useMemo(
    () => availableSuggestions.find((candidate) => candidate.id === form.recipientId),
    [availableSuggestions, form.recipientId],
  );
  const selectedOffer = useMemo(
    () => offers.find((candidate) => candidate.id === form.serviceOfferId),
    [form.serviceOfferId, offers],
  );

  if (!open) return null;

  const update = <Key extends keyof DraftFormState>(
    key: Key,
    value: DraftFormState[Key],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const stepReady = (() => {
    if (step === 0) return form.title.trim().length >= 3 && form.needSummary.trim().length >= 10 && form.category.trim().length >= 2;
    if (step === 1) return Boolean(selectedSuggestion);
    if (step === 3 && form.includeContact) {
      return form.consentStatus !== "not_required"
        && Boolean(form.contactName.trim() || form.companyName.trim());
    }
    if (step === 5 && form.compensationType === "fixed") return Number(form.fixedAmount) > 0;
    if (step === 5 && form.compensationType === "percentage") return Number(form.percentage) > 0 && Number(form.percentage) <= 100;
    if (step === 5 && form.compensationType === "custom") return form.customTerms.trim().length >= 5;
    if (step === 5 && form.compensationType === "benefit") return form.benefitDescription.trim().length >= 5;
    return true;
  })();

  const chooseSuggestion = (suggestion: RecipientSuggestion) => {
    const offer = suggestion.serviceOffer;
    setForm((current) => ({
      ...current,
      recipientId: suggestion.id,
      serviceOfferId: offer?.id ?? "",
      compensationType: offer?.compensationType ?? "none",
      category: current.category || offer?.serviceCategory || suggestion.matchedCapabilities[0] || "",
      naicsCode: current.naicsCode || offer?.naicsCodes[0] || "",
      territoryFips: current.territoryFips || offer?.territoryFips[0] || "",
    }));
  };

  const chooseOffer = (offerId: string) => {
    const offer = offers.find((candidate) => candidate.id === offerId);
    setForm((current) => ({
      ...current,
      serviceOfferId: offerId,
      compensationType: offer?.compensationType ?? current.compensationType,
      category: current.category || offer?.serviceCategory || "",
      naicsCode: current.naicsCode || offer?.naicsCodes[0] || "",
      territoryFips: current.territoryFips || offer?.territoryFips[0] || "",
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSuggestion || !stepReady || submitting || !actorKey || authorityChanged) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const fixedDollars = Number(form.fixedAmount);
      const ratePercent = Number(form.percentage);
      await onCreate({
        idempotencyKey: crypto.randomUUID(),
        recipientUid: selectedSuggestion.providerUid,
        recipientOrgId: selectedSuggestion.providerOrgId,
        recipientLabel: selectedSuggestion.providerLabel,
        referralType: form.referralType,
        title: form.title.trim(),
        needSummary: form.needSummary.trim(),
        category: form.category.trim(),
        naicsCodes: form.naicsCode.trim() ? [form.naicsCode.trim()] : [],
        territoryFips: form.territoryFips.trim() || undefined,
        consentStatus: form.includeContact ? form.consentStatus : "not_required",
        referredParty: form.includeContact ? {
          type: form.contactType,
          name: form.contactName.trim() || undefined,
          companyName: form.companyName.trim() || undefined,
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
        } : undefined,
        serviceOfferId: selectedOffer?.id,
        compensationType: form.compensationType,
        currency: "USD",
        fixedCompensationCents: form.compensationType === "fixed"
          ? Math.round(fixedDollars * 100)
          : undefined,
        compensationRateBasisPoints: form.compensationType === "percentage"
          ? Math.round(ratePercent * 100)
          : undefined,
        customTerms: form.compensationType === "custom" ? form.customTerms.trim() : undefined,
        benefitDescription: form.compensationType === "benefit" ? form.benefitDescription.trim() : undefined,
        relatedRfxId: form.relatedRfxId.trim() || undefined,
        relatedTeamId: form.relatedTeamId.trim() || undefined,
      });
      setForm(initialForm());
      setStep(0);
      setLoadedSuggestions(null);
      draftActorRef.current = actorKey;
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The draft could not be created.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] bg-slate-950/65 backdrop-blur-sm">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-referral-title"
        className="absolute inset-0 flex flex-col bg-slate-100 sm:inset-4 sm:rounded-3xl sm:shadow-2xl lg:inset-x-[max(2rem,calc((100vw-1180px)/2))] lg:inset-y-6"
      >
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:rounded-t-3xl sm:px-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-indigo-700">Business referral</p>
              <h2 id="new-referral-title" className="text-lg font-bold text-slate-950 sm:text-xl">Create a protected referral draft</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {actorOrganizationId
                  ? `Working as ${actorOrganizationName ?? "the selected organization"} · authority is verified server-side`
                  : "Choose an active organization in the Exchange context bar before creating this draft."}
              </p>
            </div>
            <button type="button" onClick={onClose} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 outline-none hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label="Close referral creation">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <ol className="mt-3 flex gap-1 overflow-x-auto [scrollbar-width:none]" aria-label="Referral creation progress">
            {STEPS.map((label, index) => (
              <li key={label} className="min-w-16 flex-1">
                <button
                  type="button"
                  onClick={() => index < step && setStep(index)}
                  disabled={index > step}
                  aria-current={index === step ? "step" : undefined}
                  className={cn(
                    "w-full rounded-lg px-1 py-1.5 text-center text-[10px] font-bold outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                    index === step ? "bg-slate-950 text-white" : index < step ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-400",
                  )}
                >
                  <span className="block text-[9px] opacity-70">{index < step ? "Done" : `0${index + 1}`}</span>
                  <span className="whitespace-nowrap">{label}</span>
                </button>
              </li>
            ))}
          </ol>
        </header>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          {authorityChanged ? (
            <p className="shrink-0 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950" role="alert">
              This draft belongs to a different actor organization. It is frozen to prevent cross-organization disclosure. Switch back to the original actor to continue.
            </p>
          ) : null}
          <fieldset disabled={authorityChanged} className="contents">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 lg:px-10">
            <div className="mx-auto max-w-4xl">
              {gatewayMode === "demo" ? (
                <p className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-950" role="status">This draft stays in memory. Development demo mode performs no Firebase writes.</p>
              ) : null}

              {step === 0 ? (
                <div>
                  <h3 className="text-xl font-bold text-slate-950">What business need are you introducing?</h3>
                  <p className="mt-1 text-sm text-slate-600">Business referrals connect a lead, customer, project, service need, partner, or opportunity. Compensation is optional.</p>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-bold text-slate-700">Referral type
                      <select value={form.referralType} onChange={(event) => update("referralType", event.target.value as DraftFormState["referralType"])} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500">
                        {REFERRAL_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                      </select>
                    </label>
                    <label className="text-sm font-bold text-slate-700">Industry or capability
                      <input value={form.category} onChange={(event) => update("category", event.target.value)} required className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. Engineering services" />
                    </label>
                    <label className="text-sm font-bold text-slate-700 sm:col-span-2">Short title
                      <input value={form.title} onChange={(event) => update("title", event.target.value)} required minLength={3} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Describe the introduction in a few words" />
                    </label>
                    <label className="text-sm font-bold text-slate-700 sm:col-span-2">Business need
                      <textarea value={form.needSummary} onChange={(event) => update("needSummary", event.target.value)} required minLength={10} rows={5} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white p-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Share only what the recipient needs to evaluate the referral." />
                    </label>
                    <label className="text-sm font-bold text-slate-700">NAICS code (optional)
                      <input inputMode="numeric" value={form.naicsCode} onChange={(event) => update("naicsCode", event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" placeholder="541330" />
                    </label>
                    <label className="text-sm font-bold text-slate-700">Territory FIPS (optional)
                      <input inputMode="numeric" value={form.territoryFips} onChange={(event) => update("territoryFips", event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" placeholder="51093" />
                    </label>
                  </div>
                </div>
              ) : null}

              {step === 1 ? (
                <div>
                  <h3 className="text-xl font-bold text-slate-950">Choose an eligible recipient</h3>
                  <p className="mt-1 text-sm text-slate-600">Suggestions are rule-based and explain their capability, territory, offer, and relationship factors.</p>
                  {loadingSuggestions ? <p className="mt-5 rounded-xl bg-white p-4 text-sm font-semibold text-slate-700" role="status">Finding eligible published providers…</p> : null}
                  {suggestionError ? <p className="mt-5 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">{suggestionError}</p> : null}
                  {!loadingSuggestions && availableSuggestions.length ? <div className="mt-5"><RecipientSuggestions suggestions={availableSuggestions} selectedId={form.recipientId} onSelect={chooseSuggestion} /></div> : null}
                  {!loadingSuggestions && !availableSuggestions.length ? <p className="mt-5 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-600">No discoverable provider matches this capability and territory. Go back and broaden the business need.</p> : null}
                  <p className="mt-4 flex items-start gap-2 rounded-xl bg-slate-200/70 p-3 text-xs leading-5 text-slate-700"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-700" aria-hidden="true" />Same-user, same-organization, suspended, unpublished, inactive, and policy-blocked recipients are excluded server-side.</p>
                </div>
              ) : null}

              {step === 2 ? (
                <div>
                  <h3 className="text-xl font-bold text-slate-950">Match a published service offer</h3>
                  <p className="mt-1 text-sm text-slate-600">A published offer provides versioned service and compensation terms. You may still make a valid referral with no offer.</p>
                  <div className="mt-5 grid gap-3 md:grid-cols-2">
                    <label className={cn("rounded-xl border bg-white p-3", !form.serviceOfferId ? "border-indigo-500 ring-1 ring-indigo-500" : "border-slate-200")}>
                      <span className="flex items-center gap-2 text-sm font-bold text-slate-950"><input type="radio" name="service-offer" value="" checked={!form.serviceOfferId} onChange={() => chooseOffer("")} /> No published offer</span>
                      <span className="mt-1 block pl-6 text-xs text-slate-500">Use direct referral terms; no compensation is a supported choice.</span>
                    </label>
                    {offers.filter((offer) => !selectedSuggestion || offer.providerLabel === selectedSuggestion.providerLabel).map((offer) => (
                      <label key={offer.id} className={cn("rounded-xl border bg-white p-3", form.serviceOfferId === offer.id ? "border-indigo-500 ring-1 ring-indigo-500" : "border-slate-200")}>
                        <span className="flex items-center gap-2 text-sm font-bold text-slate-950"><input type="radio" name="service-offer" value={offer.id} checked={form.serviceOfferId === offer.id} onChange={() => chooseOffer(offer.id)} /> {offer.serviceName}</span>
                        <span className="mt-1 block pl-6 text-xs text-slate-500">{offer.compensationLabel} · version {offer.version}</span>
                      </label>
                    ))}
                  </div>
                  {selectedOffer ? <div className="mt-4"><ServiceOfferSummary offer={selectedOffer} /></div> : null}
                </div>
              ) : null}

              {step === 3 ? (
                <div>
                  <h3 className="text-xl font-bold text-slate-950">Contact disclosure and consent</h3>
                  <p className="mt-1 text-sm text-slate-600">Contact data is stored separately from the minimized referral. It is never used for suggestions or placed in the URL.</p>
                  <label className="mt-5 flex min-h-12 items-center gap-3 rounded-xl border border-slate-300 bg-white p-3 text-sm font-bold text-slate-800">
                    <input type="checkbox" checked={form.includeContact} onChange={(event) => {
                      update("includeContact", event.target.checked);
                      if (!event.target.checked) update("consentStatus", "not_required");
                      else if (form.consentStatus === "not_required") update("consentStatus", "pending");
                    }} className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" /> Include protected third-party contact data
                  </label>
                  {form.includeContact ? (
                    <div className="mt-4 grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
                      <label className="text-sm font-bold text-slate-700">Contact type
                        <select value={form.contactType} onChange={(event) => update("contactType", event.target.value as "person" | "business")} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500"><option value="business">Business</option><option value="person">Person</option></select>
                      </label>
                      <label className="text-sm font-bold text-slate-700">Consent state
                        <select value={form.consentStatus} onChange={(event) => update("consentStatus", event.target.value as DraftFormState["consentStatus"])} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500"><option value="pending">Pending — withhold contact</option><option value="confirmed">Confirmed — disclose when authorized</option></select>
                      </label>
                      <label className="text-sm font-bold text-slate-700">Contact name
                        <input value={form.contactName} onChange={(event) => update("contactName", event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" />
                      </label>
                      <label className="text-sm font-bold text-slate-700">Company
                        <input value={form.companyName} onChange={(event) => update("companyName", event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" />
                      </label>
                      <label className="text-sm font-bold text-slate-700">Email (optional)
                        <input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" />
                      </label>
                      <label className="text-sm font-bold text-slate-700">Phone (optional)
                        <input type="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" />
                      </label>
                    </div>
                  ) : (
                    <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">No third-party contact is needed. Consent is recorded as not required.</p>
                  )}
                </div>
              ) : null}

              {step === 4 ? (
                <div>
                  <h3 className="text-xl font-bold text-slate-950">Link related Exchange work</h3>
                  <p className="mt-1 text-sm text-slate-600">Links are optional and validated server-side. Resource-program links remain unavailable until that domain exists.</p>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-bold text-slate-700">RFx ID (optional)
                      <input value={form.relatedRfxId} onChange={(event) => update("relatedRfxId", event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" placeholder="RFx record ID" />
                    </label>
                    <label className="text-sm font-bold text-slate-700">Team ID (optional)
                      <input value={form.relatedTeamId} onChange={(event) => update("relatedTeamId", event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Authorized RFx team ID" />
                    </label>
                  </div>
                </div>
              ) : null}

              {step === 5 ? (
                <div>
                  <h3 className="text-xl font-bold text-slate-950">Choose optional referral terms</h3>
                  <p className="mt-1 text-sm text-slate-600">Payment does not define a business referral. The recipient must explicitly accept a locked terms snapshot before compensation can apply.</p>
                  {selectedOffer ? <div className="mt-4"><ServiceOfferSummary offer={selectedOffer} /></div> : null}
                  <fieldset className="mt-5">
                    <legend className="text-sm font-bold text-slate-700">Compensation or benefit policy</legend>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {(["none", "fixed", "percentage", "custom", "benefit"] as ReferralCompensationType[]).map((type) => (
                        <label key={type} className={cn("flex min-h-12 items-center gap-2 rounded-xl border bg-white p-3 text-sm font-semibold", form.compensationType === type ? "border-indigo-500 ring-1 ring-indigo-500" : "border-slate-200")}>
                          <input type="radio" name="compensation" value={type} checked={form.compensationType === type} onChange={() => update("compensationType", type)} /> {referralCompensationLabel(type)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <div className="mt-4">
                    {form.compensationType === "fixed" ? <label className="text-sm font-bold text-slate-700">Fixed amount (USD)<input type="number" min="0.01" step="0.01" value={form.fixedAmount} onChange={(event) => update("fixedAmount", event.target.value)} className="mt-1.5 block min-h-11 w-full max-w-sm rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" /></label> : null}
                    {form.compensationType === "percentage" ? <label className="text-sm font-bold text-slate-700">Percentage of collected transaction<input type="number" min="0.01" max="100" step="0.01" value={form.percentage} onChange={(event) => update("percentage", event.target.value)} className="mt-1.5 block min-h-11 w-full max-w-sm rounded-xl border border-slate-300 bg-white px-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" /></label> : null}
                    {form.compensationType === "custom" ? <label className="text-sm font-bold text-slate-700">Custom explanatory terms<textarea rows={4} value={form.customTerms} onChange={(event) => update("customTerms", event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-white p-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" /></label> : null}
                    {form.compensationType === "benefit" ? <label className="text-sm font-bold text-slate-700">Non-cash benefit description<textarea rows={4} value={form.benefitDescription} onChange={(event) => update("benefitDescription", event.target.value)} className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-white p-3 font-normal outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Describe the benefit without assigning cash value." /></label> : null}
                  </div>
                  <p className="mt-5 flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs leading-5 text-indigo-950"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Accepted terms snapshot the offer version, compensation policy, attribution window, and the platform-fee configuration then in effect. Rate changes are prospective.</p>
                </div>
              ) : null}

              {step === 6 ? (
                <div>
                  <h3 className="text-xl font-bold text-slate-950">Review and preserve the draft</h3>
                  <p className="mt-1 text-sm text-slate-600">Creating this draft does not notify the recipient. Review it in Connections, then send it as a separate idempotent action.</p>
                  <dl className="mt-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs text-slate-500">Referral</dt><dd className="mt-1 font-bold text-slate-950">{form.title}</dd></div>
                    <div><dt className="text-xs text-slate-500">Recipient</dt><dd className="mt-1 font-bold text-slate-950">{selectedSuggestion?.providerLabel}</dd></div>
                    <div><dt className="text-xs text-slate-500">Capability</dt><dd className="mt-1 font-bold text-slate-950">{form.category}</dd></div>
                    <div><dt className="text-xs text-slate-500">Service offer</dt><dd className="mt-1 font-bold text-slate-950">{selectedOffer ? `${selectedOffer.serviceName} · v${selectedOffer.version}` : "Direct referral terms"}</dd></div>
                    <div><dt className="text-xs text-slate-500">Consent</dt><dd className="mt-1 font-bold capitalize text-slate-950">{form.consentStatus.replaceAll("_", " ")}</dd></div>
                    <div><dt className="text-xs text-slate-500">Compensation</dt><dd className="mt-1 font-bold text-slate-950">{form.compensationType === "none" ? "No compensation" : referralCompensationLabel(form.compensationType)}</dd></div>
                    <div><dt className="text-xs text-slate-500">RFx link</dt><dd className="mt-1 font-bold text-slate-950">{form.relatedRfxId || "None"}</dd></div>
                    <div><dt className="text-xs text-slate-500">Team link</dt><dd className="mt-1 font-bold text-slate-950">{form.relatedTeamId || "None"}</dd></div>
                  </dl>
                  {submitError ? <p className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-900" role="alert">{submitError}</p> : null}
                </div>
              ) : null}
            </div>
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:rounded-b-3xl sm:px-6">
            <button type="button" onClick={() => step === 0 ? onClose() : setStep((current) => current - 1)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500">
              {step === 0 ? <X className="h-4 w-4" aria-hidden="true" /> : <ArrowLeft className="h-4 w-4" aria-hidden="true" />}{step === 0 ? "Cancel" : "Back"}
            </button>
            <p className="hidden text-xs text-slate-500 sm:block">Step {step + 1} of {STEPS.length}</p>
            {step < STEPS.length - 1 ? (
              <button type="button" disabled={!stepReady || loadingSuggestions} onClick={async () => {
                if (step === 0) {
                  setLoadingSuggestions(true);
                  setSuggestionError(null);
                  try {
                    const next = await onSuggest({
                      serviceCategory: form.category.trim() || undefined,
                      naicsCodes: form.naicsCode.trim() ? [form.naicsCode.trim()] : [],
                      territoryFips: form.territoryFips.trim() || undefined,
                    });
                    setLoadedSuggestions(next);
                  } catch (error) {
                    setSuggestionError(error instanceof Error ? error.message : "Recipient suggestions could not be loaded.");
                  } finally {
                    setLoadingSuggestions(false);
                  }
                }
                setStep((current) => current + 1);
              }} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40">{loadingSuggestions ? "Matching…" : "Continue"} <ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
            ) : (
              <button type="submit" disabled={!stepReady || submitting || !actorKey || authorityChanged} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-bold text-white outline-none hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50"><Check className="h-4 w-4" aria-hidden="true" />{submitting ? "Creating draft…" : "Create draft"}</button>
            )}
          </footer>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
