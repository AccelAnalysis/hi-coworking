"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { callableErrorMessage } from "@/lib/callableError";
import { functions } from "@/lib/firebase";

type SmsConsent = {
  optIn: boolean;
  phone: string | null;
  source: string | null;
  textVersion: string | null;
  consentedAt: number | null;
  optedOutAt: number | null;
  optOutReason: string | null;
  updatedAt: number | null;
};

type HistoryRow = Record<string, string | number | boolean | null>;

type AuditEntry = {
  id: string;
  source: "member-operation" | "payment" | "credit" | "role";
  action: string;
  actorUid: string | null;
  actorName: string | null;
  createdAt: number;
  summary: Record<string, string | number | boolean>;
};

type MemberRecord = {
  member: {
    uid: string;
    displayName: string | null;
    email: string | null;
    phone: string | null;
    role: string | null;
    plan: string | null;
    membershipStatus: string | null;
    expiresAt: number | null;
    createdAt: number | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    membershipCancellationPending: boolean;
    accountCreditCents: number;
  };
  consent: {
    sms: SmsConsent | null;
    smsHistory: HistoryRow[];
    terms: { version: string | null; source: string | null; acceptedAt: number | null } | null;
    termsHistory: HistoryRow[];
    email: {
      marketingOptOut: boolean;
      doNotContact: boolean;
      suppressed: boolean;
      suppressionReason: string | null;
      suppressedAt: number | null;
    };
  };
  audit: AuditEntry[];
};

const getMemberRecord = httpsCallable<{ uid: string }, MemberRecord>(functions, "admin_memberRecordGet");

const SOURCE_LABELS: Record<AuditEntry["source"], string> = {
  "member-operation": "Membership & bookings",
  payment: "Payments",
  credit: "Account credit",
  role: "Role",
};

const SUMMARY_LABELS: Record<string, string> = {
  plan: "Plan",
  fromPlan: "From plan",
  toPlan: "To plan",
  fromStatus: "From",
  toStatus: "To",
  reason: "Reason",
  deltaCents: "Change",
  totalCents: "Total",
  creditCents: "Balance after",
  bookingId: "Booking",
  paymentId: "Payment",
  stripeSubscriptionId: "Subscription",
  effectiveAt: "Effective",
};

