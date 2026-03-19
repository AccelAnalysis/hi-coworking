"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { getAllBooks, updateBook, deleteBook } from "@/lib/firestore";
import type { BookDoc } from "@hi/shared";
import Link from "next/link";
import {
  BookOpen,
  Plus,
  Loader2,
  Edit3,
  Eye,
  Trash2,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from "lucide-react";

const AVAILABILITY_LABEL: Record<string, string> = {
  browse_only: "Browse",
  digital: "Digital",
  physical: "Physical",
};

const CHANNEL_LABEL: Record<string, { label: string; color: string }> = {
  owned: { label: "Owned", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  affiliate: { label: "Affiliate", color: "bg-blue-50 text-blue-700 border-blue-200" },
};

export default function AdminBookstorePage() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminBookstoreContent />
    </RequireAuth>
  );
}

function AdminBookstoreContent() {
  const [books, setBooks] = useState<BookDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchBooks = useCallback(async () => {
    setLoading(true);
    try {
      setBooks(await getAllBooks());
    } catch (err) {
      console.error("Failed to fetch books:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  const handleTogglePublish = async (book: BookDoc) => {
    try {
      await updateBook(book.id, { published: !book.published });
      fetchBooks();
    } catch (err) {
      console.error("Failed to toggle publish:", err);
    }
  };

  const handleDelete = async (bookId: string) => {
    if (!confirm("Are you sure you want to delete this book? This cannot be undone.")) return;
    setDeleting(bookId);
    try {
      await deleteBook(bookId);
      fetchBooks();
    } catch (err) {
      console.error("Failed to delete book:", err);
    } finally {
      setDeleting(null);
    }
  };

  const publishedCount = books.filter((b) => b.published).length;
  const ownedCount = books.filter((b) => b.salesChannel === "owned").length;
  const affiliateCount = books.filter((b) => b.salesChannel === "affiliate").length;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              <BookOpen className="h-8 w-8 text-slate-400" />
              Manage Bookstore
            </h1>
            <p className="text-slate-500 mt-1">Add, edit, and manage books in the virtual bookstore.</p>
          </div>
          <Link
            href="/admin/bookstore/new"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Add Book
          </Link>
        </div>

        {/* Stats */}
        {!loading && books.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Total", value: books.length, color: "text-slate-900" },
              { label: "Published", value: publishedCount, color: "text-emerald-600" },
              { label: "Owned", value: ownedCount, color: "text-indigo-600" },
              { label: "Affiliate", value: affiliateCount, color: "text-blue-600" },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl ring-1 ring-slate-200 p-3 text-center">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : books.length === 0 ? (
          <div className="text-center py-24">
            <BookOpen className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-1">No books yet</h2>
            <p className="text-sm text-slate-500">Add your first book to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {books.map((book) => {
              const channelCfg = CHANNEL_LABEL[book.salesChannel];
              return (
                <div
                  key={book.id}
                  className="p-4 rounded-xl bg-white shadow-sm ring-1 ring-slate-200"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3 flex-1 min-w-0">
                      {/* Mini cover */}
                      <div className="shrink-0 w-12 h-16 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center">
                        {book.coverImageUrl ? (
                          <img
                            src={book.coverImageUrl}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <BookOpen className="h-5 w-5 text-slate-300" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="text-sm font-bold text-slate-900 truncate">
                            {book.title}
                          </h3>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${
                            book.published
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-slate-100 text-slate-500 border-slate-200"
                          }`}>
                            {book.published ? "Published" : "Draft"}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 ${channelCfg.color}`}>
                            {channelCfg.label}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-slate-50 text-slate-400 border-slate-200 shrink-0">
                            {AVAILABILITY_LABEL[book.availabilityMode]}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span>by {book.author}</span>
                          {book.priceCents != null && book.priceCents > 0 && book.salesChannel === "owned" && (
                            <span className="font-medium text-slate-700">${(book.priceCents / 100).toFixed(2)}</span>
                          )}
                          {book.salesChannel === "affiliate" && book.affiliateNetwork && (
                            <span className="flex items-center gap-1">
                              <ExternalLink className="h-3 w-3" /> {book.affiliateNetwork}
                            </span>
                          )}
                          {book.seriesTitle && (
                            <span className="flex items-center gap-1 text-indigo-500 font-medium">
                              {book.seriesTitle}{book.seriesOrder != null ? ` #${book.seriesOrder}` : ""}
                            </span>
                          )}
                          {book.tags && book.tags.length > 0 && (
                            <span className="text-slate-400">{book.tags.join(", ")}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Link
                        href={`/bookstore/${book.id}`}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        title="View public page"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                      <Link
                        href={`/admin/bookstore/new?edit=${book.id}`}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        title="Edit"
                      >
                        <Edit3 className="h-4 w-4" />
                      </Link>
                      <button
                        onClick={() => handleTogglePublish(book)}
                        className={`p-2 rounded-lg transition-colors ${
                          book.published
                            ? "hover:bg-amber-50 text-amber-500 hover:text-amber-600"
                            : "hover:bg-emerald-50 text-emerald-500 hover:text-emerald-600"
                        }`}
                        title={book.published ? "Unpublish" : "Publish"}
                      >
                        {book.published ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={() => handleDelete(book.id)}
                        disabled={deleting === book.id}
                        className="p-2 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors disabled:opacity-50"
                        title="Delete"
                      >
                        {deleting === book.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
