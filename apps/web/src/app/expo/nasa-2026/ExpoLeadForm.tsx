"use client";

import { useEffect, useId, useState } from "react";
import {
  EXPO_CONSENT_CATALOG,
  EXPO_CONSENT_KEYS,
  EXPO_ORG_TYPES,
  validateExpoLeadPayload,
  type ExpoConsentKey,
  type ExpoLeadPayload,
  type ExpoOrgType,
} from "@/lib/expoNasaLead";
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

const DRAFT_KEY = "accel-nasa-expo-2026-draft";

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
  sms: false,
  marketing: false,
  contact: false,
  email: false,
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

export function ExpoLeadForm() {
  const formId = useId();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [honeypot, setHoneypot] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [queue, setQueue] = useState<QueuedExpoLead[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [memoryWarning, setMemoryWarning] = useState(false);

  useEffect(() => {
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
        powerNow: draft.powerNow,
        hiCoworkingEarlyAccess: draft.hiCoworkingEarlyAccess,
      },
      consent: draft.consent,
      submittedAt: new Date().toISOString(),
      clientSubmissionId: crypto.randomUUID(),
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
      setError("This iPad could not store the lead. Keep the page open and try again.");
    } finally {
      setSaving(false);
      setQueue(await listExpoLeads());
    }
  }

  return (
    <div className="min-h-dvh bg-[#f4f0e7] text-[#142033] touch-manipulation">
      <header className="bg-[#0c1b2a] px-6 pb-6 pt-[max(1.25rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto flex max-w-3xl items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#e6d3b0]">Accel Analysis</p>
            <h1 className="mt-2 text-4xl font-semibold leading-tight md:text-5xl">NASA Business Vendor Expo</h1>
            <p className="mt-2 text-xl text-white/80">October 20, 2026 · Lead capture</p>
          </div>
          <button
            type="button"
            onClick={resetForm}
            className="mt-1 min-h-14 shrink-0 rounded-full border border-white/30 px-5 text-lg font-semibold"
          >
            Clear
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-6 pb-12">
        <div className="mb-5 rounded-2xl border border-[#e2d8c8] bg-white px-5 py-4 text-lg leading-snug text-[#3d4a5c]" aria-live="polite">
          {pending.length > 0
            ? `${pending.length} waiting to sync. ${syncing ? "Syncing now." : "They stay on this iPad until the network returns."}`
            : "Consent stays off until the visitor agrees. Unchecked means no consent."}
          {pending.length > 0 && (
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={syncing}
              className="ml-3 inline-flex min-h-12 items-center rounded-full bg-[#0c1b2a] px-4 text-base font-semibold text-white disabled:opacity-60"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
          )}
        </div>

        {needsAttention.length > 0 && (
          <div className="mb-5 space-y-3">
            {needsAttention.map((lead) => (
              <div key={lead.clientSubmissionId} className="rounded-2xl border border-[#e7c1c1] bg-[#fff6f6] px-5 py-4 text-lg">
                <p className="font-semibold">{lead.payload.fullName || "A saved lead"} needs a correction.</p>
                <p className="mt-1 text-[#6d3030]">{lead.lastError}</p>
                <button
                  type="button"
                  onClick={() => void removeExpoLead(lead.clientSubmissionId).then(() => listExpoLeads().then(setQueue))}
                  className="mt-3 min-h-12 rounded-full border border-[#6d3030] px-4 font-semibold"
                >
                  Remove from iPad
                </button>
              </div>
            ))}
          </div>
        )}

        {receipt ? (
          <section className="rounded-3xl bg-white px-6 py-10 text-center shadow-sm" aria-live="polite">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#9c7340]">Accel Analysis</p>
            <h2 className="mt-3 text-5xl font-semibold tracking-tight">
              {receipt.state === "synced" ? "Lead saved" : EXPO_OFFLINE_SAVED_MESSAGE}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-2xl leading-snug text-[#3d4a5c]">
              {receipt.state === "synced"
                ? `${receipt.name} is in the NASA Expo list.`
                : `${receipt.name} is stored on this iPad and will sync when the connection returns.`}
            </p>
            {memoryWarning && receipt.state === "queued" && (
              <p className="mt-3 text-lg text-[#6d3030]">Keep this page open until the lead syncs.</p>
            )}
            <button
              type="button"
              onClick={resetForm}
              className="mt-8 min-h-16 w-full rounded-2xl bg-[#0c1b2a] px-6 text-2xl font-semibold text-white"
            >
              Next visitor
            </button>
          </section>
        ) : (
          <form id={formId} onSubmit={(event) => void onSubmit(event)} className="space-y-8" noValidate>
            {error && (
              <div role="alert" className="rounded-2xl border border-[#e7c1c1] bg-[#fff6f6] px-5 py-4 text-xl text-[#6d3030]">
                {error}
              </div>
            )}

            <section className="space-y-4">
              <h2 className="text-2xl font-semibold">Visitor</h2>
              <Field label="Full name" required value={draft.fullName} autoComplete="name" onChange={(value) => update("fullName", value)} />
              <Field label="Email" type="email" inputMode="email" autoComplete="email" value={draft.email} onChange={(value) => update("email", value)} hint="Email or phone is required." />
              <Field label="Phone" type="tel" inputMode="tel" autoComplete="tel" value={draft.phone} onChange={(value) => update("phone", value)} />
            </section>

            <section className="space-y-4">
              <h2 className="text-2xl font-semibold">Organization</h2>
              <Field label="Organization" required autoComplete="organization" value={draft.organization} onChange={(value) => update("organization", value)} />
              <Field label="Role / title" required autoComplete="organization-title" value={draft.roleTitle} onChange={(value) => update("roleTitle", value)} />
              <div>
                <p className="text-xl font-semibold">Organization type <span className="text-[#9c7340]">*</span></p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  {EXPO_ORG_TYPES.map((orgType) => {
                    const selected = draft.orgType === orgType.id;
                    return (
                      <button
                        key={orgType.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => update("orgType", orgType.id)}
                        className={`min-h-16 rounded-2xl border-2 px-4 text-left text-xl font-semibold ${
                          selected
                            ? "border-[#0c1b2a] bg-[#0c1b2a] text-white"
                            : "border-[#e2d8c8] bg-white text-[#142033]"
                        }`}
                      >
                        {orgType.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h2 className="text-2xl font-semibold">Need</h2>
              <label className="block text-xl font-semibold" htmlFor={`${formId}-need`}>
                In their words <span className="text-[#9c7340]">*</span>
              </label>
              <textarea
                id={`${formId}-need`}
                required
                rows={4}
                maxLength={500}
                value={draft.need}
                onChange={(event) => update("need", event.target.value)}
                className="mt-2 w-full rounded-2xl border-2 border-[#e2d8c8] bg-white px-4 py-4 text-xl leading-snug outline-none focus:border-[#0c1b2a]"
              />
              <Field label="Timing" value={draft.timing} onChange={(value) => update("timing", value)} hint="Optional. This quarter, FY27, or whenever." />
            </section>

            <section className="space-y-3">
              <h2 className="text-2xl font-semibold">Only if they ask</h2>
              <p className="text-lg text-[#3d4a5c]">Leave these off unless the visitor asks about them.</p>
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

            <section className="space-y-3">
              <h2 className="text-2xl font-semibold">Consent</h2>
              <p className="text-lg text-[#3d4a5c]">All four start unchecked. Check a box only after the visitor agrees to that text.</p>
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

            <div className="border-t border-[#e2d8c8] pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="submit"
                disabled={saving}
                className="min-h-16 w-full rounded-2xl bg-[#9c7340] text-2xl font-semibold text-[#0c1b2a] disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save lead"}
              </button>
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
        {label} {required && <span className="text-[#9c7340]">*</span>}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-16 w-full rounded-2xl border-2 border-[#e2d8c8] bg-white px-4 text-xl outline-none focus:border-[#0c1b2a]"
      />
      {hint && <p className="mt-2 text-lg text-[#3d4a5c]">{hint}</p>}
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
    <label className="flex min-h-16 items-start gap-4 rounded-2xl border-2 border-[#e2d8c8] bg-white p-4">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-8 w-8 shrink-0 accent-[#0c1b2a]"
      />
      <span>
        <span className="block text-xl font-semibold">{label}</span>
        <span className="mt-1 block text-lg leading-snug text-[#3d4a5c]">{detail}</span>
      </span>
    </label>
  );
}
