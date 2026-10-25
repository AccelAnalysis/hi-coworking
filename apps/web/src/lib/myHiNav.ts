/**
 * My Hi is the signed-in member's home: membership, billing, bookings and
 * account credit. Every entry point (site navigation, Stripe Checkout
 * success_url, the billing portal return_url and the welcome email) lands on
 * MY_HI_HREF. The older /account/bookings route renders the same page and
 * stays available for existing links.
 */
export const MY_HI_HREF = "/my-hi";
export const MY_HI_LABEL = "My Hi";
/** Anchor of the bookings section inside My Hi. */
export const MY_HI_BOOKINGS_ID = "bookings";
export const LEGACY_BOOKINGS_HREF = "/account/bookings";

/** True when the current path is My Hi (or its legacy bookings alias). */
export function isMyHiPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === MY_HI_HREF || path === LEGACY_BOOKINGS_HREF;
}
