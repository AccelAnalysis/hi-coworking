"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ToggleLeft } from "lucide-react";
import {
  OFFERABLE_RESOURCES,
  isResourceOffered,
  type ResourceOfferingMap,
} from "@hi/shared";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { getResourceOffering, setResourceOffered } from "@/lib/firestore";

export default function OfferedSpacesPage() {
  return (
    <RequireAuth requiredRole="admin">
      <OfferedSpacesContent />
    </RequireAuth>
  );
}

function OfferedSpacesContent() {
  const { user } = useAuth();
  const [offered, setOffered] = useState<ResourceOfferingMap>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOffered(await getResourceOffering());
    } catch (caught) {
      console.error(caught);
      setError("The offered-spaces list could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(resourceId: string, next: boolean) {
    setSavingId(resourceId);
    setError(null);
    const previous = offered;
    setOffered((current) => ({ ...current, [resourceId]: next }));
    try {
      await setResourceOffered(resourceId, next, user?.uid);
    } catch (caught) {
      console.error(caught);
      setOffered(previous);
      setError("That space could not be updated. Please try again.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">Bookings & spaces</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Offered spaces</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Turn a desk, the private office, or the conference room off when it should not be sold. Spaces that are off disappear from the floor plan, pricing, and quotes until you turn them back on. Existing bookings can still be managed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </header>

        {error ? (
          <div className="mt-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
          </div>
        ) : (
          <section className="mt-9">
            <div className="flex items-center gap-2">
              <ToggleLeft className="h-5 w-5 text-slate-500" />
              <h2 className="text-xl font-semibold text-slate-950">Customer booking</h2>
            </div>
            <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200">
              {OFFERABLE_RESOURCES.map((resource) => {
                const on = isResourceOffered(resource.id, offered);
                const busy = savingId === resource.id;
                return (
                  <div key={resource.id} className="flex items-center gap-4 py-4" data-testid={`offered-space-${resource.id}`}>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-slate-950">{resource.name}</h3>
                      <p className="mt-1 text-sm text-slate-600">{resource.description}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-semibold ${on ? "text-emerald-800" : "text-slate-500"}`}>
                        {on ? "Offered" : "Off"}
                      </span>
                      <button
                        id={`offered-${resource.id}`}
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`${resource.name} offered`}
                        disabled={busy}
                        onClick={() => void toggle(resource.id, !on)}
                        className={`relative inline-flex h-7 min-h-11 w-12 min-w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#101D4B] focus-visible:ring-offset-2 disabled:opacity-50 ${
                          on ? "bg-[#101D4B]" : "bg-slate-300"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`}
                        />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-sm text-slate-500">
              The Private Office stays off until you turn it on here. Other spaces stay on unless you switch them off.
            </p>
          </section>
        )}
      </main>
    </AppShell>
  );
}
