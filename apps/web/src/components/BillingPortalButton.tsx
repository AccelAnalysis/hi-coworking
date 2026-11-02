"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { ExternalLink, Loader2 } from "lucide-react";
import { functions } from "@/lib/firebase";
import { BILLING_PORTAL_ERROR } from "@/lib/membershipCopy";

const createBillingPortalSession = httpsCallable<
  Record<string, never>,
  { url: string }
>(functions, "members_createBillingPortalSession");

/**
 * Opens the Stripe Customer Portal for the signed-in member. The server
 * creates a short-lived session for the member's own Stripe customer and
 * returns its URL; we never build or store portal links on the client.
 */
export function BillingPortalButton() {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      const result = await createBillingPortalSession({});
      const url = result.data?.url;
      if (typeof url !== "string" || !url.startsWith("https://")) {
        throw new Error("Billing portal returned no URL.");
      }
      window.location.assign(url);
    } catch (caught) {
      console.error(caught);
      setError(BILLING_PORTAL_ERROR);
      setOpening(false);
    }
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={open}
        disabled={opening}
        aria-busy={opening}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-[#101D4B] transition hover:bg-[#EEF0F6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-70"
      >
        {opening ? (
          <>
            <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
            Opening billing…
          </>
        ) : (
          <>
            Manage membership and billing
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
          </>
        )}
      </button>
      <p className="mt-2 text-xs leading-5 text-[#C5CADB]">
        Update your payment method, view invoices, change your plan, or cancel.
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-sm leading-6 text-rose-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
