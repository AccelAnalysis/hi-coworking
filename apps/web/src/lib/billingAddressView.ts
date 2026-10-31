/**
 * Billing address readback for SayHi. The server copies the address entered
 * at Stripe Checkout into accountDetails/{uid}.billingAddress (only when the
 * SayHi billing switch is on). Pure helpers so they can be unit tested.
 */
export type BillingAddress = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function readBillingAddress(value: unknown): BillingAddress | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const address: BillingAddress = {
    line1: text(raw.line1),
    line2: text(raw.line2),
    city: text(raw.city),
    state: text(raw.state),
    postalCode: text(raw.postalCode),
    country: text(raw.country).toUpperCase(),
  };
  return address.line1 || address.postalCode ? address : null;
}

/** Display lines, US style. The country is shown only when it isn't the US. */
export function billingAddressLines(address: BillingAddress): string[] {
  const cityLine = [address.city, [address.state, address.postalCode].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [address.line1, address.line2, cityLine, address.country && address.country !== "US" ? address.country : ""]
    .filter(Boolean);
}
