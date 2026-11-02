"use client";

import { billingAddressLines, type BillingAddress } from "@/lib/billingAddressView";

/**
 * SayHi: the billing address from the customer's last checkout, read back so
 * they can confirm it. Hidden when there's no address on file.
 */
export function BillingAddressCard({ address, canManageBilling }: { address: BillingAddress | null; canManageBilling: boolean }) {
  if (!address) return null;
  return (
    <section
      aria-labelledby="sayhi-billing-address-title"
      className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
      data-testid="sayhi-billing-address"
    >
      <h2 id="sayhi-billing-address-title" className="font-semibold text-[#101D4B]">
        Billing address
      </h2>
      <address className="mt-2 text-sm not-italic leading-6 text-slate-700">
        {billingAddressLines(address).map((line) => (
          <span key={line} className="block">{line}</span>
        ))}
      </address>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {canManageBilling
          ? "From your last checkout. To change it, use Manage membership and billing."
          : "From your last checkout. Need it changed? Contact us and we'll update it."}
      </p>
    </section>
  );
}
