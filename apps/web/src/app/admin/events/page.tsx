"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { getAllEvents, updateEvent } from "@/lib/firestore";
import type { EventDoc, EventStatus } from "@hi/shared";
import Link from "next/link";
import {
  Calendar,
  Plus,
  Loader2,
  MapPin,
  Video,
  Users,
  Clock,
  Edit3,
  Eye,
  XCircle,
  CheckCircle2,
  Play,
} from "lucide-react";

const STATUS_CONFIG: Record<EventStatus, { label: string; color: string }> = {
  draft: { label: "Draft", color: "bg-slate-100 text-slate-600 border-slate-200" },
  published: { label: "Published", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled: { label: "Cancelled", color: "bg-red-50 text-red-600 border-red-200" },
  completed: { label: "Completed", color: "bg-blue-50 text-blue-600 border-blue-200" },
};

export default function AdminEventsPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminEventsContent />
    </RequireAuth>
  );
}

function AdminEventsContent() {
  const [events, setEvents] = useState<EventDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await getAllEvents());
    } catch (err) {
      console.error("Failed to fetch events:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleStatusChange = async (eventId: string, status: EventStatus) => {
    try {
      await updateEvent(eventId, { status });
      fetchEvents();
    } catch (err) {
      console.error("Failed to update event status:", err);
    }
  };

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              <Calendar className="h-8 w-8 text-slate-400" />
              Manage Events
            </h1>
            <p className="text-slate-500 mt-1">Create, edit, and manage events.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin/events/series"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Series Editor
            </Link>
            <Link
              href="/admin/events/new"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              New Event
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-24">
            <Calendar className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-1">No events yet</h2>
            <p className="text-sm text-slate-500">Create your first event to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {events.map((event) => {
              const statusCfg = STATUS_CONFIG[event.status];
              const startDate = new Date(event.startTime);
              return (
                <div
                  key={event.id}
                  className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-bold text-slate-900 truncate">
                          {event.title}
                        </h3>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${statusCfg.color}`}>
                          {statusCfg.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          {" "}
                          {startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </span>
                        <span className="flex items-center gap-1">
                          {event.format === "in-person" ? <MapPin className="h-3 w-3" /> :
                           event.format === "virtual" ? <Video className="h-3 w-3" /> :
                           <Users className="h-3 w-3" />}
                          {event.format}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {event.registrationCount}{event.seatCap ? `/${event.seatCap}` : ""} registered
                        </span>
                        {event.recordingUrl && (
                          <span className="flex items-center gap-1 text-indigo-600">
                            <Play className="h-3 w-3" /> Recording
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Link
                        href={`/events/detail?id=${event.id}`}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        title="View"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      <Link
                        href={`/admin/events/new?edit=${event.id}`}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        title="Edit"
                      >
                        <Edit3 className="h-4 w-4" />
                      </Link>
                      {event.status === "draft" && (
                        <button
                          onClick={() => handleStatusChange(event.id, "published")}
                          className="p-2 rounded-lg hover:bg-emerald-50 text-emerald-500 hover:text-emerald-600 transition-colors"
                          title="Publish"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      )}
                      {event.status === "published" && (
                        <button
                          onClick={() => handleStatusChange(event.id, "cancelled")}
                          className="p-2 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"
                          title="Cancel"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
