"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getBook, getBooksBySeries, trackAffiliateClick } from "@/lib/firestore";
import { createBookCheckoutFn } from "@/lib/functions";
import { useAuth } from "@/lib/authContext";
import type { BookDoc } from "@hi/shared";
import Link from "next/link";
import {
  BookOpen,
  Loader2,
  ArrowLeft,
  ExternalLink,
  ShoppingCart,
  Eye,
  Tag,
  Star,
  Lock,
  Download,
  Info,
  Library,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export function BookDetailClient() {
  const params = useParams();
  const { user, loading: authLoading } = useAuth();
  const [book, setBook] = useState<BookDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [seriesBooks, setSeriesBooks] = useState<BookDoc[]>([]);

  const bookId = params.id as string;

  useEffect(() => {
    if (!bookId) return;
    const fetchBook = async () => {
      setLoading(true);
      try {
        const data = await getBook(bookId);
        if (!data) {
          setNotFound(true);
        } else if (!data.published) {
          // Unpublished books are not visible publicly
          setNotFound(true);
        } else if (data.requireLoginToView && !user && !authLoading) {
          // Will show login prompt instead
          setBook(data);
        } else {
          setBook(data);
        }
      } catch (err) {
        console.error("Failed to fetch book:", err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };
    fetchBook();
  }, [bookId, user, authLoading]);

  useEffect(() => {
    if (!book?.seriesTitle) return;
    getBooksBySeries(book.seriesTitle)
      .then(setSeriesBooks)
      .catch(() => setSeriesBooks([]));
  }, [book?.seriesTitle]);

  if (loading || authLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  if (notFound) {
    return (
      <AppShell>
        <div className="text-center py-24 max-w-md mx-auto">
          <BookOpen className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-700 mb-1">Book not found</h2>
          <p className="text-sm text-slate-500 mb-6">
            This book may have been removed or is no longer available.
          </p>
          <Link
            href="/bookstore"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Bookstore
          </Link>
        </div>
      </AppShell>
    );
  }

  if (!book) return null;

  // Login required to view
  if (book.requireLoginToView && !user) {
    return (
      <AppShell>
        <div className="text-center py-24 max-w-md mx-auto">
          <Lock className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-700 mb-1">Login Required</h2>
          <p className="text-sm text-slate-500 mb-6">
            You need to be logged in to view this book.
          </p>
          <div className="flex gap-3 justify-center">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/bookstore"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  const handlePurchase = async () => {
    if (!user || !book) return;
    setPurchasing(true);
    try {
      const { data } = await createBookCheckoutFn({
        bookId: book.id,
        quantity: 1,
        successUrl: `${window.location.origin}/bookstore/${book.id}?success=true`,
        cancelUrl: window.location.href,
      });
      window.location.href = data.url;
    } catch (err: unknown) {
      console.error("Purchase failed:", err);
      alert("Failed to initiate purchase. Please try again.");
      setPurchasing(false);
    }
  };

  const hasPrice =
    book.salesChannel === "owned" &&
    book.availabilityMode !== "browse_only" &&
    book.priceCents != null &&
    book.priceCents > 0;

  const isFeatured = book.featuredRank != null && book.featuredRank <= 3;

  const handleAffiliateClick = async () => {
    if (book.salesChannel !== "affiliate" || !book.affiliateUrl) return;
    try {
      const id = `${book.id}_${Date.now()}`;
      await trackAffiliateClick({
        id,
        bookId: book.id,
        userId: user?.uid || undefined,
        destination: new URL(book.affiliateUrl).hostname,
        createdAt: Date.now(),
      });
    } catch {
      // Non-blocking
    }
  };

  const needsLoginToPurchase = book.requireLoginToPurchase && !user;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto">
        {/* Back link */}
        <Link
          href="/bookstore"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Bookstore
        </Link>

        <div className="grid md:grid-cols-5 gap-8">
          {/* Cover */}
          <div className="md:col-span-2">
            <div className="aspect-3/4 bg-slate-100 rounded-2xl overflow-hidden shadow-lg relative">
              {book.coverImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={book.coverImageUrl}
                  alt={book.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <BookOpen className="h-20 w-20 text-slate-300" />
                </div>
              )}
              {isFeatured && (
                <div className="absolute top-4 left-4 px-2.5 py-1 rounded-full bg-amber-400 text-amber-950 text-xs font-bold flex items-center gap-1 shadow-sm">
                  <Star className="h-3.5 w-3.5" /> Featured
                </div>
              )}
            </div>
          </div>

          {/* Details */}
          <div className="md:col-span-3 flex flex-col">
            {/* Badges */}
            <div className="flex items-center gap-2 mb-3">
              <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                book.salesChannel === "owned"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-blue-50 text-blue-700 border-blue-200"
              }`}>
                {book.salesChannel === "owned" ? "Hi Coworking" : "Partner"}
              </span>
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold border bg-slate-50 text-slate-500 border-slate-200">
                {book.availabilityMode === "browse_only"
                  ? "Browse Only"
                  : book.availabilityMode === "digital"
                  ? "Digital"
                  : "Physical"}
              </span>
            </div>

            {book.seriesTitle && (
              <div className="flex items-center gap-1.5 mb-2">
                <Library className="h-3.5 w-3.5 text-indigo-400" />
                <span className="text-xs font-semibold text-indigo-600">
                  {book.seriesTitle}
                  {book.seriesOrder != null ? ` — Book ${book.seriesOrder}` : ""}
                </span>
              </div>
            )}

            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 tracking-tight mb-1">
              {book.title}
            </h1>
            <p className="text-base text-slate-500 mb-4">by {book.author}</p>

            {/* Price */}
            {hasPrice && (
              <p className="text-2xl font-bold text-slate-900 mb-4">
                ${((book.priceCents ?? 0) / 100).toFixed(2)}
              </p>
            )}

            {/* Description */}
            {book.description && (
              <p className="text-sm text-slate-600 leading-relaxed mb-6 whitespace-pre-line">
                {book.description}
              </p>
            )}

            {/* Tags */}
            {book.tags && book.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6">
                {book.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-1 rounded-lg text-xs bg-slate-50 text-slate-500 border border-slate-100 flex items-center gap-1"
                  >
                    <Tag className="h-3 w-3" /> {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Series prev/next nav */}
            {seriesBooks.length > 1 && book.seriesOrder != null && (() => {
              const idx = seriesBooks.findIndex((b) => b.id === book.id);
              const prev = idx > 0 ? seriesBooks[idx - 1] : null;
              const next = idx < seriesBooks.length - 1 ? seriesBooks[idx + 1] : null;
              return (
                <div className="flex items-center gap-3 mb-6">
                  {prev ? (
                    <Link
                      href={`/bookstore/${prev.id}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      <span className="line-clamp-1 max-w-[120px]">Book {prev.seriesOrder}</span>
                    </Link>
                  ) : <span />}
                  <span className="text-xs text-slate-400 mx-auto">
                    {book.seriesOrder} of {seriesBooks.length}
                  </span>
                  {next ? (
                    <Link
                      href={`/bookstore/${next.id}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                    >
                      <span className="line-clamp-1 max-w-[120px]">Book {next.seriesOrder}</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  ) : <span />}
                </div>
              );
            })()}

            {/* CTA area */}
            <div className="mt-auto space-y-3">
              {book.availabilityMode === "browse_only" ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm">
                  <Eye className="h-4 w-4" /> This title is for browsing only and is not currently available for purchase.
                </div>
              ) : book.salesChannel === "affiliate" && book.affiliateUrl ? (
                <>
                  <a
                    href={book.affiliateUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    onClick={handleAffiliateClick}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    <ExternalLink className="h-4 w-4" /> Buy via {book.affiliateNetwork || "Partner"}
                  </a>
                  <p className="text-xs text-amber-700 flex items-center gap-1">
                    <Info className="h-3 w-3" /> We may earn a commission if you purchase through this link.
                  </p>
                </>
              ) : book.salesChannel === "owned" ? (
                <>
                  {needsLoginToPurchase ? (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-500 flex items-center gap-2">
                        <Lock className="h-4 w-4" /> You must be logged in to purchase this book.
                      </p>
                      <Link
                        href="/login"
                        className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white font-medium hover:bg-slate-800 transition-colors shadow-sm"
                      >
                        Log in to Purchase
                      </Link>
                    </div>
                  ) : (
                    <button
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white font-medium hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-60"
                      disabled={purchasing}
                      onClick={handlePurchase}
                    >
                      {purchasing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : book.availabilityMode === "digital" ? (
                        <Download className="h-4 w-4" />
                      ) : (
                        <ShoppingCart className="h-4 w-4" />
                      )}
                      {book.availabilityMode === "digital" ? "Buy Digital Copy" : "Buy Physical Copy"}
                    </button>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>

        {/* Also in this series */}
        {seriesBooks.length > 1 && (
          <div className="mt-12">
            <div className="flex items-center gap-2 mb-5">
              <Library className="h-5 w-5 text-indigo-400" />
              <h2 className="text-lg font-bold text-slate-900">Also in {book.seriesTitle}</h2>
              <div className="flex-1 h-px bg-slate-100 ml-2" />
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {seriesBooks.map((sb) => (
                <Link
                  key={sb.id}
                  href={`/bookstore/${sb.id}`}
                  className={`group flex gap-3 p-3 rounded-xl ring-1 transition-all ${
                    sb.id === book.id
                      ? "ring-indigo-300 bg-indigo-50"
                      : "ring-slate-200 bg-white hover:ring-slate-300 hover:shadow-sm"
                  }`}
                >
                  <div className="shrink-0 w-12 h-16 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center">
                    {sb.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sb.coverImageUrl} alt={sb.title} className="w-full h-full object-cover" />
                    ) : (
                      <BookOpen className="h-5 w-5 text-slate-300" />
                    )}
                  </div>
                  <div className="min-w-0">
                    {sb.seriesOrder != null && (
                      <p className="text-[10px] font-semibold text-indigo-500 mb-0.5">Book {sb.seriesOrder}</p>
                    )}
                    <p className="text-xs font-bold text-slate-900 line-clamp-2 group-hover:text-slate-700 transition-colors">
                      {sb.title}
                    </p>
                    {sb.id === book.id && (
                      <span className="text-[10px] font-medium text-indigo-500">Currently viewing</span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
