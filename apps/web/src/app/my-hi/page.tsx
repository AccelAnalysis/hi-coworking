"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy /my-hi entry point. Stripe Checkout returns here with
 * ?payment=success&plan=..., so forward to the account page with the query
 * string intact. A server redirect() in a static export drops the query.
 */
export default function MyHiPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/account/bookings${window.location.search}${window.location.hash}`);
  }, [router]);

  return (
    <main className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center px-6 text-center">
      <p role="status" className="text-base text-slate-700">
        Opening your account…
      </p>
      <Link
        href="/account/bookings"
        className="mt-4 inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-slate-900 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        Continue to your account
      </Link>
    </main>
  );
}
