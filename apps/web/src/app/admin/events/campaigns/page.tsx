"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { getCampaignJobs, getEventCampaigns, saveEventCampaign } from "@/lib/firestore";
import { enqueueCampaignJobsFn } from "@/lib/functions";
import { Bell, Loader2, Mail, Megaphone, Plus } from "lucide-react";
import type { CampaignJobDoc, EventCampaignDoc } from "@hi/shared";

const EVENT_CHANNELS = [
  { value: "push", label: "Push notification" },
  { value: "in_app", label: "In-app notification" },
] as const;

type EventNotificationChannel = (typeof EVENT_CHANNELS)[number]["value"];

export default function AdminEventCampaignsPage() {
  const [campaigns, setCampaigns] = useState<EventCampaignDoc[]>([]);
  const [jobs, setJobs] = useState<CampaignJobDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [eventId, setEventId] = useState("");
  const [channels, setChannels] = useState<EventNotificationChannel[]>(["push", "in_app"]);
  const [announceAt, setAnnounceAt] = useState("");
  const [remindersCsv, setRemindersCsv] = useState("168,24,1");
  const [followUpAt, setFollowUpAt] = useState("");

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId],
  );

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const rows = await getEventCampaigns();
        setCampaigns(rows);
        if (rows.length) {
          const id = rows[0].id;
          setSelectedCampaignId(id);
          setJobs(await getCampaignJobs(id));
        }
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const refreshJobs = async (campaignId: string) => {
    setJobs(await getCampaignJobs(campaignId));
  };

  const createCampaign = async () => {
    if (!channels.length) {
      setError("Select at least one supported event-notification channel.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const now = Date.now();
      const id = `ec_${now}_${Math.random().toString(36).slice(2, 7)}`;
      const reminderOffsetsHours = remindersCsv
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value >= 0);
      const campaign: EventCampaignDoc = {
        id,
        eventId: eventId.trim() || undefined,
        status: "draft",
        channels,
        schedule: {
          announceAt: announceAt ? new Date(announceAt).getTime() : undefined,
          reminderOffsetsHours,
          followUpAt: followUpAt ? new Date(followUpAt).getTime() : undefined,
        },
        copyVariants: {},
        stats: {
          impressions: 0,
          clicks: 0,
          registrations: 0,
          conversionRate: 0,
        },
        createdBy: "admin",
        createdAt: now,
        updatedAt: now,
      };
      await saveEventCampaign(campaign);
      setCampaigns((current) => [campaign, ...current]);
      setSelectedCampaignId(campaign.id);
      setJobs([]);
    } catch {
      setError("The event-notification campaign could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const enqueueJobs = async () => {
    if (!selectedCampaign) return;
    setSaving(true);
    setError("");
    try {
      await enqueueCampaignJobsFn({ campaignId: selectedCampaign.id });
      await refreshJobs(selectedCampaign.id);
    } catch {
      setError("The campaign could not be queued. Legacy email or SMS channels must be removed from older campaign records before they can run.");
    } finally {
      setSaving(false);
    }
  };

  const toggleChannel = (channel: EventNotificationChannel) => {
    setChannels((current) => current.includes(channel)
      ? current.filter((candidate) => candidate !== channel)
      : [...current, channel]);
  };

  return (
    <RequireAuth requiredRole="admin">
      <AppShell>
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900"><Megaphone className="h-6 w-6 text-slate-400" /> Event notifications</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Schedule push and in-app event reminders. Email and SMS are not delivered from this workflow.</p>
            </div>
            <Link href="/admin/marketing/email" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-bold text-indigo-800 hover:bg-indigo-100"><Mail className="h-4 w-4" /> Admin marketing email</Link>
          </div>

          <section className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <div className="flex items-start gap-3"><Bell className="mt-0.5 h-5 w-5 shrink-0" /><p>Microsoft marketing email is a separate, capability-protected admin module. Ordinary members, organization owners, and review administrators do not gain access from this event-notification page.</p></div>
          </section>

          {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700" role="alert">{error}</div>}

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">Create event-notification campaign</h2>
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-700">Event ID</span><input type="text" value={eventId} onChange={(event) => setEventId(event.target.value)} placeholder="Optional event ID" className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label>
              <fieldset><legend className="text-xs font-bold text-slate-700">Supported channels</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{EVENT_CHANNELS.map((option) => <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700"><input type="checkbox" checked={channels.includes(option.value)} onChange={() => toggleChannel(option.value)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />{option.label}</label>)}</div></fieldset>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label><span className="mb-1.5 block text-xs font-bold text-slate-700">Announce at</span><input type="datetime-local" value={announceAt} onChange={(event) => setAnnounceAt(event.target.value)} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label><label><span className="mb-1.5 block text-xs font-bold text-slate-700">Follow up at</span><input type="datetime-local" value={followUpAt} onChange={(event) => setFollowUpAt(event.target.value)} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label></div>
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-700">Reminder offsets in hours</span><input type="text" value={remindersCsv} onChange={(event) => setRemindersCsv(event.target.value)} placeholder="168,24,1" className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label>
              <button type="button" onClick={() => void createCampaign()} disabled={saving} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Save campaign</button>
            </section>

            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-900">Campaign queue</h2>
              {loading ? <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading campaigns…</div> : <><select value={selectedCampaignId} onChange={async (event) => { const id = event.target.value; setSelectedCampaignId(id); setJobs(id ? await getCampaignJobs(id) : []); }} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">Select campaign</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.id} ({campaign.status})</option>)}</select><button type="button" onClick={() => void enqueueJobs()} disabled={!selectedCampaignId || saving} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 disabled:opacity-50">Enqueue supported notifications</button><div className="space-y-2">{jobs.map((job) => <div key={job.id} className="rounded-xl border border-slate-200 px-3 py-3 text-xs text-slate-700"><strong className="block">{job.type}</strong><span>Status: {job.status}</span><span className="block">Scheduled: {new Date(job.scheduledFor).toLocaleString()}</span></div>)}{!jobs.length && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500">No jobs for the selected campaign.</div>}</div></>}
            </section>
          </div>
        </main>
      </AppShell>
    </RequireAuth>
  );
}
