"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getEvents, type EventFilters } from "@/lib/firestore";
import type { EventDoc, EventFormat } from "@hi/shared";
import Link from "next/link";
import {
  Calendar,
  MapPin,
  Video,
  Users,
  Loader2,
  Filter,
  Clock,
  DollarSign,
  Play,
} from "lucide-react";

const FORMAT_OPTIONS: { value: EventFormat | ""; label: string }[] = [
  { value: "", label: "All Formats" },
  { value: "in-person", label: "In-Person" },
  { value: "virtual", label: "Virtual" },
  { value: "hybrid", label: "Hybrid" },
];

const FORMAT_ICON: Record<EventFormat, typeof MapPin> = {
  "in-person": MapPin,
  virtual: Video,
  hybrid: Users,
};

const FORMAT_COLOR: Record<EventFormat, string> = {
  "in-person": "bg-blue-50 text-blue-700 border-blue-200",
  virtual: "bg-purple-50 text-purple-700 border-purple-200",
  hybrid: "bg-amber-50 text-amber-700 border-amber-200",
};

export default function EventsPage() {
  const [events, setEvents] = useState<EventDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [formatFilter, setFormatFilter] = useState<EventFormat | "">("");
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    const fetchEvents = async () => {
      setLoading(true);
      try {
        const filters: EventFilters = {
          status: "published",
          upcoming: !showPast,
        };
        if (formatFilter) filters.format = formatFilter;
        const data = await getEvents(filters);
        setEvents(data);
      } catch (err) {
        console.error("Failed to fetch events:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, [formatFilter, showPast]);

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <Calendar className="h-8 w-8 text-slate-400" />
            Events
          </h1>
          <p className="text-slate-500 mt-1">
            Workshops, networking, and knowledge-sharing — in-person, virtual, or hybrid.
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <Filter className="h-4 w-4 text-slate-400" />
          <div className="flex gap-2">
            {FORMAT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setFormatFilter(opt.value as EventFormat | "")}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  formatFilter === opt.value
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="ml-auto">
            <button
              onClick={() => setShowPast(!showPast)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                showPast
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              {showPast ? "Showing All" : "Upcoming Only"}
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-24">
            <Calendar className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-1">
              No events found
            </h2>
            <p className="text-sm text-slate-500">
              {showPast
                ? "No events match your filters."
                : "No upcoming events — check back soon!"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function EventCard({ event }: { event: EventDoc }) {
  const FormatIcon = FORMAT_ICON[event.format];
  const formatColor = FORMAT_COLOR[event.format];
  const isFree = !event.price || event.price === 0;
  const isFull = event.seatCap ? event.registrationCount >= event.seatCap : false;
  const [isPast, setIsPast] = useState(false);
  useEffect(() => { setIsPast(event.endTime < Date.now()); }, [event.endTime]);
  const startDate = new Date(event.startTime);
  const endDate = new Date(event.endTime);

  const dateStr = startDate.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeStr = `${startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} – ${endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;

  return (
    <Link
      href={`/events/detail?id=${event.id}`}
      className="block p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200 hover:ring-slate-300 hover:shadow-md transition-all"
    >
      <div className="flex items-start gap-4">
        {/* Date block */}
        <div className="shrink-0 w-16 h-16 rounded-xl bg-slate-50 border border-slate-200 flex flex-col items-center justify-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase">
            {startDate.toLocaleDateString("en-US", { month: "short" })}
          </span>
          <span className="text-xl font-bold text-slate-900 leading-none">
            {startDate.getDate()}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 line-clamp-1">
                {event.title}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                {event.description}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isPast && event.recordingUrl && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-600 border border-indigo-200 inline-flex items-center gap-1">
                  <Play className="h-3 w-3" /> Recording
                </span>
              )}
              {!isFree && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200 inline-flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  ${(event.price / 100).toFixed(2)}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3 mt-2">
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border inline-flex items-center gap-1 ${formatColor}`}>
              <FormatIcon className="h-3 w-3" />
              {event.format}
            </span>
            <span className="text-[10px] text-slate-400 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {dateStr} · {timeStr}
            </span>
            {event.location && (
              <span className="text-[10px] text-slate-400 flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {event.location}
              </span>
            )}
            {event.seatCap && (
              <span className={`text-[10px] font-medium ${isFull ? "text-red-500" : "text-slate-400"}`}>
                {event.registrationCount}/{event.seatCap} seats
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
