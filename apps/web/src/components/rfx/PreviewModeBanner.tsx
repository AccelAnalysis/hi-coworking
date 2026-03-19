"use client";

import Link from "next/link";
import { AlertTriangle, ShieldCheck } from "lucide-react";

interface PreviewModeBannerProps {
  visible: boolean;
  reasons: string[];
}

const reasonLabels: Record<string, string> = {
  territory_not_released: "your territory has not been released",
  company_not_verified: "your company verification is pending",
  role_not_permitted: "your account role does not allow transactions yet",
};

export function PreviewModeBanner({ visible, reasons }: PreviewModeBannerProps) {
  if (!visible) return null;

  const humanReasons = reasons
    .map((r) => reasonLabels[r])
    .filter(Boolean)
    .slice(0, 2)
    .join(" and ");

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="flex-1">
          <p className="font-medium">
            Marketplace is currently in preview mode. Transactions unlock when your territory is released and your account is verified.
          </p>
          {humanReasons ? (
            <p className="mt-1 text-amber-800/90">
              Currently limited because {humanReasons}.
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-3">
            <Link href="/profile" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-800 underline-offset-2 hover:underline">
              <ShieldCheck className="h-3.5 w-3.5" />
              Complete verification
            </Link>
            <Link href="/rfx/new" className="text-xs font-semibold text-amber-800 underline-offset-2 hover:underline">
              View transaction requirements
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
