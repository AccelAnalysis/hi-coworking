"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/authContext";
import { authPath } from "@/lib/purchaseNavigation";

/** Returning from Stripe is not proof of payment: only server entitlements are shown. */
export default function MembershipCompletePage() {
  const { user, userDoc, loading } = useAuth();
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const active = userDoc?.membershipStatus === "active" && Boolean(userDoc.plan) && now > 0 && (userDoc.expiresAt ?? 0) > now;
  return (
    <AppShell>
      <main className="mx-auto max-w-2xl px-4 py-14 text-center">
        <h1 className="text-3xl font-semibold text-slate-950">
          {loading ? "Checking your account…" : active ? "Your membership is active" : "Checking your membership"}
        </h1>
        <p role="status" className="mt-5 leading-7 text-slate-600">
          {active
            ? "Your account now has membership access. Your desk or meeting room is not reserved until you make a separate booking."
            : "We have not yet verified an active membership on this account. Payment and membership updates are processed on the server, even if you close this page. Do not purchase again while confirmation is pending."}
        </p>
        {!loading && !user && <p className="mt-4 text-slate-600">Sign in with the email used at checkout to check your membership.</p>}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={user ? "/account/bookings" : authPath("login", "/pricing/complete")} className="rounded-full bg-slate-950 px-6 py-3 text-white">{user ? "View account" : "Sign in to verify"}</Link>
          {active && <Link href="/book" className="rounded-full border border-slate-300 px-6 py-3">Book a space</Link>}
          <Link href="/contact" className="rounded-full border border-slate-300 px-6 py-3">{active ? "Manage membership with our team" : "Get payment help"}</Link>
        </div>
        {!active && <p className="mt-6 text-sm text-slate-500">This page updates when your account’s membership status changes. If confirmation does not arrive, contact us with your checkout email. A payment return link alone is not a receipt.</p>}
      </main>
    </AppShell>
  );
}
