"use client";

import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import {
  addOnPriceLabel,
  setupForResource,
  type PublishedCatalog,
} from "@/lib/publishedSetups";

const getPublishedCatalog = httpsCallable<Record<string, never>, PublishedCatalog>(
  functions,
  "space_getPublishedCatalog",
);

let catalogRequest: Promise<PublishedCatalog | null> | null = null;

function loadCatalog() {
  if (!catalogRequest) {
    catalogRequest = getPublishedCatalog({})
      .then((result) => result.data)
      .catch((error) => {
        // The setup card is extra detail; booking works without it.
        console.warn("Published setups could not be loaded", error);
        catalogRequest = null;
        return null;
      });
  }
  return catalogRequest;
}

/**
 * Shows how the space is set up for this booking, from the admin
 * "Published setups" catalog. Renders nothing when no setup is published.
 * Add-ons are arranged with the front desk; they are not charged online.
 */
export function PublishedSetupDetails({
  resourceId,
  serviceType,
}: {
  resourceId?: string;
  serviceType: "DESK" | "CONFERENCE";
}) {
  const [catalog, setCatalog] = useState<PublishedCatalog | null>(null);

  useEffect(() => {
    if (!resourceId) return;
    let active = true;
    void loadCatalog().then((next) => {
      if (active) setCatalog(next);
    });
    return () => {
      active = false;
    };
  }, [resourceId]);

  const match = setupForResource(catalog, resourceId, serviceType);
  if (!match) return null;
  const { setup, addOns } = match;

  return (
    <section aria-labelledby={`setup-${setup.id}`} className="mt-6 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <h3 id={`setup-${setup.id}`} className="font-semibold text-slate-950">How it&apos;s set up</h3>
      <p className="mt-1 text-sm text-slate-700">
        {setup.name}
        {setup.arrangement ? ` · ${setup.arrangement}` : ""}
        {` · seats up to ${setup.capacity}`}
      </p>
      {setup.description ? <p className="mt-2 text-sm text-slate-600">{setup.description}</p> : null}
      {addOns.length > 0 ? (
        <div className="mt-3">
          <p className="text-sm font-medium text-slate-900">Available add-ons</p>
          <ul className="mt-1 space-y-1 text-sm text-slate-600">
            {addOns.map((addOn) => (
              <li key={addOn.id}>
                {addOn.name} · {addOnPriceLabel(addOn.priceCents)}
                {addOn.description ? ` · ${addOn.description}` : ""}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Ask the front desk to arrange add-ons. They aren&apos;t charged in this checkout.</p>
        </div>
      ) : null}
    </section>
  );
}
