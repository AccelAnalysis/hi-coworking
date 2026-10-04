"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/authContext";
import { beginEventRegistration, submitEventInterest, type EventPublic } from "@/lib/eventsV2";

type ActionKind = "attend" | "pitch" | "prize";

const ACTIONS: Array<{ kind: ActionKind; label: string; detail: string }> = [
  {
    kind: "attend",
    label: "Attend the event",
    detail: "Reserve a seat to watch the competition.",
  },
  {
    kind: "prize",
    label: "Offer your business’s product as a prize",
    detail: "Tell us what your business can contribute to a prize package.",
  },
  {
    kind: "pitch",
    label: "Apply to pitch",
    detail: "This is a pre-screen for selected entrepreneurs. Applying does not reserve a pitch slot.",
  },
];

function actionError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message && message.toLowerCase() !== "internal") return message;
  return "We could not complete that request. Please try again.";
}

export function PitchEventActions({ event }: { event: EventPublic }) {
  const { user } = useAuth();
  const [kind, setKind] = useState<ActionKind>("attend");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<ActionKind | null>(null);

  const selected = ACTIONS.find((action) => action.kind === kind) || ACTIONS[0];
  const needsGuest = kind !== "attend" || !user;
  const canSubmit = !busy && (!needsGuest || (name.trim() && email.trim())) && (kind === "attend" || businessName.trim());

  async function submit() {
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
      await submitEventInterest({
        eventId: event.id,
        kind,
        name: name.trim(),
        email: email.trim(),
        businessName: businessName.trim(),
        note: note.trim() || undefined,
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
        <p className="mt-1 text-sm text-emerald-800">This is a pre-screen and does not reserve a pitch slot. We&apos;ll follow up by email.</p>
      </div>
    );
  }

  if (done === "prize") {
    return (
      <div className="rounded-3xl bg-emerald-50 p-6 text-emerald-950">
        <CheckCircle2 className="h-7 w-7" />
        <h2 className="mt-3 text-xl font-semibold">Prize offer received.</h2>
        <p className="mt-1 text-sm text-emerald-800">Thanks. We&apos;ll follow up by email about your business&apos;s product.</p>
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
            onClick={() => { setKind(action.kind); setMessage(null); }}
            className={`w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold ${kind === action.kind ? "bg-slate-950 text-white" : "bg-slate-50 text-slate-800 ring-1 ring-slate-200"}`}
          >
            {action.label}
          </button>
        ))}
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">{selected.detail}</p>

      {needsGuest && (
        <div className="mt-4 grid gap-3">
          <label className="text-sm font-medium text-slate-700">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
          </label>
        </div>
      )}

      {kind !== "attend" && (
        <div className="mt-4 grid gap-3">
          <label className="text-sm font-medium text-slate-700">
            Business name
            <input value={businessName} onChange={(event) => setBusinessName(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            {kind === "pitch" ? "What are you building?" : "What product can you offer?"}
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} className="mt-2 w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
          </label>
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
