"use client";

import { useEffect } from "react";

export function QuarantinedPublicRoute({ href }: { href: string }) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-6">
      <div className="max-w-sm text-center">
        <p className="text-sm font-semibold text-slate-900">Hi Coworking</p>
        <p className="mt-2 text-sm text-slate-600">This page is no longer available.</p>
        <a
          href={href}
          className="mt-4 inline-flex text-sm font-semibold text-slate-900 underline underline-offset-4"
        >
          Continue to Hi Coworking
        </a>
      </div>
    </main>
  );
}
