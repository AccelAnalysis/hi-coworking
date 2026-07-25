"use client";

import { type ReactNode, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, MapPin, Sparkles, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { ExchangeWorkspace } from "@/features/exchange/components/ExchangeWorkspace";
import { isExchangeDemoMode } from "@/features/exchange/demo/exchangeDemoMode";
import { useAuth } from "@/lib/authContext";
import { functions } from "@/lib/firebase";
import { exchangeGetBusinessActivationStateFn } from "@/lib/functions";

const recordActivationProgress = httpsCallable<Record<string, unknown>, { success: true }>(
  functions,
  "exchange_recordBusinessActivationProgress",
);

function ExchangeRouteFallback() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-slate-100 px-6 text-center" role="status" aria-live="polite">
      <div><div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-[#D6A23A] motion-reduce:animate-none" /><p className="mt-3 text-sm font-semibold text-slate-700">Preparing The RFxchange…</p></div>
    </div>
  );
}

export default function ExchangePage() {
  const workspace = (
    <AppShell variant="workspace">
      <Suspense fallback={<ExchangeRouteFallback />}>
        <ExchangeWorkspace />
        <OnboardingSuccess />
      </Suspense>
    </AppShell>
  );
  return isExchangeDemoMode()
    ? workspace
    : <RequireAuth><ExchangeActivationGate>{workspace}</ExchangeActivationGate></RequireAuth>;
}

function ExchangeActivationGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (loading || !user) return;
    let active = true;
    void exchangeGetBusinessActivationStateFn({})
      .then((response) => {
        if (!active) return;
        const params = new URLSearchParams(window.location.search);
        const connected = response.data.completedSteps.includes("organization_connected");
        const activationReady = response.data.currentStep === "map_activation" || response.data.currentStep === "completed";
        const pendingClaimPreview = params.get("claimPreview") === "1"
          && response.data.currentStep === "organization_claim_pending";
        const activationGateSatisfied = !response.data.guidedActivationRequired
          || (connected && activationReady)
          || pendingClaimPreview;

        if (!activationGateSatisfied) {
          router.replace(response.data.safeResumeRoute);
          return;
        }

        setAuthorized(true);
        const establishmentId = params.get("secondarySelected");
        if (
          response.data.organizationId
          && params.get("secondaryEntity") === "establishment"
          && establishmentId
          && Number(params.get("z")) >= 16
          && Number(params.get("p")) > 0
          && !response.data.completedSteps.includes("map_activation")
        ) {
          void recordActivationProgress({
            action: "map_activated",
            organizationId: response.data.organizationId,
            establishmentId,
          });
        }
      })
      .catch(() => router.replace("/exchange/onboarding"));
    return () => { active = false; };
  }, [loading, router, user]);

  return authorized ? children : <ExchangeRouteFallback />;
}

function OnboardingSuccess() {
  const params = useSearchParams();
  const router = useRouter();
  const visible = params.get("onboardingSuccess") === "1";
  const organizationId = params.get("actorOrg") || params.get("subjectOrg") || "";

  if (!visible || !organizationId) return null;

  const dismiss = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("onboardingSuccess");
    router.replace(`/exchange?${next.toString()}`, { scroll: false });
  };

  const recordOffer = (action: "enrichment_offered" | "founding_membership_offered") => {
    void recordActivationProgress({ action, organizationId }).catch(() => undefined);
  };

  return (
    <aside className="pointer-events-none fixed inset-x-3 bottom-20 z-[80] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[440px]" aria-live="polite">
      <div className="pointer-events-auto overflow-hidden rounded-3xl border border-white/20 bg-[#0B0B0D]/95 text-white shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div className="relative p-6 sm:p-7">
          <button onClick={dismiss} aria-label="Dismiss success message" className="absolute right-4 top-4 rounded-full p-2 text-white/60 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
          <div className="flex items-center gap-3"><span className="relative grid h-12 w-12 place-items-center rounded-2xl bg-[#D6A23A] text-black"><span className="absolute inset-0 animate-ping rounded-2xl bg-[#D6A23A]/40 motion-reduce:hidden" /><MapPin className="relative h-6 w-6" /></span><span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Marker active</span></div>
          <h1 className="mt-5 pr-8 text-2xl font-black tracking-tight sm:text-3xl">Your business is now on The RFxchange.</h1>
          <p className="mt-3 text-sm leading-6 text-white/70">Your first value moment is complete. Explore now, enrich your business profile, or become a Founding Member.</p>
          <div className="mt-6 grid gap-3">
            <Link onClick={() => recordOffer("enrichment_offered")} href={`/org/settings?id=${encodeURIComponent(organizationId)}&tab=enrichment&onboarding=complete`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#D6A23A] px-4 py-2.5 text-sm font-black text-black hover:bg-[#e2b553]"><Sparkles className="h-4 w-4" /> Enrich &amp; Complete Profile</Link>
            <div className="grid gap-3 sm:grid-cols-2">
              <button onClick={dismiss} className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/20 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/10">Explore the Exchange</button>
              <Link onClick={() => recordOffer("founding_membership_offered")} href={`/exchange/founding?organizationId=${encodeURIComponent(organizationId)}`} className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#D6A23A]/60 px-4 py-2.5 text-sm font-bold text-[#E7C56F] hover:bg-[#D6A23A]/10 hover:text-white">Founding Membership</Link>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
