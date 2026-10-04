"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/authContext";
import { beginEventRegistration, submitEventInterest, type EventPublic } from "@/lib/eventsV2";

type ActionKind = "attend" | "pitch" | "prize";

const SMS_CONSENT_TEXT = "I agree to receive SMS text messages from Hi Coworking at the phone number I provided about this event. Message frequency varies. Message and data rates may apply. Reply STOP to opt out and HELP for help.";

const ADVERTISING_CONSENT_TEXT = "I agree that Hi Coworking may share my contact information with participating businesses so they can contact me about their products, services, or offerings.";

const ACTIONS: Array<{ kind: ActionKind; label: string; detail: string }> = [
  {
    kind: "attend",
    label: "Attend the event",
    detail: "Reserve a seat to watch the competition.",
  },
  {
    kind: "prize",
    label: "Offer your business’s product as a prize",
    detail: "Tell us what your business can contribute. This is an intake form, not a registration.",
  },
  {
    kind: "pitch",
    label: "Apply to pitch",
    detail: "Submitting does not reserve a pitch slot.",
  },
];

const fieldClass = "mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400";

function actionError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message && message.toLowerCase() !== "internal") return message;
  return "We could not complete that request. Please try again.";
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      {children}
    </label>
  );
}

function ConsentFields({
  smsConsent,
  advertisingConsent,
  onSms,
  onAdvertising,
}: {
  smsConsent: boolean;
  advertisingConsent: boolean;
  onSms: (checked: boolean) => void;
  onAdvertising: (checked: boolean) => void;
}) {
  return (
    <div className="space-y-3 text-sm leading-6 text-slate-600">
      <label className="flex items-start gap-3">
        <input type="checkbox" checked={smsConsent} onChange={(event) => onSms(event.target.checked)} className="mt-1" required />
        <span>{SMS_CONSENT_TEXT}</span>
      </label>
      <label className="flex items-start gap-3">
        <input type="checkbox" checked={advertisingConsent} onChange={(event) => onAdvertising(event.target.checked)} className="mt-1" required />
        <span>{ADVERTISING_CONSENT_TEXT}</span>
      </label>
      <p>
        <Link href="/privacy" target="_blank" className="font-semibold text-sky-800">Privacy Policy</Link>
        {" · "}
        <Link href="/terms" target="_blank" className="font-semibold text-sky-800">Terms of Service</Link>
      </p>
    </div>
  );
}

