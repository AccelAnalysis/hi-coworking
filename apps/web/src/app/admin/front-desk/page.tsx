"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, Loader2, MonitorSmartphone, RefreshCw, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { ConfirmSheet } from "@/components/admin/ConfirmSheet";
import { ADMIN_CAPABILITIES } from "@/lib/adminCapabilities";
import { callableErrorMessage } from "@/lib/callableError";
import {
  adminKioskCloseVisit,
  adminKioskDeviceSet,
  adminKioskOverview,
  adminKioskResolveAlert,
  adminKioskSetSettings,
  formatClock,
  formatDayTime,
  formatMinutes,
  formatWindow,
  fromEasternInputValue,
  toEasternInputValue,
  type KioskOverview,
  type VisitSummary,
} from "@/lib/frontDeskKiosk";

export default function FrontDeskAdminPage() {
  return (
    <RequireAuth requiredRole="staff">
      <FrontDeskAdminContent />
    </RequireAuth>
  );
}

const STATUS_LABEL: Record<string, string> = {
  open: "Checked in",
  closed: "Checked out",
  auto_closed: "Auto-closed at closing",
  staff_closed: "Closed by staff",
};

const FLAG_LABEL: Record<string, string> = {
  late: "Late",
  no_show: "No-show",
  arrived_late: "Arrived late",
};

const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50";
const primary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const input = "min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-900";

