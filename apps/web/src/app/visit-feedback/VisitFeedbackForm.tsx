"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { callableErrorMessage } from "@/lib/callableError";
import {
  FOUND_US_OPTIONS,
  IMPROVE_NOTHING,
  IMPROVE_OPTIONS,
  NPS_MAX_LABEL,
  NPS_MIN_LABEL,
  PURPOSE_OPTIONS,
  QUESTION_LABELS,
  RATING_ROWS,
  RATING_SCALE,
  RETURN_OPTIONS,
  SURVEY_INTRO,
  SURVEY_THANKS,
  WORKED_OPTIONS,
} from "@/lib/visitFeedbackQuestions";

const NAVY = "#101D4B";
const LOGO = "/brand/hi-coworking/hi-coworking-mark-256.png";

const getInvitation = httpsCallable<{ token: string }, { ok: true; visitDate: string; hasEmail: boolean } | { ok: false; reason: "invalid" | "used" }>(
  functions,
  "visitFeedback_getInvitation",
);
const submitFeedback = httpsCallable<{ token: string; answers: Record<string, unknown> }, { ok: true } | { ok: false; reason: string }>(
  functions,
  "visitFeedback_submit",
);

type Status = "loading" | "ready" | "used" | "invalid" | "thanks";

type Draft = {
  purpose: string;
  purposeOther: string;
  foundUs: string;
  foundUsOther: string;
  ratings: Record<string, string>;
  worked: string[];
  workedOther: string;
  improve: string[];
  improveOther: string;
  returnLikelihood: string;
  nps: number | null;
  comments: string;
  followupConsent: boolean;
  followupEmail: string;
};

const EMPTY: Draft = {
  purpose: "",
  purposeOther: "",
  foundUs: "",
  foundUsOther: "",
  ratings: {},
  worked: [],
  workedOther: "",
  improve: [],
  improveOther: "",
  returnLikelihood: "",
  nps: null,
  comments: "",
  followupConsent: false,
  followupEmail: "",
};

function tokenFromLocation(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("t")?.trim() || "";
}

function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="font-display text-xl font-semibold tracking-tight" style={{ color: NAVY, fontFamily: "var(--font-fraunces), Georgia, serif" }}>
        {label}
        {optional ? <span className="ml-2 text-sm font-normal text-slate-500">Optional</span> : null}
      </legend>
      {hint ? <p className="text-sm text-slate-500">{hint}</p> : null}
      {children}
    </fieldset>
  );
}

