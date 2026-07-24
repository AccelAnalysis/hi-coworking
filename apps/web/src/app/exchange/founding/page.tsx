"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { httpsCallable } from "firebase/functions";
import { ArrowLeft, Check, Crown, Loader2, MapPin, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { functions } from "@/lib/firebase";
import {
  createExchangeMembershipCheckoutFn,
  getExchangePublicCommercialPolicyFn,
  type ExchangePublicCommercialConfiguration,
} from "@/lib/functions";

const getActivationState = httpsCallable<
  { organizationId?: string },
  {
    organizationId: string | null;
    organizationName: string | null;
    foundingMembershipHandoff: null | {
      organizationId: string;
      eligible: boolean;
      onboardingCompleted: boolean;
      membershipStatus: string;
      membershipTier: string;
      isFoundingMember: boolean;
      founderReservation: null | { status: string };
      selectedGeography: null | { name: string; state: string; status: string };
    };
  }
>(functions, "exchange_getBusinessActivationState");
const recordProgress = httpsCallable<Record<string, unknown>, { success: true }>(functions, "exchange_recordBusinessActivationProgress");

type ActivationResponse = {
  organizationId: string | null;
  organizationName: string | null;
  foundingMembershipHandoff: null | {
    organizationId: string;
    eligible: boolean;
    onboardingCompleted: boolean;
    membershipStatus: string;
    membershipTier: string;
    isFoundingMember: boolean;
    founderReservation: null | { status: string };
    selectedGeography: null | { name: string; state: string; status: string };
  };
};

function money(amountCents?: number) {
  if (typeof amountCents !== "number") return "Price pending";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amountCents / 100);
}

export default function FoundingMembershipPage() {
  return <RequireAuth><FoundingMembership /></RequireAuth>;
}

