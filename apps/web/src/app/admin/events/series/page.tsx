"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  getEventSeriesList,
  getEventSeries,
  getSeriesOccurrences,
} from "@/lib/firestore";
import { setSeriesOccurrenceOverrideFn } from "@/lib/functions";
import type { EventDoc, EventSeriesDoc } from "@hi/shared";
import {
  Loader2,
  ArrowLeft,
  CalendarDays,
  Clock,
  Edit3,
  XCircle,
  RotateCcw,
  Save,
} from "lucide-react";
import Link from "next/link";

export default function AdminSeriesOccurrencesPage() {
  return (
    <RequireAuth requiredRole="admin">
      <Suspense
        fallback={
          <AppShell>
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          </AppShell>
        }
      >
        <SeriesEditorContent />
      </Suspense>
    </RequireAuth>
  );
}

function SeriesEditorContent() {
  const searchParams = useSearchParams();
  const seriesIdParam = searchParams.get("id");

  const [seriesList, setSeriesList] = useState<EventSeriesDoc[]>([]);
  const [selectedSeriesId, setSelectedSeriesId] = useState(seriesIdParam || "");
  const [series, setSeries] = useState<EventSeriesDoc | null>(null);
  const [occurrences, setOccurrences] = useState<EventDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Override editor state
  const [editingOccurrence, setEditingOccurrence] = useState<string | null>(null);
  const [overrideTitle, setOverrideTitle] = useState("");
  const [overrideStartTime, setOverrideStartTime] = useState("");
  const [overrideEndTime, setOverrideEndTime] = useState("");
  const [overrideLocation, setOverrideLocation] = useState("");
  const [overrideCancelled, setOverrideCancelled] = useState(false);

  const loadSeriesList = useCallback(async () => {
    try {
      const list = await getEventSeriesList();
      setSeriesList(list);
      if (!selectedSeriesId && list.length > 0) {
        setSelectedSeriesId(list[0].id);
      }
    } catch (err) {
      console.error("Failed to load series list:", err);
    }
  }, [selectedSeriesId]);

  const loadSeriesData = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const [seriesData, occs] = await Promise.all([
        getEventSeries(id),
        getSeriesOccurrences(id),
      ]);
      setSeries(seriesData);
      setOccurrences(occs);
    } catch (err) {
      console.error("Failed to load series data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSeriesList();
  }, [loadSeriesList]);

  useEffect(() => {
    if (selectedSeriesId) {
      loadSeriesData(selectedSeriesId);
    }
  }, [selectedSeriesId, loadSeriesData]);

  const overridesMap = useMemo(() => {
    if (!series?.overrides) return new Map<string, Record<string, unknown>>();
    return new Map(Object.entries(series.overrides));
  }, [series]);

  const startEditingOccurrence = (occ: EventDoc) => {
    setEditingOccurrence(occ.id);
    setOverrideTitle(occ.title || "");

    const sd = new Date(occ.startTime);
    setOverrideStartTime(
      `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, "0")}-${String(sd.getDate()).padStart(2, "0")}T${String(sd.getHours()).padStart(2, "0")}:${String(sd.getMinutes()).padStart(2, "0")}`
    );

    const ed = new Date(occ.endTime);
    setOverrideEndTime(
      `${ed.getFullYear()}-${String(ed.getMonth() + 1).padStart(2, "0")}-${String(ed.getDate()).padStart(2, "0")}T${String(ed.getHours()).padStart(2, "0")}:${String(ed.getMinutes()).padStart(2, "0")}`
    );

    setOverrideLocation(occ.location || "");
    setOverrideCancelled(false);
  };

  const cancelEditing = () => {
    setEditingOccurrence(null);
    setOverrideTitle("");
    setOverrideStartTime("");
    setOverrideEndTime("");
    setOverrideLocation("");
    setOverrideCancelled(false);
  };

  const saveOverride = async (occ: EventDoc) => {
    if (!series || !occ.occurrenceDate) return;
    setSaving(true);
    try {
      const override: Record<string, unknown> = {};

      if (overrideTitle.trim() && overrideTitle.trim() !== series.title) {
        override.title = overrideTitle.trim();
      }
      if (overrideStartTime) {
        const ts = new Date(overrideStartTime).getTime();
        if (Number.isFinite(ts)) override.startTime = ts;
      }
      if (overrideEndTime) {
        const ts = new Date(overrideEndTime).getTime();
        if (Number.isFinite(ts)) override.endTime = ts;
      }
      if (overrideLocation.trim() && overrideLocation.trim() !== (series.location || "")) {
        override.location = overrideLocation.trim();
      }
      if (overrideCancelled) {
        override.cancelled = true;
      }

      await setSeriesOccurrenceOverrideFn({
        seriesId: series.id,
        occurrenceDate: occ.occurrenceDate,
        override,
      });

      cancelEditing();
      await loadSeriesData(series.id);
    } catch (err) {
      console.error("Failed to save override:", err);
    } finally {
      setSaving(false);
    }
  };

  const removeOverride = async (occ: EventDoc) => {
    if (!series || !occ.occurrenceDate) return;
    setSaving(true);
    try {
      await setSeriesOccurrenceOverrideFn({
        seriesId: series.id,
        occurrenceDate: occ.occurrenceDate,
        remove: true,
      });
      await loadSeriesData(series.id);
    } catch (err) {
      console.error("Failed to remove override:", err);
    } finally {
      setSaving(false);
    }
  };

  const cancelOccurrence = async (occ: EventDoc) => {
    if (!series || !occ.occurrenceDate) return;
    setSaving(true);
    try {
      await setSeriesOccurrenceOverrideFn({
        seriesId: series.id,
        occurrenceDate: occ.occurrenceDate,
        override: { cancelled: true },
      });
      await loadSeriesData(series.id);
    } catch (err) {
      console.error("Failed to cancel occurrence:", err);
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        <Link
          href="/admin/events"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to events
        </Link>

        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-3 mb-6">
          <CalendarDays className="h-7 w-7 text-slate-400" />
          Series Occurrence Editor
        </h1>

        {/* Series Selector */}
        <div className="mb-6">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Select Series
          </label>
          <select
            value={selectedSeriesId}
            onChange={(e) => setSelectedSeriesId(e.target.value)}
            className="w-full max-w-md rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
          >
            <option value="">Choose a series...</option>
            {seriesList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({s.status})
              </option>
            ))}
          </select>
        </div>

        {loading && selectedSeriesId ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : series ? (
          <>
            {/* Series Summary */}
            <div className="mb-6 p-4 rounded-xl border border-slate-200 bg-slate-50">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-xs font-medium text-slate-500 block">Title</span>
                  <span className="text-slate-900 font-semibold">{series.title}</span>
                </div>
                <div>
                  <span className="text-xs font-medium text-slate-500 block">Status</span>
                  <span className="text-slate-900">{series.status}</span>
                </div>
                <div>
                  <span className="text-xs font-medium text-slate-500 block">RRULE</span>
                  <span className="text-slate-700 font-mono text-xs">{series.rrule || "none"}</span>
                </div>
                <div>
                  <span className="text-xs font-medium text-slate-500 block">Occurrences</span>
                  <span className="text-slate-900 font-semibold">{occurrences.length}</span>
                </div>
              </div>
              {Object.keys(series.overrides || {}).length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-200">
                  <span className="text-xs font-medium text-slate-500">
                    Active overrides: {Object.keys(series.overrides || {}).length}
                  </span>
                </div>
              )}
            </div>

            {/* Occurrences Table */}
            <div className="space-y-2">
              {occurrences.length === 0 ? (
                <div className="text-center py-16 text-sm text-slate-500">
                  No occurrences generated yet for this series.
                </div>
              ) : (
                occurrences.map((occ) => {
                  const isEditing = editingOccurrence === occ.id;
                  const hasOverride = occ.isOverride;
                  const dayKey = occ.occurrenceDate ? String(occ.occurrenceDate) : null;
                  const existingOverride = dayKey ? overridesMap.get(dayKey) : null;
                  const isCancelled = existingOverride?.cancelled === true;

                  return (
                    <div
                      key={occ.id}
                      className={`rounded-xl border p-4 transition-colors ${
                        isCancelled
                          ? "border-red-200 bg-red-50"
                          : hasOverride
                          ? "border-amber-200 bg-amber-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      {isEditing ? (
                        /* Edit Mode */
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-slate-900">
                              Editing: {formatDate(occ.occurrenceDate || occ.startTime)}
                            </span>
                            <button
                              onClick={cancelEditing}
                              className="text-xs text-slate-500 hover:text-slate-700"
                            >
                              Cancel
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Title Override
                              </label>
                              <input
                                type="text"
                                value={overrideTitle}
                                onChange={(e) => setOverrideTitle(e.target.value)}
                                className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm"
                                placeholder={series.title}
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Location Override
                              </label>
                              <input
                                type="text"
                                value={overrideLocation}
                                onChange={(e) => setOverrideLocation(e.target.value)}
                                className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm"
                                placeholder={series.location || "No location set"}
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                Start Time
                              </label>
                              <input
                                type="datetime-local"
                                value={overrideStartTime}
                                onChange={(e) => setOverrideStartTime(e.target.value)}
                                className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">
                                End Time
                              </label>
                              <input
                                type="datetime-local"
                                value={overrideEndTime}
                                onChange={(e) => setOverrideEndTime(e.target.value)}
                                className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm"
                              />
                            </div>
                          </div>

                          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={overrideCancelled}
                              onChange={(e) => setOverrideCancelled(e.target.checked)}
                              className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                            />
                            Cancel this occurrence
                          </label>

                          <div className="flex gap-2 pt-2">
                            <button
                              onClick={() => saveOverride(occ)}
                              disabled={saving}
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
                            >
                              {saving ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Save className="h-3.5 w-3.5" />
                              )}
                              Save Override
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* View Mode */
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-sm font-semibold text-slate-900 truncate">
                                {occ.title}
                              </span>
                              {isCancelled && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-600 border border-red-200">
                                  Cancelled
                                </span>
                              )}
                              {hasOverride && !isCancelled && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                                  Modified
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-500">
                              <span className="flex items-center gap-1">
                                <CalendarDays className="h-3 w-3" />
                                {formatDate(occ.startTime)}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatTime(occ.startTime)} – {formatTime(occ.endTime)}
                              </span>
                              {occ.location && (
                                <span className="text-slate-400">{occ.location}</span>
                              )}
                              <span className="text-slate-400">
                                {occ.registrationCount || 0} registered
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => startEditingOccurrence(occ)}
                              className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                              title="Edit override"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            {!isCancelled && (
                              <button
                                onClick={() => cancelOccurrence(occ)}
                                disabled={saving}
                                className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                                title="Cancel occurrence"
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                            )}
                            {existingOverride && (
                              <button
                                onClick={() => removeOverride(occ)}
                                disabled={saving}
                                className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                                title="Remove override (reset to series defaults)"
                              >
                                <RotateCcw className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : selectedSeriesId ? (
          <div className="text-center py-16 text-sm text-slate-500">
            Series not found.
          </div>
        ) : (
          <div className="text-center py-16 text-sm text-slate-500">
            Select a series to manage its occurrences.
          </div>
        )}
      </div>
    </AppShell>
  );
}
