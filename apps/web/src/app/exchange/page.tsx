"use client";

import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { ExchangeWorkspace } from "@/features/exchange/components/ExchangeWorkspace";
import { isExchangeDemoMode } from "@/features/exchange/demo/exchangeDemoMode";

function ExchangeRouteFallback() {
  return (
    <div
      className="flex h-full min-h-0 items-center justify-center bg-slate-100 px-6 text-center"
      role="status"
      aria-live="polite"
    >
      <div>
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600 motion-reduce:animate-none" />
        <p className="mt-3 text-sm font-semibold text-slate-700">Preparing Hi Exchange…</p>
      </div>
    </div>
  );
}

export default function ExchangePage() {
  const workspace = (
    <AppShell variant="workspace">
      <Suspense fallback={<ExchangeRouteFallback />}>
        <ExchangeWorkspace />
      </Suspense>
    </AppShell>
  );
  return isExchangeDemoMode() ? workspace : <RequireAuth>{workspace}</RequireAuth>;
}
