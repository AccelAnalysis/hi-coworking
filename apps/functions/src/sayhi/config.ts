/**
 * Virtual address (VA) switch. Built but OFF until USPS CMRA registration
 * and staffing are in place (SayHi build plan steps 4-5). Anything other than
 * exactly "true" keeps every VA path closed: no Stripe add-on, no Form 1583
 * flow, no paperwork follow-ups.
 *
 * Read from the environment (the codebase .env file) rather than declared as
 * a Firebase param, so the pinned isolated deploy bundles (core,
 * front-desk-kiosk) declare no new params and a deploy never prompts. Unset
 * means off. apps/functions/.env.* set it to false explicitly.
 */
export const VIRTUAL_ADDRESS_ENABLED_PARAM = "VIRTUAL_ADDRESS_ENABLED";
export const VIRTUAL_ADDRESS_PRICE_PARAM = "VIRTUAL_ADDRESS_STRIPE_PRICE_ID";

export function isFlagOn(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

export function virtualAddressEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return isFlagOn(env[VIRTUAL_ADDRESS_ENABLED_PARAM]);
}

export function virtualAddressPriceId(env: Record<string, string | undefined> = process.env): string {
  const value = (env[VIRTUAL_ADDRESS_PRICE_PARAM] ?? "").trim();
  return /^price_[A-Za-z0-9]{6,}$/.test(value) ? value : "";
}

/**
 * Stripe Checkout extras for a membership checkout. With VA off (default) or
 * no price configured, returns nothing, so the session is unchanged apart
 * from billing address collection. With VA on, a customer who picked it on
 * Plans and pricing gets it as a line item; anyone else is offered it as an
 * optional item inside Checkout.
 */
export function membershipCheckoutExtras(input: {
  enabled: boolean;
  priceId: string;
  chosen: boolean;
}): { lineItems: Array<{ price: string; quantity: number }>; optionalItems: Array<{ price: string; quantity: number }> } {
  if (!input.enabled || !input.priceId) return { lineItems: [], optionalItems: [] };
  const item = { price: input.priceId, quantity: 1 };
  return input.chosen ? { lineItems: [item], optionalItems: [] } : { lineItems: [], optionalItems: [item] };
}
