import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_OVERVIEW_HREF,
  ADMIN_OVERVIEW_LABEL,
  ADMIN_ROUTES,
  adminBreadcrumbTrail,
  showsAdminBackNavigation,
} from "../../apps/web/src/lib/adminNavigation";

const ADMIN_DIR = "apps/web/src/app/admin";

function adminPages(dir = ADMIN_DIR): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return adminPages(full);
    return entry === "page.tsx" ? [full] : [];
  });
}

function routeOf(file: string) {
  return "/admin/" + relative(ADMIN_DIR, file).replace(/\/?page\.tsx$/, "");
}

const pages = adminPages();
const routes = pages.map(routeOf).filter((route) => route !== ADMIN_OVERVIEW_HREF);

describe("Admin back navigation", () => {
  it("covers every Admin screen except the Operations overview", () => {
    expect(routes.length).toBeGreaterThan(15);
    for (const route of routes) {
      expect(ADMIN_ROUTES[route], `${route} needs a label in adminNavigation.ts`).toBeDefined();
      expect(showsAdminBackNavigation(route)).toBe(true);
      const trail = adminBreadcrumbTrail(route);
      expect(trail[0]).toEqual({ href: ADMIN_OVERVIEW_HREF, label: ADMIN_OVERVIEW_LABEL, current: false });
      expect(trail.at(-1)).toMatchObject({ href: route, current: true });
    }
  });

  it("is not shown on the overview itself or outside Admin", () => {
    for (const path of ["/admin/dashboard", "/admin/dashboard/", "/admin", "/", "/my-hi", "/bookstore", null]) {
      expect(showsAdminBackNavigation(path)).toBe(false);
      expect(adminBreadcrumbTrail(path)).toEqual([]);
    }
  });

  it("builds parent trails and tolerates trailing slashes and .html exports", () => {
    expect(adminBreadcrumbTrail("/admin/bookstore/inventory/").map((c) => c.label)).toEqual([
      "Operations overview",
      "Bookstore",
      "Inventory",
    ]);
    expect(adminBreadcrumbTrail("/admin/events/series.html").map((c) => c.href)).toEqual([
      "/admin/dashboard",
      "/admin/events",
      "/admin/events/series",
    ]);
    expect(adminBreadcrumbTrail("/admin/something-new")).toEqual([
      { href: "/admin/dashboard", label: "Operations overview", current: false },
    ]);
  });

  it("is rendered once by the shared shell that every Admin screen uses", () => {
    const shell = readFileSync("apps/web/src/components/AppShell.tsx", "utf8");
    expect(shell).toContain("<AdminBackNavigation pathname={pathname} />");
    for (const page of pages) {
      const source = readFileSync(page, "utf8");
      expect(source, `${page} must render inside AppShell`).toContain("<AppShell");
      if (routeOf(page) === ADMIN_OVERVIEW_HREF) continue;
      expect(source, `${page} should rely on the shared back link`).not.toMatch(/>\s*(<ArrowLeft[^>]*\/>\s*)?Operations overview\s*</);
    }
  });

  it("meets the 44 px target, visible focus and labelling requirements", () => {
    const component = readFileSync("apps/web/src/components/AdminBackNavigation.tsx", "utf8");
    expect(component).toContain('aria-label="Admin"');
    expect(component).toContain("aria-label={`Back to ${overview.label}`}");
    expect(component).toContain('aria-current="page"');
    expect(component).toContain("min-h-11 min-w-11");
    expect(component).toContain("focus-visible:ring-2");
    expect(component).toContain('aria-hidden="true"');
  });
});
