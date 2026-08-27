"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const MEMBER_PREFIXES = [
  "/dashboard",
  "/profile",
  "/rfx",
  "/directory",
  "/referrals",
  "/org",
];

const PUBLIC_PREFIXES = ["/platform", "/exchange"];
const ADMIN_PREFIXES = [
  "/admin/rfx",
  "/admin/territories",
  "/admin/verification",
  "/admin/orgs",
  "/admin/analytics",
];

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function destinationFor(pathname: string): string | null {
  if (ADMIN_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return "/admin/dashboard";
  }

  if (PUBLIC_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return "/";
  }

  if (MEMBER_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))) {
    return "/my-hi";
  }

  return null;
}

export function SoftHideRfxchange() {
  const pathname = usePathname();
  const router = useRouter();
  const destination = destinationFor(pathname);

  useEffect(() => {
    if (destination) router.replace(destination);
  }, [destination, router]);

  return (
    <style jsx global>{`
      a[href="/profile"],
      a[href="/platform"],
      a[href="/exchange"],
      a[href^="/exchange/"],
      a[href="/rfx"],
      a[href^="/rfx/"],
      a[href="/directory"],
      a[href^="/directory/"],
      a[href="/referrals"],
      a[href^="/referrals/"],
      a[href="/org"],
      a[href^="/org/"],
      a[href="/admin/rfx"],
      a[href^="/admin/rfx/"],
      a[href="/admin/territories"],
      a[href^="/admin/territories/"],
      a[href="/admin/verification"],
      a[href^="/admin/verification/"],
      a[href="/admin/orgs"],
      a[href^="/admin/orgs/"],
      a[href="/admin/analytics"],
      a[href^="/admin/analytics/"] {
        display: none !important;
      }

      article:has(a[href="/rfx"]),
      .mb-8:has(a[href^="/rfx/"]) {
        display: none !important;
      }
    `}</style>
  );
}
