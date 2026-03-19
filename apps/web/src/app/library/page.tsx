"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { getUserBookPurchases, getBook } from "@/lib/firestore";
import { getDownloadLinkFn } from "@/lib/functions";
import type { BookDoc, BookPurchaseDoc } from "@hi/shared";
import Link from "next/link";
import {
  BookOpen,
  Loader2,
  Download,
  ExternalLink,
  Library,
  Calendar,
  AlertCircle,
} from "lucide-react";

export default function LibraryPage() {
  return (
    <RequireAuth>
      <LibraryContent />
    </RequireAuth>
  );
}

function LibraryContent() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState<(BookPurchaseDoc & { book?: BookDoc | null })[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const fetchLibrary = async () => {
      setLoading(true);
      try {
        const userPurchases = await getUserBookPurchases(user.uid);
        
        // Fetch book details for each purchase
        const purchasesWithBooks = await Promise.all(
          userPurchases.map(async (purchase) => {
            const book = await getBook(purchase.bookId);
            return { ...purchase, book };
          })
        );

        setPurchases(purchasesWithBooks);
      } catch (err) {
        console.error("Failed to load library:", err);
        setError("Failed to load your library. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    fetchLibrary();
  }, [user]);

  const handleDownload = async (bookId: string, title: string) => {
    setDownloadingId(bookId);
    try {
      const result = await getDownloadLinkFn({ bookId });
      const url = result.data.url;
      
      // Create a temporary anchor to trigger download if possible, or just open in new tab
      // For signed URLs (storage), usually opening in new tab is best or letting browser handle it.
      // If it's a direct file (e.g. PDF), opening in new tab works.
      window.open(url, "_blank");
    } catch (err: unknown) {
      console.error("Download failed:", err);
      alert(`Failed to generate download link for "${title}". Please try again or contact support.`);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Library className="h-8 w-8 text-indigo-600" />
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">My Library</h1>
            <p className="text-slate-500">Access your purchased books and digital content.</p>
          </div>
        </div>

        {error && (
          <div className="mb-8 p-4 bg-red-50 text-red-700 rounded-xl flex items-center gap-3">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : purchases.length === 0 ? (
          <div className="text-center py-24 bg-slate-50 rounded-2xl border border-slate-100">
            <BookOpen className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-2">Your library is empty</h2>
            <p className="text-slate-500 mb-6 max-w-sm mx-auto">
              You haven&apos;t purchased any books yet. Browse the bookstore to find resources for your business.
            </p>
            <Link
              href="/bookstore"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white font-medium hover:bg-slate-800 transition-colors"
            >
              Browse Bookstore
            </Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {purchases.map((item) => {
              const book = item.book;
              if (!book) return null; // Should not happen often, but handle deleted books

              return (
                <div key={item.id} className="bg-white rounded-xl shadow-sm ring-1 ring-slate-200 overflow-hidden flex flex-col">
                  <div className="p-5 flex gap-5">
                    {/* Cover */}
                    <div className="w-24 h-32 shrink-0 bg-slate-100 rounded-lg overflow-hidden relative">
                      {book.coverImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={book.coverImageUrl}
                          alt={book.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <BookOpen className="h-8 w-8 text-slate-300" />
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 flex flex-col">
                      <h3 className="font-bold text-slate-900 line-clamp-2 leading-tight mb-1">
                        {book.title}
                      </h3>
                      <p className="text-sm text-slate-500 mb-3">by {book.author}</p>
                      
                      <div className="mt-auto">
                        <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
                          <Calendar className="h-3 w-3" />
                          Purchased {new Date(item.createdAt).toLocaleDateString()}
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/bookstore/${book.id}`}
                            className="text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1"
                          >
                            View Details <ExternalLink className="h-3 w-3" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="bg-slate-50 p-4 border-t border-slate-100 mt-auto">
                    {book.availabilityMode === "digital" && book.digitalAssetUrl ? (
                      <button
                        onClick={() => handleDownload(book.id, book.title)}
                        disabled={downloadingId === book.id}
                        className="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
                      >
                        {downloadingId === book.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        Download Content
                      </button>
                    ) : book.availabilityMode === "physical" ? (
                      <div className="text-center text-sm text-slate-500 py-1">
                        Physical copy - Check email for shipping updates
                      </div>
                    ) : (
                      <div className="text-center text-sm text-slate-400 py-1">
                        Content not available
                      </div>
                    )}
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
