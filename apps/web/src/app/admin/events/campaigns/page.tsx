"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { getCampaignJobs, getEventCampaigns, saveEventCampaign } from "@/lib/firestore";
import { enqueueCampaignJobsFn } from "@/lib/functions";
import { Megaphone, Loader2, Plus } from "lucide-react";
import { ADMIN_CAPABILITIES } from "@/lib/adminCapabilities";
import { callableErrorMessage } from "@/lib/callableError";
import type { CampaignJobDoc, EventCampaignDoc } from "@hi/shared";

export default function AdminEventCampaignsPage() {
  const [campaigns, setCampaigns] = useState<EventCampaignDoc[]>([]);
  const [jobs, setJobs] = useState<CampaignJobDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [eventId, setEventId] = useState("");
  const [channelsCsv, setChannelsCsv] = useState("email,sms,push");
  const [announceAt, setAnnounceAt] = useState("");
  const [remindersCsv, setRemindersCsv] = useState("168,24,1");
  const [followUpAt, setFollowUpAt] = useState("");

  const selectedCampaign = useMemo(
    () => campaigns.find((c) => c.id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
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
      } catch (caught) {
        console.error(caught);
        setPageError("Campaigns couldn't be loaded. Refresh the page to try again.");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const refreshJobs = async (campaignId: string) => {
    try {
      setJobs(await getCampaignJobs(campaignId));
    } catch (caught) {
      console.error(caught);
      setJobs([]);
      setPageError("This campaign's jobs couldn't be loaded. Try selecting it again.");
    }
  };

  const createCampaign = async () => {
    setSaving(true);
    setPageError(null);
    try {
      const now = Date.now();
      const id = `ec_${now}_${Math.random().toString(36).slice(2, 7)}`;
      const reminderOffsetsHours = remindersCsv
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isFinite(v) && v >= 0);

      const channels = channelsCsv
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean) as EventCampaignDoc["channels"];

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
      const next = [campaign, ...campaigns];
      setCampaigns(next);
      setSelectedCampaignId(campaign.id);
      setJobs([]);
    } catch (caught) {
      console.error(caught);
      setPageError("The campaign couldn't be saved. Check the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  const enqueueJobs = async () => {
    if (!selectedCampaign || !ADMIN_CAPABILITIES.eventCampaigns.live) return;
    setSaving(true);
    setPageError(null);
    try {
      await enqueueCampaignJobsFn({ campaignId: selectedCampaign.id });
      await refreshJobs(selectedCampaign.id);
    } catch (caught) {
      console.error(caught);
      setPageError(callableErrorMessage(caught, "The campaign couldn't be queued."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <RequireAuth requiredRole="admin">
      <AppShell>
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-slate-400" /> Event Campaigns
          </h1>
          {!ADMIN_CAPABILITIES.eventCampaigns.live ? (
            <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
              {ADMIN_CAPABILITIES.eventCampaigns.note}
            </p>
          ) : null}
          {pageError ? <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-800" role="alert">{pageError}</p> : null}

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Create Campaign</h2>
              <input
                type="text"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                placeholder="Event ID (optional)"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={channelsCsv}
                onChange={(e) => setChannelsCsv(e.target.value)}
                placeholder="Channels: email,sms,push"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  type="datetime-local"
                  value={announceAt}
                  onChange={(e) => setAnnounceAt(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <input
                  type="datetime-local"
                  value={followUpAt}
                  onChange={(e) => setFollowUpAt(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <input
                type="text"
                value={remindersCsv}
                onChange={(e) => setRemindersCsv(e.target.value)}
                placeholder="Reminder offsets (hours): 168,24,1"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={createCampaign}
                disabled={saving}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Save Campaign
              </button>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Campaign Queue</h2>
              {loading ? (
                <div className="text-sm text-slate-500">Loading campaigns...</div>
              ) : (
                <>
                  <select
                    value={selectedCampaignId}
                    onChange={async (e) => {
                      const id = e.target.value;
                      setSelectedCampaignId(id);
                      setPageError(null);
                      if (id) {
                        await refreshJobs(id);
                      } else {
                        setJobs([]);
                      }
                    }}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="">Select campaign</option>
                    {campaigns.map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>
                        {campaign.id} ({campaign.status})
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={enqueueJobs}
                    disabled={!selectedCampaignId || saving || !ADMIN_CAPABILITIES.eventCampaigns.live}
                    className="min-h-11 px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 disabled:opacity-50"
                  >
                    Enqueue Jobs
                  </button>

                  <div className="space-y-2">
                    {jobs.map((job) => (
                      <div key={job.id} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700">
                        <div className="font-medium">{job.type}</div>
                        <div>Status: {job.status}</div>
                        <div>Scheduled: {new Date(job.scheduledFor).toLocaleString()}</div>
                      </div>
                    ))}
                    {!jobs.length && <div className="text-xs text-slate-500">No jobs yet for selected campaign.</div>}
                  </div>
                </>
              )}
            </section>
          </div>
        </div>
      </AppShell>
    </RequireAuth>
  );
}
