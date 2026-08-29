"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { finalizeEventRegistrationV2 } from "@/lib/eventFunctions";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";

export default function EventRegistrationCompletePage() {
  const [status, setStatus] = useState<"loading" | "confirmed" | "pending" | "error">("loading");
  const [registrationId, setRegistrationId] = useState("");
  const [message, setMessage] = useState("Confirming your registration…");

  useEffect(() => {
    let cancelled = false;
    async function finalize() {
      const holdId = sessionStorage.getItem("event-current-hold") || "";
      const holdSecret = holdId ? sessionStorage.getItem(`event-hold:${holdId}`) || undefined : undefined;
      if (!holdId) {
        setStatus("error");
        setMessage("We could not find this registration session. Check your payment receipt or contact Hi Coworking if you were charged.");
        return;
      }

      for (let attempt = 0; attempt < 6 && !cancelled; attempt += 1) {
        try {
          const result = await finalizeEventRegistrationV2({ holdId, holdSecret });
          if (cancelled) return;
          if (result.data.status === "confirmed" && result.data.registrationId) {
            setRegistrationId(result.data.registrationId);
            if (result.data.manageToken) sessionStorage.setItem(`event-registration:${result.data.registrationId}`, result.data.manageToken);
            sessionStorage.removeItem("event-current-hold");
            setStatus("confirmed");
            setMessage("Your registration is confirmed.");
            return;
          }
          if (result.data.status === "capacity_conflict") {
            setStatus("error");
            setMessage("Your payment completed after the temporary seat hold expired and the event became full. Hi Coworking will reconcile the payment before confirming a registration.");
            return;
          }
          if (result.data.status !== "pending") {
            setStatus("error");
            setMessage("The payment did not produce a confirmed registration. Please contact Hi Coworking if you were charged.");
            return;
          }
        } catch (error) {
          console.error(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      if (!cancelled) {
        setStatus("pending");
        setMessage("Your payment is still being confirmed. Stripe can take a moment to report the completed payment. You can safely refresh this page.");
      }
    }
    void finalize();
    return () => { cancelled = true; };
  }, []);

  return (
    <AppShell>
      <main className="mx-auto flex min-h-[65vh] max-w-2xl items-center px-4 py-16">
        <div className="w-full text-center">
          {status === "loading" && <Loader2 className="mx-auto h-10 w-10 animate-spin text-slate-400" />}
          {status === "confirmed" && <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />}
          {(status === "pending" || status === "error") && <AlertCircle className="mx-auto h-12 w-12 text-amber-600" />}
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-slate-950">
            {status === "confirmed" ? "You’re registered" : status === "error" ? "Registration needs attention" : "Confirming registration"}
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base leading-7 text-slate-600">{message}</p>
          {registrationId && <p className="mt-3 text-xs text-slate-400">Registration {registrationId}</p>}
          <div className="mt-8 flex justify-center gap-3">
            <Link href="/events" className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white">Back to Events</Link>
            {status === "pending" && <button type="button" onClick={() => window.location.reload()} className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700">Refresh</button>}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
