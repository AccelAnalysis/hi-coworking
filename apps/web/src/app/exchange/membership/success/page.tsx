"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Clock3, CheckCircle2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";

export default function SuccessPage() {
  return <Suspense fallback={<Shell organizationId="" />}><Success /></Suspense>;
}

function Success() { return <Shell organizationId={useSearchParams().get("organizationId") || ""} />; }

function Shell({ organizationId }: { organizationId: string }) {
  return <AppShell><main className="mx-auto max-w-xl px-6 py-24 text-center"><CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" /><h1 className="mt-5 text-3xl font-bold text-slate-950">Checkout received</h1><p className="mt-3 text-slate-600">Stripe is confirming the subscription. This page does not activate membership or issue credits; the verified webhook does that.</p><div className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-800"><Clock3 className="h-4 w-4" /> Processing may take a moment.</div><Link href={`/exchange/membership?organizationId=${encodeURIComponent(organizationId)}`} className="mt-8 inline-block rounded-full bg-slate-950 px-6 py-3 font-bold text-white">Return to membership</Link></main></AppShell>;
}
