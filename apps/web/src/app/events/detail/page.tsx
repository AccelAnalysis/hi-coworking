"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { AddToCalendar } from "@/components/AddToCalendar";
import { useAuth } from "@/lib/authContext";
import { getEvent } from "@/lib/firestore";
import {
  beginEventRegistrationV2,
  joinEventWaitlistV2,
} from "@/lib/eventFunctions";
import type { EventDoc } from "@hi/shared";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Users,
  Video,
} from "lucide-react";

function money(cents: number) {
  return cents <= 0 ? "Free" : `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
}

export default function EventDetailPage() {
  return (
    <Suspense fallback={<AppShell><div className="py-24 text-center text-slate-500">Loading event…</div></AppShell>}>
      <EventDetailContent />
    </Suspense>
  );
}

function EventDetailContent() {
  const params = useSearchParams();
  const eventId = params.get("id");
  const { user, userDoc } = useAuth();
  const [event, setEvent] = useState<EventDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [ticketTypeId, setTicketTypeId] = useState("");

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const found = await getEvent(eventId);
      setEvent(found);
      if (found?.ticketTypes?.length) setTicketTypeId(found.ticketTypes[0].id);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (user) {
      setName(userDoc?.displayName || user.displayName || "");
      setEmail(userDoc?.email || user.email || "");
    }
  }, [user, userDoc]);

  const selectedTicket = useMemo(
    () => event?.ticketTypes?.find((ticket) => ticket.id === ticketTypeId),
    [event, ticketTypeId],
  );

  const basePrice = selectedTicket?.priceCents ?? event?.price ?? 0;
  const confirmed = Number((event as (EventDoc & { confirmedQuantity?: number }) | null)?.confirmedQuantity ?? event?.registrationCount ?? 0);
  const held = Number((event as (EventDoc & { heldQuantity?: number }) | null)?.heldQuantity ?? 0);
  const available = event?.seatCap == null ? null : Math.max(0, event.seatCap - confirmed - held);
  const isFull = available === 0;

  async function register() {
    if (!event) return;
    if (!user && (!name.trim() || !email.trim())) {
      setMessage("Enter your name and email to register.");
      return;
    }
    setWorking(true);
    setMessage("");
    try {
      const origin = window.location.origin;
      const result = await beginEventRegistrationV2({
        eventId: event.id,
        ticketTypeId: ticketTypeId || undefined,
        quantity,
        guest: user ? undefined : { name: name.trim(), email: email.trim() },
        successUrl: `${origin}/events/complete`,
        cancelUrl: window.location.href,
      });
      if (result.data.kind === "confirmed") {
        if (result.data.manageToken) {
          sessionStorage.setItem(`event-registration:${result.data.registrationId}`, result.data.manageToken);
        }
        setMessage("You’re registered. Add the event to your calendar below.");
        await load();
        return;
      }
      sessionStorage.setItem(`event-hold:${result.data.holdId}`, result.data.holdSecret);
      sessionStorage.setItem("event-current-hold", result.data.holdId);
      window.location.assign(result.data.checkoutUrl);
    } catch (error) {
      console.error(error);
      setMessage("We couldn’t complete registration. Please try again.");
    } finally {
      setWorking(false);
    }
  }

  async function joinWaitlist() {
    if (!event) return;
    if (!user && (!name.trim() || !email.trim())) {
      setMessage("Enter your name and email to join the waitlist.");
      return;
    }
    setWorking(true);
    setMessage("");
    try {
      const result = await joinEventWaitlistV2({
        eventId: event.id,
        ticketTypeId: ticketTypeId || undefined,
        quantity,
        guest: user ? undefined : { name: name.trim(), email: email.trim() },
      });
      if (result.data.manageToken) {
        sessionStorage.setItem(`event-waitlist:${result.data.waitlistEntryId}`, result.data.manageToken);
      }
      setMessage("You’re on the waitlist. We’ll hold a spot for you when one becomes available.");
    } catch (error) {
      console.error(error);
      setMessage("We couldn’t add you to the waitlist. Please try again.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return <AppShell><div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div></AppShell>;
  }

  if (!event) {
    return (
      <AppShell>
        <div className="mx-auto max-w-3xl py-24 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Event not found</h1>
          <Link href="/events" className="mt-4 inline-block text-sm text-blue-700">See upcoming events</Link>
        </div>
      </AppShell>
    );
  }

  const start = new Date(event.startTime);
  const end = new Date(event.endTime);
  const heroUrl = event.heroImage?.downloadUrl || event.imageUrl;

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        <Link href="/events" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> Events
        </Link>

        {heroUrl && (
          <div className="mb-8 overflow-hidden rounded-3xl bg-slate-100">
            {/* Runtime Firebase-hosted event media cannot be enumerated at static build time. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroUrl} alt={event.heroImage?.alt || event.title} className="h-[280px] w-full object-cover sm:h-[420px]" />
          </div>
        )}

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section>
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">
              {event.format === "in-person" ? "At Hi Coworking" : event.format === "virtual" ? "Online" : "In person + online"}
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">{event.title}</h1>

            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-600">
              <span className="inline-flex items-center gap-2"><Calendar className="h-4 w-4" />{start.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span>
              <span className="inline-flex items-center gap-2"><Clock className="h-4 w-4" />{start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – {end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
              {event.location && <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4" />{event.location}</span>}
              {event.format !== "in-person" && <span className="inline-flex items-center gap-2"><Video className="h-4 w-4" />Virtual details are provided to registered attendees.</span>}
            </div>

            <div className="mt-9 max-w-3xl whitespace-pre-wrap text-base leading-7 text-slate-700">{event.description}</div>

            <div className="mt-10"><AddToCalendar event={event} /></div>

            {event.gallery?.length > 0 && (
              <div className="mt-12 grid gap-4 sm:grid-cols-2">
                {event.gallery.map((image, index) => image.downloadUrl ? (
                  <div key={`${image.storagePath}-${index}`} className="overflow-hidden rounded-2xl bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.downloadUrl} alt={image.alt || `${event.title} photo`} className="h-64 w-full object-cover" />
                  </div>
                ) : null)}
              </div>
            )}
          </section>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-baseline justify-between gap-4">
                <div className="text-2xl font-semibold text-slate-950">{money(basePrice)}</div>
                {available != null && <div className="text-sm text-slate-500">{available > 0 ? `${available} spot${available === 1 ? "" : "s"} left` : "Full"}</div>}
              </div>

              {event.ticketTypes?.length > 0 && (
                <label className="mt-5 block text-sm font-medium text-slate-700">
                  Ticket
                  <select value={ticketTypeId} onChange={(e) => setTicketTypeId(e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3">
                    {event.ticketTypes.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.name} · {money(ticket.priceCents)}</option>)}
                  </select>
                </label>
              )}

              <label className="mt-4 block text-sm font-medium text-slate-700">
                Tickets
                <select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3">
                  {[1,2,3,4,5].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>

              {!user && (
                <div className="mt-5 space-y-3">
                  <label className="block text-sm font-medium text-slate-700">Name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
                  <label className="block text-sm font-medium text-slate-700">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" /></label>
                  <p className="text-xs leading-5 text-slate-500">No account is required. Already a member? <Link href="/login" className="font-medium text-blue-700">Log in</Link> for member pricing when offered.</p>
                </div>
              )}

              {message && <div className="mt-5 flex gap-2 rounded-xl bg-blue-50 p-3 text-sm text-blue-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{message}</div>}

              <button onClick={isFull ? joinWaitlist : register} disabled={working || event.status !== "published"} className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                {working ? <Loader2 className="h-4 w-4 animate-spin" /> : isFull ? <Users className="h-4 w-4" /> : null}
                {isFull ? "Join waitlist" : basePrice > 0 ? "Continue to payment" : "Register"}
              </button>
            </div>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
