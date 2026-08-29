"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { AddToCalendar } from "@/components/AddToCalendar";
import { useAuth } from "@/lib/authContext";
import { getEvent } from "@/lib/firestore";
import {
  beginEventRegistrationV2,
  joinEventWaitlistV2,
} from "@/lib/eventFunctionsV2";
import type { EventDoc } from "@hi/shared";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Play,
  Users,
} from "lucide-react";

type EventV2Fields = {
  confirmedQuantity?: number;
  heldQuantity?: number;
  memberPriceCents?: number;
};

type TicketV2 = EventDoc["ticketTypes"][number] & { memberPriceCents?: number };

export default function EventDetailPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <EventDetailContent />
    </Suspense>
  );
}

function PageLoading() {
  return (
    <AppShell>
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    </AppShell>
  );
}

function EventDetailContent() {
  const searchParams = useSearchParams();
  const eventId = searchParams.get("id");
  const { user, userDoc } = useAuth();
  const [event, setEvent] = useState<EventDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [message, setMessage] = useState("");
  const [registered, setRegistered] = useState(false);
  const [waitlisted, setWaitlisted] = useState(false);

  useEffect(() => {
    if (!eventId) {
      setLoading(false);
      return;
    }
    void getEvent(eventId)
      .then((value) => {
        setEvent(value);
        if (value?.ticketTypes?.length) setSelectedTicketId(value.ticketTypes[0].id);
      })
      .finally(() => setLoading(false));
  }, [eventId]);

  const v2 = event as (EventDoc & EventV2Fields) | null;
  const confirmed = v2?.confirmedQuantity ?? event?.registrationCount ?? 0;
  const held = v2?.heldQuantity ?? 0;
  const available = event?.seatCap == null ? null : Math.max(0, event.seatCap - confirmed - held);
  const isFull = available === 0;
  const selectedTicket = useMemo(
    () => event?.ticketTypes?.find((ticket) => ticket.id === selectedTicketId) as TicketV2 | undefined,
    [event, selectedTicketId],
  );
  const publicPrice = selectedTicket?.priceCents ?? event?.price ?? 0;
  const memberPrice = selectedTicket?.memberPriceCents ?? v2?.memberPriceCents;
  const displayedPrice = user && userDoc?.membershipStatus === "active" && typeof memberPrice === "number"
    ? memberPrice
    : publicPrice;

  if (loading) return <PageLoading />;
  if (!event) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl py-24 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Event not found</h1>
          <Link href="/events" className="mt-4 inline-block text-sm text-indigo-600">Back to Events</Link>
        </div>
      </AppShell>
    );
  }

  const start = new Date(event.startTime);
  const end = new Date(event.endTime);
  const heroUrl = event.heroImage?.downloadUrl || event.imageUrl;

  async function register() {
    setMessage("");
    if (!user && (!guestName.trim() || !guestEmail.trim())) {
      setMessage("Enter your name and email to register.");
      return;
    }
    setBusy(true);
    try {
      const result = await beginEventRegistrationV2({
        eventId: event.id,
        ticketTypeId: selectedTicket?.id,
        quantity: 1,
        ...(!user ? { guest: { name: guestName.trim(), email: guestEmail.trim() } } : {}),
        successUrl: `${window.location.origin}/events/complete`,
        cancelUrl: window.location.href,
      });
      if (result.data.kind === "confirmed") {
        sessionStorage.setItem("hi-event-registration", JSON.stringify({
          registrationId: result.data.registrationId,
          manageSecret: result.data.manageSecret,
          eventId: event.id,
        }));
        setRegistered(true);
        setMessage("You're registered. A spot has been reserved for you.");
        return;
      }
      sessionStorage.setItem("hi-event-checkout", JSON.stringify({
        holdId: result.data.holdId,
        holdSecret: result.data.holdSecret,
        eventId: event.id,
      }));
      window.location.assign(result.data.checkoutUrl);
    } catch (error) {
      console.error(error);
      setMessage("We couldn't complete registration. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function joinWaitlist() {
    setMessage("");
    if (!user && (!guestName.trim() || !guestEmail.trim())) {
      setMessage("Enter your name and email to join the waitlist.");
      return;
    }
    setBusy(true);
    try {
      const result = await joinEventWaitlistV2({
        eventId: event.id,
        quantity: 1,
        ...(!user ? { guest: { name: guestName.trim(), email: guestEmail.trim() } } : {}),
      });
      sessionStorage.setItem("hi-event-waitlist", JSON.stringify({
        waitlistEntryId: result.data.waitlistEntryId,
        manageSecret: result.data.manageSecret,
        eventId: event.id,
      }));
      setWaitlisted(true);
      setMessage("You're on the waitlist. We'll let you know if a spot opens.");
    } catch (error) {
      console.error(error);
      setMessage("We couldn't add you to the waitlist. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
        <Link href="/events" className="mb-6 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> Events
        </Link>

        {heroUrl && (
          // Event media comes from Firebase Storage and is intentionally rendered
          // as content rather than decorative application chrome.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={heroUrl} alt={event.heroImage?.alt || event.title} className="mb-8 h-[300px] w-full rounded-3xl object-cover sm:h-[420px]" />
        )}

        <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
          <section>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">
              {event.format === "in-person" ? "At Hi Coworking" : event.format === "virtual" ? "Online" : "In person + online"}
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">{event.title}</h1>

            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-600">
              <span className="inline-flex items-center gap-2"><Calendar className="h-4 w-4" />{start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span>
              <span className="inline-flex items-center gap-2"><Clock className="h-4 w-4" />{start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – {end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              {event.location && <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4" />{event.location}</span>}
            </div>

            <div className="mt-10 max-w-2xl whitespace-pre-wrap text-base leading-7 text-slate-700">{event.description}</div>

            <div className="mt-8"><AddToCalendar event={event} /></div>

            {event.gallery?.length > 0 && (
              <div className="mt-12 grid gap-4 sm:grid-cols-2">
                {event.gallery.map((image) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={image.storagePath} src={image.downloadUrl} alt={image.alt} className="h-56 w-full rounded-2xl object-cover" />
                ))}
              </div>
            )}

            {event.recordingUrl && (
              <a href={event.recordingUrl} target="_blank" rel="noreferrer" className="mt-10 inline-flex items-center gap-2 text-sm font-semibold text-indigo-700">
                <Play className="h-4 w-4" /> Watch the event recording
              </a>
            )}
          </section>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-500">Registration</p>
                  <p className="mt-1 text-3xl font-semibold text-slate-950">{displayedPrice === 0 ? "Free" : `$${(displayedPrice / 100).toFixed(2)}`}</p>
                </div>
                {available != null && !isFull && <p className="text-xs text-slate-500">{available} spots left</p>}
              </div>

              {event.ticketTypes?.length > 1 && (
                <label className="mt-5 block text-sm font-medium text-slate-700">
                  Ticket
                  <select value={selectedTicketId} onChange={(e) => setSelectedTicketId(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5">
                    {event.ticketTypes.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.name}</option>)}
                  </select>
                </label>
              )}

              {!user && !registered && !waitlisted && (
                <div className="mt-5 space-y-3">
                  <input value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Your name" autoComplete="name" className="w-full rounded-xl border border-slate-200 px-3 py-2.5" />
                  <input value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} placeholder="Email" type="email" autoComplete="email" className="w-full rounded-xl border border-slate-200 px-3 py-2.5" />
                  <p className="text-xs leading-5 text-slate-500">No account is required. We use your email for this registration and event updates.</p>
                </div>
              )}

              {registered ? (
                <div className="mt-6 flex items-start gap-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /><span>You&apos;re registered.</span></div>
              ) : waitlisted ? (
                <div className="mt-6 flex items-start gap-3 rounded-2xl bg-slate-100 p-4 text-sm text-slate-700"><Users className="mt-0.5 h-5 w-5 shrink-0" /><span>You&apos;re on the waitlist.</span></div>
              ) : event.status !== "published" ? (
                <p className="mt-6 text-sm text-slate-600">Registration is not currently open.</p>
              ) : isFull ? (
                <button type="button" onClick={joinWaitlist} disabled={busy} className="mt-6 w-full rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
                  {busy ? "Joining…" : "Join waitlist"}
                </button>
              ) : (
                <button type="button" onClick={register} disabled={busy} className="mt-6 w-full rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
                  {busy ? "Reserving…" : displayedPrice === 0 ? "RSVP" : "Get ticket"}
                </button>
              )}

              {message && <p className="mt-4 text-sm leading-5 text-slate-600" aria-live="polite">{message}</p>}
            </div>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
