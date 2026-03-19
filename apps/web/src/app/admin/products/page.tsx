"use client";

import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import {
  getAllProducts,
  saveProduct,
  updateProductQBLink,
} from "@/lib/firestore";
import type { ProductDoc, PaymentPurpose } from "@hi/shared";
import {
  Loader2,
  Plus,
  Package,
  ExternalLink,
  Check,
  X,
  Edit3,
  Link as LinkIcon,
} from "lucide-react";

const PURPOSE_OPTIONS: { value: PaymentPurpose; label: string }[] = [
  { value: "membership", label: "Membership" },
  { value: "event", label: "Event" },
  { value: "rfx", label: "RFx" },
  { value: "booking", label: "Booking" },
  { value: "referral", label: "Referral" },
  { value: "bookstore", label: "Bookstore" },
  { value: "other", label: "Other" },
];

export default function AdminProductsPage() {
  return (
    <RequireAuth requiredRole="admin">
      <AdminProductsContent />
    </RequireAuth>
  );
}

function AdminProductsContent() {
  const [products, setProducts] = useState<ProductDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAllProducts();
      setProducts(data);
    } catch (err) {
      console.error("Failed to fetch products:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              <Package className="h-8 w-8 text-slate-400" />
              Products &amp; Payment Links
            </h1>
            <p className="text-slate-500 mt-1">
              Configure products with Stripe prices and QuickBooks payment links.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Add Product
          </button>
        </div>

        {showCreate && (
          <CreateProductForm
            onSaved={() => {
              setShowCreate(false);
              fetchProducts();
            }}
            onCancel={() => setShowCreate(false)}
          />
        )}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : products.length === 0 ? (
          <div className="text-center py-24">
            <Package className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-700 mb-1">
              No products yet
            </h2>
            <p className="text-sm text-slate-500">
              Create a product to configure payment links.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onUpdated={fetchProducts}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// --- Create Product Form ---

function CreateProductForm({
  onSaved,
  onCancel,
}: {
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState<PaymentPurpose>("membership");
  const [qbUrl, setQbUrl] = useState("");
  const [stripePriceId, setStripePriceId] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !amount.trim()) return;
    setSaving(true);

    try {
      const id = `prod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const product: ProductDoc = {
        id,
        name: name.trim(),
        description: description.trim() || undefined,
        amount: Math.round(parseFloat(amount) * 100),
        currency: "USD",
        purpose,
        stripePriceId: stripePriceId.trim() || undefined,
        quickbooksPaymentLinkUrl: qbUrl.trim() || undefined,
        variants: [],
        active: true,
        createdAt: Date.now(),
      };
      await saveProduct(product);
      onSaved();
    } catch (err) {
      console.error("Failed to save product:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-8 p-6 rounded-xl bg-white shadow-sm ring-1 ring-slate-200"
    >
      <h3 className="text-sm font-bold text-slate-900 mb-4">New Product</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
            placeholder="e.g. Monthly Membership"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Amount (USD) *
          </label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            step="0.01"
            min="0"
            className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
            placeholder="e.g. 250.00"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Purpose
          </label>
          <select
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as PaymentPurpose)}
            className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
          >
            {PURPOSE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Stripe Price ID
          </label>
          <input
            type="text"
            value={stripePriceId}
            onChange={(e) => setStripePriceId(e.target.value)}
            className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
            placeholder="price_xxx (optional)"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            QuickBooks Payment Link URL
          </label>
          <input
            type="url"
            value={qbUrl}
            onChange={(e) => setQbUrl(e.target.value)}
            className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
            placeholder="https://app.qbo.intuit.com/... (optional)"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Description
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg px-3 py-2.5 border border-slate-200 bg-white text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
            placeholder="Optional description"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving || !name.trim() || !amount.trim()}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-medium hover:bg-slate-800 transition-colors disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Save Product
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// --- Product Card with inline QB link editing ---

function ProductCard({
  product,
  onUpdated,
}: {
  product: ProductDoc;
  onUpdated: () => void;
}) {
  const [editingQB, setEditingQB] = useState(false);
  const [qbUrl, setQbUrl] = useState(product.quickbooksPaymentLinkUrl || "");
  const [saving, setSaving] = useState(false);

  const handleSaveQBLink = async () => {
    if (!qbUrl.trim()) return;
    setSaving(true);
    try {
      await updateProductQBLink(product.id, qbUrl.trim());
      setEditingQB(false);
      onUpdated();
    } catch (err) {
      console.error("Failed to update QB link:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-5 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            {product.name}
            {!product.active && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 uppercase">
                Inactive
              </span>
            )}
          </h3>
          {product.description && (
            <p className="text-xs text-slate-500 mt-0.5">
              {product.description}
            </p>
          )}
        </div>
        <div className="text-right">
          <span className="text-lg font-bold text-slate-900">
            ${(product.amount / 100).toFixed(2)}
          </span>
          <span className="text-xs text-slate-400 ml-1 uppercase">
            {product.currency}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 uppercase">
          {product.purpose}
        </span>
        {product.stripePriceId && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-600">
            Stripe: {product.stripePriceId}
          </span>
        )}
      </div>

      {/* QuickBooks Link */}
      <div className="mt-3 pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600 flex items-center gap-1">
            <LinkIcon className="h-3 w-3" />
            QuickBooks Payment Link
          </span>
          {!editingQB && (
            <button
              onClick={() => setEditingQB(true)}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
            >
              <Edit3 className="h-3 w-3" />
              {product.quickbooksPaymentLinkUrl ? "Edit" : "Add"}
            </button>
          )}
        </div>

        {editingQB ? (
          <div className="flex items-center gap-2 mt-2">
            <input
              type="url"
              value={qbUrl}
              onChange={(e) => setQbUrl(e.target.value)}
              className="flex-1 rounded-lg px-3 py-2 border border-slate-200 bg-white text-xs focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none"
              placeholder="https://app.qbo.intuit.com/..."
            />
            <button
              onClick={handleSaveQBLink}
              disabled={saving || !qbUrl.trim()}
              className="p-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              onClick={() => {
                setEditingQB(false);
                setQbUrl(product.quickbooksPaymentLinkUrl || "");
              }}
              className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : product.quickbooksPaymentLinkUrl ? (
          <a
            href={product.quickbooksPaymentLinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1 truncate"
          >
            {product.quickbooksPaymentLinkUrl}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        ) : (
          <p className="mt-1 text-xs text-slate-400">Not configured</p>
        )}
      </div>
    </div>
  );
}
