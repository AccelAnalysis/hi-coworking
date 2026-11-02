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

function escapeFooter(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Nurture footer: one-click unsubscribe, the preferences page, and the
 * postal address (CAN-SPAM).
 */
export function nurtureFooter(links: { unsubscribeUrl: string; preferencesUrl: string }) {
  const html = `<p style="margin-top:36px;padding-top:20px;border-top:1px solid #e2e8f0;font-size:11px;line-height:1.6;color:#64748b">You are receiving this because you contacted, booked, or hold an account with Hi Coworking. <a href="${escapeFooter(links.unsubscribeUrl)}" style="color:#475569">Unsubscribe</a> &middot; <a href="${escapeFooter(links.preferencesUrl)}" style="color:#475569">Manage preferences</a><br>${escapeFooter(NURTURE_POSTAL_ADDRESS)}</p>`;
  const text = `Unsubscribe: ${links.unsubscribeUrl}\nManage preferences: ${links.preferencesUrl}\n${NURTURE_POSTAL_ADDRESS}`;
  return { html, text };
}
