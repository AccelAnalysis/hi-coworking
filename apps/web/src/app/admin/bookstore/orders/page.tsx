"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  PackageCheck,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  cancelBookstoreOrderFn,
  listBookstoreOrdersFn,
  setBookstorePickupStatusFn,
  type BookstoreOrder,
} from "@/lib/bookstoreFunctions";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function statusLabel(order: BookstoreOrder) {
  if (order.status === "pending_payment") return "Payment pending";
  if (order.status === "cancelled") return "Cancelled";
  if (order.status === "refunded") return "Refunded";
  switch (order.fulfillmentStatus) {
    case "awaiting_prep": return "Prepare pickup";
    case "ready_for_pickup": return "Ready for pickup";
    case "picked_up": return "Picked up";
    case "inventory_exception": return "Inventory exception";
    default: return "Paid";
  }
}

function statusClass(order: BookstoreOrder) {
  if (order.fulfillmentStatus === "inventory_exception") return "text-red-700";
  if (order.fulfillmentStatus === "ready_for_pickup") return "text-emerald-700";
  if (order.fulfillmentStatus === "awaiting_prep") return "text-amber-700";
  return "text-slate-600";
}

function OrdersContent() {
  const [orders, setOrders] = useState<BookstoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await listBookstoreOrdersFn({});
      setOrders(data.orders);
    } catch (loadError) {
      console.error("Could not load bookstore orders", loadError);
      setError("Bookstore orders could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => orders.filter((order) => {
    if (showCompleted) return true;
    return !["picked_up", "cancelled"].includes(order.fulfillmentStatus)
      && order.status !== "refunded";
  }), [orders, showCompleted]);

  const attentionCount = orders.filter((order) =>
    order.status === "paid"
    && ["awaiting_prep", "ready_for_pickup", "inventory_exception"].includes(order.fulfillmentStatus),
  ).length;

  async function setPickup(orderId: string, action: "ready" | "picked_up") {
    setWorking(orderId);
    setError("");
    try {
      await setBookstorePickupStatusFn({ orderId, action });
      await load();
    } catch (actionError) {
      console.error("Pickup status update failed", actionError);
      setError("That pickup status could not be changed. Refresh the order and try again.");
    } finally {
      setWorking("");
    }
  }

  async function cancel(order: BookstoreOrder) {
    const wording = order.status === "paid"
      ? "Refund this order and return unpicked-up physical inventory to stock?"
      : "Cancel this pending checkout and release its inventory reservation?";
    if (!window.confirm(wording)) return;
    setWorking(order.id);
    setError("");
    try {
      await cancelBookstoreOrderFn({
        orderId: order.id,
        reason: order.status === "paid"
          ? "Cancelled and refunded by bookstore staff"
          : "Pending bookstore checkout cancelled by staff",
      });
      await load();
    } catch (cancelError) {
      console.error("Bookstore cancellation failed", cancelError);
      setError("The order could not be cancelled or refunded. Picked-up orders require the return workflow.");
    } finally {
      setWorking("");
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-5 pb-20 pt-10 sm:px-8 md:pt-14">
        <Link href="/admin/bookstore" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600">
          <ArrowLeft className="h-4 w-4" /> Bookstore catalog
        </Link>

        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Bookstore</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Pickup orders</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Prepare paid on-site pickup orders, hand them to customers, and resolve exceptions before inventory leaves the shelf.
            </p>
          </div>
          <button type="button" onClick={load} disabled={loading} className="inline-flex w-fit items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white">{attentionCount} need attention</span>
          <label className="inline-flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Show completed and refunded orders
          </label>
        </div>

        {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}

        {loading ? (
          <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
        ) : visible.length === 0 ? (
          <div className="py-20 text-center">
            <PackageCheck className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">No pickup orders need attention</h2>
          </div>
        ) : (
          <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
            {visible.map((order) => (
              <article key={order.id} className="py-6">
                <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h2 className="font-semibold text-slate-950">{order.orderNumber}</h2>
                      <span className={`text-sm font-semibold ${statusClass(order)}`}>{statusLabel(order)}</span>
                      {order.fulfillmentStatus === "inventory_exception" && <AlertTriangle className="h-4 w-4 text-red-700" />}
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {order.customerName || "Customer"} · {order.customerEmail}
                    </p>
                    <div className="mt-4 space-y-1.5">
                      {order.items.map((item) => (
                        <p key={`${item.bookId}-${item.variantId}`} className="text-sm text-slate-800">
                          <span className="font-semibold">{item.title}</span> · {item.variantName} · Qty {item.quantity}
                        </p>
                      ))}
                    </div>
                    {order.pickup && (
                      <div className="mt-4 text-sm text-slate-600">
                        <p>{order.pickup.address}</p>
                        <p className="mt-1">Pickup code <span className="font-mono font-semibold text-slate-950">{order.pickup.pickupCode}</span></p>
                      </div>
                    )}
                  </div>

                  <div className="flex min-w-48 flex-col items-start gap-2 lg:items-end">
                    <p className="text-lg font-semibold text-slate-950">{money(order.totalCents)}</p>
                    {order.status === "paid" && order.fulfillmentStatus === "awaiting_prep" && (
                      <button type="button" disabled={working === order.id} onClick={() => setPickup(order.id, "ready")} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                        {working === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Ready for pickup
                      </button>
                    )}
                    {order.status === "paid" && order.fulfillmentStatus === "ready_for_pickup" && (
                      <button type="button" disabled={working === order.id} onClick={() => setPickup(order.id, "picked_up")} className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                        {working === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Mark picked up
                      </button>
                    )}
                    {(order.status === "pending_payment" || (order.status === "paid" && order.fulfillmentStatus !== "picked_up")) && (
                      <button type="button" disabled={working === order.id} onClick={() => cancel(order)} className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-red-700 disabled:opacity-50">
                        <RotateCcw className="h-4 w-4" /> {order.status === "paid" ? "Refund" : "Cancel checkout"}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}

export default function AdminBookstoreOrdersPage() {
  return <RequireAuth requiredRole="admin"><OrdersContent /></RequireAuth>;
}
