"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Eye,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  TestTube2,
  TriangleAlert,
  UserPlus,
  X,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  adminMarketingGetConfigurationFn,
  adminMarketingListCampaignsFn,
  adminMarketingPreviewRecipientsFn,
  adminMarketingSaveDraftFn,
  adminMarketingSearchRecipientsFn,
  adminMarketingSendCampaignFn,
  adminMarketingSendTestFn,
  type AdminMarketingCampaign,
  type AdminMarketingConfiguration,
  type MarketingRecipientPreview,
  type MarketingSegment,
} from "@/lib/adminMarketingFunctions";

const SEGMENTS: Array<{ value: MarketingSegment; label: string; description: string }> = [
  {
    value: "all_eligible_members",
    label: "All eligible members",
    description: "Only members with an explicit subscribed marketing status.",
  },
  {
    value: "active_members",
    label: "Active members",
    description: "Explicitly subscribed members with an active membership.",
  },
  {
    value: "founding_members",
    label: "Founding members",
    description: "Explicitly subscribed members associated with a Founding plan.",
  },
  {
    value: "selected_members",
    label: "Selected members",
    description: "Choose individual explicitly subscribed members.",
  },
];

interface RecipientPreviewState {
  eligibleCount: number;
  excludedCount: number;
  excludedByReason: Record<string, number>;
  scannedCount: number;
  capped: boolean;
  sample: MarketingRecipientPreview[];
}

function readableError(error: unknown): string {
  const candidate = error as { code?: string; message?: string };
  if (candidate.code?.includes("permission-denied")) return "This account is not authorized for administrative marketing email.";
  if (candidate.code?.includes("failed-precondition")) return candidate.message || "Microsoft marketing email is not configured or enabled.";
  return candidate.message || "The marketing-email request could not be completed.";
}

