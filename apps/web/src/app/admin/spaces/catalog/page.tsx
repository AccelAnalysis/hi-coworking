"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { httpsCallable } from "firebase/functions";
import { ArrowLeft, Eye, EyeOff, Loader2, Plus, RefreshCw, Save, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { functions } from "@/lib/firebase";

type PublishedLayout = {
  layoutPath: string;
  layoutId: string;
  locationId: string;
  floorId: string;
  name: string;
  resourceIds: string[];
};

type Setup = {
  id: string;
  layoutPath: string;
  name: string;
  serviceType: "DESK" | "CONFERENCE";
  resourceId: string;
  capacity: number;
  description?: string;
  arrangement?: string;
  addOnIds?: string[];
  published: boolean;
};

type AddOn = {
  id: string;
  name: string;
  description?: string;
  priceCents: number;
  stripePriceId?: string;
  serviceTypes: Array<"DESK" | "CONFERENCE">;
  published: boolean;
};

type Catalog = { publishedLayouts: PublishedLayout[]; setups: Setup[]; addOns: AddOn[] };

const getCatalog = httpsCallable<Record<string, never>, Catalog>(functions, "space_adminGetCatalog");
const saveSetup = httpsCallable<Record<string, unknown>, Setup>(functions, "space_adminUpsertSetup");
const saveAddOn = httpsCallable<Record<string, unknown>, AddOn>(functions, "space_adminUpsertAddOn");
const setPublished = httpsCallable<{ setupId: string; published: boolean }, { success: boolean }>(functions, "space_adminSetSetupPublished");

export default function SpaceCatalogPage() {
  return <RequireAuth requiredRole="admin"><SpaceCatalogContent /></RequireAuth>;
}

function SpaceCatalogContent() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [layoutPath, setLayoutPath] = useState("");
  const [name, setName] = useState("");
  const [serviceType, setServiceType] = useState<"DESK" | "CONFERENCE">("CONFERENCE");
  const [resourceId, setResourceId] = useState("mode-conference");
  const [capacity, setCapacity] = useState(10);
  const [arrangement, setArrangement] = useState("");
  const [description, setDescription] = useState("");
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [addOnName, setAddOnName] = useState("");
  const [addOnPrice, setAddOnPrice] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getCatalog({});
      setCatalog(result.data);
      if (!layoutPath && result.data.publishedLayouts[0]) {
        const first = result.data.publishedLayouts[0];
        setLayoutPath(first.layoutPath);
        setName(first.name);
        setResourceId(first.resourceIds.find((id) => id.startsWith("mode-")) || first.resourceIds[0] || "mode-conference");
      }
    } catch (caught) {
      console.error(caught);
      setError("The published setup catalog could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [layoutPath]);

  useEffect(() => { void load(); }, [load]);

  const selectedLayout = useMemo(
    () => catalog?.publishedLayouts.find((layout) => layout.layoutPath === layoutPath) || null,
    [catalog, layoutPath],
  );

  function chooseLayout(nextPath: string) {
    setLayoutPath(nextPath);
    const layout = catalog?.publishedLayouts.find((item) => item.layoutPath === nextPath);
    if (!layout) return;
    setName(layout.name);
    const preferred = serviceType === "CONFERENCE"
      ? layout.resourceIds.find((id) => id.startsWith("mode-"))
      : layout.resourceIds.find((id) => id.startsWith("seat-"));
    setResourceId(preferred || layout.resourceIds[0] || "");
  }

  async function submitSetup(event: FormEvent) {
    event.preventDefault();
    if (!layoutPath || !name.trim() || !resourceId) return;
    setSaving(true);
    setError(null);
    try {
      await saveSetup({
        layoutPath,
        name: name.trim(),
        serviceType,
        resourceId,
        capacity,
        arrangement: arrangement.trim(),
        description: description.trim(),
        addOnIds: selectedAddOns,
        published: true,
      });
      setArrangement("");
      setDescription("");
      await load();
    } catch (caught) {
      console.error(caught);
      setError("The customer setup could not be published.");
    } finally {
      setSaving(false);
    }
  }

  async function submitAddOn(event: FormEvent) {
    event.preventDefault();
    if (!addOnName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await saveAddOn({
        name: addOnName.trim(),
        priceCents: Math.max(0, Math.round(addOnPrice * 100)),
        serviceTypes: [serviceType],
        published: true,
      });
      setAddOnName("");
      setAddOnPrice(0);
      await load();
    } catch (caught) {
      console.error(caught);
      setError("The add-on could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleSetup(setup: Setup) {
    setSaving(true);
    try {
      await setPublished({ setupId: setup.id, published: !setup.published });
      await load();
    } catch (caught) {
      console.error(caught);
      setError("The setup visibility could not be changed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        <Link href="/admin/dashboard" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950"><ArrowLeft className="h-4 w-4" /> Operations overview</Link>
        <header className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-sm font-medium text-slate-500">Space publishing</p><h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Customer setups & add-ons</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Published visual layouts become reusable customer choices here. Attach a service, capacity, arrangement label, and optional upgrades without changing application code.</p></div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
        </header>

        {error ? <div className="mt-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</div> : null}
        {loading && !catalog ? <div className="flex items-center justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div> : null}

        {catalog ? <div className="mt-9 grid gap-10 lg:grid-cols-[1fr_.9fr]">
          <section>
            <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-slate-500" /><h2 className="text-xl font-semibold text-slate-950">Published customer choices</h2></div>
            <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
              {catalog.setups.map((setup) => <div key={setup.id} className="flex items-center gap-4 py-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-950">{setup.name}</h3><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">{setup.serviceType}</span></div><p className="mt-1 text-sm text-slate-600">{setup.arrangement || setup.resourceId} · capacity {setup.capacity}{setup.addOnIds?.length ? ` · ${setup.addOnIds.length} add-on${setup.addOnIds.length === 1 ? "" : "s"}` : ""}</p></div><button type="button" disabled={saving} onClick={() => void toggleSetup(setup)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-300 px-4 text-sm font-medium text-slate-700">{setup.published ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}{setup.published ? "Live" : "Hidden"}</button></div>)}
              {catalog.setups.length === 0 ? <p className="py-6 text-sm text-slate-500">No customer setup has been published yet.</p> : null}
            </div>

            <form onSubmit={submitSetup} className="mt-8 space-y-5 border-t border-slate-200 pt-7">
              <h2 className="text-lg font-semibold text-slate-950">Publish a visual layout as a customer setup</h2>
              <label className="block text-sm font-medium text-slate-700">Published layout<select value={layoutPath} onChange={(event) => chooseLayout(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="">Choose a layout</option>{catalog.publishedLayouts.map((layout) => <option key={layout.layoutPath} value={layout.layoutPath}>{layout.name} · {layout.locationId}/{layout.floorId}</option>)}</select></label>
              <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium text-slate-700">Service<select value={serviceType} onChange={(event) => setServiceType(event.target.value as "DESK" | "CONFERENCE")} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="CONFERENCE">Conference room</option><option value="DESK">Desk</option></select></label><label className="block text-sm font-medium text-slate-700">Resource<select value={resourceId} onChange={(event) => setResourceId(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3">{(selectedLayout?.resourceIds || []).map((id) => <option key={id} value={id}>{id}</option>)}</select></label></div>
              <div className="grid gap-4 sm:grid-cols-[1fr_140px]"><label className="block text-sm font-medium text-slate-700">Customer-facing name<input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3" /></label><label className="block text-sm font-medium text-slate-700">Capacity<input type="number" min={1} max={100} value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3" /></label></div>
              <label className="block text-sm font-medium text-slate-700">Arrangement label<input value={arrangement} onChange={(event) => setArrangement(event.target.value)} placeholder="Boardroom, classroom, interview..." className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3" /></label>
              <label className="block text-sm font-medium text-slate-700">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2" /></label>
              {catalog.addOns.length ? <fieldset><legend className="text-sm font-medium text-slate-700">Available add-ons</legend><div className="mt-2 flex flex-wrap gap-2">{catalog.addOns.map((addOn) => <label key={addOn.id} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-slate-300 px-3 text-sm"><input type="checkbox" checked={selectedAddOns.includes(addOn.id)} onChange={(event) => setSelectedAddOns((current) => event.target.checked ? [...current, addOn.id] : current.filter((id) => id !== addOn.id))} />{addOn.name}</label>)}</div></fieldset> : null}
              <button type="submit" disabled={saving || !layoutPath || !resourceId} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Publish setup</button>
            </form>
          </section>

          <section>
            <div className="flex items-center gap-2"><Plus className="h-5 w-5 text-slate-500" /><h2 className="text-xl font-semibold text-slate-950">Upsell add-ons</h2></div>
            <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">{catalog.addOns.map((addOn) => <div key={addOn.id} className="py-4"><div className="flex items-center justify-between gap-3"><span className="font-semibold text-slate-950">{addOn.name}</span><span className="text-sm text-slate-600">${(addOn.priceCents / 100).toFixed(2)}</span></div><p className="mt-1 text-xs text-slate-500">{addOn.serviceTypes.join(" · ")}{addOn.stripePriceId ? " · Stripe linked" : ""}</p></div>)}</div>
            <form onSubmit={submitAddOn} className="mt-7 space-y-4"><label className="block text-sm font-medium text-slate-700">Add-on name<input value={addOnName} onChange={(event) => setAddOnName(event.target.value)} placeholder="Video conferencing" className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3" /></label><label className="block text-sm font-medium text-slate-700">Price<input type="number" min={0} step="0.01" value={addOnPrice} onChange={(event) => setAddOnPrice(Number(event.target.value))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3" /></label><button type="submit" disabled={saving || !addOnName.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-950 px-5 text-sm font-semibold text-slate-950 disabled:opacity-50"><Plus className="h-4 w-4" /> Add option</button></form>
          </section>
        </div> : null}
      </main>
    </AppShell>
  );
}