function Choice({
  checked,
  onChange,
  children,
  name,
  type = "radio",
}: {
  checked: boolean;
  onChange: () => void;
  children: React.ReactNode;
  name: string;
  type?: "radio" | "checkbox";
}) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-[15px] leading-snug transition-colors motion-reduce:transition-none ${checked ? "border-[#101D4B] bg-[#101D4B]/5" : "border-slate-200 bg-white hover:border-slate-300"}`}>
      <input type={type} name={name} checked={checked} onChange={onChange} className="h-4 w-4 accent-[#101D4B]" />
      <span>{children}</span>
    </label>
  );
}

function Shell({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-[#f6f4ef] px-4 py-10 sm:py-16" style={{ fontFamily: "var(--font-dm-sans), Arial, sans-serif" }}>
      <div className="mx-auto w-full max-w-xl">
        <div className="overflow-hidden rounded-[28px] border border-white/80 bg-white shadow-[0_24px_80px_rgba(16,29,75,0.08)]">
          <div className="h-1.5 w-full" style={{ background: NAVY }} />
          <div className="px-6 py-8 sm:px-10 sm:py-10">
            <Image src={LOGO} alt="Hi Coworking" width={48} height={48} className="h-12 w-12" />
            {children}
          </div>
        </div>
        {footer}
      </div>
    </main>
  );
}

export function VisitFeedbackForm() {
  const [status, setStatus] = useState<Status>("loading");
  const [visitDate, setVisitDate] = useState("");
  const [hasEmail, setHasEmail] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const token = useMemo(() => tokenFromLocation(), []);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setStatus("invalid");
      return;
    }
    void getInvitation({ token })
      .then((result) => {
        if (cancelled) return;
        const data = result.data;
        if (!data.ok) {
          setStatus(data.reason === "used" ? "used" : "invalid");
          return;
        }
        setVisitDate(data.visitDate);
        setHasEmail(data.hasEmail);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function toggleImprove(value: string) {
    setDraft((current) => {
      if (value === IMPROVE_NOTHING) {
        return { ...current, improve: current.improve.includes(IMPROVE_NOTHING) ? [] : [IMPROVE_NOTHING], improveOther: "" };
      }
      const withoutNothing = current.improve.filter((item) => item !== IMPROVE_NOTHING);
      const next = withoutNothing.includes(value)
        ? withoutNothing.filter((item) => item !== value)
        : [...withoutNothing, value];
      return { ...current, improve: next, improveOther: value === "other" && withoutNothing.includes(value) ? "" : current.improveOther };
    });
  }

  function toggleWorked(value: string) {
    setDraft((current) => {
      const next = current.worked.includes(value)
        ? current.worked.filter((item) => item !== value)
        : [...current.worked, value];
      return { ...current, worked: next, workedOther: value === "other" && current.worked.includes(value) ? "" : current.workedOther };
    });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const result = await submitFeedback({
        token,
        answers: {
          purpose: draft.purpose,
          purposeOther: draft.purposeOther,
          foundUs: draft.foundUs,
          foundUsOther: draft.foundUsOther,
          ratings: draft.ratings,
          worked: draft.worked,
          workedOther: draft.workedOther,
          improve: draft.improve,
          improveOther: draft.improveOther,
          returnLikelihood: draft.returnLikelihood,
          nps: draft.nps,
          comments: draft.comments,
          followupConsent: draft.followupConsent,
          followupEmail: draft.followupEmail,
        },
      });
      if (!result.data.ok) {
        setError(result.data.reason === "used" ? "You've already sent this survey." : "Please check your answers and try again.");
        if (result.data.reason === "used") setStatus("used");
        return;
      }
      setStatus("thanks");
    } catch (caught) {
      setError(callableErrorMessage(caught, "Please check your answers and try again."));
    } finally {
      setSaving(false);
    }
  }

  if (status === "loading") {
    return (
      <Shell>
        <p className="mt-8 text-slate-500">Loading your survey…</p>
      </Shell>
    );
  }

  if (status === "invalid" || status === "used") {
    return (
      <Shell
        footer={
          <p className="mt-6 text-center text-sm text-slate-500">
            <Link href="/" className="font-medium underline-offset-4 hover:underline" style={{ color: NAVY }}>Back to Hi Coworking</Link>
          </p>
        }
      >
        <h1 className="mt-6 text-3xl font-semibold tracking-tight" style={{ color: NAVY, fontFamily: "var(--font-fraunces), Georgia, serif" }}>
          {status === "used" ? "You've already shared your feedback" : "This link isn't valid"}
        </h1>
        <p className="mt-3 text-[16px] leading-7 text-slate-600">
          {status === "used"
            ? "Thank you — we have your response. There's nothing else you need to do."
            : "This survey link may be incomplete or no longer available. If you still want to share feedback, write us at hello@hi-coworking.com."}
        </p>
      </Shell>
    );
  }

  if (status === "thanks") {
    return (
      <Shell>
        <p className="mt-8 text-sm font-semibold tracking-wide text-slate-500">Thank you</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight motion-safe:animate-[fadeUp_420ms_ease]" style={{ color: NAVY, fontFamily: "var(--font-fraunces), Georgia, serif" }}>
          We appreciate you
        </h1>
        <p className="mt-4 text-[16px] leading-7 text-slate-600">{SURVEY_THANKS}</p>
        <p className="mt-8">
          <Link href="/" className="inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold text-white" style={{ background: NAVY }}>
            Back to Hi Coworking
          </Link>
        </p>
        <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } } @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }`}</style>
      </Shell>
    );
  }

  return (
    <Shell
      footer={
        <p className="mt-6 text-center text-sm text-slate-500">
          Your answers help us improve Hi Coworking. Read our <Link href="/privacy" className="underline-offset-4 hover:underline" style={{ color: NAVY }}>Privacy Policy</Link>.
        </p>
      }
    >
      <p className="mt-8 text-sm font-semibold tracking-wide text-slate-500">
        {visitDate ? `Your visit on ${visitDate}` : "Your visit"}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight" style={{ color: NAVY, fontFamily: "var(--font-fraunces), Georgia, serif" }}>
        How was your visit?
      </h1>
      <p className="mt-3 text-[16px] leading-7 text-slate-600">{SURVEY_INTRO}</p>

      <form className="mt-10 space-y-10" onSubmit={(event) => void onSubmit(event)}>
        <Field label={QUESTION_LABELS.purpose}>
          <div className="grid gap-2">
            {PURPOSE_OPTIONS.map((option) => (
              <Choice key={option.value} name="purpose" checked={draft.purpose === option.value} onChange={() => setDraft((d) => ({ ...d, purpose: option.value }))}>
                {option.label}
              </Choice>
            ))}
          </div>
          {draft.purpose === "other" ? (
            <input className="mt-2 min-h-11 w-full rounded-2xl border border-slate-200 px-4 text-[15px]" value={draft.purposeOther} onChange={(e) => setDraft((d) => ({ ...d, purposeOther: e.target.value }))} maxLength={200} placeholder="Tell us a little more" />
          ) : null}
        </Field>

        <Field label={QUESTION_LABELS.foundUs}>
          <div className="grid gap-2">
            {FOUND_US_OPTIONS.map((option) => (
              <Choice key={option.value} name="foundUs" checked={draft.foundUs === option.value} onChange={() => setDraft((d) => ({ ...d, foundUs: option.value }))}>
                {option.label}
              </Choice>
            ))}
          </div>
          {draft.foundUs === "other" ? (
            <input className="mt-2 min-h-11 w-full rounded-2xl border border-slate-200 px-4 text-[15px]" value={draft.foundUsOther} onChange={(e) => setDraft((d) => ({ ...d, foundUsOther: e.target.value }))} maxLength={200} placeholder="Tell us a little more" />
          ) : null}
        </Field>

        <Field label={QUESTION_LABELS.ratings}>
          <div className="space-y-5">
            {RATING_ROWS.map((row) => (
              <div key={row.value}>
                <p className="mb-2 text-sm font-medium text-slate-800">{row.label}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {RATING_SCALE.map((option) => (
                    <Choice
                      key={option.value}
                      name={`rating-${row.value}`}
                      checked={draft.ratings[row.value] === option.value}
                      onChange={() => setDraft((d) => ({ ...d, ratings: { ...d.ratings, [row.value]: option.value } }))}
                    >
                      {option.label}
                    </Choice>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Field>

        <Field label={QUESTION_LABELS.worked} optional>
          <div className="grid gap-2">
            {WORKED_OPTIONS.map((option) => (
              <Choice key={option.value} type="checkbox" name="worked" checked={draft.worked.includes(option.value)} onChange={() => toggleWorked(option.value)}>
                {option.label}
              </Choice>
            ))}
          </div>
          {draft.worked.includes("other") ? (
            <input className="mt-2 min-h-11 w-full rounded-2xl border border-slate-200 px-4 text-[15px]" value={draft.workedOther} onChange={(e) => setDraft((d) => ({ ...d, workedOther: e.target.value }))} maxLength={200} placeholder="What else worked well?" />
          ) : null}
        </Field>

        <Field label={QUESTION_LABELS.improve}>
          <div className="grid gap-2">
            {IMPROVE_OPTIONS.map((option) => (
              <Choice key={option.value} type="checkbox" name="improve" checked={draft.improve.includes(option.value)} onChange={() => toggleImprove(option.value)}>
                {option.label}
              </Choice>
            ))}
          </div>
          {draft.improve.includes("other") ? (
            <input className="mt-2 min-h-11 w-full rounded-2xl border border-slate-200 px-4 text-[15px]" value={draft.improveOther} onChange={(e) => setDraft((d) => ({ ...d, improveOther: e.target.value }))} maxLength={200} placeholder="What else could we improve?" />
          ) : null}
        </Field>

        <Field label={QUESTION_LABELS.returnLikelihood}>
          <div className="grid gap-2">
            {RETURN_OPTIONS.map((option) => (
              <Choice key={option.value} name="returnLikelihood" checked={draft.returnLikelihood === option.value} onChange={() => setDraft((d) => ({ ...d, returnLikelihood: option.value }))}>
                {option.label}
              </Choice>
            ))}
          </div>
        </Field>

        <Field label={QUESTION_LABELS.nps} hint={`${NPS_MIN_LABEL} (0) to ${NPS_MAX_LABEL} (10)`}>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 11 }, (_, score) => {
              const selected = draft.nps === score;
              return (
                <button
                  key={score}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, nps: score }))}
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-full border text-sm font-semibold transition-colors motion-reduce:transition-none ${selected ? "border-transparent text-white" : "border-slate-200 bg-white text-slate-800 hover:border-slate-300"}`}
                  style={selected ? { background: NAVY } : undefined}
                  aria-pressed={selected}
                  aria-label={`${score}`}
                >
                  {score}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={QUESTION_LABELS.comments} optional>
          <textarea
            className="min-h-28 w-full rounded-2xl border border-slate-200 px-4 py-3 text-[15px] leading-6"
            value={draft.comments}
            onChange={(e) => setDraft((d) => ({ ...d, comments: e.target.value }))}
            maxLength={2000}
            placeholder="Anything at all — we read every response."
          />
        </Field>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 px-4 py-4">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-[#101D4B]"
            checked={draft.followupConsent}
            onChange={(e) => setDraft((d) => ({ ...d, followupConsent: e.target.checked, followupEmail: e.target.checked ? d.followupEmail : "" }))}
          />
          <span className="text-[15px] leading-6 text-slate-800">{QUESTION_LABELS.followupConsent}</span>
        </label>
        {draft.followupConsent && !hasEmail ? (
          <input
            type="email"
            className="min-h-11 w-full rounded-2xl border border-slate-200 px-4 text-[15px]"
            value={draft.followupEmail}
            onChange={(e) => setDraft((d) => ({ ...d, followupEmail: e.target.value }))}
            placeholder="Email for a follow-up"
            autoComplete="email"
            required
          />
        ) : null}

        {error ? <p className="text-sm text-red-700" role="alert">{error}</p> : null}

        <button
          type="submit"
          disabled={saving}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-full text-sm font-semibold text-white disabled:opacity-60 sm:w-auto sm:px-8"
          style={{ background: NAVY }}
        >
          {saving ? "Sending…" : "Send feedback"}
        </button>
      </form>
    </Shell>
  );
}