function MarketingEmailWorkspace() {
  const [configuration, setConfiguration] = useState<AdminMarketingConfiguration | null>(null);
  const [history, setHistory] = useState<AdminMarketingCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "preview" | "test" | "send" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [campaignId, setCampaignId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [segment, setSegment] = useState<MarketingSegment>("all_eligible_members");
  const [senderAlias, setSenderAlias] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [preview, setPreview] = useState<RecipientPreviewState | null>(null);
  const [selectedRecipients, setSelectedRecipients] = useState<MarketingRecipientPreview[]>([]);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipientResults, setRecipientResults] = useState<MarketingRecipientPreview[]>([]);
  const [searchingRecipients, setSearchingRecipients] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const selectedIds = useMemo(
    () => selectedRecipients.map((recipient) => recipient.uid),
    [selectedRecipients],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [configResult, historyResult] = await Promise.all([
        adminMarketingGetConfigurationFn({}),
        adminMarketingListCampaignsFn({}),
      ]);
      setConfiguration(configResult.data);
      setHistory(historyResult.data.campaigns);
      setSenderAlias((current) => current || configResult.data.defaultSenderAlias);
      setReplyTo((current) => current || configResult.data.approvedReplyTo[0] || "");
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (segment !== "selected_members") {
      setSelectedRecipients([]);
      setRecipientResults([]);
      setRecipientQuery("");
    }
    setPreview(null);
  }, [segment]);

  useEffect(() => {
    if (segment !== "selected_members" || recipientQuery.trim().length < 2) {
      setRecipientResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearchingRecipients(true);
      try {
        const result = await adminMarketingSearchRecipientsFn({ query: recipientQuery.trim() });
        setRecipientResults(result.data.recipients.filter(
          (recipient) => !selectedIds.includes(recipient.uid),
        ));
      } catch {
        setRecipientResults([]);
      } finally {
        setSearchingRecipients(false);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [recipientQuery, segment, selectedIds]);

  const saveDraft = async (): Promise<AdminMarketingCampaign> => {
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const result = await adminMarketingSaveDraftFn({
        campaignId,
        name,
        subject,
        bodyText,
        segment,
        senderAlias,
        replyTo: replyTo || undefined,
        selectedUserIds: selectedIds,
      });
      setCampaignId(result.data.campaign.id);
      setHistory((current) => [
        result.data.campaign,
        ...current.filter((campaign) => campaign.id !== result.data.campaign.id),
      ]);
      setNotice("Draft saved.");
      return result.data.campaign;
    } catch (saveError) {
      setError(readableError(saveError));
      throw saveError;
    } finally {
      setBusy(null);
    }
  };

  const previewRecipients = async () => {
    setBusy("preview");
    setError("");
    setNotice("");
    try {
      const result = await adminMarketingPreviewRecipientsFn({
        segment,
        selectedUserIds: selectedIds,
      });
      setPreview(result.data);
      setNotice(`${result.data.eligibleCount.toLocaleString()} eligible recipient${result.data.eligibleCount === 1 ? "" : "s"}.`);
    } catch (previewError) {
      setError(readableError(previewError));
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    setBusy("test");
    setError("");
    setNotice("");
    try {
      const result = await adminMarketingSendTestFn({
        recipient: testRecipient,
        subject,
        bodyText,
        senderAlias,
        replyTo: replyTo || undefined,
      });
      setNotice(result.data.requiresRecipientVisibleAliasVerification
        ? "Microsoft Graph accepted the test. Verify the displayed From and Reply-To addresses in the recipient mailbox."
        : "Microsoft Graph accepted the test message.");
    } catch (testError) {
      setError(readableError(testError));
    } finally {
      setBusy(null);
    }
  };

  const sendCampaign = async () => {
    if (!preview) {
      setError("Preview the current eligible recipients before sending.");
      return;
    }
    if (!window.confirm(`Send this marketing email to ${preview.eligibleCount.toLocaleString()} eligible recipient${preview.eligibleCount === 1 ? "" : "s"}?`)) return;
    setBusy("send");
    setError("");
    setNotice("");
    try {
      const draft = campaignId ? undefined : await saveDraft();
      const targetCampaignId = campaignId || draft?.id;
      if (!targetCampaignId) throw new Error("Campaign draft could not be resolved.");
      const result = await adminMarketingSendCampaignFn({
        campaignId: targetCampaignId,
        idempotencyKey: crypto.randomUUID(),
        confirmedRecipientCount: preview.eligibleCount,
      });
      setHistory((current) => [
        result.data.campaign,
        ...current.filter((campaign) => campaign.id !== result.data.campaign.id),
      ]);
      setNotice(result.data.idempotent
        ? "This send request was already processed; no duplicate message was sent."
        : `${result.data.campaign.sentRecipientCount.toLocaleString()} message${result.data.campaign.sentRecipientCount === 1 ? "" : "s"} accepted for delivery.`);
    } catch (sendError) {
      setError(readableError(sendError));
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <AppShell><div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div></AppShell>;
  }

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-3xl font-bold text-slate-950"><Mail className="h-7 w-7 text-indigo-600" /> Marketing email</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Admin-only outreach through one centrally managed Microsoft 365 mailbox. Members never connect or authorize a mailbox.</p>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50"><RefreshCw className="h-4 w-4" /> Refresh</button>
        </div>

        {configuration && (
          <section className={`mt-6 rounded-2xl border p-4 ${configuration.enabled ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            <div className="flex items-start gap-3">
              {configuration.enabled ? <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-700" /> : <TriangleAlert className="mt-0.5 h-5 w-5 text-amber-700" />}
              <div className="min-w-0">
                <p className="font-bold text-slate-900">{configuration.enabled ? `Microsoft marketing email enabled in ${configuration.environment} mode` : "Microsoft marketing email is disabled"}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">Member mailbox connections: disabled · SMS: not implemented · Unsubscribe: {configuration.unsubscribeConfigured ? "configured" : "required before campaign sending"}</p>
              </div>
            </div>
          </section>
        )}

        {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700" role="alert">{error}</div>}
        {notice && <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800" role="status">{notice}</div>}

        <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold text-slate-950">Campaign</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-bold text-slate-700">Campaign name</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" placeholder="Founding Membership announcement" /></label>
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-700">Sender alias</span><select value={senderAlias} onChange={(event) => setSenderAlias(event.target.value)} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">{configuration?.senderAliases.map((alias) => <option key={alias} value={alias}>{alias}</option>)}</select></label>
              <label className="block"><span className="mb-1.5 block text-xs font-bold text-slate-700">Reply-To</span><select value={replyTo} onChange={(event) => setReplyTo(event.target.value)} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">Use mailbox default</option>{configuration?.approvedReplyTo.map((address) => <option key={address} value={address}>{address}</option>)}</select></label>
              <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-bold text-slate-700">Subject</span><input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} className="h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" /></label>
              <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-bold text-slate-700">Message</span><textarea value={bodyText} onChange={(event) => setBodyText(event.target.value)} maxLength={20000} className="min-h-64 w-full rounded-xl border border-slate-300 p-3 text-sm leading-6 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" placeholder="Write the marketing message in plain text. The server creates safe HTML and appends the unsubscribe link." /></label>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" disabled={busy !== null} onClick={() => void saveDraft()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 disabled:opacity-50">{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save draft</button>
              <button type="button" onClick={() => setShowPreview((current) => !current)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700"><Eye className="h-4 w-4" /> Preview</button>
            </div>
            {showPreview && <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-5"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{subject || "Untitled message"}</p><div className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-800">{bodyText || "Your message preview will appear here."}</div><p className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-500">The live campaign adds a secure unsubscribe link. Test messages do not alter marketing preferences.</p></div>}
          </section>

          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-950">Recipients</h2>
              <label className="mt-3 block"><span className="mb-1.5 block text-xs font-bold text-slate-700">Approved segment</span><select value={segment} onChange={(event) => setSegment(event.target.value as MarketingSegment)} className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm">{SEGMENTS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <p className="mt-2 text-xs leading-5 text-slate-500">{SEGMENTS.find((option) => option.value === segment)?.description}</p>
              {segment === "selected_members" && <div className="mt-4"><label className="flex h-11 items-center rounded-xl border border-slate-300 px-3"><Search className="mr-2 h-4 w-4 text-slate-400" /><input value={recipientQuery} onChange={(event) => setRecipientQuery(event.target.value)} className="min-w-0 flex-1 text-sm outline-none" placeholder="Search subscribed members" />{searchingRecipients && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}</label>{recipientResults.length > 0 && <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1">{recipientResults.map((recipient) => <button key={recipient.uid} type="button" onClick={() => { setSelectedRecipients((current) => [...current, recipient]); setRecipientQuery(""); setRecipientResults([]); setPreview(null); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50"><UserPlus className="h-4 w-4 text-slate-400" /><span className="min-w-0"><strong className="block truncate">{recipient.displayName}</strong><span className="block truncate text-slate-500">{recipient.email}</span></span></button>)}</div>}<div className="mt-2 space-y-1">{selectedRecipients.map((recipient) => <div key={recipient.uid} className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 text-xs"><span className="min-w-0 truncate">{recipient.displayName} · {recipient.email}</span><button type="button" onClick={() => { setSelectedRecipients((current) => current.filter((item) => item.uid !== recipient.uid)); setPreview(null); }} aria-label={`Remove ${recipient.displayName}`}><X className="h-4 w-4" /></button></div>)}</div></div>}
              <button type="button" disabled={busy !== null} onClick={() => void previewRecipients()} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50">{busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Preview eligibility</button>
              {preview && <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-700"><p className="font-bold">{preview.eligibleCount.toLocaleString()} eligible</p><p className="mt-1">{preview.excludedCount.toLocaleString()} excluded after consent, suppression, role, segment, and environment checks.</p>{Object.keys(preview.excludedByReason).length > 0 && <div className="mt-2 space-y-1 text-slate-500">{Object.entries(preview.excludedByReason).map(([reason, count]) => <p key={reason}>{reason.replaceAll("_", " ")}: {count}</p>)}</div>}</div>}
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-950"><TestTube2 className="h-4 w-4" /> Controlled test</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">The recipient must be in the server-controlled development allowlist.</p>
              <input type="email" value={testRecipient} onChange={(event) => setTestRecipient(event.target.value)} className="mt-3 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" placeholder="approved-test@example.com" />
              <button type="button" disabled={busy !== null} onClick={() => void sendTest()} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-bold text-indigo-800 disabled:opacity-50">{busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />} Send test</button>
            </section>

            <button type="button" disabled={busy !== null || !configuration?.enabled} onClick={() => void sendCampaign()} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">{busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Confirm and send</button>
          </div>
        </div>

        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-slate-950">Campaign history</h2>
          <div className="mt-4 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><th className="px-3 py-2">Campaign</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Sender</th><th className="px-3 py-2 text-right">Recipients</th><th className="px-3 py-2">Updated</th></tr></thead><tbody>{history.map((campaign) => <tr key={campaign.id} className="border-b border-slate-100 last:border-0"><td className="px-3 py-3"><strong className="block text-slate-900">{campaign.name}</strong><span className="text-xs text-slate-500">{campaign.subject}</span></td><td className="px-3 py-3 font-semibold text-slate-700">{campaign.status.replaceAll("_", " ")}</td><td className="px-3 py-3 text-slate-600">{campaign.senderAlias}</td><td className="px-3 py-3 text-right text-slate-600">{campaign.sentRecipientCount.toLocaleString()}</td><td className="px-3 py-3 text-slate-500">{new Date(campaign.updatedAt).toLocaleString()}</td></tr>)}{history.length === 0 && <tr><td colSpan={5} className="px-3 py-10 text-center text-slate-500">No administrative marketing campaigns yet.</td></tr>}</tbody></table></div>
        </section>
      </main>
    </AppShell>
  );
}

export default function AdminMarketingEmailPage() {
  return <RequireAuth requiredCapability="adminMarketingEmail"><MarketingEmailWorkspace /></RequireAuth>;
}
