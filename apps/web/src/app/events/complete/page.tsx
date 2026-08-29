"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { finalizeEventRegistration } from "@/lib/eventsV2";

type CheckoutState = {
  holdId: string;
  holdSecret: string;
  eventId: string;
  eventSlug: string;
  expiresAt: number;
};

function CompletionContent() {
  const searchParams = useSearchParams();
  const eventIdentifier = searchParams.get("event") || "";
  const [status, setStatus] = useState<"checking" | "confirmed" | "pending" | "failed">("checking");
  const [registrationId, setRegistrationId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function finalize() {
      const raw = sessionStorage.getItem("hi:eventCheckout");
      if (!raw) {
        if (active) setStatus("pending");
        return;
      }
      try {
        const checkout = JSON.parse(raw) as CheckoutState;
        const result = await finalizeEventRegistration({
          holdId: checkout.holdId,
          holdSecret: checkout.holdSecret,
        });
        if (!active) return;
        if (result.data.status === "confirmed") {
          sessionStorage.removeItem("hi:eventCheckout");
          setRegistrationId(result.data.registrationId || null);
          setStatus("confirmed");
        } else if (result.data.status === "failed") {
          setStatus("failed");
        } else {
          setStatus("pending");
        }
      } catch (error) {
        console.error("Event checkout finalization failed", error);
        if (active) setStatus("pending");
      }
    }
    void finalize();
    return () => { active = false; };
  }, []);

  return (
    <AppShell>
      <main className="mx-auto flex min-h-[65vh] w-full max-w-2xl items-center px-4 py-16 sm:px-6">
        <div className="w-full text-center">
          {status === "checking" && (
            <>
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-400" />
              <h1 className="mt-5 text-3xl font-semibold text-slate-950">Confirming your registration…</h1>
            </>
          )}

          {status === "confirmed" && (
            <>
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-950">You&apos;re registered.</h1>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">
                Payment is complete and your spot is confirmed. We&apos;ll send event details and reminders by email.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                {eventIdentifier && (
                  <Link href={`/events/detail?event=${encodeURIComponent(eventIdentifier)}`} className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white">View event</Link>
                )}
                {registrationId && (
                  <Link href="/events" className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 ring-1 ring-slate-200">More events</Link>
                )}
              </div>
            </>
          )}

          {status === "pending" && (
            <>
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-sky-600" />
              <h1 className="mt-5 text-3xl font-semibold text-slate-950">Payment received. We&apos;re finishing the registration.</h1>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">
                You do not need to pay again. Your confirmation email will arrive once the payment webhook completes.
              </p>
              <Link href="/events" className="mt-7 inline-flex rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white">Back to events</Link>
            </>
          )}

          {status === "failed" && (
            <>
              <h1 className="text-3xl font-semibold text-slate-950">The payment did not complete.</h1>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">No registration was confirmed. Return to the event to try again.</p>
              {eventIdentifier ? (
                <Link href={`/events/detail?event=${encodeURIComponent(eventIdentifier)}`} className="mt-7 inline-flex rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white">Return to event</Link>
              ) : (
                <Link href="/events" className="mt-7 inline-flex rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white">Events</Link>
              )}
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}

export default function EventCompletePage() {
  return (
    <Suspense fallback={<AppShell><div className="flex min-h-[65vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div></AppShell>}>
      <CompletionContent />
    </Suspense>
  );
}
