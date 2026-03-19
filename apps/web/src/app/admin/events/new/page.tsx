"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { getEvent, saveEvent, updateEvent, uploadEventMediaImage } from "@/lib/firestore";
import { upsertEventSeriesFn } from "@/lib/functions";
import type { EventDoc, EventFormat, EventStatus, EventTicketType, EventSponsorshipTier, EventSeriesDoc, EventMediaImage } from "@hi/shared";
import {
  Calendar,
  Loader2,
  Check,
  ArrowLeft,
  Trash2,
  Plus,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";

const FORMAT_OPTIONS: { value: EventFormat; label: string }[] = [
  { value: "in-person", label: "In-Person" },
  { value: "virtual", label: "Virtual" },
  { value: "hybrid", label: "Hybrid" },
];

const STATUS_OPTIONS: { value: EventStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "cancelled", label: "Cancelled" },
  { value: "completed", label: "Completed" },
];

export default function AdminEventFormPage() {
  return (
    <RequireAuth requiredRole="admin">
      <Suspense fallback={<AppShell><div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div></AppShell>}>
        <EventFormContent />
      </Suspense>
    </RequireAuth>
  );
}

function EventFormContent() {
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const router = useRouter();
  const { user } = useAuth();

  const [loading, setLoading] = useState(!!editId);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState<EventFormat>("in-person");
  const [status, setStatus] = useState<EventStatus>("draft");
  const [location, setLocation] = useState("");
  const [virtualUrl, setVirtualUrl] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [seatCap, setSeatCap] = useState("");
  const [price, setPrice] = useState("");
  const [linkedRfxId, setLinkedRfxId] = useState("");
  const [recordingUrl, setRecordingUrl] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [timezone, setTimezone] = useState("America/New_York");
  const [durationMins, setDurationMins] = useState("60");
  const [recurrencePreset, setRecurrencePreset] = useState<"weekly" | "biweekly" | "monthly" | "quarterly" | "custom">("weekly");
  const [customRrule, setCustomRrule] = useState("");
  const [recurrenceByDay, setRecurrenceByDay] = useState<string[]>([]);
  const [exceptionDateInput, setExceptionDateInput] = useState("");
  const [exceptionDates, setExceptionDates] = useState<string[]>([]);
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideTitle, setOverrideTitle] = useState("");
  const [overrideStartTime, setOverrideStartTime] = useState("");
  const [overrideEndTime, setOverrideEndTime] = useState("");
  const [overrideCancelled, setOverrideCancelled] = useState(false);
  const [occurrenceOverrides, setOccurrenceOverrides] = useState<Array<{
    date: string;
    title?: string;
    startTime?: string;
    endTime?: string;
    cancelled?: boolean;
  }>>([]);

  const [heroImage, setHeroImage] = useState<EventMediaImage | undefined>(undefined);
  const [gallery, setGallery] = useState<EventMediaImage[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  // Monetization State
  const [ticketTypes, setTicketTypes] = useState<EventTicketType[]>([]);
  const [sponsorships, setSponsorships] = useState<EventSponsorshipTier[]>([]);
  const [allowVendorTables, setAllowVendorTables] = useState(false);
  const [vendorTablePrice, setVendorTablePrice] = useState("");
  const [upsellProducts, setUpsellProducts] = useState<string[]>([]);

  useEffect(() => {
    if (!editId) return;
    const loadEvent = async () => {
      try {
        const ev = await getEvent(editId);
        if (ev) {
          setTitle(ev.title);
          setDescription(ev.description);
          setFormat(ev.format);
          setStatus(ev.status);
          setLocation(ev.location || "");
          setVirtualUrl(ev.virtualUrl || "");
          setSeatCap(ev.seatCap ? String(ev.seatCap) : "");
          setPrice(ev.price ? String(ev.price / 100) : "");
          setLinkedRfxId(ev.linkedRfxId || "");
          setRecordingUrl(ev.recordingUrl || "");
          
          setTicketTypes(ev.ticketTypes || []);
          setSponsorships(ev.sponsorships || []);
          setAllowVendorTables(ev.allowVendorTables || false);
          setVendorTablePrice(ev.vendorTablePriceCents ? String(ev.vendorTablePriceCents / 100) : "");
          setUpsellProducts(ev.upsellProducts || []);
          setHeroImage(ev.heroImage);
          setGallery(ev.gallery || []);

          const sd = new Date(ev.startTime);
          setStartDate(sd.toISOString().split("T")[0]);
          setStartTime(sd.toTimeString().slice(0, 5));

          const ed = new Date(ev.endTime);
          setEndDate(ed.toISOString().split("T")[0]);
          setEndTime(ed.toTimeString().slice(0, 5));
        }
      } catch (err) {
        console.error("Failed to load event:", err);
      } finally {
        setLoading(false);
      }
    };
    loadEvent();
  }, [editId]);

  // Sponsorship Handlers
  const addSponsorship = () => {
    setSponsorships([...sponsorships, {
      id: `sp_${Date.now()}`,
      name: "",
      priceCents: 0,
      slots: 1,
      soldCount: 0,
      benefits: [],
    }]);
  };

  const updateSponsorship = <K extends keyof EventSponsorshipTier>(index: number, field: K, value: EventSponsorshipTier[K]) => {
    const newSponsorships = [...sponsorships];
    newSponsorships[index] = { ...newSponsorships[index], [field]: value };
    setSponsorships(newSponsorships);
  };

  const removeSponsorship = (index: number) => {
    setSponsorships(sponsorships.filter((_, i) => i !== index));
  };

  // Ticket Type Handlers
  const addTicketType = () => {
    setTicketTypes([...ticketTypes, {
      id: `tt_${Date.now()}`,
      name: "",
      priceCents: 0,
      soldCount: 0,
      targetAudience: "public",
    }]);
  };

  const updateTicketType = <K extends keyof EventTicketType>(index: number, field: K, value: EventTicketType[K]) => {
    const newTickets = [...ticketTypes];
    newTickets[index] = { ...newTickets[index], [field]: value };
    setTicketTypes(newTickets);
  };

  const removeTicketType = (index: number) => {
    setTicketTypes(ticketTypes.filter((_, i) => i !== index));
  };

  const toggleByDay = (day: string) => {
    setRecurrenceByDay((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  };

  const addExceptionDate = () => {
    if (!exceptionDateInput) return;
    if (exceptionDates.includes(exceptionDateInput)) return;
    setExceptionDates([...exceptionDates, exceptionDateInput].sort());
    setExceptionDateInput("");
  };

  const removeExceptionDate = (date: string) => {
    setExceptionDates(exceptionDates.filter((d) => d !== date));
  };

  const addOccurrenceOverride = () => {
    if (!overrideDate) return;
    setOccurrenceOverrides((prev) => [
      ...prev.filter((o) => o.date !== overrideDate),
      {
        date: overrideDate,
        title: overrideTitle.trim() || undefined,
        startTime: overrideStartTime || undefined,
        endTime: overrideEndTime || undefined,
        cancelled: overrideCancelled || undefined,
      },
    ]);
    setOverrideDate("");
    setOverrideTitle("");
    setOverrideStartTime("");
    setOverrideEndTime("");
    setOverrideCancelled(false);
  };

  const removeOccurrenceOverride = (date: string) => {
    setOccurrenceOverrides((prev) => prev.filter((o) => o.date !== date));
  };

  const uploadHero = async (file: File) => {
    const entityId = editId || `draft_${user?.uid || "anon"}`;
    setUploadingMedia(true);
    try {
      const uploaded = await uploadEventMediaImage(isRecurring ? "series" : "events", entityId, file);
      setHeroImage(uploaded);
    } finally {
      setUploadingMedia(false);
    }
  };

  const uploadGalleryFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const entityId = editId || `draft_${user?.uid || "anon"}`;
    setUploadingMedia(true);
    try {
      const uploaded = await Promise.all(
        Array.from(files).map((file) => uploadEventMediaImage(isRecurring ? "series" : "events", entityId, file))
      );
      setGallery((prev) => [...prev, ...uploaded]);
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !startDate || !startTime || !endDate || !endTime) return;
    setSaving(true);

    try {
      const startTimestamp = new Date(`${startDate}T${startTime}`).getTime();
      const endTimestamp = new Date(`${endDate}T${endTime}`).getTime();

      const eventData = {
        title: title.trim(),
        description: description.trim(),
        format,
        status,
        location: location.trim() || undefined,
        virtualUrl: virtualUrl.trim() || undefined,
        startTime: startTimestamp,
        endTime: endTimestamp,
        seatCap: seatCap ? parseInt(seatCap) : undefined,
        price: price ? Math.round(parseFloat(price) * 100) : 0,
        linkedRfxId: linkedRfxId.trim() || undefined,
        recordingUrl: recordingUrl.trim() || undefined,
        ticketTypes,
        sponsorships,
        allowVendorTables,
        vendorTablePriceCents: vendorTablePrice ? Math.round(parseFloat(vendorTablePrice) * 100) : undefined,
        upsellProducts,
        heroImage,
        gallery,
      };

      const rruleFromPreset = () => {
        let base = "FREQ=WEEKLY;INTERVAL=1";
        if (recurrencePreset === "biweekly") base = "FREQ=WEEKLY;INTERVAL=2";
        if (recurrencePreset === "monthly") base = "FREQ=MONTHLY;INTERVAL=1";
        if (recurrencePreset === "quarterly") base = "FREQ=MONTHLY;INTERVAL=3";
        if (recurrencePreset === "custom") base = customRrule.trim() || "FREQ=WEEKLY;INTERVAL=1";

        if (recurrenceByDay.length && !base.includes("BYDAY=")) {
          base = `${base};BYDAY=${recurrenceByDay.join(",")}`;
        }
        return base;
      };

      const overrideToTimestamp = (date: string, time?: string) => {
        if (!time) return undefined;
        const ts = new Date(`${date}T${time}`).getTime();
        return Number.isFinite(ts) ? ts : undefined;
      };

      const seriesExceptions = exceptionDates
        .map((d) => new Date(`${d}T00:00:00`).getTime())
        .filter((v) => Number.isFinite(v));

      const seriesOverrides = occurrenceOverrides.reduce<Record<string, Record<string, unknown>>>((acc, item) => {
        const dateTs = new Date(`${item.date}T00:00:00`).getTime();
        if (!Number.isFinite(dateTs)) return acc;
        const startTs = overrideToTimestamp(item.date, item.startTime);
        const endTs = overrideToTimestamp(item.date, item.endTime);
        acc[String(dateTs)] = {
          ...(item.title ? { title: item.title } : {}),
          ...(typeof startTs === "number" ? { startTime: startTs } : {}),
          ...(typeof endTs === "number" ? { endTime: endTs } : {}),
          ...(item.cancelled ? { cancelled: true } : {}),
        };
        return acc;
      }, {});

      if (!editId && isRecurring) {
        const seriesId = `es_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const series: EventSeriesDoc = {
          id: seriesId,
          title: title.trim(),
          description: description.trim(),
          format,
          status,
          timezone,
          rrule: rruleFromPreset(),
          startTimeOfDay: startTime,
          durationMins: Math.max(30, parseInt(durationMins, 10) || 60),
          seriesStartDate: startTimestamp,
          seriesEndDate: endTimestamp,
          exceptions: seriesExceptions,
          overrides: seriesOverrides,
          location: location.trim() || undefined,
          virtualUrl: virtualUrl.trim() || undefined,
          seatCap: seatCap ? parseInt(seatCap, 10) : undefined,
          price: price ? Math.round(parseFloat(price) * 100) : 0,
          currency: "USD",
          linkedRfxId: linkedRfxId.trim() || undefined,
          recordingUrl: recordingUrl.trim() || undefined,
          ticketTypes,
          sponsorships,
          allowVendorTables,
          vendorTablePriceCents: vendorTablePrice ? Math.round(parseFloat(vendorTablePrice) * 100) : undefined,
          upsellProducts,
          heroImage,
          gallery,
          promoVideo: undefined,
          speakerCards: [],
          sponsorLogos: [],
          topics: [],
          audienceRules: undefined,
          campaign: undefined,
          createdBy: user?.uid || "",
          createdAt: Date.now(),
        };

        await upsertEventSeriesFn({ series: series as unknown as Record<string, unknown> });
        router.push("/admin/events");
        return;
      }

      if (editId) {
        await updateEvent(editId, eventData);
      } else {
        const id = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const event: EventDoc = {
          id,
          ...eventData,
          isOverride: false,
          gallery: [],
          speakerCards: [],
          sponsorLogos: [],
          topics: [],
          registrationCount: 0,
          currency: "USD",
          createdBy: user?.uid || "",
          createdAt: Date.now(),
        };
        await saveEvent(event);
      }

      router.push("/admin/events");
    } catch (err) {
      console.error("Failed to save event:", err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto">
        <Link
          href="/admin/events"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to events
        </Link>

        <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-3 mb-8">
          <Calendar className="h-7 w-7 text-slate-400" />
          {editId ? "Edit Event" : "New Event"}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
              placeholder="Event title"
            />
          </div>

          {/* Recurrence */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-900">Recurring Event</label>
                <p className="text-xs text-slate-500">Create an event series with rolling occurrences.</p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={isRecurring}
                  onChange={(e) => setIsRecurring(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                Enable
              </label>
            </div>

            {isRecurring && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Timezone</label>
                  <input
                    type="text"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Duration (minutes)</label>
                  <input
                    type="number"
                    min="30"
                    value={durationMins}
                    onChange={(e) => setDurationMins(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Recurrence Pattern</label>
                  <select
                    value={recurrencePreset}
                    onChange={(e) => setRecurrencePreset(e.target.value as typeof recurrencePreset)}
                    className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Biweekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="custom">Custom RRULE</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-2">Days of Week (BYDAY)</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: "Sun", code: "SU" },
                      { label: "Mon", code: "MO" },
                      { label: "Tue", code: "TU" },
                      { label: "Wed", code: "WE" },
                      { label: "Thu", code: "TH" },
                      { label: "Fri", code: "FR" },
                      { label: "Sat", code: "SA" },
                    ].map((day) => (
                      <button
                        key={day.code}
                        type="button"
                        onClick={() => toggleByDay(day.code)}
                        className={`px-2.5 py-1 rounded-md text-xs border ${recurrenceByDay.includes(day.code) ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200"}`}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Exception Dates</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={exceptionDateInput}
                      onChange={(e) => setExceptionDateInput(e.target.value)}
                      className="rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm"
                    />
                    <button
                      type="button"
                      onClick={addExceptionDate}
                      className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-900 text-white"
                    >
                      Add Exception
                    </button>
                  </div>
                  {exceptionDates.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {exceptionDates.map((date) => (
                        <button
                          key={date}
                          type="button"
                          onClick={() => removeExceptionDate(date)}
                          className="text-xs px-2 py-1 rounded-md border border-slate-200 bg-white text-slate-700"
                        >
                          {date} ×
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="md:col-span-2 p-3 rounded-lg border border-slate-200 bg-white">
                  <p className="text-xs font-medium text-slate-700 mb-2">Occurrence Override</p>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                    <input
                      type="date"
                      value={overrideDate}
                      onChange={(e) => setOverrideDate(e.target.value)}
                      className="rounded-lg px-2.5 py-2 border border-slate-200 text-xs"
                    />
                    <input
                      type="text"
                      value={overrideTitle}
                      onChange={(e) => setOverrideTitle(e.target.value)}
                      placeholder="Title override"
                      className="rounded-lg px-2.5 py-2 border border-slate-200 text-xs"
                    />
                    <input
                      type="time"
                      value={overrideStartTime}
                      onChange={(e) => setOverrideStartTime(e.target.value)}
                      className="rounded-lg px-2.5 py-2 border border-slate-200 text-xs"
                    />
                    <input
                      type="time"
                      value={overrideEndTime}
                      onChange={(e) => setOverrideEndTime(e.target.value)}
                      className="rounded-lg px-2.5 py-2 border border-slate-200 text-xs"
                    />
                    <button
                      type="button"
                      onClick={addOccurrenceOverride}
                      className="rounded-lg px-2.5 py-2 bg-slate-900 text-white text-xs font-medium"
                    >
                      Save Override
                    </button>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 mt-2">
                    <input
                      type="checkbox"
                      checked={overrideCancelled}
                      onChange={(e) => setOverrideCancelled(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300"
                    />
                    Cancel this occurrence
                  </label>
                  {occurrenceOverrides.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {occurrenceOverrides.map((item) => (
                        <button
                          key={item.date}
                          type="button"
                          onClick={() => removeOccurrenceOverride(item.date)}
                          className="block text-xs text-slate-600 hover:text-slate-900"
                        >
                          {item.date} {item.cancelled ? "(cancelled)" : ""} {item.title ? `- ${item.title}` : ""} ×
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {recurrencePreset === "custom" && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Custom RRULE</label>
                    <input
                      type="text"
                      value={customRrule}
                      onChange={(e) => setCustomRrule(e.target.value)}
                      placeholder="FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE"
                      className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Media */}
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-900">Event Media</label>
              <p className="text-xs text-slate-500">Upload hero and gallery assets for event cards and social previews.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Hero Image</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadHero(file);
                }}
                className="block w-full text-xs text-slate-700"
              />
              {heroImage?.downloadUrl && (
                <Image
                  src={heroImage.downloadUrl}
                  alt={heroImage.alt}
                  width={1200}
                  height={320}
                  className="mt-2 h-24 w-full object-cover rounded-lg border border-slate-200"
                  unoptimized
                />
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Gallery Images</label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  void uploadGalleryFiles(e.target.files);
                }}
                className="block w-full text-xs text-slate-700"
              />
              {gallery.length > 0 && (
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {gallery.map((img) => (
                    <div key={img.storagePath} className="relative">
                      {img.downloadUrl && (
                        <Image
                          src={img.downloadUrl}
                          alt={img.alt}
                          width={400}
                          height={240}
                          className="h-20 w-full object-cover rounded-lg border border-slate-200"
                          unoptimized
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => setGallery((prev) => prev.filter((g) => g.storagePath !== img.storagePath))}
                        className="absolute top-1 right-1 text-[10px] bg-white/90 px-1.5 py-0.5 rounded"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {uploadingMedia && <p className="text-xs text-slate-500">Uploading media...</p>}
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={4}
              className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none resize-none"
              placeholder="Describe the event..."
            />
          </div>

          {/* Format + Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Format *</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as EventFormat)}
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
              >
                {FORMAT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as EventStatus)}
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Date/Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Start Date *</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); if (!endDate) setEndDate(e.target.value); }}
                required
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Start Time *</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">End Date *</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">End Time *</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
              />
            </div>
          </div>

          {/* Location + Virtual URL */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Location</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                placeholder="e.g. Hi Coworking, Suite 200"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Virtual URL</label>
              <input
                type="url"
                value={virtualUrl}
                onChange={(e) => setVirtualUrl(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                placeholder="https://zoom.us/..."
              />
            </div>
          </div>

          {/* Seat cap + Price */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Seat Capacity</label>
              <input
                type="number"
                value={seatCap}
                onChange={(e) => setSeatCap(e.target.value)}
                min="0"
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                placeholder="Unlimited if blank"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Base Price (USD)</label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                step="0.01"
                min="0"
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                placeholder="0 = free"
              />
            </div>
          </div>

          {/* Monetization Section */}
          <div className="border-t border-slate-200 pt-6">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Monetization</h3>

            {/* Sponsorship Tiers */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-slate-700">Sponsorship Tiers</label>
                <button
                  type="button"
                  onClick={addSponsorship}
                  className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  <Plus className="h-3 w-3" /> Add Tier
                </button>
              </div>
              
              <div className="space-y-3">
                {sponsorships.map((tier, idx) => (
                  <div key={tier.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 relative group">
                    <button
                      type="button"
                      onClick={() => removeSponsorship(idx)}
                      className="absolute top-2 right-2 p-1 text-slate-400 hover:text-red-500 transition-colors"
                      title="Remove tier"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <div className="grid grid-cols-2 gap-3 pr-6">
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">Name</label>
                        <input
                          type="text"
                          value={tier.name}
                          onChange={(e) => updateSponsorship(idx, "name", e.target.value)}
                          className="w-full rounded-lg px-2.5 py-1.5 border border-slate-200 bg-white text-xs"
                          placeholder="e.g. Gold Sponsor"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">Price (Cents)</label>
                        <input
                          type="number"
                          value={tier.priceCents}
                          onChange={(e) => updateSponsorship(idx, "priceCents", parseInt(e.target.value) || 0)}
                          className="w-full rounded-lg px-2.5 py-1.5 border border-slate-200 bg-white text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">Slots</label>
                        <input
                          type="number"
                          value={tier.slots}
                          onChange={(e) => updateSponsorship(idx, "slots", parseInt(e.target.value) || 0)}
                          className="w-full rounded-lg px-2.5 py-1.5 border border-slate-200 bg-white text-xs"
                        />
                      </div>
                      <div>
                         <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">Benefits (comma sep)</label>
                         <input
                          type="text"
                          value={tier.benefits.join(", ")}
                          onChange={(e) => updateSponsorship(idx, "benefits", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                          className="w-full rounded-lg px-2.5 py-1.5 border border-slate-200 bg-white text-xs"
                          placeholder="Logo, Shoutout..."
                        />
                      </div>
                    </div>
                  </div>
                ))}
                {sponsorships.length === 0 && (
                  <div className="text-center py-4 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                    No sponsorship tiers defined.
                  </div>
                )}
              </div>
            </div>

            {/* Ticket Types */}
            <div className="mb-6">
               <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-slate-700">Ticket Types (Optional)</label>
                <button
                  type="button"
                  onClick={addTicketType}
                  className="text-xs flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  <Plus className="h-3 w-3" /> Add Ticket Type
                </button>
              </div>
              <div className="space-y-3">
                {ticketTypes.map((tt, idx) => (
                  <div key={tt.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 relative">
                     <button
                      type="button"
                      onClick={() => removeTicketType(idx)}
                      className="absolute top-2 right-2 p-1 text-slate-400 hover:text-red-500 transition-colors"
                      title="Remove ticket type"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <div className="grid grid-cols-2 gap-3 pr-6">
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">Name</label>
                         <input
                          type="text"
                          value={tt.name}
                          onChange={(e) => updateTicketType(idx, "name", e.target.value)}
                          className="w-full rounded-lg px-2.5 py-1.5 border border-slate-200 bg-white text-xs"
                          placeholder="e.g. VIP Admission"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">Price (Cents)</label>
                        <input
                          type="number"
                          value={tt.priceCents}
                          onChange={(e) => updateTicketType(idx, "priceCents", parseInt(e.target.value) || 0)}
                          className="w-full rounded-lg px-2.5 py-1.5 border border-slate-200 bg-white text-xs"
                        />
                      </div>
                    </div>
                  </div>
                ))}
                 {ticketTypes.length === 0 && (
                  <div className="text-center py-4 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-xs">
                    Using base price only. Add ticket types for tiered pricing.
                  </div>
                )}
              </div>
            </div>

            {/* Vendor Tables */}
            <div className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
              <input
                type="checkbox"
                checked={allowVendorTables}
                onChange={(e) => setAllowVendorTables(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-900">Allow Vendor Tables</label>
                <p className="text-xs text-slate-500">Enable vendors to book tables for this event.</p>
                
                {allowVendorTables && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Table Price (USD)</label>
                    <input
                      type="number"
                      value={vendorTablePrice}
                      onChange={(e) => setVendorTablePrice(e.target.value)}
                      step="0.01"
                      min="0"
                      className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                      placeholder="e.g. 100.00"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Link to RFx + Recording URL */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Linked RFx ID</label>
              <input
                type="text"
                value={linkedRfxId}
                onChange={(e) => setLinkedRfxId(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                placeholder="rfx_xxx (optional)"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Recording URL</label>
              <input
                type="url"
                value={recordingUrl}
                onChange={(e) => setRecordingUrl(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                placeholder="https://... (post-event)"
              />
            </div>
          </div>

          {/* Submit */}
          <div className="flex items-center gap-3 pt-4">
            <button
              type="submit"
              disabled={saving || !title.trim() || !startDate || !startTime || !endDate || !endTime}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {editId ? "Update Event" : "Create Event"}
            </button>
            <Link
              href="/admin/events"
              className="px-6 py-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
