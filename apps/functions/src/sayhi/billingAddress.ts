/**
 * Billing address readback (SayHi step 6). Stripe Checkout collects the
 * address; the webhook copies it into accountDetails/{uid}.billingAddress so
 * the member can confirm it on SayHi. Pure helpers, unit tested.
 */

/** Same collection as sayhi/functions.ts ACCOUNT_DETAILS_COLLECTION. */
export const BILLING_ACCOUNT_DETAILS_COLLECTION = "accountDetails";

export type BillingAddress = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

type StripeAddressLike = {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
} | null | undefined;

const clean = (value: unknown, max = 200) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

export function billingAddressFromStripe(address: StripeAddressLike): BillingAddress | null {
  if (!address) return null;
  const result: BillingAddress = {
    line1: clean(address.line1),
    line2: clean(address.line2),
    city: clean(address.city, 100),
    state: clean(address.state, 100),
    postalCode: clean(address.postal_code, 20),
    country: clean(address.country, 2).toUpperCase(),
  };
  return result.line1 || result.postalCode ? result : null;
}

/** Flattened for WebhookResult.metadata (string values only). */
export function billingAddressMetadata(address: BillingAddress | null): Record<string, string> {
  if (!address) return {};
  return { billingAddress: JSON.stringify(address) };
}

export function billingAddressFromMetadata(metadata: Record<string, string> | undefined): BillingAddress | null {
  const raw = metadata?.billingAddress;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return billingAddressFromStripe({
      line1: parsed.line1 as string,
      line2: parsed.line2 as string,
      city: parsed.city as string,
      state: parsed.state as string,
      postal_code: parsed.postalCode as string,
      country: parsed.country as string,
    });
  } catch {
    return null;
  }
}
