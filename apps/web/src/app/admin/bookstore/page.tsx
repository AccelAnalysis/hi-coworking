"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Boxes, Eye, Loader2, PackageCheck, Pencil, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { getAllBooks, updateBook } from "@/lib/firestore";
import type { BookDoc } from "@hi/shared";

function AdminBookstoreContent() {
  const [books, setBooks] = useState<BookDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBooks(await getAllBooks());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function togglePublished(book: BookDoc) {
    setWorking(book.id);
    try {
      await updateBook(book.id, { published: !book.published, updatedAt: Date.now() });
      await load();
    } finally {
      setWorking("");
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-5 pb-20 pt-10 sm:px-8 md:pt-14">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Administration</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Bookstore</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Manage the shelf, receive on-site inventory, and fulfill paid pickup orders.
            </p>
          </div>
          <Link href="/admin/bookstore/new" className="inline-flex w-fit items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" /> Add book
          </Link>
        </div>

        <nav className="mt-8 flex flex-wrap gap-2 border-b border-slate-200 pb-4" aria-label="Bookstore administration">
          <span className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Catalog</span>
          <Link href="/admin/bookstore/inventory" className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-slate-650 hover:bg-slate-100">
            <Boxes className="h-4 w-4" /> Inventory
          </Link>
          <Link href="/admin/bookstore/orders" className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-slate-650 hover:bg-slate-100">
            <PackageCheck className="h-4 w-4" /> Orders
          </Link>
        </nav>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div>
        ) : books.length === 0 ? (
          <div className="py-20 text-center">
            <BookOpen className="mx-auto h-10 w-10 text-slate-300" />
            <h2 className="mt-4 text-xl font-semibold text-slate-900">No books in the catalog</h2>
            <Link href="/admin/bookstore/new" className="mt-5 inline-flex text-sm font-semibold text-slate-950">Add the first title</Link>
          </div>
        ) : (
          <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
            {books.map((book) => (
              <article key={book.id} className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 gap-4">
                  <div className="h-20 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                    {book.coverImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={book.coverImageUrl} alt="" className="h-full w-full object-cover" />
                    ) : <div className="flex h-full items-center justify-center"><BookOpen className="h-5 w-5 text-slate-300" /></div>}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <h2 className="truncate font-semibold text-slate-950">{book.title}</h2>
                      <span className={`text-xs font-semibold ${book.published ? "text-emerald-700" : "text-slate-400"}`}>{book.published ? "Published" : "Draft / archived"}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{book.author}</p>
                    <p className="mt-2 text-sm text-slate-600">
                      {book.salesChannel === "affiliate" ? `External partner${book.affiliateNetwork ? ` · ${book.affiliateNetwork}` : ""}` : book.availabilityMode === "physical" ? "Physical · pickup inventory managed separately" : book.availabilityMode === "digital" ? "Digital" : "Available to read here"}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link href={`/bookstore/item?id=${encodeURIComponent(book.id)}`} className="rounded-full p-2.5 text-slate-500 hover:bg-slate-100" title="View"><Eye className="h-4 w-4" /></Link>
                  <Link href={`/admin/bookstore/new?edit=${encodeURIComponent(book.id)}`} className="rounded-full p-2.5 text-slate-500 hover:bg-slate-100" title="Edit"><Pencil className="h-4 w-4" /></Link>
                  <button
                    type="button"
                    disabled={working === book.id}
                    onClick={() => togglePublished(book)}
                    className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {working === book.id ? "Saving…" : book.published ? "Archive" : "Publish"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}

export default function AdminBookstorePage() {
  return <RequireAuth requiredRole="admin"><AdminBookstoreContent /></RequireAuth>;
}
