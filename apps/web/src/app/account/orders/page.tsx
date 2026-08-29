"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Loader2, MapPin, PackageCheck, ReceiptText } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { getMyBookstoreOrdersFn, type BookstoreOrder } from "@/lib/bookstoreFunctions";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function statusLabel(order: BookstoreOrder) {
  if (order.status === "refunded") return "Refunded";
  if (order.status === "cancelled") return "Cancelled";
  if (order.status === "pending_payment") return "Payment pending";
  switch (order.fulfillmentStatus) {
    case "ready_for_pickup": return "Ready for pickup";
    case "picked_up": return "Picked up";
    case "awaiting_prep": return "Preparing for pickup";
    case "inventory_exception": return "Staff review";
    default: return "Paid";
  }
}

function OrdersContent() {
  const [orders, setOrders] = useState<BookstoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getMyBookstoreOrdersFn({})
      .then(({ data }) => setOrders(data.orders))
      .catch((loadError) => {
        console.error("Could not load bookstore orders", loadError);
        setError("Your bookstore orders could not be loaded.");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-4xl px-5 pb-20 pt-10 sm:px-8 md:pt-14">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Account</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">My bookstore orders</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">Track pickup purchases and review your bookstore order history.</p>
        </div>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
        ) : error ? (
          <p className="mt-10 text-sm font-medium text-red-700">{error}</p>
        ) : orders.length === 0 ? (
          <div className="mt-12 py-12 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">No bookstore orders yet</h2>
            <Link href="/bookstore" className="mt-5 inline-flex text-sm font-semibold text-slate-950">Browse the Bookstore</Link>
          </div>
        ) : (
          <div className="mt-10 divide-y divide-slate-200 border-y border-slate-200">
            {orders.map((order) => (
              <article key={order.id} className="py-6">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <ReceiptText className="h-4 w-4 text-slate-400" />
                      <p className="text-sm font-semibold text-slate-500">{order.orderNumber}</p>
                    </div>
                    <div className="mt-3 space-y-1">
                      {order.items.map((item) => (
                        <p key={`${item.bookId}-${item.variantId}`} className="font-semibold text-slate-950">
                          {item.title} <span className="font-normal text-slate-500">· {item.variantName} · Qty {item.quantity}</span>
                        </p>
                      ))}
                    </div>
                    {order.fulfillmentMethod === "pickup" && order.pickup && (
                      <p className="mt-3 flex items-start gap-2 text-sm text-slate-600">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {order.pickup.address}
                      </p>
                    )}
                  </div>
                  <div className="sm:text-right">
                    <p className="text-lg font-semibold text-slate-950">{money(order.totalCents)}</p>
                    <p className={`mt-1 text-sm font-semibold ${order.fulfillmentStatus === "ready_for_pickup" ? "text-emerald-700" : order.fulfillmentStatus === "inventory_exception" ? "text-red-700" : "text-slate-600"}`}>
                      {statusLabel(order)}
                    </p>
                    {order.fulfillmentStatus === "picked_up" && <PackageCheck className="mt-2 inline h-5 w-5 text-emerald-700" />}
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

export default function BookstoreOrdersPage() {
  return <RequireAuth><OrdersContent /></RequireAuth>;
}