export function PitchEventActions({ event }: { event: EventPublic }) {
  const { user } = useAuth();
  const [kind, setKind] = useState<ActionKind>("attend");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [website, setWebsite] = useState("");
  const [businessDescription, setBusinessDescription] = useState("");
  const [offer, setOffer] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [advertisingConsent, setAdvertisingConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<ActionKind | null>(null);

  const selected = ACTIONS.find((action) => action.kind === kind) || ACTIONS[0];
  const needsGuest = kind !== "attend" || !user;
  const consentsChecked = smsConsent && advertisingConsent;
  const pitchReady = Boolean(firstName.trim() && lastName.trim() && businessName.trim() && businessDescription.trim() && website.trim() && email.trim() && phone.trim() && consentsChecked);
  const prizeReady = Boolean(name.trim() && email.trim() && phone.trim() && businessName.trim() && website.trim() && offer.trim() && consentsChecked);
  const attendReady = !needsGuest || Boolean(name.trim() && email.trim());
  const canSubmit = !busy && (kind === "attend" ? attendReady : kind === "pitch" ? pitchReady : prizeReady);

  function choose(next: ActionKind) {
    setKind(next);
    setMessage(null);
    setSmsConsent(false);
    setAdvertisingConsent(false);
  }

  async function submit() {
    if (!canSubmit) return;
    setMessage(null);
    setBusy(true);
    try {
      if (kind === "attend") {
        const result = await beginEventRegistration({
          eventId: event.id,
          quantity: 1,
          ...(!user ? { guest: { name: name.trim(), email: email.trim() } } : {}),
        });
        if (result.data.kind === "full") {
          setMessage("This event is full, so a seat could not be reserved.");
          return;
        }
        setDone("attend");
        return;
      }
      if (!consentsChecked) return;
      await submitEventInterest(kind === "pitch" ? {
        eventId: event.id,
        kind,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        businessName: businessName.trim(),
        businessDescription: businessDescription.trim(),
        website: website.trim(),
        smsConsent: true,
        advertisingConsent: true,
      } : {
        eventId: event.id,
        kind,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        businessName: businessName.trim(),
        website: website.trim(),
        offer: offer.trim(),
        smsConsent: true,
        advertisingConsent: true,
      });
      setDone(kind);
    } catch (error) {
      setMessage(actionError(error));
    } finally {
      setBusy(false);
    }
  }

  if (done === "attend") {
    return (
      <div className="rounded-3xl bg-emerald-50 p-6 text-emerald-950">
        <CheckCircle2 className="h-7 w-7" />
        <h2 className="mt-3 text-xl font-semibold">You&apos;re registered to attend.</h2>
        <p className="mt-1 text-sm text-emerald-800">We&apos;ll send your confirmation and event details by email.</p>
      </div>
    );
  }

  if (done === "pitch") {
    return (
      <div className="rounded-3xl bg-emerald-50 p-6 text-emerald-950">
        <CheckCircle2 className="h-7 w-7" />
        <h2 className="mt-3 text-xl font-semibold">Application received.</h2>
        <p className="mt-1 text-sm text-emerald-800">Submitting does not reserve a pitch slot. We saved this application for review.</p>
      </div>
    );
  }

  if (done === "prize") {
    return (
      <div className="rounded-3xl bg-emerald-50 p-6 text-emerald-950">
        <CheckCircle2 className="h-7 w-7" />
        <h2 className="mt-3 text-xl font-semibold">Prize offer received.</h2>
        <p className="mt-1 text-sm text-emerald-800">We saved this offer for review.</p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Take part</p>
      <div className="mt-4 space-y-2">
        {ACTIONS.map((action) => (
          <button
            key={action.kind}
            type="button"
            onClick={() => choose(action.kind)}
            className={`w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold ${kind === action.kind ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-800 ring-1 ring-slate-200"}`}
          >
            {action.label}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">{selected.detail}</p>

      {kind === "attend" && needsGuest && (
        <div className="mt-4 grid gap-3">
          <Field label="Name"><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className={fieldClass} /></Field>
          <Field label="Email"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className={fieldClass} /></Field>
        </div>
      )}

      {kind === "pitch" && (
        <div className="mt-4 grid gap-3">
          <p className="text-sm font-medium text-slate-800">Submitting does not reserve a pitch slot.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First name"><input value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="given-name" className={fieldClass} /></Field>
            <Field label="Last name"><input value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="family-name" className={fieldClass} /></Field>
          </div>
          <Field label="Business name"><input value={businessName} onChange={(event) => setBusinessName(event.target.value)} autoComplete="organization" className={fieldClass} /></Field>
          <Field label="Business description"><textarea value={businessDescription} onChange={(event) => setBusinessDescription(event.target.value)} rows={4} className={`${fieldClass} resize-y`} /></Field>
          <Field label="Website"><input value={website} onChange={(event) => setWebsite(event.target.value)} inputMode="url" autoComplete="url" placeholder="https://" className={fieldClass} /></Field>
          <Field label="Email"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className={fieldClass} /></Field>
          <Field label="Phone"><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" className={fieldClass} /></Field>
          <ConsentFields smsConsent={smsConsent} advertisingConsent={advertisingConsent} onSms={setSmsConsent} onAdvertising={setAdvertisingConsent} />
        </div>
      )}

      {kind === "prize" && (
        <div className="mt-4 grid gap-3">
          <Field label="Name"><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className={fieldClass} /></Field>
          <Field label="Email"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className={fieldClass} /></Field>
          <Field label="Phone"><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" className={fieldClass} /></Field>
          <Field label="Business name"><input value={businessName} onChange={(event) => setBusinessName(event.target.value)} autoComplete="organization" className={fieldClass} /></Field>
          <Field label="Website"><input value={website} onChange={(event) => setWebsite(event.target.value)} inputMode="url" autoComplete="url" placeholder="https://" className={fieldClass} /></Field>
          <Field label="What are you offering?"><textarea value={offer} onChange={(event) => setOffer(event.target.value)} rows={4} className={`${fieldClass} resize-y`} /></Field>
          <ConsentFields smsConsent={smsConsent} advertisingConsent={advertisingConsent} onSms={setSmsConsent} onAdvertising={setAdvertisingConsent} />
        </div>
      )}

      {message && <p className="mt-4 text-sm text-rose-600">{message}</p>}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={!canSubmit}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {selected.label}
      </button>
    </div>
  );
}
