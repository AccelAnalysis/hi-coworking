"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarDays, Clock3, Loader2, MapPin, Play, Video } from "lucide-react";
import { AddToCalendar } from "@/components/AddToCalendar";
import { AppShell } from "@/components/AppShell";
import { EventRegistrationPanel } from "@/components/events/EventRegistrationPanel";
import { PitchEventActions } from "@/components/events/PitchEventActions";
import { eventPrimaryImage, getPublicEvent, isPitchCompetitionEvent, publicEventDescription, type EventPublic } from "@/lib/eventsV2";

function dateLabel(event: EventPublic) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: event.timezone || "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(event.startTime));
}

function timeLabel(event: EventPublic) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: event.timezone || "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatter.format(new Date(event.startTime))} – ${formatter.format(new Date(event.endTime))}`;
}

function EventDetailContent() {
  const searchParams = useSearchParams();
  const identifier = searchParams.get("event") || searchParams.get("id");
  const [event, setEvent] = useState<EventPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      if (!identifier) {
        setLoading(false);
        setError(true);
        return;
      }
      setLoading(true);
      try {
        const result = await getPublicEvent(identifier);
        if (!active) return;
        setEvent(result);
        setError(!result);
      } catch (err) {
        console.error("Failed to load event", err);
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [identifier]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex min-h-[60vh] items-center justify-center" role="status">
          <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  if (error || !event) {
    return (
      <AppShell>
        <main className="mx-auto w-full max-w-4xl px-4 py-20 text-center sm:px-6">
          <CalendarDays className="mx-auto h-9 w-9 text-slate-300" />
          <h1 className="mt-4 text-3xl font-semibold text-slate-950">We couldn&apos;t find that event.</h1>
          <Link href="/events" className="mt-6 inline-flex rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white">See events</Link>
        </main>
      </AppShell>
    );
  }

  const hero = eventPrimaryImage(event);
  const completed = event.status === "completed" || event.endTime < Date.now();

  return (
    <AppShell>
      <main>
        <div className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6 sm:pt-10">
          <Link href="/events" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-slate-950">
            <ArrowLeft className="h-4 w-4" /> Events
          </Link>
        </div>

        <section className="mx-auto mt-6 grid w-full max-w-6xl min-w-0 gap-8 px-4 sm:px-6 lg:grid-cols-[1.45fr_0.8fr] lg:gap-10">
          <div className="min-w-0">
            <div className="relative aspect-video w-full min-w-0 max-w-full overflow-hidden rounded-[2rem] bg-slate-100">
              {hero?.downloadUrl && (
                <Image
                  src={hero.downloadUrl}
                  alt={hero.alt || event.title}
                  fill
                  priority
                  className="object-contain"
                  sizes="(max-width: 1024px) 100vw, 65vw"
                />
              )}
            </div>

            <div className="py-8 sm:py-10">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">
                {completed ? "Past event" : "At Hi Coworking"}
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">{event.title}</h1>

              <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-600">
                <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4" /> {dateLabel(event)}</span>
                <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4" /> {timeLabel(event)}</span>
                {event.location && <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4" /> {event.location}</span>}
                {event.format !== "in-person" && <span className="inline-flex items-center gap-2"><Video className="h-4 w-4" /> {event.format === "virtual" ? "Online" : "In person + online"}</span>}
              </div>

              <div className="mt-8 max-w-3xl whitespace-pre-wrap break-words text-base leading-8 text-slate-650">{publicEventDescription(event.description)}</div>

              {!completed && (
                <div className="mt-8">
                  <AddToCalendar event={event} />
                </div>
              )}

              {completed && event.recordingUrl && (
                <a
                  href={event.recordingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-8 inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white"
                >
                  <Play className="h-4 w-4" /> Watch the recording
                </a>
              )}
            </div>

            {event.gallery?.length > 0 && (
              <section className="border-t border-slate-200 py-10">
                <h2 className="text-2xl font-semibold text-slate-950">From the event</h2>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {event.gallery.filter((image) => image.downloadUrl).map((image, index) => (
                    <div key={`${image.storagePath}-${index}`} className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-slate-100">
                      <Image
                        src={image.downloadUrl!}
                        alt={image.alt || `${event.title} photo ${index + 1}`}
                        fill
                        className="object-cover"
                        sizes="(max-width: 640px) 100vw, 50vw"
                      />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="lg:pt-2">
            <div className="lg:sticky lg:top-24">
              {!completed && event.status === "published" ? (
                isPitchCompetitionEvent(event) ? <PitchEventActions event={event} /> : <EventRegistrationPanel event={event} />
              ) : (
                <div className="rounded-3xl bg-slate-100 p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">This event has ended</p>
                  <p className="mt-3 text-sm leading-6 text-slate-600">See what&apos;s coming up next at Hi Coworking.</p>
                  <Link href="/events" className="mt-5 inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Upcoming events</Link>
                </div>
              )}
            </div>
          </aside>
        </section>
      </main>
    </AppShell>
  );
}

export default function EventDetailPage() {
  return (
    <Suspense fallback={<AppShell><div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div></AppShell>}>
      <EventDetailContent />
    </Suspense>
  );
}
