"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  getPaymentsLedger,
  type PaymentLedgerFilters,
} from "@/lib/firestore";
import type { PaymentDoc, PaymentProvider, PaymentStatus, PaymentPurpose } from "@hi/shared";
import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import {
  Search,
  Loader2,
  Filter,
  X,
  DollarSign,
  ChevronRight,
  CreditCard,
  FileText,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
  MoreVertical,
  ExternalLink,
  Receipt,
} from "lucide-react";

const markPaymentStatus = httpsCallable<
  { paymentId: string; newStatus: string; note?: string },
  { success: boolean; paymentId: string; previousStatus: string; newStatus: string; auditId: string }
>(functions, "admin_markPaymentStatus");

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

  // Filters
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<PaymentProvider | "">("");
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | "">("");
  const [purposeFilter, setPurposeFilter] = useState<PaymentPurpose | "">("");

  const buildFilters = useCallback((): PaymentLedgerFilters => {
    const f: PaymentLedgerFilters = {};
    if (search.trim()) f.search = search.trim();
    if (providerFilter) f.provider = providerFilter;
    if (statusFilter) f.status = statusFilter;
    if (purposeFilter) f.purpose = purposeFilter;
    return f;
  }, [search, providerFilter, statusFilter, purposeFilter]);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPaymentsLedger(buildFilters(), PAGE_SIZE);
      setPayments(result.payments);
      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);
    } catch (err) {
      console.error("Failed to fetch payments:", err);
    } finally {
      setLoading(false);
    }
  }, [buildFilters]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await getPaymentsLedger(buildFilters(), PAGE_SIZE, lastDoc);
      setPayments((prev) => [...prev, ...result.payments]);
      setLastDoc(result.lastDoc);
      setHasMore(result.hasMore);
    } catch (err) {
      console.error("Failed to load more payments:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setProviderFilter("");
    setStatusFilter("");
    setPurposeFilter("");
  };

  const hasActiveFilters =
    !!search || !!providerFilter || !!statusFilter || !!purposeFilter;

  const [backfillLoading, setBackfillLoading] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ synced: number; skipped: number; failed: number } | null>(null);

  const handleBackfillQBO = async () => {
    setBackfillLoading(true);
    setBackfillResult(null);
    try {
      const res = await backfillQBO({ limit: 50 });
      setBackfillResult(res.data);
      fetchPayments();
    } catch (err) {
      console.error("QBO backfill failed:", err);
    } finally {
      setBackfillLoading(false);
    }
  };

  // Summary stats
  const totalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
  const paidCount = payments.filter((p) => p.status === "paid").length;
  const pendingCount = payments.filter((p) => p.status === "pending").length;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              <DollarSign className="h-8 w-8 text-slate-400" />
              Payment Ledger
            </h1>
            <p className="text-slate-500 mt-1">
              Unified view of all payments across Stripe and QuickBooks.
            </p>
          </div>
          <button
            onClick={handleBackfillQBO}
            disabled={backfillLoading}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-medium border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-60"
          >
            {backfillLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Receipt className="h-4 w-4" />
            )}
            Sync to QuickBooks
          </button>
        </div>

        {backfillResult && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
            QBO sync complete: <strong>{backfillResult.synced}</strong> synced, {backfillResult.skipped} already synced, {backfillResult.failed} failed.
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Total (this page)
            </span>
            <div className="text-2xl font-bold text-slate-900 mt-1">
              ${(totalAmount / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Paid
            </span>
            <div className="text-2xl font-bold text-emerald-700 mt-1">
              {paidCount}
            </div>
          </div>
          <div className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Pending
            </span>
            <div className="text-2xl font-bold text-amber-700 mt-1">
              {pendingCount}
            </div>
          </div>
        </div>

        {/* Search + Filter bar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by payment ID, user ID, or reference..."
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-white focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all text-sm"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`inline-flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
              showFilters || hasActiveFilters
                ? "bg-slate-900 text-white border-slate-900"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            <Filter className="h-4 w-4" />
            Filters
            {hasActiveFilters && (
              <span className="ml-1 h-5 w-5 rounded-full bg-white/20 text-[10px] font-bold flex items-center justify-center">
                {(providerFilter ? 1 : 0) +
                  (statusFilter ? 1 : 0) +
                  (purposeFilter ? 1 : 0)}
              </span>
            )}
          </button>
        </div>

        {/* Expandable filters */}
        {showFilters && (
          <div className="p-5 mb-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900">
                Filter Payments
              </h3>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
                >
                  <X className="h-3 w-3" /> Clear all
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Provider */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Provider
                </label>
                <select
                  value={providerFilter}
                  onChange={(e) =>
                    setProviderFilter(e.target.value as PaymentProvider | "")
                  }
                  className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                >
                  <option value="">All providers</option>
                  {(
                    Object.entries(PROVIDER_LABELS) as [
                      PaymentProvider,
                      string,
                    ][]
                  ).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as PaymentStatus | "")
                  }
                  className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                >
                  <option value="">All statuses</option>
                  {(
                    Object.entries(STATUS_CONFIG) as [
                      PaymentStatus,
                      (typeof STATUS_CONFIG)[PaymentStatus],
                    ][]
                  ).map(([key, cfg]) => (
                    <option key={key} value={key}>
                      {cfg.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Purpose */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">
                  Purpose
                </label>
                <select
                  value={purposeFilter}
                  onChange={(e) =>
                    setPurposeFilter(e.target.value as PaymentPurpose | "")
                  }
                  className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                >
                  <option value="">All purposes</option>
                  {(
                    Object.entries(PURPOSE_LABELS) as [
                      PaymentPurpose,
                      string,
                    ][]
                  ).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Results table */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : payments.length === 0 ? (
          <div className="text-center py-24">
            <DollarSign className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-1">
              No payments found
            </h2>
            <p className="text-sm text-slate-500">
              {hasActiveFilters
                ? "Try adjusting your filters."
                : "No payment transactions have been recorded yet."}
            </p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 overflow-hidden">
              {/* Table header */}
              <div className="hidden md:grid grid-cols-12 gap-4 px-5 py-3 border-b border-slate-100 text-xs font-medium text-slate-500 uppercase tracking-wide">
                <div className="col-span-2">ID</div>
                <div className="col-span-2">Provider</div>
                <div className="col-span-2">Amount</div>
                <div className="col-span-1">Purpose</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Date</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>

              {/* Rows */}
              <div className="divide-y divide-slate-100">
                {payments.map((payment) => (
                  <PaymentRow key={payment.id} payment={payment} onStatusChanged={fetchPayments} />
                ))}
              </div>
            </div>

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center mt-6">
                <button
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm transition-all disabled:opacity-60"
                >
                  {loadingMore ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  Load more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function PaymentRow({ payment, onStatusChanged }: { payment: PaymentDoc; onStatusChanged: () => void }) {
  const statusCfg = STATUS_CONFIG[payment.status];
  const StatusIcon = statusCfg.icon;
  const providerLabel = PROVIDER_LABELS[payment.provider] ?? payment.provider;
  const purposeLabel = PURPOSE_LABELS[payment.purpose] ?? payment.purpose;
  const isStripe = payment.provider === "stripe";

  const [showActions, setShowActions] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [confirmAction, setConfirmAction] = useState<"paid" | "failed" | "refunded" | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const isSynced = !!payment.accountingRefs?.qboSalesReceiptId;

  const handleSyncToQBO = async () => {
    setSyncLoading(true);
    try {
      await syncToQBO({ paymentId: payment.id });
      onStatusChanged();
    } catch (err) {
      console.error("QBO sync failed:", err);
    } finally {
      setSyncLoading(false);
    }
  };

  const handleMarkStatus = async (newStatus: "paid" | "failed" | "refunded") => {
    setActionLoading(true);
    try {
      await markPaymentStatus({
        paymentId: payment.id,
        newStatus,
        note: noteText.trim() || undefined,
      });
      setShowActions(false);
      setConfirmAction(null);
      setNoteText("");
      onStatusChanged();
    } catch (err) {
      console.error("Failed to update payment status:", err);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="relative">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 px-5 py-4 hover:bg-slate-50 transition-colors items-center">
        {/* ID */}
        <div className="col-span-2">
          <span className="text-xs font-mono text-slate-500 truncate block">
            {payment.id.slice(0, 12)}...
          </span>
          <span className="text-[10px] text-slate-400 block md:hidden mt-0.5">
            {new Date(payment.createdAt).toLocaleDateString()}
          </span>
        </div>

        {/* Provider */}
        <div className="col-span-2 flex items-center gap-1.5">
          {isStripe ? (
            <CreditCard className="h-3.5 w-3.5 text-indigo-500" />
          ) : (
            <FileText className="h-3.5 w-3.5 text-emerald-500" />
          )}
          <span className="text-sm font-medium text-slate-700">
            {providerLabel}
          </span>
        </div>

        {/* Amount */}
        <div className="col-span-2">
          <span className="text-sm font-bold text-slate-900">
            ${(payment.amount / 100).toLocaleString("en-US", {
              minimumFractionDigits: 2,
            })}
          </span>
          <span className="text-[10px] text-slate-400 ml-1 uppercase">
            {payment.currency}
          </span>
        </div>

        {/* Purpose */}
        <div className="col-span-1">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200 uppercase">
            {purposeLabel}
          </span>
        </div>

        {/* Status */}
        <div className="col-span-2">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusCfg.bgColor} ${statusCfg.color}`}
          >
            <StatusIcon className="h-3 w-3" />
            {statusCfg.label}
          </span>
        </div>

        {/* Date */}
        <div className="col-span-2 hidden md:block">
          <span className="text-xs text-slate-500">
            {new Date(payment.createdAt).toLocaleDateString()}{" "}
            {new Date(payment.createdAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </div>

        {/* Actions */}
        <div className="col-span-1 flex justify-end">
          <button
            onClick={() => setShowActions(!showActions)}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* QB Invoice info bar */}
      {payment.providerRefs?.qbInvoiceNumber && (
        <div className="px-5 py-2 bg-amber-50/50 border-t border-amber-100 flex items-center gap-3 text-xs">
          <Receipt className="h-3.5 w-3.5 text-amber-600 shrink-0" />
          <span className="text-amber-800 font-medium">
            Invoice #{payment.providerRefs.qbInvoiceNumber}
          </span>
          {payment.providerRefs.qbInvoiceUrl && (
            <a
              href={payment.providerRefs.qbInvoiceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-medium ml-auto"
            >
              View / Pay Invoice
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      {/* Action panel */}
      {showActions && (
        <div className="px-5 pb-4 pt-1 bg-slate-50 border-t border-slate-100">
          {confirmAction ? (
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-[10px] font-medium text-slate-500 uppercase mb-1">
                  Note (optional)
                </label>
                <input
                  type="text"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Reason for status change..."
                  className="w-full rounded-lg px-3 py-2 border border-slate-200 bg-white text-xs focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
                />
              </div>
              <button
                onClick={() => handleMarkStatus(confirmAction)}
                disabled={actionLoading}
                className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                {actionLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Confirm {confirmAction}
              </button>
              <button
                onClick={() => { setConfirmAction(null); setNoteText(""); }}
                className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-white"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {payment.status !== "paid" && (
                <button
                  onClick={() => setConfirmAction("paid")}
                  className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200 hover:bg-emerald-100 transition-colors inline-flex items-center gap-1"
                >
                  <CheckCircle2 className="h-3 w-3" /> Mark Paid
                </button>
              )}
              {payment.status !== "failed" && (
                <button
                  onClick={() => setConfirmAction("failed")}
                  className="px-3 py-1.5 rounded-lg bg-red-50 text-red-700 text-xs font-semibold border border-red-200 hover:bg-red-100 transition-colors inline-flex items-center gap-1"
                >
                  <XCircle className="h-3 w-3" /> Mark Failed
                </button>
              )}
              {payment.status === "paid" && (
                <button
                  onClick={() => setConfirmAction("refunded")}
                  className="px-3 py-1.5 rounded-lg bg-slate-50 text-slate-700 text-xs font-semibold border border-slate-200 hover:bg-slate-100 transition-colors inline-flex items-center gap-1"
                >
                  <RotateCcw className="h-3 w-3" /> Refund
                </button>
              )}
              {payment.status === "paid" && !isSynced && (
                <button
                  onClick={handleSyncToQBO}
                  disabled={syncLoading}
                  className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-semibold border border-amber-200 hover:bg-amber-100 transition-colors inline-flex items-center gap-1 disabled:opacity-60"
                >
                  {syncLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Receipt className="h-3 w-3" />}
                  Sync to QBO
                </button>
              )}
              {isSynced && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200 inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> QBO Synced
                </span>
              )}
              <button
                onClick={() => setShowActions(false)}
                className="ml-auto text-xs text-slate-400 hover:text-slate-600"
              >
                Close
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
