"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  DollarSign,
  ExternalLink,
  FileText,
  Filter,
  Loader2,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  getPaymentsLedger,
  type PaymentLedgerFilters,
} from "@/lib/firestore";
import { functions } from "@/lib/firebase";
import type {
  PaymentDoc,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
} from "@hi/shared";

const syncToQBO = httpsCallable<
  { paymentId: string },
  { synced: boolean; salesReceiptId?: string }
>(functions, "admin_syncPaymentToQBO");

const backfillQBO = httpsCallable<
  { limit?: number },
  { synced: number; skipped: number; failed: number }
>(functions, "admin_backfillQBO");

const PAGE_SIZE = 20;

const PROVIDER_LABELS: Record<PaymentProvider, string> = {
  stripe: "Stripe",
  quickbooks_link: "QB Link",
  quickbooks_invoice: "QB Invoice",
  quickbooks_payments: "QB Payments",
};

const PROVIDER_AUTHORITY: Record<PaymentProvider, string> = {
  stripe: "Stripe webhook / verified Stripe transaction",
  quickbooks_link: "QuickBooks payment link",
  quickbooks_invoice: "QuickBooks invoice reconciliation",
  quickbooks_payments: "QuickBooks Payments webhook",
};

const STATUS_CONFIG: Record<
  PaymentStatus,
  { label: string; color: string; bgColor: string; icon: React.ElementType }
> = {
  pending: {
    label: "Pending",
    color: "text-amber-700",
    bgColor: "bg-amber-50 border-amber-200",
    icon: Clock,
  },
  paid: {
    label: "Paid",
    color: "text-emerald-700",
    bgColor: "bg-emerald-50 border-emerald-200",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    color: "text-red-700",
    bgColor: "bg-red-50 border-red-200",
    icon: XCircle,
  },
  refunded: {
    label: "Refunded",
    color: "text-slate-700",
    bgColor: "bg-slate-50 border-slate-200",
    icon: RotateCcw,
  },
};

const PURPOSE_LABELS: Record<PaymentPurpose, string> = {
  membership: "Membership",
  event: "Event",
  rfx: "RFx",
  booking: "Booking",
  referral: "Referral",
  bookstore: "Bookstore",
  other: "Other",
};

function purposeHref(payment: PaymentDoc) {
  switch (payment.purpose) {
    case "membership":
      return `/admin/members/actions?uid=${encodeURIComponent(payment.uid)}`;
    case "booking":
      return `/admin/members`;
    case "event":
      return "/admin/events";
    case "bookstore":
      return "/admin/bookstore/orders";
    default:
      return null;
  }
}

function purposeActionLabel(purpose: PaymentPurpose) {
  switch (purpose) {
    case "membership": return "Manage membership";
    case "booking": return "Open member bookings";
    case "event": return "Manage event";
    case "bookstore": return "Manage order";
    default: return "";
  }
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((Number.isFinite(cents) ? cents : 0) / 100);
}

function formatDate(timestamp: number) {
  if (!Number.isFinite(timestamp)) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export default function AdminPaymentsPageWrapper() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminPaymentsContent />
    </RequireAuth>
  );
}

