"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { adminBreadcrumbTrail } from "@/lib/adminNavigation";

const linkClass =
  "inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2";

/**
 * Shared Admin back navigation. One bar, directly under the site header, on
 * every /admin/** screen except the Operations overview. Targets are at
 * least 44 by 44 px and show a visible focus ring (WCAG 2.2 AA 2.4.7, 2.5.8;
 * Apple HIG hit targets).
 */
export function AdminBackNavigation({ pathname }: { pathname: string | null }) {
  const trail = adminBreadcrumbTrail(pathname);
  if (trail.length === 0) return null;
  const [overview, ...rest] = trail;
  return (
    <div className="border-b border-slate-200 bg-white" data-testid="admin-back-navigation">
      <nav aria-label="Admin" className="mx-auto w-full max-w-7xl px-4 py-1">
        <ol className="flex flex-wrap items-center gap-x-1">
          <li>
            <Link href={overview.href} className={linkClass} aria-label={`Back to ${overview.label}`}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              <span>{overview.label}</span>
            </Link>
          </li>
          {rest.map((crumb) => (
            <li key={crumb.href} className="flex items-center gap-x-1">
              <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
              {crumb.current ? (
                <span aria-current="page" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-slate-950">
                  {crumb.label}
                </span>
              ) : (
                <Link href={crumb.href} className={linkClass}>
                  {crumb.label}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
