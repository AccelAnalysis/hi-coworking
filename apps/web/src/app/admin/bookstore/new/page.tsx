"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { saveBook, getBook, updateBook } from "@/lib/firestore";
import { useAuth } from "@/lib/authContext";
import type { BookDoc, BookAvailabilityMode, BookSalesChannel } from "@hi/shared";
import Link from "next/link";
import {
  BookOpen,
  ArrowLeft,
  Loader2,
  Save,
} from "lucide-react";

export default function AdminBookEditorPage() {
  return (
    <RequireAuth requiredRole="admin">
      <BookEditorContent />
    </RequireAuth>
  );
}

function BookEditorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const { user } = useAuth();

  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(!!editId);

  // Form state
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [availabilityMode, setAvailabilityMode] = useState<BookAvailabilityMode>("digital");
  const [salesChannel, setSalesChannel] = useState<BookSalesChannel>("owned");
  const [priceCents, setPriceCents] = useState<number>(0);
  const [stripePriceId, setStripePriceId] = useState("");
  const [affiliateUrl, setAffiliateUrl] = useState("");
  const [affiliateNetwork, setAffiliateNetwork] = useState("");
  const [digitalAssetUrl, setDigitalAssetUrl] = useState("");
  const [requireLoginToView, setRequireLoginToView] = useState(false);
  const [requireLoginToPurchase, setRequireLoginToPurchase] = useState(false);
  const [requireLoginToAccessContent, setRequireLoginToAccessContent] = useState(false);
  const [tags, setTags] = useState("");
  const [seriesTitle, setSeriesTitle] = useState("");
  const [seriesOrder, setSeriesOrder] = useState<number | undefined>(undefined);
  const [featuredRank, setFeaturedRank] = useState<number | undefined>(undefined);
  const [published, setPublished] = useState(false);

  // Load existing book for editing
  useEffect(() => {
    if (!editId) return;
    const load = async () => {
      setLoadingEdit(true);
      try {
        const book = await getBook(editId);
        if (book) {
          setTitle(book.title);
          setAuthor(book.author);
          setDescription(book.description || "");
          setCoverImageUrl(book.coverImageUrl || "");
          setAvailabilityMode(book.availabilityMode);
          setSalesChannel(book.salesChannel);
          setPriceCents(book.priceCents ?? 0);
          setStripePriceId(book.stripePriceId || "");
          setAffiliateUrl(book.affiliateUrl || "");
          setAffiliateNetwork(book.affiliateNetwork || "");
          setDigitalAssetUrl(book.digitalAssetUrl || "");
          setRequireLoginToView(book.requireLoginToView);
          setRequireLoginToPurchase(book.requireLoginToPurchase);
          setRequireLoginToAccessContent(book.requireLoginToAccessContent);
          setTags((book.tags || []).join(", "));
          setSeriesTitle(book.seriesTitle || "");
          setSeriesOrder(book.seriesOrder);
          setFeaturedRank(book.featuredRank);
          setPublished(book.published);
        }
      } catch (err) {
        console.error("Failed to load book:", err);
      } finally {
        setLoadingEdit(false);
      }
    };
    load();
  }, [editId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);

    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      if (editId) {
        await updateBook(editId, {
          title,
          author,
          description: description || undefined,
          coverImageUrl: coverImageUrl || undefined,
          availabilityMode,
          salesChannel,
          priceCents: salesChannel === "owned" && availabilityMode !== "browse_only" ? priceCents : undefined,
          stripePriceId: stripePriceId || undefined,
          affiliateUrl: salesChannel === "affiliate" ? affiliateUrl || undefined : undefined,
          affiliateNetwork: salesChannel === "affiliate" ? affiliateNetwork || undefined : undefined,
          digitalAssetUrl: availabilityMode === "digital" && salesChannel === "owned" ? digitalAssetUrl || undefined : undefined,
          requireLoginToView,
          requireLoginToPurchase,
          requireLoginToAccessContent,
          tags: tagList,
          seriesTitle: seriesTitle || undefined,
          seriesOrder: seriesTitle ? seriesOrder : undefined,
          featuredRank,
          published,
          variants: [],
          bundleIds: [],
        });
      } else {
        const id = `book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const book: BookDoc = {
          id,
          title,
          author,
          description: description || undefined,
          coverImageUrl: coverImageUrl || undefined,
          availabilityMode,
          salesChannel,
          priceCents: salesChannel === "owned" && availabilityMode !== "browse_only" ? priceCents : undefined,
          stripePriceId: stripePriceId || undefined,
          affiliateUrl: salesChannel === "affiliate" ? affiliateUrl || undefined : undefined,
          affiliateNetwork: salesChannel === "affiliate" ? affiliateNetwork || undefined : undefined,
          digitalAssetUrl: availabilityMode === "digital" && salesChannel === "owned" ? digitalAssetUrl || undefined : undefined,
          requireLoginToView,
          requireLoginToPurchase,
          requireLoginToAccessContent,
          tags: tagList,
          seriesTitle: seriesTitle || undefined,
          seriesOrder: seriesTitle ? seriesOrder : undefined,
          featuredRank,
          published,
          variants: [],
          bundleIds: [],
          createdBy: user.uid,
          createdAt: Date.now(),
        };
        await saveBook(book);
      }
      router.push("/admin/bookstore");
    } catch (err) {
      console.error("Failed to save book:", err);
      alert("Failed to save. Check console for details.");
    } finally {
      setSaving(false);
    }
  };

  if (loadingEdit) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      </AppShell>
    );
  }

  const showOwnedPricing = salesChannel === "owned" && availabilityMode !== "browse_only";
  const showAffiliateFields = salesChannel === "affiliate";
  const showDigitalAsset = availabilityMode === "digital" && salesChannel === "owned";
  const showContentAccessToggle = availabilityMode === "digital" && salesChannel === "owned";

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <Link
          href="/admin/bookstore"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Manage Bookstore
        </Link>

        <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3 mb-8">
          <BookOpen className="h-8 w-8 text-slate-400" />
          {editId ? "Edit Book" : "Add Book"}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <fieldset className="space-y-4 p-5 rounded-xl bg-white ring-1 ring-slate-200">
            <legend className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Book Info</legend>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                placeholder="e.g. Procurement Playbook for Small Business"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Author *</label>
              <input
                type="text"
                required
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                placeholder="e.g. Hi Coworking Team"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none resize-y"
                placeholder="A brief description of the book..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Cover Image URL</label>
              <input
                type="url"
                value={coverImageUrl}
                onChange={(e) => setCoverImageUrl(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                placeholder="https://..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                placeholder="e.g. procurement, small business, leadership"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Series Title</label>
                <input
                  type="text"
                  value={seriesTitle}
                  onChange={(e) => setSeriesTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  placeholder="e.g. Procurement Mastery"
                />
                <p className="text-xs text-slate-400 mt-1">Leave blank if not part of a series.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Series Order</label>
                <input
                  type="number"
                  min={1}
                  value={seriesOrder ?? ""}
                  onChange={(e) => setSeriesOrder(e.target.value ? parseInt(e.target.value) : undefined)}
                  disabled={!seriesTitle}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none disabled:opacity-40 disabled:bg-slate-50"
                  placeholder="1"
                />
                <p className="text-xs text-slate-400 mt-1">Book # within the series.</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Featured Rank</label>
              <input
                type="number"
                min={1}
                value={featuredRank ?? ""}
                onChange={(e) => setFeaturedRank(e.target.value ? parseInt(e.target.value) : undefined)}
                className="w-32 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                placeholder="—"
              />
              <p className="text-xs text-slate-400 mt-1">Lower number = more featured. Leave blank for unfeatured.</p>
            </div>
          </fieldset>

          {/* Availability */}
          <fieldset className="space-y-4 p-5 rounded-xl bg-white ring-1 ring-slate-200">
            <legend className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Availability</legend>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Mode</label>
                <select
                  value={availabilityMode}
                  onChange={(e) => setAvailabilityMode(e.target.value as BookAvailabilityMode)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                >
                  <option value="browse_only">Browse Only</option>
                  <option value="digital">Digital</option>
                  <option value="physical">Physical</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Sold Via</label>
                <select
                  value={salesChannel}
                  onChange={(e) => setSalesChannel(e.target.value as BookSalesChannel)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                >
                  <option value="owned">Hi Coworking (checkout here)</option>
                  <option value="affiliate">Affiliate link (outbound)</option>
                </select>
              </div>
            </div>

            {/* Summary pill */}
            <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-500">
              <strong>Summary:</strong>{" "}
              {salesChannel === "owned" ? "Hi Coworking" : "Affiliate"} /{" "}
              {availabilityMode === "browse_only" ? "Browse Only" : availabilityMode === "digital" ? "Digital" : "Physical"} /{" "}
              {requireLoginToPurchase ? "Login required" : "Guest allowed"}
            </div>
          </fieldset>

          {/* Pricing / Affiliate */}
          {(showOwnedPricing || showAffiliateFields) && (
            <fieldset className="space-y-4 p-5 rounded-xl bg-white ring-1 ring-slate-200">
              <legend className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
                {showAffiliateFields ? "Affiliate" : "Pricing"}
              </legend>

              {showOwnedPricing && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Price (USD)</label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-400">$</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={(priceCents / 100).toFixed(2)}
                        onChange={(e) => setPriceCents(Math.round(parseFloat(e.target.value || "0") * 100))}
                        className="w-32 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Stripe Price ID</label>
                    <input
                      type="text"
                      value={stripePriceId}
                      onChange={(e) => setStripePriceId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                      placeholder="price_..."
                    />
                    <p className="text-xs text-slate-400 mt-1">Optional. Set after creating the product in Stripe.</p>
                  </div>
                </>
              )}

              {showAffiliateFields && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Affiliate URL *</label>
                    <input
                      type="url"
                      value={affiliateUrl}
                      onChange={(e) => setAffiliateUrl(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                      placeholder="https://amzn.to/..."
                      required={salesChannel === "affiliate" && availabilityMode !== "browse_only"}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Affiliate Network</label>
                    <input
                      type="text"
                      value={affiliateNetwork}
                      onChange={(e) => setAffiliateNetwork(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                      placeholder="e.g. Amazon, Bookshop.org"
                    />
                  </div>
                </>
              )}
            </fieldset>
          )}

          {/* Digital Asset */}
          {showDigitalAsset && (
            <fieldset className="space-y-4 p-5 rounded-xl bg-white ring-1 ring-slate-200">
              <legend className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Digital Delivery</legend>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Digital Asset URL</label>
                <input
                  type="url"
                  value={digitalAssetUrl}
                  onChange={(e) => setDigitalAssetUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  placeholder="Firebase Storage URL or download link"
                />
                <p className="text-xs text-slate-400 mt-1">The file buyers will receive after purchase.</p>
              </div>
            </fieldset>
          )}

          {/* Access Policy */}
          <fieldset className="space-y-3 p-5 rounded-xl bg-white ring-1 ring-slate-200">
            <legend className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Access Policy</legend>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={requireLoginToView}
                onChange={(e) => setRequireLoginToView(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <span className="text-sm font-medium text-slate-700">Login required to view</span>
                <p className="text-xs text-slate-400">Hide this book from non-logged-in visitors.</p>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={requireLoginToPurchase}
                onChange={(e) => setRequireLoginToPurchase(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <div>
                <span className="text-sm font-medium text-slate-700">Login required to purchase</span>
                <p className="text-xs text-slate-400">Block guest checkout; user must create an account first.</p>
              </div>
            </label>

            {showContentAccessToggle && (
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireLoginToAccessContent}
                  onChange={(e) => setRequireLoginToAccessContent(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <span className="text-sm font-medium text-slate-700">Login required to access content</span>
                  <p className="text-xs text-slate-400">Digital downloads require an account (shows in &ldquo;My Library&rdquo;).</p>
                </div>
              </label>
            )}
          </fieldset>

          {/* Publish + Save */}
          <fieldset className="space-y-3 p-5 rounded-xl bg-white ring-1 ring-slate-200">
            <legend className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Status</legend>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={published}
                onChange={(e) => setPublished(e.target.checked)}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <div>
                <span className="text-sm font-medium text-slate-700">Published</span>
                <p className="text-xs text-slate-400">Make this book visible on the public bookstore.</p>
              </div>
            </label>
          </fieldset>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving || !title || !author}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-slate-900 text-white font-medium hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editId ? "Update Book" : "Add Book"}
            </button>
            <Link
              href="/admin/bookstore"
              className="px-4 py-3 rounded-xl text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
