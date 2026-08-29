"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, BookOpen, Check, ExternalLink, Loader2, MapPin, ShoppingBag } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/authContext";
import { getBook, trackAffiliateClick } from "@/lib/firestore";
import {
  createBookstoreCheckoutFn,
  getBookstorePublicStockFn,
} from "@/lib/bookstoreFunctions";
import type { BookDoc, ProductVariant } from "@hi/shared";

type StoreVariant = ProductVariant & {
  sku?: string;
  pickupReadyImmediately?: boolean;
  pickupLocationIds?: string[];
};

function formatPrice(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function variantsFor(book: BookDoc): StoreVariant[] {
  if (book.variants?.length) return book.variants as StoreVariant[];
  if (book.availabilityMode === "browse_only") return [];
  return [{
    id: "standard",
    name: book.availabilityMode === "digital" ? "Digital edition" : "Physical copy",
    priceCents: book.priceCents || 0,
    type: book.availabilityMode,
    digitalAssetUrl: book.digitalAssetUrl,
    pickupReadyImmediately: true,
  }];
}

export default function BookstoreItemPage() {
  const searchParams = useSearchParams();
  const bookId = searchParams.get("id") || "";
  const { user, loading: authLoading } = useAuth();
  const [book, setBook] = useState<BookDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [stock, setStock] = useState<"in_stock" | "low_stock" | "out_of_stock" | null>(null);
  const [pickupAddress, setPickupAddress] = useState("15373 Carrollton Blvd, Carrollton, VA");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!bookId) {
      setLoading(false);
      return;
    }
    let active = true;
    getBook(bookId)
      .then((result) => {
        if (!active) return;
        if (!result?.published) {
          setBook(null);
          return;
        }
        setBook(result);
        const variants = variantsFor(result);
        if (variants.length) setSelectedVariantId(variants[0].id);
      })
      .catch((fetchError) => {
        console.error("Failed to load book", fetchError);
        if (active) setBook(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [bookId]);

  useEffect(() => {
    if (!user) return;
    setCustomerName((current) => current || user.displayName || "");
    setCustomerEmail((current) => current || user.email || "");
  }, [user]);

  const variants = useMemo(() => book ? variantsFor(book) : [], [book]);
  const selectedVariant = variants.find((variant) => variant.id === selectedVariantId) || variants[0];

  useEffect(() => {
    if (!book || !selectedVariant || selectedVariant.type !== "physical") {
      setStock(null);
      return;
    }
    let active = true;
    setStock(null);
    getBookstorePublicStockFn({ bookId: book.id, variantId: selectedVariant.id, locationId: "main" })
      .then(({ data }) => {
        if (!active) return;
        setStock(data.status);
        setPickupAddress(data.pickupLocation.address);
      })
      .catch(() => {
        if (active) setStock("out_of_stock");
      });
    return () => { active = false; };
  }, [book, selectedVariant]);

  async function handleAffiliateClick() {
    if (!book?.affiliateUrl) return;
    try {
      await trackAffiliateClick({
        id: `${book.id}_${Date.now()}`,
        bookId: book.id,
        userId: user?.uid,
        destination: new URL(book.affiliateUrl).hostname,
        createdAt: Date.now(),
      });
    } catch {
      // Non-blocking analytics.
    }
  }

  async function handlePurchase() {
    if (!book || !selectedVariant) return;
    setError("");
    if (!customerEmail.trim() || !customerEmail.includes("@")) {
      setError("Enter the email address where you want your order confirmation associated.");
      return;
    }
    if (selectedVariant.type === "physical" && stock === "out_of_stock") {
      setError("This book is currently out of stock for pickup.");
      return;
    }
    setPurchasing(true);
    try {
      const { data } = await createBookstoreCheckoutFn({
        bookId: book.id,
        variantId: selectedVariant.id,
        quantity,
        fulfillmentMethod: selectedVariant.type === "digital" ? "digital" : "pickup",
        pickupLocationId: selectedVariant.type === "physical" ? "main" : undefined,
        customerName: customerName.trim() || undefined,
        customerEmail: customerEmail.trim(),
        successUrl: `${window.location.origin}/bookstore/order`,
        cancelUrl: window.location.href,
      });
      sessionStorage.setItem("bookstoreLatestOrder", JSON.stringify({
        orderId: data.orderId,
        accessToken: data.accessToken,
      }));
      sessionStorage.setItem(`bookstoreOrderAccess:${data.orderId}`, data.accessToken);
      window.location.assign(data.url);
    } catch (purchaseError) {
      console.error("Bookstore checkout failed", purchaseError);
      const message = purchaseError instanceof Error ? purchaseError.message : "Checkout could not be started.";
      setError(message.includes("sold out") ? "This book just sold out for pickup." : "Checkout could not be started. Please try again.");
      setPurchasing(false);
    }
  }

  if (loading || authLoading) {
    return <AppShell><div className="flex min-h-[55vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div></AppShell>;
  }

  if (!bookId || !book) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl px-5 py-24 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-slate-300" />
          <h1 className="mt-5 text-2xl font-semibold text-slate-950">Book not found</h1>
          <Link href="/bookstore" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
            <ArrowLeft className="h-4 w-4" /> Back to Bookstore
          </Link>
        </div>
      </AppShell>
    );
  }

  if (book.requireLoginToView && !user) {
    return (
      <AppShell>
        <div className="mx-auto max-w-xl px-5 py-24 text-center">
          <h1 className="text-2xl font-semibold text-slate-950">Sign in to view this title</h1>
          <Link href="/login" className="mt-6 inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white">Log in</Link>
        </div>
      </AppShell>
    );
  }

  const isBrowseOnly = book.availabilityMode === "browse_only";
  const isAffiliate = book.salesChannel === "affiliate";
  const needsLogin = Boolean(book.requireLoginToPurchase && !user);

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-5 pb-24 pt-8 sm:px-8 md:pt-12">
        <Link href="/bookstore" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" /> Bookstore
        </Link>

        <div className="mt-8 grid gap-10 md:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)] md:gap-14">
          <div className="mx-auto w-full max-w-sm">
            <div className="aspect-[3/4] overflow-hidden rounded-[1.75rem] bg-slate-100 shadow-md">
              {book.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={book.coverImageUrl} alt={book.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center"><BookOpen className="h-20 w-20 text-slate-300" /></div>
              )}
            </div>
          </div>

          <div className="flex flex-col justify-center">
            {book.seriesTitle && <p className="text-sm font-semibold text-slate-500">{book.seriesTitle}{book.seriesOrder ? ` · Book ${book.seriesOrder}` : ""}</p>}
            <h1 className="mt-2 text-4xl font-semibold tracking-[-0.03em] text-slate-950 md:text-5xl">{book.title}</h1>
            <p className="mt-2 text-base text-slate-500">by {book.author}</p>
            {book.description && <p className="mt-6 max-w-2xl whitespace-pre-line text-base leading-7 text-slate-650">{book.description}</p>}

            {isBrowseOnly ? (
              <div className="mt-8 max-w-xl rounded-2xl bg-slate-50 p-5">
                <p className="font-semibold text-slate-900">Available to read at Hi Coworking</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">This copy is part of the in-space shelf and is not currently offered for purchase.</p>
              </div>
            ) : isAffiliate ? (
              <div className="mt-8">
                <a
                  href={book.affiliateUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  onClick={handleAffiliateClick}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3.5 text-sm font-semibold text-white"
                >
                  Buy from {book.affiliateNetwork || "partner"} <ExternalLink className="h-4 w-4" />
                </a>
                <p className="mt-3 text-xs leading-5 text-slate-500">Hi Coworking may earn a commission from this link at no additional cost to you.</p>
              </div>
            ) : (
              <div className="mt-9 max-w-xl">
                {variants.length > 1 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Choose a format</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {variants.map((variant) => (
                        <button
                          key={variant.id}
                          type="button"
                          onClick={() => setSelectedVariantId(variant.id)}
                          className={`flex items-center justify-between rounded-2xl px-4 py-3 text-left transition ${selectedVariant?.id === variant.id ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-900 hover:bg-slate-200"}`}
                        >
                          <span className="font-semibold">{variant.name}</span>
                          <span>{formatPrice(variant.priceCents)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {selectedVariant && (
                  <div className="mt-5">
                    {variants.length === 1 && <p className="text-2xl font-semibold text-slate-950">{formatPrice(selectedVariant.priceCents)}</p>}
                    {selectedVariant.type === "physical" ? (
                      <div className="mt-4 flex gap-3 rounded-2xl bg-slate-50 p-4">
                        <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
                        <div>
                          <p className="font-semibold text-slate-900">Pick up at Hi Coworking</p>
                          <p className="mt-1 text-sm text-slate-600">{pickupAddress}</p>
                          <p className={`mt-2 text-sm font-semibold ${stock === "out_of_stock" ? "text-red-700" : "text-emerald-700"}`}>
                            {stock == null ? "Checking on-site stock…" : stock === "out_of_stock" ? "Out of stock" : stock === "low_stock" ? "Low stock · available for pickup" : "In stock · available for pickup"}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 flex gap-3 rounded-2xl bg-slate-50 p-4">
                        <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                        <div><p className="font-semibold text-slate-900">Digital access</p><p className="mt-1 text-sm text-slate-600">Your purchase is added to your Hi Coworking library when you are signed in.</p></div>
                      </div>
                    )}

                    {!user && !needsLogin && (
                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        <label className="text-sm font-medium text-slate-700">Name
                          <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-slate-500" autoComplete="name" />
                        </label>
                        <label className="text-sm font-medium text-slate-700">Email
                          <input type="email" required value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:border-slate-500" autoComplete="email" />
                        </label>
                      </div>
                    )}

                    {selectedVariant.type === "physical" && (
                      <label className="mt-5 block max-w-28 text-sm font-medium text-slate-700">Quantity
                        <select value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                          {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                    )}

                    {error && <p className="mt-4 text-sm font-medium text-red-700">{error}</p>}

                    {needsLogin ? (
                      <Link href="/login" className="mt-6 inline-flex rounded-full bg-slate-950 px-6 py-3.5 text-sm font-semibold text-white">Log in to purchase</Link>
                    ) : (
                      <button
                        type="button"
                        onClick={handlePurchase}
                        disabled={purchasing || (selectedVariant.type === "physical" && stock !== "in_stock" && stock !== "low_stock")}
                        className="mt-6 inline-flex items-center gap-2 rounded-full bg-slate-950 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {purchasing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
                        {selectedVariant.type === "physical" ? "Buy for pickup" : "Buy digital edition"}
                      </button>
                    )}
                    <p className="mt-3 text-xs leading-5 text-slate-500">Payment is completed securely through Stripe. Pickup inventory is reserved when checkout begins.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
