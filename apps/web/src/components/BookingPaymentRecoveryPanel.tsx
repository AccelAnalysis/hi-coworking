"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

type RecoveryCase = {
  id: string;
  holdId: string;
  paymentId: string;
  userId?: string;
  amountCents: number;
  currency: string;
  reason: string;
  status: string;
  requiredAction: string;
  createdAt: number;
};

const listRecovery = httpsCallable<Record<string, never>, { cases: RecoveryCase[] }>(
  functions, "booking_adminListPaymentRecovery",
);

/** Read-only operational queue; never changes financial or reservation state. */
export function BookingPaymentRecoveryPanel() {
  const [cases, setCases] = useState<RecoveryCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await listRecovery({});
      setCases(result.data.cases);
    } catch {
      setError("Booking recovery cases could not be loaded. This does not mean the queue is empty. Refresh or contact the system administrator; previously loaded cases may be stale.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <section aria-labelledby="booking-recovery-title" className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="booking-recovery-title" className="text-lg font-semibold text-amber-950">Needs booking recovery</h2>
          <p className="mt-1 text-sm text-amber-900">Up to 100 newest open cases. These payments need staff review; a queued case is not a completed refund or a confirmed booking.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50">{loading ? "Loading recovery…" : "Refresh recovery"}</button>
      </div>
      <p className="mt-3 text-sm leading-6 text-amber-950">Verify the payment and hold references, contact the purchaser, then use the authorized refund workflow or arrange an alternate reservation with their agreement. Do not charge again, mark a payment refunded manually, or promise access before the replacement booking is confirmed. This panel is read-only.</p>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!loading && !error && cases.length === 0 && <p role="status" className="mt-4 text-sm text-amber-900">No open booking recovery cases were returned.</p>}
      {cases.length > 0 && <ul className="mt-4 space-y-3">
        {cases.map((item) => <li key={item.id} className="rounded-xl border border-amber-200 bg-white p-4 text-sm">
          <div className="flex flex-wrap justify-between gap-2 font-semibold text-slate-950">
            <span>{item.status} · {(item.amountCents / 100).toFixed(2)} {item.currency.toUpperCase()}</span>
            <time>{Number.isFinite(item.createdAt) ? new Date(item.createdAt).toLocaleString() : "Date unavailable"}</time>
          </div>
          <dl className="mt-3 grid gap-x-5 gap-y-2 break-all sm:grid-cols-2">
            <div><dt className="text-slate-500">Recovery reference</dt><dd>{item.id}</dd></div>
            <div><dt className="text-slate-500">Payment reference</dt><dd>{item.paymentId}</dd></div>
            <div><dt className="text-slate-500">Booking hold</dt><dd>{item.holdId}</dd></div>
            <div><dt className="text-slate-500">Account</dt><dd>{item.userId ? <Link className="underline" href={`/admin/members/actions?uid=${encodeURIComponent(item.userId)}`}>{item.userId}</Link> : "Purchaser account not assigned"}</dd></div>
          </dl>
          <p className="mt-3 text-slate-700"><strong>Reason:</strong> {item.reason}</p>
          <p className="mt-1 text-slate-700"><strong>Required action:</strong> {item.requiredAction}</p>
        </li>)}
      </ul>}
    </section>
  );
}
