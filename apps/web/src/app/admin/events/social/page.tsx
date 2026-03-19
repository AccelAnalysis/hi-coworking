"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { getEventShareKits, getSocialPosts, saveEventShareKit, saveSocialPost } from "@/lib/firestore";
import { Share2, Loader2, Plus } from "lucide-react";
import type { EventShareKitDoc, SocialPostDoc } from "@hi/shared";

export default function AdminEventSocialPage() {
  const [shareKits, setShareKits] = useState<EventShareKitDoc[]>([]);
  const [posts, setPosts] = useState<SocialPostDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [eventId, setEventId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [caption, setCaption] = useState("");
  const [channel, setChannel] = useState<SocialPostDoc["channel"]>("linkedin");
  const [scheduledFor, setScheduledFor] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [kits, queuedPosts] = await Promise.all([getEventShareKits(), getSocialPosts()]);
      setShareKits(kits);
      setPosts(queuedPosts);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createShareKit = async () => {
    setSaving(true);
    try {
      const now = Date.now();
      const id = `esk_${now}_${Math.random().toString(36).slice(2, 7)}`;
      const doc: EventShareKitDoc = {
        id,
        eventId: eventId.trim() || undefined,
        seriesId: seriesId.trim() || undefined,
        assets: [],
        captions: {},
        status: "generating",
        createdAt: now,
      };
      await saveEventShareKit(doc);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const createSocialPost = async () => {
    if (!caption.trim() || !scheduledFor) return;
    setSaving(true);
    try {
      const now = Date.now();
      const id = `sp_${now}_${Math.random().toString(36).slice(2, 7)}`;
      const doc: SocialPostDoc = {
        id,
        eventId: eventId.trim() || undefined,
        seriesId: seriesId.trim() || undefined,
        channel,
        caption: caption.trim(),
        scheduledFor: new Date(scheduledFor).getTime(),
        status: "scheduled",
        retries: 0,
        createdBy: "admin",
        createdAt: now,
        updatedAt: now,
      };
      await saveSocialPost(doc);
      await load();
      setCaption("");
      setScheduledFor("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <RequireAuth requiredRole="admin">
      <AppShell>
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Share2 className="h-6 w-6 text-slate-400" /> Event Social Distribution
          </h1>

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <h2 className="text-sm font-semibold text-slate-900">Create Share Kit / Social Post</h2>
              <input
                type="text"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                placeholder="Event ID"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={seriesId}
                onChange={(e) => setSeriesId(e.target.value)}
                placeholder="Series ID"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={createShareKit}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Generate Share Kit
                </button>
              </div>

              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Post caption"
                rows={3}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as SocialPostDoc["channel"])}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  <option value="linkedin">LinkedIn</option>
                  <option value="facebook">Facebook</option>
                  <option value="instagram">Instagram</option>
                  <option value="x">X</option>
                </select>
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="button"
                onClick={createSocialPost}
                disabled={saving || !caption.trim() || !scheduledFor}
                className="px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-700 disabled:opacity-50"
              >
                Queue Social Post
              </button>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">Queue Status</h2>
              {loading ? (
                <div className="text-sm text-slate-500">Loading social queue...</div>
              ) : (
                <>
                  <div>
                    <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Share Kits</h3>
                    <div className="space-y-2">
                      {shareKits.map((kit) => (
                        <div key={kit.id} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700">
                          <div className="font-medium">{kit.id}</div>
                          <div>Status: {kit.status}</div>
                          <div>Assets: {kit.assets?.length || 0}</div>
                        </div>
                      ))}
                      {!shareKits.length && <div className="text-xs text-slate-500">No share kits queued.</div>}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">Social Posts</h3>
                    <div className="space-y-2">
                      {posts.map((post) => (
                        <div key={post.id} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700">
                          <div className="font-medium">{post.channel}</div>
                          <div>Status: {post.status}</div>
                          <div>Scheduled: {new Date(post.scheduledFor).toLocaleString()}</div>
                        </div>
                      ))}
                      {!posts.length && <div className="text-xs text-slate-500">No social posts queued.</div>}
                    </div>
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
