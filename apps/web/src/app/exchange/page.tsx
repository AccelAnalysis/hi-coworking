"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { ExchangeWorkspace } from "@/features/exchange/components/ExchangeWorkspace";
import { isExchangeDemoMode } from "@/features/exchange/demo/exchangeDemoMode";
import { useAuth } from "@/lib/authContext";
import {
  exchangeGetBusinessActivationStateFn,
  exchangeRecordBusinessActivationProgressFn,
} from "@/lib/functions";

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
  return isExchangeDemoMode()
    ? workspace
    : <RequireAuth><ExchangeActivationGate>{workspace}</ExchangeActivationGate></RequireAuth>;
}

function ExchangeActivationGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  useEffect(() => {
    if (loading || !user) return;
    let active = true;
    void exchangeGetBusinessActivationStateFn({})
      .then((response) => {
        if (!active) return;
        const connected = response.data.completedSteps.includes("organization_connected");
        const activationReady = response.data.currentStep === "map_activation"
          || response.data.currentStep === "completed";
        if (connected && (!response.data.guidedActivationRequired || activationReady)) {
          setAuthorized(true);
          const params = new URLSearchParams(window.location.search);
          const establishmentId = params.get("secondarySelected");
          if (
            response.data.organizationId
            && params.get("secondaryEntity") === "establishment"
            && establishmentId
            && Number(params.get("z")) >= 16
            && Number(params.get("p")) > 0
          ) {
            void exchangeRecordBusinessActivationProgressFn({
              action: "map_activated",
              organizationId: response.data.organizationId,
              establishmentId,
            });
          }
        } else {
          router.replace(response.data.safeResumeRoute);
        }
      })
      .catch(() => router.replace("/exchange/onboarding"));
    return () => {
      active = false;
    };
  }, [loading, router, user]);
  return authorized ? children : <ExchangeRouteFallback />;
}
