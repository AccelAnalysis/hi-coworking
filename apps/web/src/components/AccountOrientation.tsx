"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { reload, sendEmailVerification, type User } from "firebase/auth";
import { createVerificationController } from "@/lib/emailVerification";

function storedCooldown(uid: string): number {
  try { return Number(sessionStorage.getItem(`verification-cooldown:${uid}`)) || 0; } catch { return 0; }
}

export function AccountOrientation({ user }: { user: User }) {
  const [verified, setVerified] = useState(user.emailVerified);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [now, setNow] = useState(0);
  const controller = useMemo(() => createVerificationController({
    isVerified: () => user.emailVerified,
    retryAt: storedCooldown(user.uid),
    onCooldown: (until) => {
      try { sessionStorage.setItem(`verification-cooldown:${user.uid}`, String(until)); } catch { /* Memory cooldown still applies. */ }
    },
    // Called only by the explicit button handler, never by rendering or an effect.
    send: () => sendEmailVerification(user, { url: `${window.location.origin}/account/bookings` }),
  }), [user]);

  useEffect(() => {
    setVerified(user.emailVerified);
    setNotice("");
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [user]);

  const waitSeconds = Math.max(0, Math.ceil((controller.getRetryAt() - now) / 1000));
  async function requestVerification() {
    setBusy(true);
    const result = await controller.request();
    setNotice(result.message);
    setError(!result.ok);
    setNow(Date.now());
    setBusy(false);
  }
  async function refreshVerification() {
    setBusy(true);
    setError(false);
    try {
      await reload(user);
      await user.getIdToken(true);
      setVerified(user.emailVerified);
      setNotice(user.emailVerified ? "Email verified. Thank you!" : "Your email is not verified yet. Open the verification link in your inbox, then refresh again.");
    } catch {
      setError(true);
      setNotice("We could not refresh your verification status. Please try again; your bookings are unaffected.");
    } finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="arrival-checklist-title" className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <h2 id="arrival-checklist-title" className="text-lg font-semibold text-slate-900">Before your first visit</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600">
        <li>Review your booking time and workspace below. <Link className="underline" href="/book">Need a reservation?</Link></li>
        <li>Check the access status for your booking before arrival. Booking confirmation does not mean your door credential is ready.</li>
        <li><Link className="underline" href="/contact">Contact the team</Link> if access is missing or you need arrival help. <Link className="underline" href="/spaces">Explore the spaces.</Link></li>
      </ol>
      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="text-sm font-semibold text-slate-900">Email {verified ? "verified" : "not yet verified"}{user.email ? `: ${user.email}` : ""}</p>
        {!verified && <>
          <p className="mt-1 text-sm text-slate-600">Verify your address to keep your account contact details trustworthy. You can continue booking and managing reservations without doing this now.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" disabled={busy || waitSeconds > 0 || !user.email} onClick={requestVerification} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {waitSeconds > 0 ? `Request again in ${waitSeconds}s` : "Send verification email"}
            </button>
            <button type="button" disabled={busy} onClick={refreshVerification} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">I verified — refresh status</button>
          </div>
        </>}
        {notice && <p role={error ? "alert" : "status"} className={`mt-3 text-sm ${error ? "text-red-700" : "text-slate-600"}`}>{notice}</p>}
      </div>
    </section>
  );
}
