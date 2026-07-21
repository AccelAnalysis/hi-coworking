"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, MailX, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { adminMarketingUnsubscribeFn } from "@/lib/adminMarketingFunctions";

function PreferenceContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Updating your marketing-email preference…");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("This unsubscribe link is incomplete.");
      return;
    }
    void adminMarketingUnsubscribeFn({ token })
      .then(() => {
        setStatus("success");
        setMessage("You have been unsubscribed from Hi-Coworking marketing email.");
      })
      .catch((error: unknown) => {
        const candidate = error as { code?: string };
        setStatus("error");
        setMessage(candidate.code?.includes("deadline-exceeded")
          ? "This unsubscribe link has expired. Contact Hi-Coworking to update your preference."
          : "This unsubscribe link could not be verified. Contact Hi-Coworking to update your preference.");
      });
  }, [token]);

  return (
    <AppShell>
      <main className="mx-auto flex min-h-[65vh] max-w-xl items-center px-4 py-12 sm:px-6">
        <section className="w-full rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          {status === "loading" ? <Loader2 className="mx-auto h-10 w-10 animate-spin text-indigo-600" /> : status === "success" ? <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" /> : <TriangleAlert className="mx-auto h-10 w-10 text-amber-600" />}
          <h1 className="mt-5 flex items-center justify-center gap-2 text-2xl font-bold text-slate-950"><MailX className="h-6 w-6" /> Email preferences</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600" role="status">{message}</p>
          <p className="mt-5 text-xs leading-5 text-slate-500">This preference applies to optional marketing and outreach. Required authentication, payment, legal, and in-application service notices are handled separately.</p>
        </section>
      </main>
    </AppShell>
  );
}

export default function EmailPreferencesPage() {
  return <Suspense fallback={<div className="flex min-h-dvh items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>}><PreferenceContent /></Suspense>;
}
