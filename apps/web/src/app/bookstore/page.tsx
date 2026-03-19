"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getPublishedBooks, trackAffiliateClick } from "@/lib/firestore";
import { useAuth } from "@/lib/authContext";
import type { BookDoc } from "@hi/shared";
import Link from "next/link";
import {
  BookOpen,
  Loader2,
  Filter,
  ExternalLink,
  ShoppingCart,
  Eye,
  Tag,
  Star,
  Library,
} from "lucide-react";

const AVAILABILITY_LABEL: Record<string, string> = {
  browse_only: "Browse",
  digital: "Digital",
  physical: "Physical",
};

const CHANNEL_BADGE: Record<string, { label: string; color: string }> = {
  owned: { label: "Hi Coworking", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  affiliate: { label: "Partner", color: "bg-blue-50 text-blue-700 border-blue-200" },
};

export default function BookstorePage() {
  const { user } = useAuth();
  const [books, setBooks] = useState<BookDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagFilter, setTagFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState<"" | "owned" | "affiliate">("");

  useEffect(() => {
    const fetchBooks = async () => {
      setLoading(true);
      try {
        const data = await getPublishedBooks();
        setBooks(data);
      } catch (err) {
        console.error("Failed to fetch books:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchBooks();
  }, []);

  // Derive unique tags from loaded books
  const allTags = Array.from(new Set(books.flatMap((b) => b.tags || [])));

  // Client-side filtering
  let filtered = books;
  if (tagFilter) {
    filtered = filtered.filter((b) => b.tags?.includes(tagFilter));
  }
  if (channelFilter) {
    filtered = filtered.filter((b) => b.salesChannel === channelFilter);
  }
  // Hide books that require login to view if user is not logged in
  if (!user) {
    filtered = filtered.filter((b) => !b.requireLoginToView);
  }

  // Group into series and standalone
  const seriesMap = new Map<string, BookDoc[]>();
  const standalone: BookDoc[] = [];
  for (const book of filtered) {
    if (book.seriesTitle) {
      const group = seriesMap.get(book.seriesTitle) ?? [];
      group.push(book);
      seriesMap.set(book.seriesTitle, group);
    } else {
      standalone.push(book);
    }
  }
  // Sort within each series by seriesOrder
  for (const group of seriesMap.values()) {
    group.sort((a, b) => (a.seriesOrder ?? 999) - (b.seriesOrder ?? 999));
  }
  // Sort standalone by featuredRank then createdAt
  standalone.sort((a, b) => {
    if (a.featuredRank != null && b.featuredRank != null) return a.featuredRank - b.featuredRank;
    if (a.featuredRank != null) return -1;
    if (b.featuredRank != null) return 1;
    return (b.createdAt ?? 0) - (a.createdAt ?? 0);
  });

  const seriesEntries = Array.from(seriesMap.entries());
  const hasContent = filtered.length > 0;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <BookOpen className="h-8 w-8 text-slate-400" />
            Bookstore
          </h1>
          <p className="text-slate-500 mt-1">
            Books written by the Hi Coworking team and curated reads from our partners.
          </p>
        </div>

        {/* Affiliate disclosure */}
        <div className="mb-6 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <strong>Disclosure:</strong> Some links are affiliate links. We may earn a commission if you purchase through these links, at no extra cost to you.
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Filter className="h-4 w-4 text-slate-400" />

          {/* Channel filter */}
          <div className="flex gap-2">
            {[
              { value: "", label: "All" },
              { value: "owned", label: "Hi Coworking" },
              { value: "affiliate", label: "Partner" },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setChannelFilter(opt.value as "" | "owned" | "affiliate")}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  channelFilter === opt.value
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Tag filter */}
          {allTags.length > 0 && (
            <>
              <div className="w-px h-5 bg-slate-200" />
              <div className="flex gap-2 flex-wrap">
                {tagFilter && (
                  <button
                    onClick={() => setTagFilter("")}
                    className="px-3 py-1.5 rounded-full text-xs font-medium bg-slate-900 text-white border border-slate-900"
                  >
                    {tagFilter} ✕
                  </button>
                )}
                {!tagFilter &&
                  allTags.slice(0, 6).map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setTagFilter(tag)}
                      className="px-3 py-1.5 rounded-full text-xs font-medium bg-white text-slate-600 border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      <Tag className="h-3 w-3 inline mr-1" />
                      {tag}
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : !hasContent ? (
          <div className="text-center py-24">
            <BookOpen className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-1">No books found</h2>
            <p className="text-sm text-slate-500">
              {tagFilter || channelFilter
                ? "Try adjusting your filters."
                : "Check back soon — we're adding new titles!"}
            </p>
          </div>
        ) : (
          <div className="space-y-12">
            {/* Series sections */}
            {seriesEntries.map(([title, seriesBooks]) => (
              <section key={title}>
                <div className="flex items-center gap-2 mb-4">
                  <Library className="h-5 w-5 text-indigo-400 shrink-0" />
                  <h2 className="text-lg font-bold text-slate-900">{title}</h2>
                  <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-600 border border-indigo-200">
                    {seriesBooks.length} {seriesBooks.length === 1 ? "book" : "books"}
                  </span>
                  <div className="flex-1 h-px bg-slate-100 ml-2" />
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {seriesBooks.map((book) => (
                    <BookCard key={book.id} book={book} userId={user?.uid} />
                  ))}
                </div>
              </section>
            ))}

            {/* Standalone books */}
            {standalone.length > 0 && (
              <section>
                {seriesEntries.length > 0 && (
                  <div className="flex items-center gap-2 mb-4">
                    <BookOpen className="h-5 w-5 text-slate-400 shrink-0" />
                    <h2 className="text-lg font-bold text-slate-900">More Titles</h2>
                    <div className="flex-1 h-px bg-slate-100 ml-2" />
                  </div>
                )}
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {standalone.map((book) => (
                    <BookCard key={book.id} book={book} userId={user?.uid} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function BookCard({ book, userId }: { book: BookDoc; userId?: string }) {
  const channelBadge = CHANNEL_BADGE[book.salesChannel];
  const isFeatured = book.featuredRank != null && book.featuredRank <= 3;
  const hasPrice =
    book.salesChannel === "owned" &&
    book.availabilityMode !== "browse_only" &&
    book.priceCents != null &&
    book.priceCents > 0;

  const handleAffiliateClick = async () => {
    if (book.salesChannel !== "affiliate" || !book.affiliateUrl) return;
    try {
      const id = `${book.id}_${Date.now()}`;
      await trackAffiliateClick({
        id,
        bookId: book.id,
        userId: userId || undefined,
        destination: new URL(book.affiliateUrl).hostname,
        createdAt: Date.now(),
      });
    } catch {
      // Non-blocking — don't prevent navigation
    }
  };

  const ctaContent = () => {
    if (book.availabilityMode === "browse_only") {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400">
          <Eye className="h-3.5 w-3.5" /> Browse Only
        </span>
      );
    }
    if (book.salesChannel === "affiliate" && book.affiliateUrl) {
      return (
        <a
          href={book.affiliateUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          onClick={handleAffiliateClick}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Buy via Partner
        </a>
      );
    }
    if (book.salesChannel === "owned") {
      return (
        <Link
          href={`/bookstore/${book.id}`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 transition-colors"
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          {book.availabilityMode === "digital" ? "Get Digital" : "Buy"}
        </Link>
      );
    }
    return null;
  };

  return (
    <div className="group relative flex flex-col bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 hover:ring-slate-300 hover:shadow-md transition-all overflow-hidden">
      {/* Cover image */}
      <Link href={`/bookstore/${book.id}`} className="block aspect-3/4 bg-slate-100 relative overflow-hidden">
        {book.coverImageUrl ? (
          <img
            src={book.coverImageUrl}
            alt={book.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <BookOpen className="h-16 w-16 text-slate-300" />
          </div>
        )}
        {isFeatured && (
          <div className="absolute top-3 left-3 px-2 py-0.5 rounded-full bg-amber-400 text-amber-950 text-[10px] font-bold flex items-center gap-1">
            <Star className="h-3 w-3" /> Featured
          </div>
        )}
      </Link>

      {/* Info */}
      <div className="flex flex-col flex-1 p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${channelBadge.color}`}>
            {channelBadge.label}
          </span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-slate-50 text-slate-500 border-slate-200">
            {AVAILABILITY_LABEL[book.availabilityMode]}
          </span>
        </div>

        <Link href={`/bookstore/${book.id}`}>
          <h3 className="text-sm font-bold text-slate-900 line-clamp-2 hover:text-slate-700 transition-colors">
            {book.title}
          </h3>
        </Link>
        <p className="text-xs text-slate-500 mt-0.5">{book.author}</p>
        {book.seriesTitle && book.seriesOrder != null && (
          <p className="text-[10px] font-semibold text-indigo-500 mt-0.5">
            Book {book.seriesOrder} of {book.seriesTitle}
          </p>
        )}

        {book.description && (
          <p className="text-xs text-slate-400 mt-2 line-clamp-2 leading-relaxed">
            {book.description}
          </p>
        )}

        {/* Tags */}
        {book.tags && book.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {book.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded text-[10px] bg-slate-50 text-slate-400 border border-slate-100"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Price + CTA */}
        <div className="flex items-center justify-between mt-auto pt-4">
          {hasPrice ? (
            <span className="text-sm font-bold text-slate-900">
              ${((book.priceCents ?? 0) / 100).toFixed(2)}
            </span>
          ) : (
            <span />
          )}
          {ctaContent()}
        </div>
      </div>
    </div>
  );
}
