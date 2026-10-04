"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2, MapPin } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import {
  eventAvailableSeats,
  eventPrimaryImage,
  listPastEvents,
  listPublishedEvents,
  type EventPublic,
} from "@/lib/eventsV2";

function dateLabel(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(timestamp));
}

function timeLabel(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function priceLabel(event: EventPublic) {
  const prices = event.ticketTypes?.length
    ? event.ticketTypes.filter((ticket) => ticket.targetAudience !== "vip").map((ticket) => ticket.priceCents)
    : [event.price || 0];
  const minimum = Math.min(...prices);
  if (minimum <= 0) return "Free";
  return `From $${(minimum / 100).toFixed(minimum % 100 === 0 ? 0 : 2)}`;
}

function hrefFor(event: EventPublic) {
  return `/events/detail?event=${encodeURIComponent(event.slug || event.id)}`;
}

function EventImage({ event, priority = false }: { event: EventPublic; priority?: boolean }) {
  const image = eventPrimaryImage(event);
  if (image?.downloadUrl) {
    return (
      <Image
        src={image.downloadUrl}
        alt={image.alt || event.title}
        fill
        priority={priority}
        className="object-contain"
        sizes={priority ? "(max-width: 1024px) 100vw, 62vw" : "(max-width: 768px) 100vw, 33vw"}
      />
    );
  }
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-slate-100 via-sky-50 to-slate-200" aria-hidden="true" />
  );
}

export default function EventsPage() {
  const [events, setEvents] = useState<EventPublic[]>([]);
  const [pastEvents, setPastEvents] = useState<EventPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"upcoming" | "month" | "past">("upcoming");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [upcoming, past] = await Promise.all([
          listPublishedEvents(),
          listPastEvents(),
        ]);
        if (!active) return;
        setEvents(upcoming);
        setPastEvents(past);
      } catch (err) {
        if (!active) return;
        console.error("Failed to load events", err);
        setError("We couldn’t load the event calendar right now. Please try again shortly.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const thisMonth = useMemo(() => {
    const now = new Date();
    return events.filter((event) => {
      const date = new Date(event.startTime);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    });
  }, [events]);

  const visible = view === "past" ? pastEvents : view === "month" ? thisMonth : events;
  const featured = view === "upcoming" ? visible[0] : undefined;
  const gridEvents = featured ? visible.slice(1) : visible;

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">At Hi Coworking</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">Come work, learn, and meet people here.</h1>
          <p className="mt-4 text-base leading-7 text-slate-600">
            Community mornings, practical workshops, and local gatherings in Carrollton.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap gap-2" aria-label="Event view">
          {([
            ["upcoming", "Upcoming"],
            ["month", "This month"],
            ["past", "Past events"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                view === value
                  ? "bg-slate-950 text-white"
                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:text-slate-950"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading && (
          <div className="flex min-h-64 items-center justify-center" role="status">
            <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
          </div>
        )}

        {!loading && error && (
          <div className="mt-10 rounded-2xl bg-rose-50 p-5 text-sm text-rose-800">{error}</div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className="mt-12 border-t border-slate-200 py-16">
            <CalendarDays className="h-8 w-8 text-slate-300" />
            <h2 className="mt-4 text-2xl font-semibold text-slate-900">
              {view === "past" ? "No past events to show yet." : "Nothing scheduled here yet."}
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">
              Check back soon. New gatherings will appear here as they’re announced.
            </p>
          </div>
        )}

        {!loading && !error && featured && (
          <Link href={hrefFor(featured)} className="group mt-10 grid min-w-0 overflow-hidden rounded-[2rem] bg-slate-950 text-white lg:grid-cols-[1.45fr_1fr]">
            <div className="relative aspect-video w-full min-w-0 overflow-hidden bg-slate-900">
              <EventImage event={featured} priority />
            </div>
            <div className="flex flex-col justify-between p-7 sm:p-9">
              <div>
                <p className="text-sm font-medium text-sky-200">Next up · {dateLabel(featured.startTime)}</p>
                <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{featured.title}</h2>
                <p className="mt-4 line-clamp-3 break-words text-sm leading-6 text-slate-300">{featured.description}</p>
              </div>
              <div className="mt-8 space-y-2 text-sm text-slate-300">
                <p>{timeLabel(featured.startTime)} · {priceLabel(featured)}</p>
                {featured.location && (
                  <p className="flex items-center gap-2"><MapPin className="h-4 w-4" /> {featured.location}</p>
                )}
                {eventAvailableSeats(featured) === 0 && <p className="font-medium text-amber-200">Waitlist available</p>}
                <span className="mt-5 inline-flex rounded-full bg-white px-4 py-2 font-semibold text-slate-950 transition group-hover:bg-sky-100">View event</span>
              </div>
            </div>
          </Link>
        )}

        {!loading && !error && gridEvents.length > 0 && (
          <section className="mt-12" aria-labelledby="event-list-heading">
            <div className="flex items-end justify-between border-b border-slate-200 pb-4">
              <h2 id="event-list-heading" className="text-2xl font-semibold text-slate-950">
                {view === "past" ? "Past events" : view === "month" ? "This month" : "More upcoming"}
              </h2>
            </div>
            <div className="mt-6 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {gridEvents.map((event) => {
                const available = eventAvailableSeats(event);
                return (
                  <Link key={event.id} href={hrefFor(event)} className="group block">
                    <div className="relative aspect-video w-full min-w-0 overflow-hidden rounded-3xl bg-slate-100">
                      <EventImage event={event} />
                    </div>
                    <div className="pt-4">
                      <p className="text-sm font-medium text-sky-700">{dateLabel(event.startTime)} · {timeLabel(event.startTime)}</p>
                      <h3 className="mt-1 text-xl font-semibold text-slate-950 transition group-hover:text-sky-800">{event.title}</h3>
                      <p className="mt-2 line-clamp-2 break-words text-sm leading-6 text-slate-500">{event.description}</p>
                      <div className="mt-3 flex items-center gap-3 text-sm text-slate-600">
                        <span>{priceLabel(event)}</span>
                        {available === 0 && <span className="text-amber-700">Waitlist</span>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </main>
    </AppShell>
  );
}
