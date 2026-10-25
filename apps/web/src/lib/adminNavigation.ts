// Back navigation for every Admin screen.
//
// AppShell renders the trail on every /admin/** route except the Operations
// overview itself, so each Admin tool has the same way back. Keep labels in
// step with the tiles on /admin/dashboard.

export const ADMIN_OVERVIEW_HREF = "/admin/dashboard";
export const ADMIN_OVERVIEW_LABEL = "Operations overview";

type AdminRoute = { label: string; parent?: string };

export const ADMIN_ROUTES: Record<string, AdminRoute> = {
  "/admin/members": { label: "Members" },
  "/admin/members/actions": { label: "Booking operations", parent: "/admin/members" },
  "/admin/spaces": { label: "Hours & closures" },
  "/admin/spaces/catalog": { label: "Published setups" },
  "/admin/builder": { label: "Visual designer" },
  "/admin/access": { label: "Door access" },
  "/admin/nurture": { label: "Nurture" },
  "/admin/events": { label: "Events" },
  "/admin/events/new": { label: "Event editor", parent: "/admin/events" },
  "/admin/events/series": { label: "Recurring series", parent: "/admin/events" },
  "/admin/events/submissions": { label: "Submissions", parent: "/admin/events" },
  "/admin/events/campaigns": { label: "Campaigns", parent: "/admin/events" },
  "/admin/events/social": { label: "Social", parent: "/admin/events" },
  "/admin/bookstore": { label: "Bookstore" },
  "/admin/bookstore/new": { label: "Title editor", parent: "/admin/bookstore" },
  "/admin/bookstore/inventory": { label: "Inventory", parent: "/admin/bookstore" },
  "/admin/bookstore/orders": { label: "Orders", parent: "/admin/bookstore" },
  "/admin/payments": { label: "Payments" },
  "/admin/leads": { label: "Leads" },
  "/admin/products": { label: "Pricing & memberships" },
  "/admin/roles": { label: "Roles & permissions" },
};

export type AdminCrumb = { href: string; label: string; current: boolean };

export function normalizeAdminPath(pathname: string | null | undefined): string {
  const path = String(pathname || "").split(/[?#]/)[0].replace(/\/index(\.html)?$/, "").replace(/\.html$/, "");
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** True on every Admin screen that needs a way back to the overview. */
export function showsAdminBackNavigation(pathname: string | null | undefined): boolean {
  const path = normalizeAdminPath(pathname);
  if (!path.startsWith("/admin/")) return false;
  return path !== ADMIN_OVERVIEW_HREF;
}

/**
 * The trail from the Operations overview to the current screen. The first
 * crumb is always the overview. Unknown Admin paths still get the overview
 * link, so no Admin screen is left without a way back.
 */
export function adminBreadcrumbTrail(pathname: string | null | undefined): AdminCrumb[] {
  if (!showsAdminBackNavigation(pathname)) return [];
  const path = normalizeAdminPath(pathname);
  const chain: AdminCrumb[] = [];
  let cursor: string | undefined = path;
  const seen = new Set<string>();
  while (cursor && ADMIN_ROUTES[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    chain.unshift({ href: cursor, label: ADMIN_ROUTES[cursor].label, current: cursor === path });
    cursor = ADMIN_ROUTES[cursor].parent;
  }
  return [{ href: ADMIN_OVERVIEW_HREF, label: ADMIN_OVERVIEW_LABEL, current: false }, ...chain];
}
