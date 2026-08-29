"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, ExternalLink, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/authContext";
import { getPublishedBooks, trackAffiliateClick } from "@/lib/firestore";
import type { BookDoc } from "@hi/shared";

function startingPrice(book: BookDoc) {
  const variantPrices = (book.variants || [])
    .map((variant) => variant.priceCents)
    .filter((price) => Number.isFinite(price) && price > 0);
  if (variantPrices.length) return Math.min(...variantPrices);
  return book.priceCents && book.priceCents > 0 ? book.priceCents : undefined;
}

function offerLabel(book: BookDoc) {
  if (book.availabilityMode === "browse_only") return "Available to read here";
  if (book.salesChannel === "affiliate") return "Recommended reading";
  if (book.availabilityMode === "digital") return "Digital edition";
  return "Pickup at Hi Coworking";
}

function BookTile({ book, userId }: { book: BookDoc; userId?: string }) {
  const price = startingPrice(book);
  const itemHref = `/bookstore/item?id=${encodeURIComponent(book.id)}`;

  async function handleAffiliateClick() {
    if (!book.affiliateUrl) return;
    try {
      await trackAffiliateClick({
        id: `${book.id}_${Date.now()}`,
        bookId: book.id,
        userId,
        destination: new URL(book.affiliateUrl).hostname,
        createdAt: Date.now(),
      });
    } catch {
      // Tracking never blocks the customer from visiting the retailer.
    }
  }

  return (
    <article className="group">
      <Link href={itemHref} className="block">
        <div className="aspect-[3/4] overflow-hidden rounded-[1.5rem] bg-slate-100 shadow-sm">
          {book.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={book.coverImageUrl}
              alt={book.title}
              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-slate-100">
              <BookOpen className="h-14 w-14 text-slate-300" />
            </div>
          )}
        </div>
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          {offerLabel(book)}
        </p>
        <h3 className="mt-1 text-lg font-semibold leading-snug text-slate-950">{book.title}</h3>
        <p className="mt-1 text-sm text-slate-500">{book.author}</p>
        {book.description && (
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{book.description}</p>
        )}
      </Link>

      <div className="mt-3 flex items-center justify-between gap-4">
        <span className="text-sm font-semibold text-slate-900">
          {price != null ? `${book.variants?.length ? "From " : ""}$${(price / 100).toFixed(2)}` : ""}
        </span>
        {book.salesChannel === "affiliate" && book.affiliateUrl ? (
          <a
            href={book.affiliateUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={handleAffiliateClick}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800 hover:text-slate-950"
          >
            Buy from partner <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <Link
            href={itemHref}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800 hover:text-slate-950"
          >
            View book <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </article>
  );
}

function Shelf({ title, intro, books, userId }: {
  title: string;
  intro?: string;
  books: BookDoc[];
  userId?: string;
}) {
  if (!books.length) return null;
  return (
    <section className="py-10 md:py-14">
      <div className="mb-7 max-w-2xl">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
        {intro && <p className="mt-2 text-sm leading-6 text-slate-600">{intro}</p>}
      </div>
      <div className="grid gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {books.map((book) => <BookTile key={book.id} book={book} userId={userId} />)}
      </div>
    </section>
  );
}

export default function BookstorePage() {
  const { user } = useAuth();
  const [books, setBooks] = useState<BookDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    getPublishedBooks()
      .then((data) => {
        if (!active) return;
        setBooks(data);
        setLoadError(false);
      })
      .catch((error) => {
        console.error("Failed to load bookstore", error);
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const visibleBooks = useMemo(
    () => books.filter((book) => user || !book.requireLoginToView),
    [books, user],
  );
  const featured = visibleBooks
    .filter((book) => book.featuredRank != null && book.featuredRank <= 3)
    .sort((a, b) => (a.featuredRank ?? 99) - (b.featuredRank ?? 99));
  const featuredIds = new Set(featured.map((book) => book.id));
  const owned = visibleBooks.filter((book) => book.salesChannel === "owned" && !featuredIds.has(book.id));
  const partner = visibleBooks.filter((book) => book.salesChannel === "affiliate" && !featuredIds.has(book.id));

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-7xl px-5 pb-20 pt-10 sm:px-8 md:pt-14">
        <header className="max-w-3xl py-8 md:py-12">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Bookstore</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.03em] text-slate-950 md:text-6xl">
            Books worth keeping close.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 md:text-lg">
            Pick up books stocked at Hi Coworking, purchase digital editions, or explore titles we recommend from trusted partners.
          </p>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
            <span>Online purchase + on-site pickup</span>
            <span>Secure digital access</span>
          </div>
        </header>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center" role="status">
            <Loader2 className="h-7 w-7 animate-spin text-slate-400" />
          </div>
        ) : loadError ? (
          <div className="py-20 text-center">
            <h2 className="text-xl font-semibold text-slate-900">The bookstore could not load.</h2>
            <p className="mt-2 text-sm text-slate-500">Please refresh and try again.</p>
          </div>
        ) : visibleBooks.length === 0 ? (
          <div className="py-20 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">The shelf is being stocked.</h2>
            <p className="mt-2 text-sm text-slate-500">Check back soon for books and resources.</p>
          </div>
        ) : (
          <>
            <Shelf
              title="Featured"
              intro="A few titles we think deserve the front of the shelf."
              books={featured}
              userId={user?.uid}
            />
            <Shelf
              title="From Hi Coworking & on our shelf"
              intro="Books you can purchase directly from us, including copies stocked on site for pickup."
              books={owned}
              userId={user?.uid}
            />
            <Shelf
              title="Recommended reading"
              intro="Curated titles sold by outside retailers. Some links may be affiliate links, which can earn Hi Coworking a commission at no additional cost to you."
              books={partner}
              userId={user?.uid}
            />
          </>
        )}
      </main>
    </AppShell>
  );
}