function FrontDeskAdminContent() {
  const [overview, setOverview] = useState<KioskOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [closing, setClosing] = useState<VisitSummary | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminKioskOverview({});
      setOverview(result.data);
    } catch (caught) {
      console.error(caught);
      setError(callableErrorMessage(caught, "Front-desk visits could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function run(key: string, action: () => Promise<unknown>, done: string, fallback: string) {
    setSaving(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      await load();
    } catch (caught) {
      console.error(caught);
      setError(callableErrorMessage(caught, fallback));
    } finally {
      setSaving(null);
    }
  }

  const live = ADMIN_CAPABILITIES.frontDesk.live;

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Front desk</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Check-ins and visits</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Members check in and out on the front-desk iPad. Extra time is recorded at the member&apos;s plan rate for review; nothing here charges a card.
            </p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className={button}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </header>

        {!live ? (
          <div className="mt-6 flex items-start gap-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900" role="note">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> <p>{ADMIN_CAPABILITIES.frontDesk.note}</p>
          </div>
        ) : null}
        {error ? <div className="mt-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</div> : null}
        {notice ? <div className="mt-6 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">{notice}</div> : null}

        {loading && !overview ? (
          <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>
        ) : overview ? (
          <>
            <section className="mt-8 grid gap-px overflow-hidden rounded-3xl bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Checked in now" value={overview.openVisits.length} />
              <Metric label="Needs review" value={overview.needsReview.length} attention={overview.needsReview.length > 0} />
              <Metric label="Hours alerts" value={overview.alerts.length} attention={overview.alerts.length > 0} />
              <Metric label="Late or no-show today" value={overview.flags.filter((f) => f.status !== "arrived_late").length} />
            </section>

            <Section title="Hours alerts" icon={AlertCircle} empty={overview.alerts.length === 0 ? "No open alerts." : null}
              hint="Staff only. The member saw a normal check-in.">
              {overview.alerts.map((alert) => (
                <Row key={alert.alertId}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-950">{alert.memberLabel}</p>
                    <p className="text-sm text-slate-600">{alert.label} · {formatDayTime(alert.createdAt)}</p>
                  </div>
                  <button type="button" className={button} disabled={saving === alert.alertId}
                    onClick={() => void run(alert.alertId, () => adminKioskResolveAlert({ alertId: alert.alertId }), "Alert resolved.", "The alert could not be resolved.")}>
                    {saving === alert.alertId ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Resolve
                  </button>
                </Row>
              ))}
            </Section>

            <Section title="Needs review" icon={TriangleAlert} empty={overview.needsReview.length === 0 ? "Nothing to review." : null}
              hint="Visits auto-closed at closing time because nobody checked out. No extra time is assumed until staff set the real check-out time.">
              {overview.needsReview.map((visit) => <VisitRow key={visit.visitId} visit={visit} onClose={() => setClosing(visit)} />)}
            </Section>

            <Section title="Checked in now" icon={Clock3} empty={overview.openVisits.length === 0 ? "Nobody is checked in." : null}>
              {overview.openVisits.map((visit) => <VisitRow key={visit.visitId} visit={visit} onClose={() => setClosing(visit)} />)}
            </Section>

            <Section title="Late and no-show today" icon={Clock3} empty={overview.flags.length === 0 ? "No flags today." : null}
              hint="Flags only. Nothing is cancelled or charged.">
              {overview.flags.map((flag) => (
                <Row key={flag.bookingId}>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-950">{flag.memberLabel}</p>
                    <p className="text-sm text-slate-600">Booking {formatWindow({ start: flag.start, end: flag.end })}</p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{FLAG_LABEL[flag.status] || flag.status}</span>
                </Row>
              ))}
            </Section>

            <Section title="Today's visits" icon={Clock3} empty={overview.todayVisits.length === 0 ? "No visits yet today." : null}>
              {overview.todayVisits.map((visit) => <VisitRow key={visit.visitId} visit={visit} />)}
            </Section>

            {overview.devices ? (
              <AdminTools overview={overview} saving={saving} run={run} />
            ) : null}
          </>
        ) : null}

        <CloseVisitSheet visit={closing} onClose={() => setClosing(null)}
          onSubmit={async (checkOutAt, reason) => {
            if (!closing) return;
            const visitId = closing.visitId;
            setClosing(null);
            await run(visitId, () => adminKioskCloseVisit({ visitId, checkOutAt, reason }), "Visit closed and logged.", "The visit could not be closed.");
          }} />
      </main>
    </AppShell>
  );
}

function VisitRow({ visit, onClose }: { visit: VisitSummary; onClose?: () => void }) {
  const allowance = visit.allowanceSource === "booking"
    ? `Booked ${formatWindow(visit.bookedWindow) || ""}`
    : visit.allowanceSource === "monthly"
      ? `${formatMinutes(visit.allowanceMinutes)} included left`
      : "No booking or included hours";
  return (
    <Row>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-950">{visit.memberLabel}</p>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-slate-600">{STATUS_LABEL[visit.status] || visit.status}</span>
          {visit.alertReason ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900">Hours alert</span> : null}
        </div>
        <p className="mt-1 text-sm text-slate-600">
          In {formatClock(visit.checkInAt)}
          {visit.checkOutAt ? ` · Out ${formatClock(visit.checkOutAt)}` : ""}
          {visit.actualMinutes != null ? ` · ${formatMinutes(visit.actualMinutes)}` : ""}
          {` · ${allowance}`}
        </p>
        {visit.overageMinutes ? (
          <p className="mt-1 text-sm font-medium text-slate-900">
            Extra time {formatMinutes(visit.overageMinutes)} at {(visit.rateCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}/hr ({visit.rateSource === "plan" ? "plan rate" : "guest rate"}) · not charged
          </p>
        ) : null}
        {visit.closeReason ? <p className="mt-1 text-sm text-slate-600">Reason: {visit.closeReason}</p> : null}
      </div>
      {onClose ? <button type="button" className={button} onClick={onClose}>Close visit</button> : null}
    </Row>
  );
}

function CloseVisitSheet({ visit, onClose, onSubmit }: { visit: VisitSummary | null; onClose: () => void; onSubmit: (checkOutAt: number, reason: string) => Promise<void> }) {
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [lastVisit, setLastVisit] = useState<string | null>(null);

  // Reset the form whenever a different visit is opened.
  if ((visit?.visitId || null) !== lastVisit) {
    setLastVisit(visit?.visitId || null);
    setTime(visit ? toEasternInputValue(visit.checkOutAt || visit.checkInAt) : "");
    setReason("");
    setProblem(null);
  }

  return (
    <ConfirmSheet
      open={Boolean(visit)}
      title={visit ? `Close visit for ${visit.memberLabel}` : "Close visit"}
      confirmLabel="Close visit"
      cancelLabel="Cancel"
      onClose={onClose}
      onConfirm={async () => {
        const checkOutAt = fromEasternInputValue(time);
        if (checkOutAt == null) return setProblem("Enter the check-out time.");
        if (reason.trim().length < 3) return setProblem("Add a reason (at least 3 characters).");
        await onSubmit(checkOutAt, reason.trim());
      }}
    >
      {visit ? (
        <div className="space-y-4 text-left">
          <p className="text-sm text-slate-600">Checked in {formatDayTime(visit.checkInAt)}. Extra time is recalculated from the time you set and logged to the member&apos;s audit history.</p>
          <label className="block space-y-1 text-sm font-medium text-slate-800">
            <span>Check-out time (Eastern)</span>
            <input className={input} type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} required />
          </label>
          <label className="block space-y-1 text-sm font-medium text-slate-800">
            <span>Reason (required)</span>
            <textarea className={`${input} min-h-20 py-2`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} required />
          </label>
          {problem ? <p className="text-sm text-rose-700" role="alert">{problem}</p> : null}
        </div>
      ) : null}
    </ConfirmSheet>
  );
}

function AdminTools({ overview, saving, run }: {
  overview: KioskOverview;
  saving: string | null;
  run: (key: string, action: () => Promise<unknown>, done: string, fallback: string) => Promise<void>;
}) {
  const [idle, setIdle] = useState(String(overview.settings.idleLogoMinutes));
  const [logo, setLogo] = useState(String(overview.settings.logoSeconds));
  const [uid, setUid] = useState("");
  const [label, setLabel] = useState("Front desk");
  const [revoking, setRevoking] = useState<string | null>(null);

  return (
    <>
      <Section title="Kiosk screen" icon={MonitorSmartphone} hint="How long the kiosk waits on the start screen before showing the logo, and how long the logo stays up.">
        <form className="grid gap-4 py-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void run("settings", () => adminKioskSetSettings({ idleLogoMinutes: Number(idle), logoSeconds: Number(logo) }), "Kiosk screen settings saved.", "Settings could not be saved.");
          }}>
          <label className="block space-y-1 text-sm font-medium text-slate-800">
            <span>Show logo after (minutes idle)</span>
            <input className={input} type="number" min={1} max={120} value={idle} onChange={(e) => setIdle(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm font-medium text-slate-800">
            <span>Logo shows for (seconds)</span>
            <input className={input} type="number" min={3} max={15} value={logo} onChange={(e) => setLogo(e.target.value)} />
          </label>
          <button type="submit" className={primary} disabled={saving === "settings"}>Save</button>
        </form>
      </Section>

      <Section title="Kiosk devices" icon={MonitorSmartphone} empty={overview.devices?.length ? null : "No kiosk devices enrolled."}
        hint="Enroll a dedicated kiosk account (never a staff account) by its user ID. Revoking signs the iPad out.">
        {(overview.devices || []).map((device) => (
          <Row key={device.uid}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-950">{device.label || "Front desk"}</p>
              <p className="text-sm text-slate-600">{device.enabled ? "Enrolled" : "Revoked"} · {device.uid}</p>
            </div>
            {device.enabled ? <button type="button" className={button} onClick={() => setRevoking(device.uid)}>Revoke</button> : null}
          </Row>
        ))}
        <form className="grid gap-4 py-5 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const value = uid.trim();
            if (!value) return;
            void run("enroll", () => adminKioskDeviceSet({ uid: value, action: "enroll", label }), "Kiosk device enrolled. Sign in on the iPad to start.", "The device could not be enrolled.").then(() => setUid(""));
          }}>
          <label className="block space-y-1 text-sm font-medium text-slate-800">
            <span>Kiosk account user ID</span>
            <input className={input} value={uid} onChange={(e) => setUid(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <label className="block space-y-1 text-sm font-medium text-slate-800">
            <span>Label</span>
            <input className={input} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
          </label>
          <button type="submit" className={primary} disabled={saving === "enroll" || !uid.trim()}>Enroll</button>
        </form>
      </Section>

      <ConfirmSheet
        open={Boolean(revoking)}
        title="Revoke this kiosk device?"
        confirmLabel="Revoke device"
        cancelLabel="Keep enrolled"
        destructive
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          const target = revoking;
          setRevoking(null);
          if (target) await run(`revoke-${target}`, () => adminKioskDeviceSet({ uid: target, action: "revoke" }), "Kiosk device revoked and signed out.", "The device could not be revoked.");
        }}
      >
        <p className="text-sm text-slate-600">The iPad will be signed out and can&apos;t check anyone in until it is enrolled again.</p>
      </ConfirmSheet>
    </>
  );
}

function Section({ title, icon: Icon, hint, empty, children }: { title: string; icon: typeof Clock3; hint?: string; empty?: string | null; children?: React.ReactNode }) {
  return (
    <section className="mt-10">
      <div className="flex items-center gap-2"><Icon className="h-5 w-5 text-slate-500" /><h2 className="text-xl font-semibold text-slate-950">{title}</h2></div>
      {hint ? <p className="mt-1 text-sm text-slate-600">{hint}</p> : null}
      <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
        {empty ? <p className="py-5 text-sm text-slate-500">{empty}</p> : null}
        {children}
      </div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center">{children}</div>;
}

function Metric({ label, value, attention = false }: { label: string; value: number; attention?: boolean }) {
  return <div className="bg-white p-4"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p><p className={`mt-2 text-2xl font-semibold ${attention ? "text-rose-700" : "text-slate-950"}`}>{value.toLocaleString()}</p></div>;
}
