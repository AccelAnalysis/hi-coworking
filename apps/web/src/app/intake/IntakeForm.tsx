"use client";

import { useEffect, useId, useState } from "react";
import {
  ACCEL_DISPLAY_NAME,
  ACCEL_EMAIL,
  ACCEL_ONE_LINER,
  ACCEL_PHONE_DISPLAY,
  ACCEL_TAGLINE,
  EXPO_CONSENT_CATALOG,
  EXPO_CONSENT_KEYS,
  EXPO_ORG_TYPES,
  INTAKE_PRIVACY_NOTICE,
  resolveIntakeProfile,
  validateExpoLeadPayload,
  type ExpoConsentKey,
  type ExpoLeadPayload,
  type ExpoOrgType,
  type IntakeProfile,
} from "@/lib/expoNasaLead";
import { AccelWordmark } from "@/components/AccelWordmark";
import {
  EXPO_OFFLINE_SAVED_MESSAGE,
  enqueueExpoLead,
  expoQueueInMemory,
  flushExpoLeads,
  listExpoLeads,
  postExpoLead,
  removeExpoLead,
  subscribeExpoQueue,
  type QueuedExpoLead,
} from "@/lib/expoLeadQueue";

const DRAFT_KEY = "accel-analysis-intake-draft";

type Draft = {
  fullName: string;
  organization: string;
  roleTitle: string;
  email: string;
  phone: string;
  orgType: ExpoOrgType | "";
  need: string;
  timing: string;
  powerNow: boolean;
  hiCoworkingEarlyAccess: boolean;
  consent: Record<ExpoConsentKey, boolean>;
};

const EMPTY_CONSENT: Record<ExpoConsentKey, boolean> = {
  email: false,
  sms: false,
  phone: false,
};

const EMPTY_DRAFT: Draft = {
  fullName: "",
  organization: "",
  roleTitle: "",
  email: "",
  phone: "",
  orgType: "",
  need: "",
  timing: "",
  powerNow: false,
  hiCoworkingEarlyAccess: false,
  consent: EMPTY_CONSENT,
};

type Receipt = {
  id: string;
  state: "synced" | "queued";
  name: string;
};

type UrlContext = {
  event: string;
  eventId: string;
  list: string;
};

function readUrlContext(): UrlContext {
  const params = new URLSearchParams(window.location.search);
  return {
    event: params.get("event")?.trim() ?? "",
    eventId: params.get("event_id")?.trim() ?? "",
    list: params.get("list")?.trim() ?? "",
  };
}

