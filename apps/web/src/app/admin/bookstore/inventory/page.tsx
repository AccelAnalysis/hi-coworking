"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, Loader2, Minus, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { getAllBooks } from "@/lib/firestore";
import {
  adjustBookInventoryFn,
  listBookInventoryFn,
  type BookInventoryItem,
} from "@/lib/bookstoreFunctions";
import type { BookDoc, ProductVariant } from "@hi/shared";

type PhysicalOption = {
  key: string;
  bookId: string;
  variantId?: string;
  label: string;
};

function physicalOptions(books: BookDoc[]): PhysicalOption[] {
  return books.flatMap((book) => {
    const variants = (book.variants || []).filter((variant: ProductVariant) => variant.type === "physical");
    if (variants.length) {
      return variants.map((variant) => ({
        key: `${book.id}::${variant.id}`,
        bookId: book.id,
        variantId: variant.id,
        label: `${book.title} — ${variant.name}`,
      }));
    }
    if (book.salesChannel === "owned" && book.availabilityMode === "physical") {
      return [{ key: `${book.id}::standard`, bookId: book.id, variantId: "standard", label: `${book.title} — Physical copy` }];
    }
    return [];
  });
}

function InventoryContent() {
  const [books, setBooks] = useState<BookDoc[]>([]);
  const [inventory, setInventory] = useState<BookInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedKey, setSelectedKey] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [reorderAt, setReorderAt] = useState(3);
  const [reason, setReason] = useState("Stock received at Hi Coworking");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const options = useMemo(() => physicalOptions(books), [books]);
  const selected = options.find((option) => option.key === selectedKey) || options[0];

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [bookRows, inventoryResult] = await Promise.all([getAllBooks(), listBookInventoryFn({})]);
      setBooks(bookRows);
      setInventory(inventoryResult.data.inventory);
    } catch (loadError) {
      console.error("Could not load bookstore inventory", loadError);
      setError("Inventory could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!selectedKey && options[0]) setSelectedKey(options[0].key);
  }, [options, selectedKey]);

  async function applyAdjustment(direction: 1 | -1) {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      await adjustBookInventoryFn({
        bookId: selected.bookId,
        variantId: selected.variantId,
        locationId: "main",
        quantityDelta: Math.max(1, quantity) * direction,
        reorderAt: Math.max(0, reorderAt),
        reason: reason.trim() || (direction > 0 ? "Stock received" : "Manual stock adjustment"),
      });
      await load();
    } catch (adjustError) {
      console.error("Inventory adjustment failed", adjustError);
      setError("The inventory adjustment could not be completed. Reserved pickup orders cannot be removed from stock.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-5 pb-20 pt-10 sm:px-8 md:pt-14">
        <Link href="/admin/bookstore" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600"><ArrowLeft className="h-4 w-4" /> Bookstore catalog</Link>
        <div className="mt-5">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Bookstore</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">On-site inventory</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Receive retail books, correct physical counts, and see how many copies are reserved by active pickup checkouts.</p>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <section className="rounded-2xl bg-slate-50 p-5">
            <h2 className="font-semibold text-slate-950">Adjust stock</h2>
            {options.length === 0 ? (
              <p className="mt-3 text-sm leading-6 text-slate-600">Add a Hi Coworking physical book to the catalog before receiving inventory.</p>
            ) : (
              <div className="mt-4 space-y-4">
                <label className="block text-sm font-medium text-slate-700">Book / format
                  <select value={selected?.key || ""} onChange={(event) => setSelectedKey(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm font-medium text-slate-700">Quantity
                    <input type="number" min={1} max={1000} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
                  </label>
                  <label className="text-sm font-medium text-slate-700">Reorder at
                    <input type="number" min={0} value={reorderAt} onChange={(event) => setReorderAt(Math.max(0, Number(event.target.value) || 0))} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
                  </label>
                </div>
                <label className="block text-sm font-medium text-slate-700">Reason
                  <input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5" />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={saving} onClick={() => applyAdjustment(1)} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" /> Receive stock</button>
                  <button type="button" disabled={saving} onClick={() => applyAdjustment(-1)} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50"><Minus className="h-4 w-4" /> Remove stock</button>
                </div>
              </div>
            )}
            {error && <p className="mt-4 text-sm font-medium text-red-700">{error}</p>}
          </section>

          <section>
            <div className="flex items-center gap-2"><Boxes className="h-5 w-5 text-slate-400" /><h2 className="font-semibold text-slate-950">Current shelf stock</h2></div>
            {loading ? (
              <div className="flex min-h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : inventory.length === 0 ? (
              <p className="mt-6 text-sm leading-6 text-slate-600">No retail stock has been received yet. Physical books remain unavailable for online pickup until inventory is added here.</p>
            ) : (
              <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
                {inventory.map((item) => (
                  <div key={item.id} className="grid grid-cols-[1fr_auto] gap-4 py-4">
                    <div>
                      <p className="font-semibold text-slate-950">{item.bookTitle}</p>
                      <p className="mt-1 text-sm text-slate-500">{item.variantName} · {item.sku}</p>
                      <p className={`mt-2 text-sm font-semibold ${item.stockStatus === "out_of_stock" ? "text-red-700" : item.stockStatus === "low_stock" ? "text-amber-700" : "text-emerald-700"}`}>{item.stockStatus === "out_of_stock" ? "Out of stock" : item.stockStatus === "low_stock" ? "Low stock" : "In stock"}</p>
                    </div>
                    <dl className="grid grid-cols-3 gap-4 text-center">
                      <div><dt className="text-xs text-slate-500">On hand</dt><dd className="mt-1 text-lg font-semibold text-slate-950">{item.onHand}</dd></div>
                      <div><dt className="text-xs text-slate-500">Reserved</dt><dd className="mt-1 text-lg font-semibold text-slate-950">{item.reserved}</dd></div>
                      <div><dt className="text-xs text-slate-500">Available</dt><dd className="mt-1 text-lg font-semibold text-slate-950">{item.available}</dd></div>
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </AppShell>
  );
}

export default function AdminBookstoreInventoryPage() {
  return <RequireAuth requiredRole="admin"><InventoryContent /></RequireAuth>;
}
