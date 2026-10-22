"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signInWithCustomToken } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { bookingHoldKey, LEGACY_HOLD_KEY, parseBookingHold, type BookingHold } from "@/lib/bookingRecovery";
import { authPath } from "@/lib/purchaseNavigation";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, Loader2 } from "lucide-react";
import { BookingCatalogDetails, type BookingCatalogSnapshot } from "@/components/BookingCatalogDetails";
import { AppShell } from "@/components/AppShell";
import { auth, db, functions } from "@/lib/firebase";

const finalizeCheckout = httpsCallable<
  { holdId: string; holdSecret?: string },
  {
    success: true;
    bookingId: string;
    alreadyFinalized?: boolean;
    customToken?: string;
    bookingDetails?: BookingCatalogSnapshot;
  } | { success: false; status: "recovery_required"; recoveryId: string; message?: string }
    | { success: false; status: "cancelled"; message: string }
>(functions, "booking_finalizeCheckout");

const finalizeAdminMemberCheckout = httpsCallable<
  { holdId: string; holdSecret: string },
  { success: boolean; bookingId: string; alreadyFinalized?: boolean }
>(functions, "admin_bookingForMemberFinalize");

type State =
  | { kind: "loading" }
  | { kind: "success"; bookingId: string; accountReady: boolean; customToken?: string; bookingDetails?: BookingCatalogSnapshot }
  | { kind: "recovery"; recoveryId: string; message: string }
  | { kind: "error"; message: string };

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function BookingCompletePage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [retry, setRetry] = useState(0);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const alreadyConfirmed = params.get("bookingId");
    if (alreadyConfirmed) {
      let cancelled = false;
      // A query string is never evidence of payment or a confirmed booking.
      void auth.authStateReady().then(async () => {
        if (!auth.currentUser) throw new Error("Sign in with the booking account to verify this reservation. Do not pay again.");
        const snapshot = await getDoc(doc(db, "bookings", alreadyConfirmed));
        if (!snapshot.exists() || snapshot.data().status !== "CONFIRMED") throw new Error("We could not verify a confirmed reservation. Check your account or contact Hi Coworking before paying again.");
        if (!cancelled) setState({ kind: "success", bookingId: snapshot.id, accountReady: true, bookingDetails: snapshot.data() as BookingCatalogSnapshot });
      }).catch(() => {
        if (!cancelled) setState({ kind: "error", message: "Sign in with the booking account to check this reservation, or contact Hi Coworking. This link alone does not confirm a booking. Do not pay again." });
      });
      return () => { cancelled = true; };
    }

    const adminHoldId = params.get("adminHoldId");
    const adminHoldSecret = params.get("adminHoldSecret");
    if (adminHoldId && adminHoldSecret) {
      let cancelled = false;
      async function finalizeAdminBooking() {
        let lastError: unknown;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          try {
            const result = await finalizeAdminMemberCheckout({
              holdId: adminHoldId!,
              holdSecret: adminHoldSecret!,
            });
            if (cancelled) return;
            setState({
              kind: "success",
              bookingId: result.data.bookingId,
              accountReady: Boolean(auth.currentUser),
            });
            return;
          } catch (error) {
            lastError = error;
            if (cancelled) return;
            if (attempt < 5) await sleep(1_500);
          }
        }
        console.error(lastError);
        if (!cancelled) {
          setState({
            kind: "error",
            message:
              "Payment returned, but the member booking is still reconciling. Do not pay again. Hi Coworking can verify the payment and booking hold.",
          });
        }
      }
      void finalizeAdminBooking();
      return () => { cancelled = true; };
    }

    const expectedHoldId = params.get("holdId");
    let stored: BookingHold | null = null;
    try {
      // A return for one checkout must never consume another tab's hold.
      const raw = window.localStorage.getItem(expectedHoldId ? bookingHoldKey(expectedHoldId) : LEGACY_HOLD_KEY);
      stored = parseBookingHold(raw, expectedHoldId);
      if (!stored && expectedHoldId) stored = parseBookingHold(window.localStorage.getItem(LEGACY_HOLD_KEY), expectedHoldId);
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

          if (!result.data.success) {
            if (result.data.status === "cancelled") {
              setState({ kind: "error", message: result.data.message });
              return;
            }
            setState({ kind: "recovery", recoveryId: result.data.recoveryId, message: result.data.message || "Payment was received, but the reservation needs staff review. A recovery case has been queued; this does not mean a refund has been issued. Do not pay again." });
            return;
          }
          let accountReady = false;
          if (auth.currentUser && !result.data.customToken) {
            try {
              const booking = await getDoc(doc(db, "bookings", result.data.bookingId));
              accountReady = booking.exists() && booking.data().userId === auth.currentUser.uid;
            } catch { /* A different signed-in account must verify the purchaser inbox. */ }
          }
          if (cancelled) return;
          // Keep the hold secret in this browser so refresh/back can recover status.
          // Never silently replace an unrelated signed-in account with the purchaser.
          setState({
            kind: "success",
            bookingId: result.data.bookingId,
            accountReady,
            customToken: result.data.customToken,
            bookingDetails: result.data.bookingDetails,
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
  }, [retry]);

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
              We are checking the server’s payment and booking status. Confirmation does not depend on keeping this page open.
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
            {state.bookingDetails && <BookingCatalogDetails booking={state.bookingDetails} />}
            {!state.accountReady && (
              <p className="mx-auto mt-4 max-w-lg rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
                Your booking is confirmed. To manage it on another visit, sign in using the checkout email. If you have not set a password, choose “Forgot password / claim account” and verify access to that inbox. Do not pay again.
              </p>
            )}
            {state.customToken && <div className="mt-5">
              <button disabled={claiming} className="rounded-full border border-slate-300 px-5 py-3 disabled:opacity-50" onClick={async () => {
                setClaiming(true); setClaimError("");
                try {
                  await signInWithCustomToken(auth, state.customToken!);
                  setState({ kind: "success", bookingId: state.bookingId, accountReady: true, bookingDetails: state.bookingDetails });
                } catch { setClaimError("Your booking is still confirmed. Use the email recovery link on the sign-in page to access your account."); }
                finally { setClaiming(false); }
              }}>{claiming ? "Signing in…" : auth.currentUser ? "Switch to the purchaser’s account" : "Continue to your booking account"}</button>
              {claimError && <p role="alert" className="mt-2 text-sm text-amber-900">{claimError}</p>}
            </div>}
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href={state.accountReady ? "/account/bookings" : authPath("login", "/account/bookings")}
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
              {state.kind === "recovery" ? "Payment received — booking needs review" : "We need to verify this checkout."}
            </h1>
            <p className="mt-3 leading-7 text-amber-900">
              {state.message}
            </p>
            {state.kind === "recovery" && <p className="mt-3 text-sm text-amber-900">Recovery reference: {state.recoveryId}. Do not pay again. A refund is not confirmed unless our team confirms it.</p>}
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <button onClick={() => { setState({ kind: "loading" }); setRetry((value) => value + 1); }} className="rounded-full border border-amber-300 px-6 py-3 font-medium">Check status again</button>
              <Link href={authPath("login", "/account/bookings")} className="rounded-full border border-amber-300 px-6 py-3 font-medium">Sign in / recover account</Link>
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