export function IntakeForm() {
  const formId = useId();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [profile, setProfile] = useState<IntakeProfile>(() =>
    resolveIntakeProfile({ explicit: true }),
  );
  const [urlContext, setUrlContext] = useState<UrlContext>({ event: "", eventId: "", list: "" });
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [queue, setQueue] = useState<QueuedExpoLead[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [memoryWarning, setMemoryWarning] = useState(false);

  useEffect(() => {
    const context = readUrlContext();
    setUrlContext(context);
    setProfile(resolveIntakeProfile({ ...context, explicit: true }));

    const stored = window.sessionStorage.getItem(DRAFT_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Partial<Draft>;
        setDraft({
          ...EMPTY_DRAFT,
          ...parsed,
          consent: { ...EMPTY_CONSENT, ...parsed.consent },
        });
      } catch {
        window.sessionStorage.removeItem(DRAFT_KEY);
      }
    }

    let cancelled = false;
    const refresh = () => {
      void listExpoLeads().then((leads) => {
        if (!cancelled) setQueue(leads);
      });
    };
    refresh();
    const unsubscribe = subscribeExpoQueue(refresh);
    const applyFlush = (result: { syncedIds: string[]; leads: QueuedExpoLead[] }) => {
      if (cancelled) return;
      setQueue(result.leads);
      setReceipt((current) =>
        current && current.state === "queued" && result.syncedIds.includes(current.id)
          ? { ...current, state: "synced" }
          : current,
      );
    };
    const onOnline = () => {
      void flushExpoLeads().then(applyFlush);
    };
    window.addEventListener("online", onOnline);
    void flushExpoLeads().then(applyFlush);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener("online", onOnline);
    };
  }, []);

  useEffect(() => {
    if (receipt) return;
    const blank = JSON.stringify(draft) === JSON.stringify(EMPTY_DRAFT);
    if (blank) {
      window.sessionStorage.removeItem(DRAFT_KEY);
      return;
    }
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [draft, receipt]);

  useEffect(() => {
    if (!receipt || receipt.state !== "queued") return;
    const blocked = queue.find(
      (lead) => lead.clientSubmissionId === receipt.id && lead.status === "needs_attention",
    );
    if (!blocked) return;
    setReceipt(null);
    setError(blocked.lastError || "This lead needs a correction before it can sync.");
  }, [queue, receipt]);

  const pending = queue.filter((lead) => lead.status === "pending");
  const needsAttention = queue.filter((lead) => lead.status === "needs_attention");
  const nasaFields = profile.fieldSet === "nasa-expo";

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateConsent(key: ExpoConsentKey, checked: boolean) {
    setDraft((current) => ({
      ...current,
      consent: { ...current.consent, [key]: checked },
    }));
  }

  function resetForm() {
    setDraft(EMPTY_DRAFT);
    setHoneypot("");
    setError(null);
    setReceipt(null);
    window.sessionStorage.removeItem(DRAFT_KEY);
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const result = await flushExpoLeads({ force: true });
      setQueue(result.leads);
      setReceipt((current) =>
        current && current.state === "queued" && result.syncedIds.includes(current.id)
          ? { ...current, state: "synced" }
          : current,
      );
    } finally {
      setSyncing(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const payload: ExpoLeadPayload = {
      fullName: draft.fullName,
      organization: draft.organization,
      roleTitle: draft.roleTitle,
      email: draft.email,
      phone: draft.phone,
      orgType: draft.orgType,
      need: draft.need,
      timing: draft.timing,
      interests: {
        powerNow: nasaFields ? draft.powerNow : false,
        hiCoworkingEarlyAccess: nasaFields ? draft.hiCoworkingEarlyAccess : false,
      },
      consent: draft.consent,
      submittedAt: new Date().toISOString(),
      clientSubmissionId: crypto.randomUUID(),
      event: urlContext.event,
      eventId: urlContext.eventId,
      list: urlContext.list,
      expo_hp: honeypot,
    };
    const validated = validateExpoLeadPayload(payload);
    if (!validated.ok) {
      setError(validated.error);
      return;
    }

    setSaving(true);
    try {
      if (!navigator.onLine) {
        await enqueueExpoLead(payload);
        setMemoryWarning(expoQueueInMemory());
        setReceipt({ id: payload.clientSubmissionId, state: "queued", name: validated.lead.fullName });
        setDraft(EMPTY_DRAFT);
        window.sessionStorage.removeItem(DRAFT_KEY);
        return;
      }

      const outcome = await postExpoLead(payload);
      if (outcome.decision === "saved") {
        setReceipt({ id: payload.clientSubmissionId, state: "synced", name: validated.lead.fullName });
        setDraft(EMPTY_DRAFT);
        window.sessionStorage.removeItem(DRAFT_KEY);
        return;
      }
      if (outcome.decision === "queue") {
        await enqueueExpoLead(payload, outcome.error);
        setMemoryWarning(expoQueueInMemory());
        setReceipt({ id: payload.clientSubmissionId, state: "queued", name: validated.lead.fullName });
        setDraft(EMPTY_DRAFT);
        window.sessionStorage.removeItem(DRAFT_KEY);
        return;
      }
      setError(outcome.error || "Could not save this lead.");
    } catch {
      setError("This device could not store the lead. Keep the page open and try again.");
    } finally {
      setSaving(false);
      setQueue(await listExpoLeads());
    }
  }

  return (
    <div className="min-h-dvh bg-[#F2F6FF] text-[#1B1B1B] touch-manipulation [font-family:var(--font-aa-body),Arial,sans-serif]">
      <header className="border-b border-[#5E5E5E]/20 bg-white px-5 pb-5 pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
        <div className="mx-auto flex max-w-3xl items-start justify-between gap-4">
          <div className="min-w-0">
            <AccelWordmark height={48} />
            <h1 className="mt-4 text-[2rem] leading-tight font-bold text-[#00072E] [font-family:var(--font-aa-display),Georgia,serif] sm:text-5xl">
              Tell us how to follow up
            </h1>
            <p className="mt-3 max-w-xl text-lg leading-snug text-[#1B1B1B] sm:text-xl">{ACCEL_TAGLINE}</p>
            <p className="mt-1 max-w-xl text-base leading-snug text-[#5E5E5E]">{ACCEL_ONE_LINER}</p>
          </div>
          <button
            type="button"
            onClick={resetForm}
            className="mt-1 min-h-14 shrink-0 rounded-full border-2 border-[#0163FD] px-5 text-lg font-semibold text-[#0163FD] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#03C9FF]"
          >
            Clear
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 pb-16 sm:px-8">
        <div
          className="mb-5 rounded-2xl border-2 border-[#5E5E5E]/25 bg-white px-5 py-4 text-lg leading-snug text-[#1B1B1B]"
          aria-live="polite"
        >
          {pending.length > 0
            ? `${pending.length} waiting to sync. ${syncing ? "Syncing now." : "They stay on this device until the network returns."}`
            : "Each consent box starts off. Leave it off unless the person agrees to that sentence."}
          {pending.length > 0 && (
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={syncing}
              className="mt-3 flex min-h-12 items-center rounded-full bg-[#0163FD] px-5 text-base font-semibold text-white disabled:opacity-60 sm:mt-0 sm:ml-3 sm:inline-flex"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>

        {needsAttention.length > 0 && (
          <div className="mb-5 space-y-3">
            {needsAttention.map((lead) => (
              <div key={lead.clientSubmissionId} role="alert" className="rounded-2xl border-2 border-[#1B1B1B] bg-white px-5 py-4 text-lg">
                <p className="font-semibold">Needs a correction. {lead.payload.fullName || "A saved lead"} is still on this device.</p>
                <p className="mt-1 text-[#1B1B1B]">{lead.lastError}</p>
                <button
                  type="button"
                  onClick={() => void removeExpoLead(lead.clientSubmissionId).then(() => listExpoLeads().then(setQueue))}
                  className="mt-3 min-h-12 rounded-full border-2 border-[#1B1B1B] px-4 font-semibold"
                >
                  Remove from this device
                </button>
              </div>
            ))}
          </div>
        )}

        {receipt ? (
          <section className="rounded-3xl bg-white px-6 py-10 text-center shadow-sm" aria-live="polite">
            <p className="text-sm font-semibold tracking-[0.16em] text-[#0163FD] uppercase">{ACCEL_DISPLAY_NAME}</p>
            <h2 className="mt-3 text-4xl font-bold tracking-tight text-[#00072E] [font-family:var(--font-aa-display),Georgia,serif] sm:text-5xl">
              {receipt.state === "synced" ? "Lead saved" : EXPO_OFFLINE_SAVED_MESSAGE}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-2xl leading-snug text-[#1B1B1B]">
              {receipt.state === "synced"
                ? `${receipt.name} is with the Accel Analysis team.`
                : `${receipt.name} is stored on this device and will sync when the connection returns.`}
            </p>
            {memoryWarning && receipt.state === "queued" && (
              <p className="mt-3 text-lg font-semibold">Keep this page open until the lead syncs.</p>
            )}
            <button
              type="button"
              onClick={resetForm}
              className="mt-8 min-h-16 w-full rounded-2xl bg-[#0163FD] px-6 text-2xl font-semibold text-white focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#03C9FF]"
            >
              Next person
            </button>
          </section>
        ) : (
          <form id={formId} onSubmit={(event) => void onSubmit(event)} className="space-y-6" noValidate>
            {error && (
              <div role="alert" className="rounded-2xl border-2 border-[#1B1B1B] bg-white px-5 py-4 text-xl text-[#1B1B1B]">
                <span className="font-semibold">Needs a correction. </span>
                {error}
              </div>
            )}

            <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-2xl font-bold text-[#00072E] [font-family:var(--font-aa-display),Georgia,serif]">Person</h2>
              <Field label="Full name" required value={draft.fullName} autoComplete="name" onChange={(value) => update("fullName", value)} />
              <Field label="Email" type="email" inputMode="email" autoComplete="email" value={draft.email} onChange={(value) => update("email", value)} hint="Email or phone is required." />
              <Field label="Phone" type="tel" inputMode="tel" autoComplete="tel" value={draft.phone} onChange={(value) => update("phone", value)} hint="Optional when email is filled in." />
            </section>

            <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-2xl font-bold text-[#00072E] [font-family:var(--font-aa-display),Georgia,serif]">Organization</h2>
              <Field label="Organization" required autoComplete="organization" value={draft.organization} onChange={(value) => update("organization", value)} />
              <Field label="Role / title" required autoComplete="organization-title" value={draft.roleTitle} onChange={(value) => update("roleTitle", value)} />
              {nasaFields && (
                <div>
                  <p className="text-xl font-semibold" id={`${formId}-org-type`}>
                    Organization type <span className="text-[#0163FD]">Required</span>
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-labelledby={`${formId}-org-type`}>
                    {EXPO_ORG_TYPES.map((orgType) => {
                      const selected = draft.orgType === orgType.id;
                      return (
                        <button
                          key={orgType.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => update("orgType", orgType.id)}
                          className={`min-h-16 rounded-2xl border-2 px-4 text-left text-xl font-semibold focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#03C9FF] ${
                            selected
                              ? "border-[#0163FD] bg-[#0163FD] text-white"
                              : "border-[#5E5E5E]/35 bg-white text-[#1B1B1B]"
                          }`}
                        >
                          {orgType.label}
                          {selected ? <span className="mt-1 block text-base font-semibold">Selected</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-2xl font-bold text-[#00072E] [font-family:var(--font-aa-display),Georgia,serif]">What they need</h2>
              <label className="block text-xl font-semibold" htmlFor={`${formId}-need`}>
                In their words <span className="text-[#0163FD]">Required</span>
              </label>
              <textarea
                id={`${formId}-need`}
                required
                rows={4}
                maxLength={500}
                value={draft.need}
                onChange={(event) => update("need", event.target.value)}
                className="mt-2 w-full rounded-2xl border-2 border-[#5E5E5E]/35 bg-white px-4 py-4 text-xl leading-snug outline-none focus:border-[#0163FD] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#03C9FF]"
              />
              <Field label="Timing" value={draft.timing} onChange={(value) => update("timing", value)} hint="Optional. This quarter, next fiscal year, or whenever." />
            </section>

            {nasaFields && (
              <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm sm:p-6">
                <h2 className="text-2xl font-bold text-[#00072E] [font-family:var(--font-aa-display),Georgia,serif]">Only if they ask</h2>
                <p className="text-lg text-[#5E5E5E]">Leave these off unless the person asks about them.</p>
                <CheckRow
                  checked={draft.powerNow}
                  onChange={(checked) => update("powerNow", checked)}
                  label="Power NOW"
                  detail="They asked about Power NOW."
                />
                <CheckRow
                  checked={draft.hiCoworkingEarlyAccess}
                  onChange={(checked) => update("hiCoworkingEarlyAccess", checked)}
                  label="Hi Coworking Early Access"
                  detail="They asked about Hi Coworking early access."
                />
              </section>
            )}

            <section className="space-y-3 rounded-3xl bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-2xl font-bold text-[#00072E] [font-family:var(--font-aa-display),Georgia,serif]">Consent</h2>
              <p className="text-lg text-[#1B1B1B]">
                Three choices: email, text, and phone. All start unchecked. Check a box only after the person agrees to that sentence.
              </p>
              {EXPO_CONSENT_KEYS.map((key) => {
                const item = EXPO_CONSENT_CATALOG[key];
                return (
                  <CheckRow
                    key={key}
                    checked={draft.consent[key]}
                    onChange={(checked) => updateConsent(key, checked)}
                    label={item.label}
                    detail={item.wording}
                  />
                );
              })}
              <div className="rounded-2xl bg-[#F2F6FF] p-4">
                <h3 className="text-lg font-semibold">Privacy</h3>
                <p className="mt-2 text-base leading-relaxed text-[#1B1B1B]">{INTAKE_PRIVACY_NOTICE}</p>
              </div>
            </section>

            <div className="absolute -left-[9999px] h-0 overflow-hidden" aria-hidden="true">
              <label>
                Leave blank
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(event) => setHoneypot(event.target.value)}
                  name="expo_hp"
                />
              </label>
            </div>

            <div className="pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="submit"
                disabled={saving}
                className="min-h-16 w-full rounded-2xl bg-[#0163FD] text-2xl font-semibold text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#03C9FF]"
              >
                {saving ? "Saving…" : "Save lead"}
              </button>
              <p className="mt-4 text-center text-base text-[#5E5E5E]">
                {ACCEL_DISPLAY_NAME}
                {" · "}
                <a className="font-semibold text-[#0163FD] underline" href="tel:+17572360651">{ACCEL_PHONE_DISPLAY}</a>
                {" · "}
                <a className="font-semibold text-[#0163FD] underline" href={`mailto:${ACCEL_EMAIL}`}>{ACCEL_EMAIL}</a>
              </p>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  required,
  type = "text",
  inputMode,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  required?: boolean;
  type?: string;
  inputMode?: "email" | "tel" | "text";
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xl font-semibold">
        {label} {required ? <span className="text-[#0163FD]">Required</span> : null}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-16 w-full rounded-2xl border-2 border-[#5E5E5E]/35 bg-white px-4 text-xl outline-none focus:border-[#0163FD] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#03C9FF]"
      />
      {hint ? <p className="mt-2 text-base text-[#5E5E5E]">{hint}</p> : null}
    </div>
  );
}

function CheckRow({
  checked,
  onChange,
  label,
  detail,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  detail: string;
}) {
  return (
    <label className={`flex min-h-16 items-start gap-4 rounded-2xl border-2 bg-white p-4 ${checked ? "border-[#0163FD]" : "border-[#5E5E5E]/35"}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-8 w-8 shrink-0 accent-[#0163FD]"
      />
      <span>
        <span className="block text-xl font-semibold">
          {label}
          {checked ? <span className="ml-2 text-base font-semibold text-[#0163FD]">Checked</span> : <span className="ml-2 text-base font-semibold text-[#5E5E5E]">Unchecked</span>}
        </span>
        <span className="mt-1 block text-lg leading-snug text-[#1B1B1B]">{detail}</span>
      </span>
    </label>
  );
}
