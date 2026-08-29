"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { claimEventWaitlistOffer } from "@/lib/eventsV2";

function WaitlistClaimContent() {
  const params = useSearchParams();
  const entryId = params.get("entry") || "";
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    setToken(hash.get("token") || "");
  }, []);

  async function claim() {
    if (!entryId || !token) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await claimEventWaitlistOffer({
        entryId,
        token,
        successUrl: `${window.location.origin}/events/complete`,
        cancelUrl: window.location.href,
      });
      if (result.data.kind === "confirmed") {
        setConfirmed(true);
        return;
      }
      sessionStorage.setItem("hi:eventCheckout", JSON.stringify({
        holdId: result.data.holdId,
        holdSecret: result.data.holdSecret,
        eventId: "",
        eventSlug: "",
        expiresAt: result.data.expiresAt,
      }));
      window.location.assign(result.data.checkoutUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This waitlist offer could not be claimed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <main className="mx-auto flex min-h-[65vh] w-full max-w-xl items-center px-4 py-16 text-center sm:px-6">
        <div className="w-full">
          {confirmed ? (
            <>
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950">Your spot is confirmed.</h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">We&apos;ll send your registration details by email.</p>
              <Link href="/events" className="mt-7 inline-flex rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white">Events</Link>
            </>
          ) : (
            <>
              <Users className="mx-auto h-9 w-9 text-sky-700" />
              <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">A spot opened</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">Your place is temporarily reserved.</h1>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-600">
                Claim the spot now. If payment is required, you&apos;ll continue to secure checkout.
              </p>
              {message && <p className="mt-5 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{message}</p>}
              <button
                type="button"
                onClick={claim}
                disabled={busy || !entryId || !token}
                className="mt-7 inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Claim my spot
              </button>
              {(!entryId || !token) && (
                <p className="mt-4 text-xs text-slate-500">Use the complete claim link from your waitlist email.</p>
              )}
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}

export default function EventWaitlistPage() {
  return (
    <Suspense fallback={<AppShell><div className="flex min-h-[65vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div></AppShell>}>
      <WaitlistClaimContent />
    </Suspense>
  );
}
