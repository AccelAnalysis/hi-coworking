"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";

export default function CanceledPage() {
  return <Suspense fallback={<Shell organizationId="" />}><Canceled /></Suspense>;
}

function Canceled() { return <Shell organizationId={useSearchParams().get("organizationId") || ""} />; }

function Shell({ organizationId }: { organizationId: string }) {
  return <AppShell><main className="mx-auto max-w-xl px-6 py-24 text-center"><h1 className="text-3xl font-bold text-slate-950">Checkout canceled</h1><p className="mt-3 text-slate-600">No membership was activated. Your organization can continue with Free Exchange Membership.</p><div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><Link href={`/exchange/membership?organizationId=${encodeURIComponent(organizationId)}`} className="rounded-full bg-slate-950 px-6 py-3 font-bold text-white">Review membership</Link><Link href="/exchange/onboarding" className="rounded-full border border-slate-300 px-6 py-3 font-bold text-slate-700">Back to organizations</Link></div></main></AppShell>;
}
