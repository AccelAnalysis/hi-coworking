/** Pure link and footer helpers for nurture emails (no Firebase imports). */

// CAN-SPAM: every commercial email carries a valid postal address.
export const NURTURE_POSTAL_ADDRESS = "Hi Coworking · 15373 Carrollton Blvd, Carrollton, VA 23314";

/**
 * Campaign documents are seeded once into Firestore, so links saved before the
 * site moved still point at retired routes. Resolve them at send time.
 */
export const NURTURE_ROUTE_ALIASES: Record<string, string> = {
  "/visit": "/contact",
  "/membership": "/pricing",
  "/dashboard": "/my-hi",
  "/dashboard/membership": "/my-hi",
};

export function campaignHref(siteOrigin: string, value?: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return undefined;
  const [path, ...rest] = value.split(/(?=[?#])/);
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return `${siteOrigin}${NURTURE_ROUTE_ALIASES[normalized] ?? normalized}${rest.join("")}`;
}