function formatDateTime(timestamp?: number | null) {
  if (!timestamp) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function words(value?: string | null) {
  if (!value) return "Not set";
  return value.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

function summaryValue(key: string, value: string | number | boolean) {
  if (typeof value === "number" && key.endsWith("Cents")) return key === "deltaCents" && value > 0 ? `+${money(value)}` : money(value);
  if (typeof value === "number" && key.endsWith("At")) return formatDateTime(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return words(String(value));
}

export default function MemberRecordPage() {
  return (
    <RequireAuth requiredRole="admin">
      <MemberRecordContent />
    </RequireAuth>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-900">{children}</dd>
    </div>
  );
}

function Pill({ tone, children }: { tone: "good" | "warn" | "neutral"; children: ReactNode }) {
  const classes =
    tone === "good" ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
    : tone === "warn" ? "bg-amber-50 text-amber-900 ring-amber-200"
    : "bg-slate-100 text-slate-700 ring-slate-200";
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${classes}`}>{children}</span>;
}

function MemberRecordContent() {
  const [uid, setUid] = useState<string | null>(null);
  const [record, setRecord] = useState<MemberRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<"all" | AuditEntry["source"]>("all");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("uid");
    setUid(requested && requested.trim() ? requested.trim() : null);
    if (!requested) setLoading(false);
  }, []);

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getMemberRecord({ uid });
      setRecord(result.data);
    } catch (err) {
      setRecord(null);
      setError(callableErrorMessage(err, "Could not load this member record."));
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);

  const auditRows = useMemo(
    () => (record?.audit ?? []).filter((row) => sourceFilter === "all" || row.source === sourceFilter),
    [record, sourceFilter],
  );

  const member = record?.member;
  const consent = record?.consent;
  const title = member?.displayName || member?.email || "Member record";

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">

        <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Member record</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
            {member && <p className="mt-2 text-sm text-slate-600">{words(member.plan)} · {words(member.membershipStatus)}</p>}
          </div>
          {uid && (
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/admin/members/actions?uid=${encodeURIComponent(uid)}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <WalletCards className="h-4 w-4" aria-hidden="true" /> Member actions
              </Link>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" /> Refresh
              </button>
            </div>
          )}
        </div>

        {!uid && !loading && (
          <p role="alert" className="mt-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
            No member selected. Open a member from the <Link href="/admin/members" className="font-semibold underline">members list</Link>.
          </p>
        )}

        {error && (
          <div role="alert" className="mt-6 flex items-start gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-800 ring-1 ring-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-24" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-slate-500" aria-hidden="true" />
            <span className="sr-only">Loading member record</span>
          </div>
        )}

        {!loading && member && consent && (
          <div className="mt-8 grid gap-10">
            <section aria-labelledby="account-heading">
              <h2 id="account-heading" className="text-xl font-semibold text-slate-950">Account</h2>
              <dl className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Email">{member.email || "Not set"}</Field>
                <Field label="Phone">{member.phone || "Not set"}</Field>
                <Field label="Role">{words(member.role)}</Field>
                <Field label="Plan">{words(member.plan)}</Field>
                <Field label="Status">
                  {words(member.membershipStatus)}
                  {member.membershipCancellationPending ? " (cancels at period end)" : ""}
                </Field>
                <Field label="Paid through">{formatDateTime(member.expiresAt)}</Field>
                <Field label="Member since">{formatDateTime(member.createdAt)}</Field>
                <Field label="Account credit">{money(member.accountCreditCents)}</Field>
                <Field label="Member ID"><code className="text-xs">{member.uid}</code></Field>
                <Field label="Stripe customer">{member.stripeCustomerId ? <code className="text-xs">{member.stripeCustomerId}</code> : "None"}</Field>
                <Field label="Stripe subscription">{member.stripeSubscriptionId ? <code className="text-xs">{member.stripeSubscriptionId}</code> : "None"}</Field>
              </dl>
            </section>

            <section aria-labelledby="consent-heading">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="consent-heading" className="text-xl font-semibold text-slate-950">Consent</h2>
                <Link href="/admin/members/consent" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-sky-800 hover:underline">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" /> All consent and suppressions
                </Link>
              </div>
              <div className="mt-4 grid gap-6 lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-base font-semibold text-slate-950">Text messages</h3>
                  <div className="mt-2">
                    {consent.sms ? (
                      consent.sms.optIn ? <Pill tone="good">Opted in</Pill> : <Pill tone="warn">Opted out</Pill>
                    ) : (
                      <Pill tone="neutral">No choice recorded</Pill>
                    )}
                  </div>
                  {consent.sms && (
                    <dl className="mt-4 grid gap-3">
                      <Field label="Consented number">{consent.sms.phone || "Not recorded"}</Field>
                      <Field label="Source">{words(consent.sms.source)}</Field>
                      <Field label="Wording version">{consent.sms.textVersion || "Not recorded"}</Field>
                      <Field label="Opted in">{formatDateTime(consent.sms.consentedAt)}</Field>
                      {!consent.sms.optIn && <Field label="Opted out">{formatDateTime(consent.sms.optedOutAt)}</Field>}
                      {!consent.sms.optIn && <Field label="Opt-out reason">{words(consent.sms.optOutReason)}</Field>}
                    </dl>
                  )}
                  {consent.smsHistory.length > 0 && (
                    <details className="mt-4 text-sm">
                      <summary className="min-h-11 cursor-pointer py-2 font-semibold text-slate-700">History ({consent.smsHistory.length})</summary>
                      <ul className="mt-2 grid gap-1 text-slate-700">
                        {consent.smsHistory.map((row, i) => (
                          <li key={i}>{row.optIn ? "Opted in" : "Opted out"} · {words(String(row.source || ""))} · {formatDateTime(Number(row.at) || null)}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-base font-semibold text-slate-950">Terms of service</h3>
                  <div className="mt-2">
                    {consent.terms?.acceptedAt ? <Pill tone="good">Accepted</Pill> : <Pill tone="warn">Not accepted</Pill>}
                  </div>
                  {consent.terms && (
                    <dl className="mt-4 grid gap-3">
                      <Field label="Version">{consent.terms.version || "Not recorded"}</Field>
                      <Field label="Source">{words(consent.terms.source)}</Field>
                      <Field label="Accepted">{formatDateTime(consent.terms.acceptedAt)}</Field>
                    </dl>
                  )}
                  {consent.termsHistory.length > 0 && (
                    <details className="mt-4 text-sm">
                      <summary className="min-h-11 cursor-pointer py-2 font-semibold text-slate-700">History ({consent.termsHistory.length})</summary>
                      <ul className="mt-2 grid gap-1 text-slate-700">
                        {consent.termsHistory.map((row, i) => (
                          <li key={i}>{String(row.version || "Unknown version")} · {words(String(row.source || ""))} · {formatDateTime(Number(row.at) || null)}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 p-5">
                  <h3 className="text-base font-semibold text-slate-950">Marketing email</h3>
                  <div className="mt-2">
                    {consent.email.marketingOptOut || consent.email.doNotContact || consent.email.suppressed ? (
                      <Pill tone="warn">Not sent</Pill>
                    ) : (
                      <Pill tone="good">Can be sent</Pill>
                    )}
                  </div>
                  <dl className="mt-4 grid gap-3">
                    <Field label="Unsubscribed">{consent.email.marketingOptOut ? "Yes" : "No"}</Field>
                    <Field label="Do not contact">{consent.email.doNotContact ? "Yes" : "No"}</Field>
                    <Field label="Suppression list">
                      {consent.email.suppressed ? `${words(consent.email.suppressionReason)}, ${formatDateTime(consent.email.suppressedAt)}` : "Not listed"}
                    </Field>
                  </dl>
                  <p className="mt-4 text-xs leading-5 text-slate-600">Account and booking email is always sent.</p>
                </div>
              </div>
            </section>

            <section aria-labelledby="audit-heading">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 id="audit-heading" className="text-xl font-semibold text-slate-950">Admin audit trail</h2>
                <label className="grid gap-1 text-sm font-semibold text-slate-700">
                  Show
                  <select
                    value={sourceFilter}
                    onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}
                    className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900"
                  >
                    <option value="all">All changes</option>
                    {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="sr-only" role="status">{auditRows.length} audit entries shown</p>
              {auditRows.length === 0 ? (
                <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-6 text-sm text-slate-600">No admin changes recorded for this filter.</p>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                    <caption className="sr-only">Admin changes to this member, newest first</caption>
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-semibold">When</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Area</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Change</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Details</th>
                        <th scope="col" className="px-4 py-3 font-semibold">By</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {auditRows.map((row) => (
                        <tr key={`${row.source}-${row.id}`}>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-700">{formatDateTime(row.createdAt)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-700">{SOURCE_LABELS[row.source]}</td>
                          <td className="px-4 py-3 font-medium text-slate-900">{words(row.action)}</td>
                          <td className="px-4 py-3 text-slate-700">
                            {Object.keys(row.summary).length === 0
                              ? "—"
                              : Object.entries(row.summary).map(([key, value]) => (
                                  <span key={key} className="mr-3 inline-block">
                                    <span className="text-slate-500">{SUMMARY_LABELS[key] || key}:</span> {summaryValue(key, value)}
                                  </span>
                                ))}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.actorName || (row.actorUid ? "Admin" : "System")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 text-xs text-slate-600">Shows the latest 100 entries across membership, payment, credit and role changes.</p>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
