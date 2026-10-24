"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, Loader2, MailX, MessageSquare } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { SmsConsentCheckbox } from "@/components/sms/SmsConsentCheckbox";
import { useAuth } from "@/lib/authContext";
import { functions } from "@/lib/firebase";
import { HI_SMS_CONSENT_VERSION, normalizeUsMobile, setMemberSmsConsent } from "@/lib/smsConsent";

const unsubscribe = httpsCallable<{ token: string }, { success: boolean }>(functions, "nurture_unsubscribe");

type EmailState = "loading" | "success" | "missing" | "error";
type StoredSmsConsent = { optIn?: boolean; phone?: string | null };

function formatUsPhone(e164: string | null | undefined) {
  const digits = String(e164 || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : "";
}

function EmailPreference() {
  const [state, setState] = useState<EmailState>("loading");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") || "";
    if (!token) {
      setState("missing");
      return;
    }
    void unsubscribe({ token })
      .then(() => setState("success"))
      .catch((error) => {
        console.error(error);
        setState("error");
      });
  }, []);

  if (state === "missing") return null;

  return (
    <section className="w-full border-b border-slate-200 py-10 text-center" aria-live="polite">
      {state === "loading" ? (
        <><Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-400" aria-hidden="true" /><h1 className="mt-5 text-2xl font-semibold text-slate-950">Updating your preferences</h1></>
      ) : state === "success" ? (
        <><CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" aria-hidden="true" /><h1 className="mt-5 text-2xl font-semibold text-slate-950">Follow-up emails are off</h1><p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">You will no longer receive Hi Coworking nurture or promotional follow-up at this address. Essential booking, payment, account, and access messages are unaffected.</p></>
      ) : (
        <><MailX className="mx-auto h-9 w-9 text-rose-600" aria-hidden="true" /><h1 className="mt-5 text-2xl font-semibold text-slate-950">We could not update this link</h1><p className="mt-3 text-sm text-slate-600">The link may already be expired or invalid. You can still contact Hi Coworking to update your communication preference.</p></>
      )}
    </section>
  );
}

function TextPreference() {
  const { user, userDoc, loading } = useAuth();
  const stored = ((userDoc as { smsConsent?: StoredSmsConsent } | null)?.smsConsent ?? null) as StoredSmsConsent | null;
  const optedIn = stored?.optIn === true;
  const [phone, setPhone] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(false);

  useEffect(() => {
    setRetry(new URLSearchParams(window.location.search).get("sms") === "retry");
  }, []);

  useEffect(() => {
    setChecked(optedIn);
    if (stored?.phone) setPhone(formatUsPhone(stored.phone));
  }, [optedIn, stored?.phone]);

  const save = async () => {
    setError("");
    setStatus("");
    const smsPhone = checked ? normalizeUsMobile(phone) : null;
    if (checked && !smsPhone) {
      setError("Enter a 10-digit US mobile number to get texts.");
      return;
    }
    setBusy(true);
    try {
      const result = await setMemberSmsConsent({
        optIn: checked,
        phone: smsPhone || undefined,
        source: "preferences",
        textVersion: HI_SMS_CONSENT_VERSION,
      });
      setRetry(false);
      setStatus(result.data.optIn ? `Event texts are on for ${formatUsPhone(result.data.phone)}.` : "Event texts are off.");
    } catch (saveError) {
      console.error(saveError);
      setError("We couldn't save your text preference. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="w-full py-10" aria-labelledby="sms-preferences-heading">
      <div className="flex items-center gap-3">
        <MessageSquare className="h-6 w-6 text-slate-500" aria-hidden="true" />
        <h2 id="sms-preferences-heading" className="text-xl font-semibold text-slate-950">Text messages</h2>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Get Hi Coworking event invitations, reminders and updates by text. Texts are optional, and you can turn them off here or reply STOP at any time.
      </p>

      {loading ? (
        <Loader2 className="mt-6 h-6 w-6 animate-spin text-slate-400" aria-label="Loading" />
      ) : !user ? (
        <p className="mt-6 text-sm text-slate-700">
          <Link href="/login" className="font-semibold text-sky-800 underline underline-offset-2">Sign in</Link>{" "}
          to manage text messages for your account.
        </p>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {retry && !optedIn && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              Your account is ready. We couldn&apos;t turn on texts during sign-up, so you can do that here.
            </p>
          )}
          <div className="space-y-1.5">
            <label htmlFor="sms-phone" className="text-sm font-semibold text-slate-700">Mobile number</label>
            <input
              id="sms-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="(555) 555-5555"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>
          <SmsConsentCheckbox checked={checked} onChange={setChecked} disabled={busy} />
          {error && <p className="text-sm text-rose-700" role="alert">{error}</p>}
          {status && <p className="text-sm text-emerald-700" role="status">{status}</p>}
          <button
            type="submit"
            disabled={busy}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white disabled:opacity-70"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="Saving" /> : "Save text preference"}
          </button>
        </form>
      )}
    </section>
  );
}

export default function PreferencesPage() {
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
        <EmailPreference />
        <TextPreference />
        <p className="border-t border-slate-200 pt-6 text-sm text-slate-600">
          See <Link href="/sms-terms" className="font-semibold text-sky-800 underline underline-offset-2">SMS Terms</Link> and{" "}
          <Link href="/privacy" className="font-semibold text-sky-800 underline underline-offset-2">Privacy Policy</Link>. To stop follow-up emails, use the link in any Hi Coworking follow-up email.
        </p>
        <Link href="/" className="mt-7 inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-slate-800">Return to Hi Coworking</Link>
      </main>
    </AppShell>
  );
}
