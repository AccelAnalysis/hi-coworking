"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { functions } from "@/lib/firebase";

const finalizeCheckout = httpsCallable<
  { holdId: string; holdSecret?: string },
  { success: boolean; bookingId: string; alreadyFinalized?: boolean }
>(functions, "booking_finalizeCheckout");

type State =
  | { kind: "loading" }
  | { kind: "success"; bookingId: string }
  | { kind: "error"; message: string };

export default function BookingCompletePage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const alreadyConfirmed = params.get("bookingId");
    if (alreadyConfirmed) {
      setState({ kind: "success", bookingId: alreadyConfirmed });
      return;
    }

    let stored: { holdId?: string; holdSecret?: string; expiresAt?: number } | null = null;
    try {
      const raw = window.localStorage.getItem("hi-coworking-booking-hold");
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      stored = null;
    }

    if (!stored?.holdId || !stored.holdSecret) {
      setState({ kind: "error", message: "We could not find the booking hold for this checkout. If you were charged, please contact Hi Coworking so we can reconcile it." });
      return;
    }

    let cancelled = false;
    async function finalize() {
      try {
        const result = await finalizeCheckout({ holdId: stored!.holdId!, holdSecret: stored!.holdSecret });
        if (cancelled) return;
        window.localStorage.removeItem("hi-coworking-booking-hold");
        setState({ kind: "success", bookingId: result.data.bookingId });
      } catch (error) {
        console.error(error);
        if (cancelled) return;
        setState({ kind: "error", message: "Payment returned, but confirmation is still pending. Please refresh once. If it remains pending, contact Hi Coworking before making another payment." });
      }
    }
    void finalize();
    return () => { cancelled = true; };
  }, []);

  return (
    <AppShell>
      <main className="mx-auto flex min-h-[65vh] w-full max-w-2xl items-center px-4 py-12 sm:px-6">
        {state.kind === "loading" ? (
          <div className="w-full text-center">
            <Loader2 className="mx-auto h-9 w-9 animate-spin text-slate-500" />
            <h1 className="mt-5 text-2xl font-semibold text-slate-950">Confirming your booking…</h1>
            <p className="mt-2 text-slate-600">We are checking payment and securing the space.</p>
          </div>
        ) : state.kind === "success" ? (
          <div className="w-full text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <p className="mt-5 text-sm font-medium text-slate-500">You’re booked</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Your space is confirmed.</h1>
            <p className="mx-auto mt-3 max-w-lg text-slate-600">Your booking is saved. Access instructions are tied to the confirmed reservation, not the checkout attempt.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/my-hi" className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-6 py-3 font-medium text-white hover:bg-slate-800">Go to My Hi</Link>
              <Link href="/book" className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-300 px-6 py-3 font-medium text-slate-800 hover:bg-slate-50">Book another space</Link>
            </div>
            <p className="mt-6 text-xs text-slate-400">Booking reference: {state.bookingId}</p>
          </div>
        ) : (
          <div className="w-full rounded-2xl bg-amber-50 p-6 text-center">
            <h1 className="text-2xl font-semibold text-amber-950">We need to verify this checkout.</h1>
            <p className="mt-3 leading-7 text-amber-900">{state.message}</p>
            <Link href="/my-hi" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-6 py-3 font-medium text-white">Go to My Hi</Link>
          </div>
        )}
      </main>
    </AppShell>
  );
}