function AdminPaymentsContent() {
  const [payments, setPayments] = useState<PaymentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<PaymentProvider | "">("");
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | "">("");
  const [purposeFilter, setPurposeFilter] = useState<PaymentPurpose | "">("");
  const [backfillLoading, setBackfillLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buildFilters = useCallback((): PaymentLedgerFilters => {
    const filters: PaymentLedgerFilters = {};
    if (search.trim()) filters.search = search.trim();
    if (providerFilter) filters.provider = providerFilter;
    if (statusFilter) filters.status = statusFilter;
    if (purposeFilter) filters.purpose = purposeFilter;
    return filters;
  }, [search, providerFilter, statusFilter, purposeFilter]);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPaymentsLedger(buildFilters(), PAGE_SIZE);
      setPayments(result.payments);
      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);
    } catch (caught) {
      console.error("Failed to fetch payments:", caught);
      setError("The payment ledger could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }, [buildFilters]);

  useEffect(() => {
    void fetchPayments();
  }, [fetchPayments]);

  async function loadMore() {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const result = await getPaymentsLedger(
        buildFilters(),
        PAGE_SIZE,
        lastDoc,
      );
      setPayments((current) => [...current, ...result.payments]);
      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);
    } catch (caught) {
      console.error("Failed to load more payments:", caught);
      setError("More payment records could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function handleBackfillQBO() {
    setBackfillLoading(true);
    setMessage(null);
    setError(null);
    try {
      const result = await backfillQBO({ limit: 50 });
      setMessage(
        `QuickBooks accounting sync: ${result.data.synced} synced, ${result.data.skipped} already synced, ${result.data.failed} failed.`,
      );
      await fetchPayments();
    } catch (caught) {
      console.error("QBO backfill failed:", caught);
      setError("QuickBooks accounting sync could not be completed.");
    } finally {
      setBackfillLoading(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setProviderFilter("");
    setStatusFilter("");
    setPurposeFilter("");
  }

  const hasActiveFilters = Boolean(
    search || providerFilter || statusFilter || purposeFilter,
  );

  const summary = useMemo(() => ({
    totalAmount: payments.reduce((sum, payment) => sum + payment.amount, 0),
    paidCount: payments.filter((payment) => payment.status === "paid").length,
    pendingCount: payments.filter((payment) => payment.status === "pending").length,
  }), [payments]);

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Admin</p>
            <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold tracking-tight text-slate-950">
              <DollarSign className="h-7 w-7 text-slate-400" />
              Payment Ledger
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
              A unified record of provider-authoritative payments. Stripe and QuickBooks determine financial status; transaction changes happen in the workflow that created the charge.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void fetchPayments()}
              disabled={loading}
              className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh ledger
            </button>
            <button
              type="button"
              onClick={() => void handleBackfillQBO()}
              disabled={backfillLoading}
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {backfillLoading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Receipt className="h-4 w-4" />}
              Sync accounting
            </button>
          </div>
        </div>

        <div className="mt-6 flex items-start gap-3 rounded-2xl bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-950 ring-1 ring-sky-100">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            <strong>Financial state is read-only here.</strong> Admins can no longer mark a provider transaction paid, failed, or refunded from this ledger. Membership changes, booking refunds, event refunds, and bookstore refunds must use their authoritative transaction workflows.
          </p>
        </div>

        {(error || message) && (
          <div className={`mt-4 flex items-start gap-3 rounded-2xl px-4 py-3 text-sm ${error ? "bg-red-50 text-red-800 ring-1 ring-red-100" : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100"}`}>
            {error
              ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{error || message}</span>
          </div>
        )}

        <div className="mt-7 grid gap-5 border-y border-slate-200 py-6 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Value shown</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{money(summary.totalAmount)}</p>
            <p className="mt-1 text-xs text-slate-500">Current loaded results</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Paid</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-700">{summary.paidCount}</p>
            <p className="mt-1 text-xs text-slate-500">Provider-confirmed ledger records</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pending</p>
            <p className="mt-1 text-2xl font-semibold text-amber-700">{summary.pendingCount}</p>
            <p className="mt-1 text-xs text-slate-500">Awaiting provider confirmation</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search payment ID, user ID, or reference"
              className="w-full rounded-full border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-100"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((current) => !current)}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-5 text-sm font-semibold ${showFilters || hasActiveFilters ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"}`}
          >
            <Filter className="h-4 w-4" /> Filters
          </button>
        </div>

        {showFilters && (
          <div className="mt-4 grid gap-4 border-b border-slate-200 pb-6 sm:grid-cols-3">
            <label className="text-sm font-semibold text-slate-700">
              Provider
              <select
                value={providerFilter}
                onChange={(event) => setProviderFilter(event.target.value as PaymentProvider | "")}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 font-normal"
              >
                <option value="">All providers</option>
                {(Object.entries(PROVIDER_LABELS) as [PaymentProvider, string][]).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as PaymentStatus | "")}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 font-normal"
              >
                <option value="">All statuses</option>
                {(Object.entries(STATUS_CONFIG) as [PaymentStatus, (typeof STATUS_CONFIG)[PaymentStatus]][]).map(([key, config]) => (
                  <option key={key} value={key}>{config.label}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Purpose
              <select
                value={purposeFilter}
                onChange={(event) => setPurposeFilter(event.target.value as PaymentPurpose | "")}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 font-normal"
              >
                <option value="">All purposes</option>
                {(Object.entries(PURPOSE_LABELS) as [PaymentPurpose, string][]).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 sm:col-span-3 sm:justify-self-start"
              >
                <X className="h-4 w-4" /> Clear filters
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : payments.length === 0 ? (
          <div className="py-20 text-center">
            <DollarSign className="mx-auto h-9 w-9 text-slate-300" />
            <p className="mt-4 text-sm text-slate-500">
              {hasActiveFilters ? "No payments match those filters." : "No payment transactions have been recorded yet."}
            </p>
          </div>
        ) : (
          <div className="mt-7 divide-y divide-slate-200 border-y border-slate-200">
            {payments.map((payment) => (
              <PaymentRow
                key={payment.id}
                payment={payment}
                onSynced={fetchPayments}
                onMessage={setMessage}
                onError={setError}
              />
            ))}
          </div>
        )}

        {hasMore && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              {loadingMore
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <ChevronRight className="h-4 w-4" />}
              Load more
            </button>
          </div>
        )}
      </main>
    </AppShell>
  );
}

function PaymentRow({
  payment,
  onSynced,
  onMessage,
  onError,
}: {
  payment: PaymentDoc;
  onSynced: () => Promise<void>;
  onMessage: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const statusConfig = STATUS_CONFIG[payment.status];
  const StatusIcon = statusConfig.icon;
  const lifecycleHref = purposeHref(payment);
  const isSynced = Boolean(payment.accountingRefs?.qboSalesReceiptId);
  const [syncLoading, setSyncLoading] = useState(false);

  async function handleSyncToQBO() {
    setSyncLoading(true);
    onMessage(null);
    onError(null);
    try {
      await syncToQBO({ paymentId: payment.id });
      onMessage("Payment copied to QuickBooks accounting. Provider payment status was not changed.");
      await onSynced();
    } catch (caught) {
      console.error("QBO sync failed:", caught);
      onError("This payment could not be synced to QuickBooks accounting.");
    } finally {
      setSyncLoading(false);
    }
  }

  return (
    <article className="grid gap-4 py-5 sm:grid-cols-[1.15fr_0.8fr_0.8fr_0.9fr_auto] sm:items-center sm:px-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-semibold text-slate-950">{PURPOSE_LABELS[payment.purpose]}</span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusConfig.bgColor} ${statusConfig.color}`}>
            <StatusIcon className="h-3 w-3" /> {statusConfig.label}
          </span>
        </div>
        <p className="mt-1 truncate font-mono text-xs text-slate-400">{payment.id}</p>
        <p className="mt-1 text-xs text-slate-500">{formatDate(payment.createdAt)}</p>
      </div>

      <div>
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          {payment.provider === "stripe"
            ? <CreditCard className="h-4 w-4 text-slate-400" />
            : <FileText className="h-4 w-4 text-slate-400" />}
          {PROVIDER_LABELS[payment.provider]}
        </p>
        <p className="mt-1 text-xs leading-5 text-slate-400">{PROVIDER_AUTHORITY[payment.provider]}</p>
      </div>

      <div>
        <p className="text-lg font-semibold text-slate-950">{money(payment.amount)}</p>
        <p className="mt-1 text-xs uppercase text-slate-400">{payment.currency}</p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Accounting</p>
        {isSynced ? (
          <p className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> QBO synced
          </p>
        ) : payment.status === "paid" ? (
          <button
            type="button"
            onClick={() => void handleSyncToQBO()}
            disabled={syncLoading}
            className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-slate-700 underline underline-offset-4 disabled:opacity-50"
          >
            {syncLoading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Receipt className="h-4 w-4" />}
            Sync QBO
          </button>
        ) : (
          <p className="mt-1 text-sm text-slate-400">After payment</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
        {payment.providerRefs?.qbInvoiceUrl && (
          <a
            href={payment.providerRefs.qbInvoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 underline underline-offset-4"
          >
            Invoice <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        {lifecycleHref && (
          <Link
            href={lifecycleHref}
            className="inline-flex min-h-9 items-center rounded-full border border-slate-200 px-3 text-sm font-semibold text-slate-700"
          >
            {purposeActionLabel(payment.purpose)}
          </Link>
        )}
      </div>
    </article>
  );
}
