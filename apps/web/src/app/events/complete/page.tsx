"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { finalizeEventRegistrationV2 } from "@/lib/eventFunctionsV2";
import { CheckCircle2, Loader2 } from "lucide-react";

type StoredCheckout = {
  holdId: string;
  holdSecret: string;
  eventId: string;
};

export default function EventCheckoutCompletePage() {
  const [state, setState] = useState<"loading" | "confirmed" | "pending" | "error">("loading");
  const [eventId, setEventId] = useState("");

  useEffect(() => {
    const raw = sessionStorage.getItem("hi-event-checkout");
    if (!raw) {
      setState("error");
      return;
    }
    let checkout: StoredCheckout;
    try {
      checkout = JSON.parse(raw) as StoredCheckout;
    } catch {
      setState("error");
      return;
    }
    setEventId(checkout.eventId);

    let cancelled = false;
    let attempts = 0;
    const finalize = async () => {
      attempts += 1;
      try {
        const result = await finalizeEventRegistrationV2({
          holdId: checkout.holdId,
          holdSecret: checkout.holdSecret,
        });
        if (cancelled) return;
        if (result.data.status === "confirmed") {
          sessionStorage.setItem("hi-event-registration", JSON.stringify({
            registrationId: result.data.registrationId,
            manageSecret: checkout.holdSecret,
            eventId: checkout.eventId,
          }));
          sessionStorage.removeItem("hi-event-checkout");
          setState("confirmed");
          return;
        }
        if (attempts < 8) {
          setState("pending");
          window.setTimeout(finalize, 1500);
        } else {
          setState("pending");
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) setState("error");
      }
    };
    void finalize();
    return () => { cancelled = true; };
  }, []);

  return (
    <AppShell>
      <main className="mx-auto flex min-h-[65vh] max-w-xl items-center px-4 py-16 text-center">
        <div className="w-full">
          {state === "loading" && <Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-400" />}
          {state === "confirmed" && <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />}
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-950">
            {state === "confirmed" ? "You're registered" : state === "error" ? "We couldn't verify the registration" : "Confirming your registration"}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-600">
            {state === "confirmed"
              ? "Your payment and event spot are confirmed."
              : state === "error"
                ? "Your payment may still have completed. Please return to the event page or contact Hi Coworking if you need help."
                : "Stripe is confirming the payment with Hi Coworking. You can leave this page; the server also finalizes paid registrations independently."}
          </p>
          <div className="mt-8 flex justify-center gap-3">
            {eventId && <Link href={`/events/detail?id=${eventId}`} className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white">View event</Link>}
            <Link href="/events" className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700">All events</Link>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
