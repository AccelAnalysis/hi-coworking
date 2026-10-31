"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, Loader2 } from "lucide-react";
import { functions } from "@/lib/firebase";
import { RequireAuth } from "@/components/RequireAuth";
import { SAYHI_PREVIEW_DEMO, VIRTUAL_ADDRESS } from "@/lib/sayhiFlags";

const submitForm1583 = httpsCallable<Record<string, never>, { ok: boolean }>(functions, "va_submitForm1583");

/**
 * Virtual address: PS Form 1583 follow-up (step 5). Built, OFF behind
 * NEXT_PUBLIC_VIRTUAL_ADDRESS (and VIRTUAL_ADDRESS_ENABLED on the server).
 * The live signature confirmation is always done by a person: Hi Coworking's
 * owner, a staff member, or a notary.
 */
export default function VirtualAddressPage() {
  const [previewDemo, setPreviewDemo] = useState(false);
  useEffect(() => {
    // Private preview only: ?demo shows the steps without signing in.
    if (SAYHI_PREVIEW_DEMO && new URLSearchParams(window.location.search).has("demo")) setPreviewDemo(true);
  }, []);
  if (!VIRTUAL_ADDRESS) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="font-display text-2xl font-semibold text-[#101D4B]">This page isn&apos;t available.</h1>
        <Link href="/my-hi" className="mt-6 inline-flex min-h-11 items-center font-semibold text-[#101D4B] underline underline-offset-4">
          Go to SayHi
        </Link>
      </main>
    );
  }
  if (previewDemo) return <Form1583Steps />;
  return (
    <RequireAuth>
      <Form1583Steps />
    </RequireAuth>
  );
}

function Form1583Steps() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const submit = async () => {
    setState("sending");
    try {
      await submitForm1583({});
      setState("done");
    } catch (error) {
      console.error(error);
      setState("error");
    }
  };
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-3xl font-semibold text-[#101D4B]">Set up your virtual address</h1>
      <p className="mt-3 text-base leading-7 text-slate-600">
        USPS requires PS Form 1583 before we can receive mail for you.
      </p>
      <ol className="mt-8 space-y-4">
        <li className="rounded-2xl bg-[#EEF0F6] p-5">
          <h2 className="font-semibold text-[#101D4B]">1. Fill out PS Form 1583</h2>
          <p className="mt-1 text-sm leading-6 text-slate-700">
            One form per person. For a business, an officer signs and lists their title, plus anyone who will pick up mail.
          </p>
        </li>
        <li className="rounded-2xl bg-[#EEF0F6] p-5">
          <h2 className="font-semibold text-[#101D4B]">2. Have two forms of ID ready</h2>
          <p className="mt-1 text-sm leading-6 text-slate-700">One with your photo, and one that shows your address.</p>
        </li>
        <li className="rounded-2xl bg-[#EEF0F6] p-5">
          <h2 className="font-semibold text-[#101D4B]">3. Confirm your signature live</h2>
          <p className="mt-1 text-sm leading-6 text-slate-700" data-testid="human-signature">
            A member of the Hi Coworking team confirms your signature with you live, by video call or in person at the front desk.
            You can also use a notary.
          </p>
        </li>
      </ol>
      <p className="mt-6 text-sm leading-6 text-slate-600">
        Your suite number is assigned after your form and IDs are accepted.
      </p>
      {state === "done" ? (
        <p className="mt-8 flex items-center gap-2 font-semibold text-[#101D4B]" role="status">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          Thanks. We&apos;ll be in touch to schedule your live confirmation.
        </p>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={state === "sending"}
          className="mt-8 inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#101D4B] px-6 font-semibold text-white hover:bg-[#3A4675] focus:outline-none focus:ring-2 focus:ring-[#101D4B] focus:ring-offset-2 disabled:opacity-70"
        >
          {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          My form and IDs are ready
        </button>
      )}
      {state === "error" ? (
        <p className="mt-4 text-sm font-medium text-red-700" role="alert">Something went wrong. Please try again.</p>
      ) : null}
    </main>
  );
}
