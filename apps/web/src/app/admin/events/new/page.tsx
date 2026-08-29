"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { getEvent, uploadEventMediaImage } from "@/lib/firestore";
import { adminPublishEventV2, adminSaveEventV2, type EventPublic } from "@/lib/eventsV2";
import type { EventMediaImage, EventTicketType } from "@hi/shared";

function localDateTimeValue(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function cents(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : 0;
}

function EventEditorContent() {
  const params = useSearchParams();
  const editId = params.get("edit");
  const router = useRouter();
  const [eventId] = useState(() => editId || `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const [loading, setLoading] = useState(Boolean(editId));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [format, setFormat] = useState<"in-person" | "virtual" | "hybrid">("in-person");
  const [location, setLocation] = useState("15373 Carrollton Blvd, Carrollton, VA");
  const [virtualUrl, setVirtualUrl] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [capacity, setCapacity] = useState("");
  const [paid, setPaid] = useState(false);
  const [publicPrice, setPublicPrice] = useState("");
  const [memberPrice, setMemberPrice] = useState("");
  const [refundCutoff, setRefundCutoff] = useState("24");
  const [confirmation, setConfirmation] = useState(true);
  const [reminder24h, setReminder24h] = useState(true);
  const [reminder1h, setReminder1h] = useState(true);
  const [followUp, setFollowUp] = useState(false);
  const [heroImage, setHeroImage] = useState<EventMediaImage | undefined>();
  const [ticketTypes, setTicketTypes] = useState<EventTicketType[]>([]);
  const [advancedTickets, setAdvancedTickets] = useState(false);
  const [existingStatus, setExistingStatus] = useState<EventPublic["status"]>("draft");

  useEffect(() => {
    if (!editId) return;
    let active = true;
    async function load() {
      try {
        const raw = await getEvent(editId!);
        const event = raw as EventPublic | null;
        if (!active || !event) return;
        setTitle(event.title);
        setDescription(event.description);
        setFormat(event.format);
        setLocation(event.location || "");
        setVirtualUrl(event.virtualUrl || "");
        setStart(localDateTimeValue(event.startTime));
        setEnd(localDateTimeValue(event.endTime));
        setCapacity(event.seatCap ? String(event.seatCap) : "");
        setPaid((event.price || 0) > 0 || Boolean(event.ticketTypes?.some((ticket) => ticket.priceCents > 0)));
        setPublicPrice(event.price ? String(event.price / 100) : "");
        setMemberPrice(typeof event.memberPriceCents === "number" ? String(event.memberPriceCents / 100) : "");
        setRefundCutoff(String(event.refundCutoffHours ?? 24));
        setHeroImage(event.heroImage);
        setTicketTypes(event.ticketTypes || []);
        setAdvancedTickets(Boolean(event.ticketTypes?.length));
        setConfirmation(event.reminders?.confirmation !== false);
        setReminder24h(event.reminders?.reminder24h !== false);
        setReminder1h(event.reminders?.reminder1h !== false);
        setFollowUp(event.reminders?.followUp === true);
        setExistingStatus(event.status);
        setSavedSlug(event.slug || null);
      } catch (error) {
        console.error(error);
        setMessage("Could not load this event.");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [editId]);

  const valid = useMemo(() => (
    title.trim().length > 0
    && description.trim().length > 0
    && Boolean(start)
    && Boolean(end)
    && new Date(end).getTime() > new Date(start).getTime()
    && (!paid || advancedTickets || cents(publicPrice) > 0)
  ), [title, description, start, end, paid, advancedTickets, publicPrice]);

  function addTicket() {
    setTicketTypes((current) => [...current, {
      id: `ticket_${Date.now()}`,
      name: "General admission",
      priceCents: paid ? cents(publicPrice) : 0,
      soldCount: 0,
      targetAudience: "public",
    }]);
  }

  function updateTicket(index: number, patch: Partial<EventTicketType>) {
    setTicketTypes((current) => current.map((ticket, ticketIndex) => (
      ticketIndex === index ? { ...ticket, ...patch } : ticket
    )));
  }

  async function uploadHero(file?: File) {
    if (!file) return;
    setUploading(true);
    setMessage(null);
    try {
      const uploaded = await uploadEventMediaImage("events", eventId, file);
      setHeroImage(uploaded);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload the event image.");
    } finally {
      setUploading(false);
    }
  }

  async function save(publishAfter: boolean) {
    if (!valid) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await adminSaveEventV2({
        id: eventId,
        title: title.trim(),
        description: description.trim(),
        format,
        location: location.trim() || undefined,
        virtualUrl: virtualUrl.trim() || undefined,
        startTime: new Date(start).getTime(),
        endTime: new Date(end).getTime(),
        timezone: "America/New_York",
        seatCap: capacity ? Number(capacity) : undefined,
        price: paid && !advancedTickets ? cents(publicPrice) : 0,
        memberPriceCents: paid && !advancedTickets && memberPrice ? cents(memberPrice) : undefined,
        currency: "usd",
        ticketTypes: advancedTickets ? ticketTypes : [],
        heroImage,
        refundCutoffHours: Number(refundCutoff) || 24,
        confirmation,
        reminder24h,
        reminder1h,
        followUp,
      });
      setSavedSlug(result.data.slug);
      if (publishAfter && existingStatus !== "published") {
        await adminPublishEventV2({ eventId });
      }
      router.push("/admin/events");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save this event.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <AppShell><div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div></AppShell>;
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <Link href="/admin/events" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-950"><ArrowLeft className="h-4 w-4" /> Events</Link>

        <div className="mt-6 grid gap-10 lg:grid-cols-[1fr_18rem]">
          <form className="space-y-10" onSubmit={(event) => { event.preventDefault(); void save(false); }}>
            <section>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Event</p>
              <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">{editId ? "Edit event" : "Create an event"}</h1>

              <div className="mt-7 space-y-5">
                <label className="block text-sm font-medium text-slate-700">
                  Event name
                  <input value={title} onChange={(event) => setTitle(event.target.value)} className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-base outline-none focus:border-slate-400" placeholder="Community Coffee" />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  What should people know?
                  <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} className="mt-2 w-full resize-y rounded-2xl border border-slate-200 px-4 py-3 text-sm leading-6 outline-none focus:border-slate-400" placeholder="A short, inviting description of the gathering." />
                </label>

                <div>
                  <p className="text-sm font-medium text-slate-700">Event image</p>
                  {heroImage?.downloadUrl ? (
                    <div className="mt-2 overflow-hidden rounded-3xl bg-slate-100">
                      <div className="relative aspect-[16/8]"><Image src={heroImage.downloadUrl} alt={heroImage.alt || title || "Event"} fill className="object-cover" sizes="700px" /></div>
                      <label className="flex cursor-pointer items-center justify-center gap-2 border-t border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700">
                        <ImagePlus className="h-4 w-4" /> Change image
                        <input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadHero(event.target.files?.[0])} />
                      </label>
                    </div>
                  ) : (
                    <label className="mt-2 flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 text-center">
                      {uploading ? <Loader2 className="h-6 w-6 animate-spin text-slate-400" /> : <ImagePlus className="h-6 w-6 text-slate-400" />}
                      <span className="mt-2 text-sm font-medium text-slate-700">Add a photo</span>
                      <span className="mt-1 text-xs text-slate-500">This becomes the main public event image.</span>
                      <input type="file" accept="image/*" className="hidden" onChange={(event) => void uploadHero(event.target.files?.[0])} />
                    </label>
                  )}
                </div>
              </div>
            </section>

            <section className="border-t border-slate-200 pt-8">
              <h2 className="text-2xl font-semibold text-slate-950">When & where</h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">Starts<input type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
                <label className="text-sm font-medium text-slate-700">Ends<input type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
                <label className="text-sm font-medium text-slate-700">Format<select value={format} onChange={(event) => setFormat(event.target.value as typeof format)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5"><option value="in-person">In person</option><option value="virtual">Online</option><option value="hybrid">In person + online</option></select></label>
                <label className="text-sm font-medium text-slate-700">Capacity<input type="number" min="1" value={capacity} onChange={(event) => setCapacity(event.target.value)} placeholder="Unlimited" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
              </div>
              {(format === "in-person" || format === "hybrid") && <label className="mt-4 block text-sm font-medium text-slate-700">Location<input value={location} onChange={(event) => setLocation(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>}
              {(format === "virtual" || format === "hybrid") && <label className="mt-4 block text-sm font-medium text-slate-700">Online meeting link<input type="url" value={virtualUrl} onChange={(event) => setVirtualUrl(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" placeholder="https://…" /></label>}
              <p className="mt-4 text-sm text-slate-500">Repeats regularly? <Link href="/admin/events/series" className="font-semibold text-sky-800">Create a recurring series</Link>.</p>
            </section>

            <section className="border-t border-slate-200 pt-8">
              <h2 className="text-2xl font-semibold text-slate-950">Registration</h2>
              <div className="mt-5 flex gap-2">
                <button type="button" onClick={() => setPaid(false)} className={`rounded-full px-4 py-2 text-sm font-semibold ${!paid ? "bg-slate-950 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>Free</button>
                <button type="button" onClick={() => setPaid(true)} className={`rounded-full px-4 py-2 text-sm font-semibold ${paid ? "bg-slate-950 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>Paid</button>
              </div>

              {paid && !advancedTickets && (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium text-slate-700">Public price<input inputMode="decimal" value={publicPrice} onChange={(event) => setPublicPrice(event.target.value)} placeholder="25.00" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
                  <label className="text-sm font-medium text-slate-700">Member price <span className="font-normal text-slate-400">(optional)</span><input inputMode="decimal" value={memberPrice} onChange={(event) => setMemberPrice(event.target.value)} placeholder="15.00" className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
                </div>
              )}

              <label className="mt-5 flex items-center gap-3 text-sm text-slate-700">
                <input type="checkbox" checked={advancedTickets} onChange={(event) => { setAdvancedTickets(event.target.checked); if (event.target.checked && ticketTypes.length === 0) addTicket(); }} />
                Use multiple ticket types
              </label>

              {advancedTickets && (
                <div className="mt-5 space-y-4">
                  {ticketTypes.map((ticket, index) => (
                    <div key={ticket.id} className="grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-[1fr_8rem_9rem_auto] sm:items-end">
                      <label className="text-xs font-medium text-slate-600">Name<input value={ticket.name} onChange={(event) => updateTicket(index, { name: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
                      <label className="text-xs font-medium text-slate-600">Price<input inputMode="decimal" value={(ticket.priceCents / 100).toString()} onChange={(event) => updateTicket(index, { priceCents: cents(event.target.value) })} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" /></label>
                      <label className="text-xs font-medium text-slate-600">Audience<select value={ticket.targetAudience || "public"} onChange={(event) => updateTicket(index, { targetAudience: event.target.value as EventTicketType["targetAudience"] })} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"><option value="public">Public</option><option value="member">Members</option><option value="vip">Staff/VIP</option></select></label>
                      <button type="button" onClick={() => setTicketTypes((current) => current.filter((_, ticketIndex) => ticketIndex !== index))} className="rounded-xl bg-white p-2.5 text-rose-600 ring-1 ring-slate-200"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={addTicket} className="inline-flex items-center gap-2 text-sm font-semibold text-sky-800"><Plus className="h-4 w-4" /> Add ticket type</button>
                </div>
              )}

              <label className="mt-6 block max-w-xs text-sm font-medium text-slate-700">Full-refund cutoff (hours before event)<input type="number" min="0" value={refundCutoff} onChange={(event) => setRefundCutoff(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>
            </section>

            <section className="border-t border-slate-200 pt-8">
              <h2 className="text-2xl font-semibold text-slate-950">Communication</h2>
              <div className="mt-5 space-y-3 text-sm text-slate-700">
                <label className="flex items-center gap-3"><input type="checkbox" checked={confirmation} onChange={(event) => setConfirmation(event.target.checked)} /> Send registration confirmation</label>
                <label className="flex items-center gap-3"><input type="checkbox" checked={reminder24h} onChange={(event) => setReminder24h(event.target.checked)} /> Reminder 24 hours before</label>
                <label className="flex items-center gap-3"><input type="checkbox" checked={reminder1h} onChange={(event) => setReminder1h(event.target.checked)} /> Reminder 1 hour before</label>
                <label className="flex items-center gap-3"><input type="checkbox" checked={followUp} onChange={(event) => setFollowUp(event.target.checked)} /> Follow-up after the event</label>
              </div>
            </section>

            {message && <p className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-700">{message}</p>}
          </form>

          <aside>
            <div className="sticky top-24 rounded-3xl bg-slate-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Publish</p>
              <p className="mt-3 text-sm leading-6 text-slate-600">Save a draft while you work, or publish when the public event page is ready.</p>
              <button type="button" onClick={() => void save(false)} disabled={!valid || saving} className="mt-5 w-full rounded-full bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 disabled:opacity-50">{saving ? "Saving…" : "Save draft"}</button>
              {existingStatus !== "published" && <button type="button" onClick={() => void save(true)} disabled={!valid || saving} className="mt-2 w-full rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Save & publish</button>}
              {existingStatus === "published" && <button type="button" onClick={() => void save(false)} disabled={!valid || saving} className="mt-2 w-full rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Save changes</button>}
              {savedSlug && <Link href={`/events/detail?event=${encodeURIComponent(savedSlug)}`} className="mt-4 block text-center text-sm font-semibold text-sky-800">View public event →</Link>}
            </div>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}

export default function AdminEventEditorPage() {
  return (
    <RequireAuth requiredRole="admin">
      <Suspense fallback={<AppShell><div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div></AppShell>}>
        <EventEditorContent />
      </Suspense>
    </RequireAuth>
  );
}