function FoundingMembership() {
  const params = useSearchParams();
  const requestedOrganizationId = params.get("organizationId") || undefined;
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [configuration, setConfiguration] = useState<ExchangePublicCommercialConfiguration | null>(null);
  const [state, setState] = useState<ActivationResponse | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      getActivationState({ ...(requestedOrganizationId ? { organizationId: requestedOrganizationId } : {}) }),
      getExchangePublicCommercialPolicyFn({}),
    ]).then(([activation, policy]) => {
      if (!active) return;
      setState(activation.data);
      setConfiguration(policy.data.configuration);
      if (activation.data.organizationId) {
        void recordProgress({ action: "founding_membership_offered", organizationId: activation.data.organizationId });
      }
    }).catch(() => active && setError("Founding Membership information is temporarily unavailable."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [requestedOrganizationId]);

  if (loading) return <AppShell><main className="grid min-h-[70dvh] place-items-center bg-[#F7F3EA]"><div role="status" className="text-center"><Loader2 className="mx-auto h-9 w-9 animate-spin text-[#D6A23A]" /><p className="mt-3 font-semibold text-slate-700">Loading Founding Membership…</p></div></main></AppShell>;

  const organizationId = state?.organizationId || requestedOrganizationId || "";
  const handoff = state?.foundingMembershipHandoff;
  const founding = configuration?.foundingMembership;
  const checkoutOpen = Boolean(
    configuration?.featureFlags.exchangeFoundingCheckoutEnabled
    && founding?.enabled
    && founding?.checkoutReady,
  );
  const eligible = Boolean(handoff?.eligible && handoff.onboardingCompleted);

  const beginCheckout = async () => {
    if (!organizationId || !checkoutOpen || !eligible) return;
    setBusy(true);
    setError("");
    try {
      await recordProgress({ action: "checkout_handoff_initiated", organizationId });
      const returnPath = `/exchange/founding?organizationId=${encodeURIComponent(organizationId)}`;
      const response = await createExchangeMembershipCheckoutFn({
        organizationId,
        key: "exchange_founding",
        returnPath,
      });
      window.location.assign(response.data.url);
    } catch (value) {
      const message = String((value as { message?: string }).message || "");
      setError(message.includes("not open")
        ? "Founding enrollment is not open yet. Your business remains active on the Exchange."
        : "We could not open checkout. No membership change was made.");
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <main className="min-h-dvh bg-[#F7F3EA] px-4 py-8 sm:py-12">
        <div className="mx-auto max-w-5xl">
          <Link href={organizationId ? `/exchange?actorOrg=${encodeURIComponent(organizationId)}&subjectOrg=${encodeURIComponent(organizationId)}` : "/exchange"} className="inline-flex items-center gap-1 text-sm font-bold text-slate-600 hover:text-slate-950"><ArrowLeft className="h-4 w-4" /> Back to the Exchange</Link>
          <div className="mt-5 overflow-hidden rounded-3xl border border-black/10 bg-white shadow-2xl shadow-black/10">
            <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
              <section className="p-6 sm:p-10 lg:p-12">
                <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-amber-800"><Crown className="h-3.5 w-3.5" /> Founding Membership</span>
                <h1 className="mt-5 text-3xl font-black tracking-tight text-slate-950 sm:text-5xl">Your business is on the Exchange. Help shape what comes next.</h1>
                <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">Become a Founding Member to unlock the full launch experience and help shape the network as it grows.</p>

                {handoff?.selectedGeography && <div className="mt-6 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700"><MapPin className="h-4 w-4 text-[#D6A23A]" /> {handoff.selectedGeography.name}, {handoff.selectedGeography.state}</div>}

                <ul className="mt-8 space-y-3 text-sm leading-6 text-slate-700">
                  {["Founding organization recognition", "Early access to approved launch workflows", "Enhanced opportunity and partner discovery as benefits become active", "A structured feedback channel during the launch period"].map((benefit) => <li key={benefit} className="flex gap-3"><span className="mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700"><Check className="h-3.5 w-3.5" /></span>{benefit}</li>)}
                </ul>

                {error && <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{error}</div>}
              </section>

              <aside className="bg-[#0B0B0D] p-6 text-white sm:p-10 lg:p-12">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-[#E7C56F]">{state?.organizationName || "Your organization"}</p>
                <div className="mt-4 flex items-end gap-2"><strong className="text-4xl font-black">{money(founding?.amountCents)}</strong>{founding?.amountCents ? <span className="pb-1 text-sm text-white/60">/month</span> : null}</div>
                {founding?.foundingCapacity ? <p className="mt-2 text-sm text-white/60">Planned capacity: {founding.foundingCapacity} Founding organizations.</p> : null}

                <div className="mt-7 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/70">
                  <div className="flex items-center gap-2 font-bold text-white"><ShieldCheck className="h-4 w-4 text-[#D6A23A]" /> Reliable handoff</div>
                  <p className="mt-2">Checkout creates no duplicate business or membership record. Membership changes occur only after the payment provider confirms the subscription.</p>
                </div>

                {handoff?.isFoundingMember ? <div className="mt-6 rounded-2xl bg-emerald-400/10 p-4 font-bold text-emerald-300">This organization is already a Founding Member.</div> : !eligible ? <div className="mt-6 rounded-2xl bg-amber-400/10 p-4 text-sm leading-6 text-amber-200">Complete business marker activation with an owner or administrator account before enrollment.</div> : !checkoutOpen ? <div className="mt-6 rounded-2xl bg-blue-400/10 p-4 text-sm leading-6 text-blue-200">Founding enrollment is not open yet. The platform will not represent a membership as active until checkout and payment confirmation are available.</div> : null}

                <button disabled={busy || !checkoutOpen || !eligible || handoff?.isFoundingMember} onClick={() => void beginCheckout()} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#D6A23A] px-5 py-3 font-black text-black transition hover:bg-[#e2b553] disabled:cursor-not-allowed disabled:opacity-45">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}{handoff?.isFoundingMember ? "Founding Membership active" : checkoutOpen ? "Continue to secure checkout" : "Enrollment opening soon"}</button>
                <p className="mt-4 text-center text-xs leading-5 text-white/45">No premium permissions are activated without a valid membership state.</p>
              </aside>
            </div>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
