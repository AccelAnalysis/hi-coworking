"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, Loader2, MailX } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { functions } from "@/lib/firebase";

const unsubscribe = httpsCallable<{ token: string }, { success: boolean }>(functions, "nurture_unsubscribe");

export default function PreferencesPage() {
  const [state, setState] = useState<"loading" | "success" | "missing" | "error">("loading");

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

  return (
    <AppShell>
      <main className="mx-auto flex min-h-[60vh] w-full max-w-2xl items-center px-4 py-12 sm:px-6">
        <section className="w-full border-y border-slate-200 py-10 text-center">
          {state === "loading" ? (
            <><Loader2 className="mx-auto h-8 w-8 animate-spin text-slate-400" /><h1 className="mt-5 text-2xl font-semibold text-slate-950">Updating your preferences</h1></>
          ) : state === "success" ? (
            <><CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" /><h1 className="mt-5 text-2xl font-semibold text-slate-950">Follow-up emails are off</h1><p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-600">You will no longer receive Hi Coworking nurture or promotional follow-up at this address. Essential booking, payment, account, and access messages are unaffected.</p></>
          ) : state === "missing" ? (
            <><MailX className="mx-auto h-9 w-9 text-slate-500" /><h1 className="mt-5 text-2xl font-semibold text-slate-950">Preference link required</h1><p className="mt-3 text-sm text-slate-600">Use the preference link from a Hi Coworking follow-up email, or manage communication preferences from your signed-in account.</p></>
          ) : (
            <><MailX className="mx-auto h-9 w-9 text-rose-600" /><h1 className="mt-5 text-2xl font-semibold text-slate-950">We could not update this link</h1><p className="mt-3 text-sm text-slate-600">The link may already be expired or invalid. You can still contact Hi Coworking to update your communication preference.</p></>
          )}
          <Link href="/" className="mt-7 inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-slate-800">Return to Hi Coworking</Link>
        </section>
      </main>
    </AppShell>
  );
}
