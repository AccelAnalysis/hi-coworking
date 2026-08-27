"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signInWithCustomToken } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { auth, functions } from "@/lib/firebase";

const finalizeCheckout = httpsCallable<
  { holdId: string; holdSecret?: string },
  {
    success: boolean;
    bookingId: string;
    alreadyFinalized?: boolean;
    customToken?: string;
  }
>(functions, "booking_finalizeCheckout");

type State =
  | { kind: "loading" }
  | { kind: "success"; bookingId: string; accountReady: boolean }
  | { kind: "error"; message: string };

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function BookingCompletePage() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const alreadyConfirmed = params.get("bookingId");
    if (alreadyConfirmed) {
      setState({
        kind: "success",
        bookingId: alreadyConfirmed,
        accountReady: Boolean(auth.currentUser),
      });
      return;
    }

    let stored: {
      holdId?: string;
      holdSecret?: string;
      expiresAt?: number;
    } | null = null;
    try {
      const raw = window.localStorage.getItem(
        "hi-coworking-booking-hold",
      );
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      stored = null;
    }

    if (!stored?.holdId || !stored.holdSecret) {
      setState({
        kind: "error",
        message:
          "We could not find the booking hold for this checkout. If you were charged, contact Hi Coworking so the payment can be reconciled before you try again.",
      });
      return;
    }

    let cancelled = false;
    async function finalize() {
      let lastError: unknown;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          const result = await finalizeCheckout({
            holdId: stored!.holdId!,
            holdSecret: stored!.holdSecret,
          });
          if (cancelled) return;

          let accountReady = Boolean(auth.currentUser);
          if (result.data.customToken) {
            try {
              await signInWithCustomToken(
                auth,
                result.data.customToken,
              );
              accountReady = true;
            } catch (signInError) {
              console.error(
                "Booking confirmed but automatic account sign-in failed",
                signInError,
              );
            }
          }

          window.localStorage.removeItem(
            "hi-coworking-booking-hold",
          );
          setState({
            kind: "success",
            bookingId: result.data.bookingId,
            accountReady,
          });
          return;
        } catch (error) {
          lastError = error;
          if (cancelled) return;
          if (attempt < 5) await sleep(1_500);
        }
      }

      console.error(lastError);
      if (cancelled) return;
      setState({
        kind: "error",
        message:
          "Payment returned, but confirmation is still pending. Refresh once. If it remains pending, contact Hi Coworking before making another payment.",
      });
    }

    void finalize();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell>
      <main className="mx-auto flex min-h-[65vh] w-full max-w-2xl items-center px-4 py-12 sm:px-6">
        {state.kind === "loading" ? (
          <div className="w-full text-center">
            <Loader2 className="mx-auto h-9 w-9 animate-spin text-slate-500" />
            <h1 className="mt-5 text-2xl font-semibold text-slate-950">
              Confirming your booking…
            </h1>
            <p className="mt-2 text-slate-600">
              We are reconciling payment, securing the space, and preparing
              access.
            </p>
          </div>
        ) : state.kind === "success" ? (
          <div className="w-full text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
            <p className="mt-5 text-sm font-medium text-slate-500">
              You’re booked
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              Your space is confirmed.
            </h1>
            <p className="mx-auto mt-3 max-w-lg text-slate-600">
              Your reservation is saved. Access is issued only against the
              confirmed booking, and booking management lives in Account.
            </p>
            {!state.accountReady && (
              <p className="mx-auto mt-4 max-w-lg rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
                The booking is confirmed, but automatic account sign-in did
                not complete. Use Log in or contact Hi Coworking for account
                access; do not pay again.
              </p>
            )}
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/account/bookings"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-6 py-3 font-medium text-white hover:bg-slate-800"
              >
                View booking
              </Link>
              <Link
                href="/spaces"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-slate-300 px-6 py-3 font-medium text-slate-800 hover:bg-slate-50"
              >
                Return to Spaces
              </Link>
            </div>
            <p className="mt-6 text-xs text-slate-400">
              Booking reference: {state.bookingId}
            </p>
          </div>
        ) : (
          <div className="w-full rounded-2xl bg-amber-50 p-6 text-center">
            <h1 className="text-2xl font-semibold text-amber-950">
              We need to verify this checkout.
            </h1>
            <p className="mt-3 leading-7 text-amber-900">
              {state.message}
            </p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/contact"
                className="inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-6 py-3 font-medium text-white"
              >
                Contact Hi Coworking
              </Link>
              <Link
                href="/spaces"
                className="inline-flex min-h-12 items-center justify-center rounded-full border border-amber-300 px-6 py-3 font-medium text-amber-950"
              >
                Return to Spaces
              </Link>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
