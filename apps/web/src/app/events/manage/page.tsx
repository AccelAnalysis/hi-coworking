"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CalendarDays, Loader2 } from "lucide-react";
import { AddToCalendar } from "@/components/AddToCalendar";
import { AppShell } from "@/components/AppShell";
import {
  cancelEventRegistrationV2,
  getEventRegistration,
  type EventCancellationQuote,
  type EventPublic,
  type EventRegistrationV2,
} from "@/lib/eventsV2";

function ManageContent() {
  const params = useSearchParams();
  const registrationId = params.get("registration") || "";
  const [token, setToken] = useState("");
  const [registration, setRegistration] = useState<EventRegistrationV2 | null>(null);
  const [event, setEvent] = useState<EventPublic | null>(null);
  const [cancellation, setCancellation] = useState<EventCancellationQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    setToken(hash.get("token") || "");
  }, []);

  useEffect(() => {
    if (!registrationId) {
      setLoading(false);
      return;
    }
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const result = await getEventRegistration({
          registrationId,
          ...(token ? { manageToken: token } : {}),
        });
        if (!active) return;
        setRegistration(result.data.registration);
        setEvent(result.data.event);
        setCancellation(result.data.cancellation);
      } catch (error) {
        console.error("Could not load registration", error);
        if (active) setMessage("We could not open this registration. Use the secure link from your confirmation email or sign in to your account.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [registrationId, token]);

  async function cancelRegistration() {
    if (!registration || !cancellation?.canCancel) return;
    const prompt = cancellation.refundCents > 0
      ? `Cancel this registration? A $${(cancellation.refundCents / 100).toFixed(2)} refund will be issued to the original payment method.`
      : "Cancel this registration? This registration is outside the refund window.";
    if (!window.confirm(prompt)) return;
    setCancelling(true);
    setMessage(null);
    try {
      const result = await cancelEventRegistrationV2({
        registrationId: registration.id,
        ...(token ? { manageToken: token } : {}),
      });
      setRegistration({
        ...registration,
        status: result.data.refundPending ? "REFUND_PENDING" : "CANCELLED",
        cancelledAt: Date.now(),
      });
      setCancellation({ ...cancellation, canCancel: false });
      setMessage(result.data.refundPending
        ? "Your registration is cancelled and the refund is being returned to the original payment method."
        : "Your registration is cancelled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "We could not cancel the registration.");
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return <AppShell><div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div></AppShell>;
  }

  if (!registration || !event) {
    return (
      <AppShell>
        <main className="mx-auto w-full max-w-xl px-4 py-20 text-center sm:px-6">
          <CalendarDays className="mx-auto h-9 w-9 text-slate-300" />
          <h1 className="mt-4 text-3xl font-semibold text-slate-950">Registration unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">{message || "We couldn’t find that registration."}</p>
          <Link href="/events" className="mt-7 inline-flex rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white">Events</Link>
        </main>
      </AppShell>
    );
  }

  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: event.timezone || "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(event.startTime));

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Your registration</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">{event.title}</h1>
        <p className="mt-3 text-sm text-slate-600">{date}{event.location ? ` · ${event.location}` : ""}</p>

        <div className="mt-8 border-y border-slate-200 py-6">
          <dl className="grid gap-5 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Attendee</dt>
              <dd className="mt-1 text-base font-medium text-slate-900">{registration.displayName}</dd>
              <dd className="text-sm text-slate-500">{registration.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Tickets</dt>
              <dd className="mt-1 text-base font-medium text-slate-900">{registration.quantity}{registration.ticketTypeName ? ` · ${registration.ticketTypeName}` : ""}</dd>
              <dd className="text-sm text-slate-500">
                {registration.amountPaidCents > 0 ? `$${(registration.amountPaidCents / 100).toFixed(2)} paid` : "Free"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Status</dt>
              <dd className="mt-1 text-base font-medium text-slate-900">{registration.status.replaceAll("_", " ").toLowerCase()}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">Attendance</dt>
              <dd className="mt-1 text-base font-medium text-slate-900">{registration.attendanceStatus.replaceAll("_", " ").toLowerCase()}</dd>
            </div>
          </dl>
        </div>

        {registration.status === "CONFIRMED" && (
          <div className="mt-7 flex flex-wrap gap-3">
            <AddToCalendar event={event} />
            {cancellation?.canCancel && (
              <button
                type="button"
                onClick={cancelRegistration}
                disabled={cancelling}
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-50"
              >
                {cancelling && <Loader2 className="h-4 w-4 animate-spin" />}
                Cancel registration
              </button>
            )}
          </div>
        )}

        {cancellation?.canCancel && registration.amountPaidCents > 0 && (
          <p className="mt-4 text-sm text-slate-500">
            {cancellation.refundEligible
              ? `Cancel at least ${cancellation.cutoffHours} hours before the event for a full refund.`
              : "This registration is outside the refund window."}
          </p>
        )}

        {message && <p className="mt-6 rounded-2xl bg-slate-100 p-4 text-sm text-slate-700">{message}</p>}

        <Link href={`/events/detail?event=${encodeURIComponent(event.slug || event.id)}`} className="mt-8 inline-flex text-sm font-semibold text-sky-800 hover:text-sky-950">View event details →</Link>
      </main>
    </AppShell>
  );
}

export default function ManageEventRegistrationPage() {
  return (
    <Suspense fallback={<AppShell><div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div></AppShell>}>
      <ManageContent />
    </Suspense>
  );
}
