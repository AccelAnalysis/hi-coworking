"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, BookOpen, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { getBook, saveBook, updateBook } from "@/lib/firestore";
import type { BookAvailabilityMode, BookDoc, BookSalesChannel, ProductVariant } from "@hi/shared";

type EditableVariant = ProductVariant & {
  sku?: string;
  pickupReadyImmediately?: boolean;
  pickupLocationIds?: string[];
};

function emptyVariant(type: "physical" | "digital" = "physical"): EditableVariant {
  return {
    id: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name: type === "physical" ? "Paperback" : "Digital edition",
    priceCents: 0,
    type,
    sku: "",
    pickupReadyImmediately: true,
    pickupLocationIds: type === "physical" ? ["main"] : [],
  };
}

function moneyInput(cents: number) {
  return Number.isFinite(cents) ? (cents / 100).toFixed(2) : "0.00";
}

function BookEditorContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const { user } = useAuth();

  const [loading, setLoading] = useState(Boolean(editId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const [salesChannel, setSalesChannel] = useState<BookSalesChannel>("owned");
  const [availabilityMode, setAvailabilityMode] = useState<BookAvailabilityMode>("physical");
  const [priceCents, setPriceCents] = useState(0);
  const [digitalAssetUrl, setDigitalAssetUrl] = useState("");
  const [affiliateUrl, setAffiliateUrl] = useState("");
  const [affiliateNetwork, setAffiliateNetwork] = useState("");
  const [variants, setVariants] = useState<EditableVariant[]>([]);
  const [tags, setTags] = useState("");
  const [seriesTitle, setSeriesTitle] = useState("");
  const [seriesOrder, setSeriesOrder] = useState<number | undefined>();
  const [featuredRank, setFeaturedRank] = useState<number | undefined>();
  const [requireLoginToView, setRequireLoginToView] = useState(false);
  const [requireLoginToPurchase, setRequireLoginToPurchase] = useState(false);
  const [requireLoginToAccessContent, setRequireLoginToAccessContent] = useState(false);
  const [published, setPublished] = useState(false);
  const [existingBundleIds, setExistingBundleIds] = useState<string[]>([]);

  useEffect(() => {
    if (!editId) return;
    let active = true;
    setLoading(true);
    getBook(editId)
      .then((book) => {
        if (!active || !book) return;
        setTitle(book.title);
        setAuthor(book.author);
        setDescription(book.description || "");
        setCoverImageUrl(book.coverImageUrl || "");
        setSalesChannel(book.salesChannel);
        setAvailabilityMode(book.availabilityMode);
        setPriceCents(book.priceCents || 0);
        setDigitalAssetUrl(book.digitalAssetUrl || "");
        setAffiliateUrl(book.affiliateUrl || "");
        setAffiliateNetwork(book.affiliateNetwork || "");
        setVariants((book.variants || []) as EditableVariant[]);
        setExistingBundleIds(book.bundleIds || []);
        setTags((book.tags || []).join(", "));
        setSeriesTitle(book.seriesTitle || "");
        setSeriesOrder(book.seriesOrder);
        setFeaturedRank(book.featuredRank);
        setRequireLoginToView(book.requireLoginToView);
        setRequireLoginToPurchase(book.requireLoginToPurchase);
        setRequireLoginToAccessContent(book.requireLoginToAccessContent);
        setPublished(book.published);
      })
      .catch((loadError) => {
        console.error("Failed to load book", loadError);
        if (active) setError("This book could not be loaded.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [editId]);

  const hasFormats = salesChannel === "owned" && availabilityMode !== "browse_only" && variants.length > 0;
  const derivedMode = useMemo<BookAvailabilityMode>(() => {
    if (!hasFormats) return availabilityMode;
    const hasPhysical = variants.some((variant) => variant.type === "physical");
    return hasPhysical ? "physical" : "digital";
  }, [availabilityMode, hasFormats, variants]);

  function patchVariant(index: number, patch: Partial<EditableVariant>) {
    setVariants((current) => current.map((variant, position) => position === index ? { ...variant, ...patch } : variant));
  }

  function addVariant(type: "physical" | "digital") {
    setVariants((current) => [...current, emptyVariant(type)]);
  }

  function removeVariant(index: number) {
    setVariants((current) => current.filter((_, position) => position !== index));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    setError("");
    try {
      const cleanTags = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
      const cleanVariants = salesChannel === "owned" && availabilityMode !== "browse_only"
        ? variants.map((variant) => ({
            ...variant,
            name: variant.name.trim(),
            priceCents: Math.max(0, Math.round(variant.priceCents)),
            sku: variant.sku?.trim() || undefined,
            pickupLocationIds: variant.type === "physical" ? ["main"] : [],
            pickupReadyImmediately: variant.type === "physical" ? variant.pickupReadyImmediately !== false : undefined,
          }))
        : [];
      if (cleanVariants.some((variant) => !variant.name || variant.priceCents <= 0)) {
        setError("Every sellable format needs a name and a price greater than $0.");
        setSaving(false);
        return;
      }

      const base: Partial<BookDoc> = {
        title: title.trim(),
        author: author.trim(),
        description: description.trim() || undefined,
        coverImageUrl: coverImageUrl.trim() || undefined,
        salesChannel,
        availabilityMode: derivedMode,
        priceCents: salesChannel === "owned" && availabilityMode !== "browse_only" && cleanVariants.length === 0 ? priceCents : undefined,
        digitalAssetUrl: salesChannel === "owned" && availabilityMode === "digital" && cleanVariants.length === 0 ? digitalAssetUrl.trim() || undefined : undefined,
        affiliateUrl: salesChannel === "affiliate" ? affiliateUrl.trim() || undefined : undefined,
        affiliateNetwork: salesChannel === "affiliate" ? affiliateNetwork.trim() || undefined : undefined,
        variants: cleanVariants,
        bundleIds: existingBundleIds,
        requireLoginToView,
        requireLoginToPurchase,
        requireLoginToAccessContent,
        tags: cleanTags,
        seriesTitle: seriesTitle.trim() || undefined,
        seriesOrder: seriesTitle.trim() ? seriesOrder : undefined,
        featuredRank,
        published,
        updatedAt: Date.now(),
      };

      if (editId) {
        await updateBook(editId, base);
      } else {
        const id = `book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await saveBook({
          id,
          title: base.title || "Untitled",
          author: base.author || "",
          description: base.description,
          coverImageUrl: base.coverImageUrl,
          availabilityMode: base.availabilityMode || "physical",
          salesChannel: base.salesChannel || "owned",
          priceCents: base.priceCents,
          affiliateUrl: base.affiliateUrl,
          affiliateNetwork: base.affiliateNetwork,
          digitalAssetUrl: base.digitalAssetUrl,
          variants: base.variants || [],
          bundleIds: [],
          requireLoginToView,
          requireLoginToPurchase,
          requireLoginToAccessContent,
          tags: cleanTags,
          seriesTitle: base.seriesTitle,
          seriesOrder: base.seriesOrder,
          featuredRank,
          published,
          createdBy: user.uid,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      router.push("/admin/bookstore");
    } catch (saveError) {
      console.error("Failed to save book", saveError);
      setError("The book could not be saved. Check the required fields and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <AppShell><div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-slate-400" /></div></AppShell>;
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-3xl px-5 pb-20 pt-10 sm:px-8 md:pt-14">
        <Link href="/admin/bookstore" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600"><ArrowLeft className="h-4 w-4" /> Bookstore catalog</Link>
        <div className="mt-5">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Catalog</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{editId ? "Edit book" : "Add a book"}</h1>
        </div>

        <form onSubmit={submit} className="mt-9 space-y-10">
          <section>
            <h2 className="text-lg font-semibold text-slate-950">Book details</h2>
            <div className="mt-4 grid gap-4">
              <label className="text-sm font-medium text-slate-700">Title
                <input required value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-slate-500" />
              </label>
              <label className="text-sm font-medium text-slate-700">Author
                <input required value={author} onChange={(event) => setAuthor(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-slate-500" />
              </label>
              <label className="text-sm font-medium text-slate-700">Description
                <textarea rows={5} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-slate-500" />
              </label>
              <label className="text-sm font-medium text-slate-700">Cover image URL
                <input type="url" value={coverImageUrl} onChange={(event) => setCoverImageUrl(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 outline-none focus:border-slate-500" />
              </label>
            </div>
          </section>

          <section className="border-t border-slate-200 pt-8">
            <h2 className="text-lg font-semibold text-slate-950">How customers can get it</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">Sold by
                <select value={salesChannel} onChange={(event) => setSalesChannel(event.target.value as BookSalesChannel)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                  <option value="owned">Hi Coworking</option>
                  <option value="affiliate">External retailer</option>
                </select>
              </label>
              {salesChannel === "owned" && (
                <label className="text-sm font-medium text-slate-700">Offering
                  <select value={availabilityMode} onChange={(event) => setAvailabilityMode(event.target.value as BookAvailabilityMode)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <option value="physical">Physical / pickup</option>
                    <option value="digital">Digital</option>
                    <option value="browse_only">Available to read here</option>
                  </select>
                </label>
              )}
            </div>

            {salesChannel === "affiliate" ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">Retailer / network
                  <input value={affiliateNetwork} onChange={(event) => setAffiliateNetwork(event.target.value)} placeholder="Amazon, Bookshop…" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5" />
                </label>
                <label className="text-sm font-medium text-slate-700">Purchase URL
                  <input type="url" value={affiliateUrl} onChange={(event) => setAffiliateUrl(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5" />
                </label>
              </div>
            ) : availabilityMode === "browse_only" ? (
              <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">This title will be shown as available to read at Hi Coworking and will not have a checkout button.</p>
            ) : (
              <div className="mt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-slate-950">Formats</h3>
                    <p className="mt-1 text-sm text-slate-500">Use formats when a title has a paperback, digital edition, or both. Leave empty to use the simple price below.</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => addVariant("physical")} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"><Plus className="h-4 w-4" /> Physical</button>
                    <button type="button" onClick={() => addVariant("digital")} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"><Plus className="h-4 w-4" /> Digital</button>
                  </div>
                </div>

                {variants.length > 0 ? (
                  <div className="mt-4 space-y-4">
                    {variants.map((variant, index) => (
                      <div key={variant.id} className="rounded-2xl bg-slate-50 p-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="text-sm font-medium text-slate-700">Format name
                            <input value={variant.name} onChange={(event) => patchVariant(index, { name: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
                          </label>
                          <label className="text-sm font-medium text-slate-700">Type
                            <select value={variant.type} onChange={(event) => patchVariant(index, { type: event.target.value as "physical" | "digital", pickupLocationIds: event.target.value === "physical" ? ["main"] : [] })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                              <option value="physical">Physical / pickup</option>
                              <option value="digital">Digital</option>
                            </select>
                          </label>
                          <label className="text-sm font-medium text-slate-700">Price
                            <div className="mt-1.5 flex items-center gap-2"><span>$</span><input type="number" min={0} step="0.01" value={moneyInput(variant.priceCents)} onChange={(event) => patchVariant(index, { priceCents: Math.round(Number(event.target.value || 0) * 100) })} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5" /></div>
                          </label>
                          {variant.type === "physical" ? (
                            <label className="text-sm font-medium text-slate-700">SKU
                              <input value={variant.sku || ""} onChange={(event) => patchVariant(index, { sku: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
                            </label>
                          ) : (
                            <label className="text-sm font-medium text-slate-700">Digital file path / URL
                              <input value={variant.digitalAssetUrl || ""} onChange={(event) => patchVariant(index, { digitalAssetUrl: event.target.value })} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
                            </label>
                          )}
                        </div>
                        {variant.type === "physical" && (
                          <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={variant.pickupReadyImmediately !== false} onChange={(event) => patchVariant(index, { pickupReadyImmediately: event.target.checked })} /> Ready for pickup immediately after payment</label>
                        )}
                        <button type="button" onClick={() => removeVariant(index)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-red-700"><Trash2 className="h-4 w-4" /> Remove format</button>
                      </div>
                    ))}
                    {variants.some((variant) => variant.type === "physical") && <p className="text-sm leading-6 text-slate-600">Physical formats are not sellable for pickup until their on-site stock is entered under <Link className="font-semibold text-slate-950" href="/admin/bookstore/inventory">Inventory</Link>.</p>}
                  </div>
                ) : (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="text-sm font-medium text-slate-700">Price
                      <div className="mt-1.5 flex items-center gap-2"><span>$</span><input type="number" min={0} step="0.01" value={moneyInput(priceCents)} onChange={(event) => setPriceCents(Math.round(Number(event.target.value || 0) * 100))} className="w-full rounded-xl border border-slate-200 px-3 py-2.5" /></div>
                    </label>
                    {availabilityMode === "digital" && <label className="text-sm font-medium text-slate-700">Digital file path / URL<input value={digitalAssetUrl} onChange={(event) => setDigitalAssetUrl(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5" /></label>}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="border-t border-slate-200 pt-8">
            <h2 className="text-lg font-semibold text-slate-950">Presentation</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700 sm:col-span-2">Tags
                <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="leadership, local business" className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5" />
              </label>
              <label className="text-sm font-medium text-slate-700">Series title
                <input value={seriesTitle} onChange={(event) => setSeriesTitle(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5" />
              </label>
              <label className="text-sm font-medium text-slate-700">Series order
                <input type="number" min={1} value={seriesOrder ?? ""} onChange={(event) => setSeriesOrder(event.target.value ? Number(event.target.value) : undefined)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5" />
              </label>
              <label className="text-sm font-medium text-slate-700">Featured position
                <input type="number" min={1} value={featuredRank ?? ""} onChange={(event) => setFeaturedRank(event.target.value ? Number(event.target.value) : undefined)} className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5" />
              </label>
              <label className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} /> Published</label>
            </div>
          </section>

          <section className="border-t border-slate-200 pt-8">
            <h2 className="text-lg font-semibold text-slate-950">Access</h2>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <label className="flex items-center gap-2"><input type="checkbox" checked={requireLoginToView} onChange={(event) => setRequireLoginToView(event.target.checked)} /> Require login to view</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={requireLoginToPurchase} onChange={(event) => setRequireLoginToPurchase(event.target.checked)} /> Require login to purchase</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={requireLoginToAccessContent} onChange={(event) => setRequireLoginToAccessContent(event.target.checked)} /> Require login for digital-library access</label>
            </div>
          </section>

          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}

          <div className="flex gap-3 border-t border-slate-200 pt-6">
            <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save book</button>
            <Link href="/admin/bookstore" className="rounded-full px-5 py-3 text-sm font-semibold text-slate-600">Cancel</Link>
          </div>
        </form>
      </main>
    </AppShell>
  );
}

export default function AdminBookstoreEditorPage() {
  return <RequireAuth requiredRole="admin"><BookEditorContent /></RequireAuth>;
}
