"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, CheckCircle2, Download, Loader2, MapPin, PackageCheck, ReceiptText } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/authContext";
import {
  getBookstoreDownloadLinkFn,
  getBookstoreOrderFn,
  type BookstoreOrder,
} from "@/lib/bookstoreFunctions";

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function statusCopy(order: BookstoreOrder) {
  if (order.status === "pending_payment") return {
    title: "Confirming your payment",
    body: "Stripe has returned you to Hi Coworking. We are waiting for the signed payment confirmation before we finalize the order.",
  };
  if (order.status === "refunded") return { title: "Order refunded", body: "This order has been refunded and is no longer active." };
  if (order.status === "cancelled") return { title: "Order cancelled", body: "This checkout was cancelled before fulfillment." };
  if (order.fulfillmentStatus === "inventory_exception") return {
    title: "Payment received — staff is confirming your copy",
    body: "We received your payment, but the final inventory check needs staff attention before pickup. Your order remains recorded and staff can resolve or refund it.",
  };
  if (order.fulfillmentStatus === "picked_up") return { title: "Picked up", body: "This order has been completed. Thank you for shopping with Hi Coworking." };
  if (order.fulfillmentStatus === "ready_for_pickup") return { title: "Your order is ready", body: "Your book is reserved and ready for pickup at Hi Coworking." };
  if (order.fulfillmentMethod === "pickup") return { title: "Order confirmed", body: "Your book has been purchased. We will show it as ready as soon as staff finishes preparing it." };
  return { title: "Your digital purchase is ready", body: "Your order is confirmed and your digital edition is available below." };
}

export default function BookstoreOrderPage() {
  const { user, loading: authLoading } = useAuth();
  const [order, setOrder] = useState<BookstoreOrder | null>(null);
  const [orderId, setOrderId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState("");

  useEffect(() => {
    try {
      const latest = sessionStorage.getItem("bookstoreLatestOrder");
      if (!latest) {
        setLoading(false);
        return;
      }
      const parsed = JSON.parse(latest) as { orderId?: string; accessToken?: string };
      if (!parsed.orderId) {
        setLoading(false);
        return;
      }
      setOrderId(parsed.orderId);
      setAccessToken(parsed.accessToken || sessionStorage.getItem(`bookstoreOrderAccess:${parsed.orderId}`) || "");
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!orderId || authLoading) return;
    let cancelled = false;
    let attempts = 0;

    async function loadOrder() {
      try {
        const { data } = await getBookstoreOrderFn({ orderId, accessToken: accessToken || undefined });
        if (cancelled) return;
        setOrder(data.order);
        setError("");
        attempts += 1;
        if (data.order.status === "pending_payment" && attempts < 8) {
          window.setTimeout(loadOrder, 1500);
        } else {
          setLoading(false);
        }
      } catch (loadError) {
        console.error("Could not load bookstore order", loadError);
        if (!cancelled) {
          setError("We could not verify this order in this browser.");
          setLoading(false);
        }
      }
    }

    loadOrder();
    return () => { cancelled = true; };
  }, [orderId, accessToken, authLoading]);

  async function download(bookId: string) {
    setDownloading(bookId);
    try {
      const { data } = await getBookstoreDownloadLinkFn({
        bookId,
        orderId: user ? undefined : orderId,
        accessToken: user ? undefined : accessToken,
      });
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (downloadError) {
      console.error("Digital download failed", downloadError);
      setError("The digital file could not be opened. Please try again shortly.");
    } finally {
      setDownloading("");
    }
  }

  if (loading || authLoading) {
    return (
      <AppShell>
        <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-5 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          <h1 className="mt-5 text-xl font-semibold text-slate-900">Finalizing your order</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">We are matching your Stripe payment to the bookstore order.</p>
        </div>
      </AppShell>
    );
  }

  if (!order) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl px-5 py-24 text-center">
          <ReceiptText className="mx-auto h-10 w-10 text-slate-300" />
          <h1 className="mt-4 text-2xl font-semibold text-slate-950">Order confirmation</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {error || "There is no recent bookstore checkout stored in this browser."}
          </p>
          <div className="mt-7 flex justify-center gap-4">
            <Link href="/bookstore" className="text-sm font-semibold text-slate-700">Bookstore</Link>
            {user && <Link href="/account/orders" className="text-sm font-semibold text-slate-950">My Orders</Link>}
          </div>
        </div>
      </AppShell>
    );
  }

  const copy = statusCopy(order);
  const digitalItems = order.items.filter((item) => item.type === "digital");

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 md:py-20">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
          {order.fulfillmentStatus === "picked_up" ? <PackageCheck className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
        </div>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{order.orderNumber}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">{copy.title}</h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">{copy.body}</p>

        <section className="mt-10 border-y border-slate-200 py-6">
          <div className="space-y-4">
            {order.items.map((item) => (
              <div key={`${item.bookId}-${item.variantId}`} className="flex items-start justify-between gap-6">
                <div>
                  <p className="font-semibold text-slate-950">{item.title}</p>
                  <p className="mt-1 text-sm text-slate-500">{item.variantName} · Qty {item.quantity}</p>
                </div>
                <p className="font-semibold text-slate-900">{money(item.unitPriceCents * item.quantity)}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-5 text-base font-semibold text-slate-950">
            <span>Total</span><span>{money(order.totalCents)}</span>
          </div>
        </section>

        {order.fulfillmentMethod === "pickup" && order.pickup && (
          <section className="mt-8 flex gap-4 rounded-2xl bg-slate-50 p-5">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
            <div>
              <h2 className="font-semibold text-slate-950">Pickup at {order.pickup.locationName}</h2>
              <p className="mt-1 text-sm text-slate-600">{order.pickup.address}</p>
              <p className="mt-3 text-sm text-slate-600">Pickup code <span className="font-mono font-semibold text-slate-950">{order.pickup.pickupCode}</span></p>
              {order.fulfillmentStatus === "ready_for_pickup" && <p className="mt-3 text-sm font-semibold text-emerald-700">Ready for pickup</p>}
              {order.fulfillmentStatus === "awaiting_prep" && <p className="mt-3 text-sm font-semibold text-amber-700">Staff is preparing your order</p>}
            </div>
          </section>
        )}

        {order.status === "paid" && digitalItems.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-slate-950">Digital access</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              {digitalItems.map((item) => (
                <button
                  key={`${item.bookId}-${item.variantId}`}
                  type="button"
                  onClick={() => download(item.bookId)}
                  disabled={downloading === item.bookId}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {downloading === item.bookId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Open {item.title}
                </button>
              ))}
            </div>
          </section>
        )}

        {error && <p className="mt-6 text-sm font-medium text-red-700">{error}</p>}

        <div className="mt-10 flex flex-wrap gap-5 text-sm font-semibold">
          <Link href="/bookstore" className="text-slate-600 hover:text-slate-950">Back to Bookstore</Link>
          {user && <Link href="/account/orders" className="text-slate-950">View My Orders</Link>}
          {user && digitalItems.length > 0 && <Link href="/library" className="inline-flex items-center gap-1.5 text-slate-950"><BookOpen className="h-4 w-4" /> My Library</Link>}
        </div>
      </main>
    </AppShell>
  );
}
