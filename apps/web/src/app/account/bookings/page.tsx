"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { httpsCallable } from "firebase/functions";
import {
  Calendar,
  Clock,
  CreditCard,
  KeyRound,
  Loader2,
  MapPin,
  ReceiptText,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { MY_HI_BOOKINGS_ID } from "@/lib/myHiNav";
import { BillingPortalButton } from "@/components/BillingPortalButton";
import { BookingManagementCard } from "@/components/BookingManagementCard";
import { MembershipWelcomeBanner } from "@/components/MembershipWelcomeBanner";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { functions } from "@/lib/firebase";
import { getUserBookingsFromFirestore } from "@/lib/firestore";
import { membershipEndsLabel, membershipSummary, welcomeBannerCopy } from "@/lib/membershipCopy";
import { MEMBERSHIP_TIERS, type Booking } from "@hi/shared";

const FACILITY_TIME_ZONE = "America/New_York";

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900";

/** The query string, read without a hydration mismatch in the static export. */
function useLocationSearch() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("popstate", onChange);
      return () => window.removeEventListener("popstate", onChange);
    },
    () => window.location.search,
    () => "",
  );
}

type ManagedBooking = Omit<Booking, "paymentMethod"> & {
  totalCents?: number;
  subtotalCents?: number;
  accountCreditAppliedCents?: number;
  includedHoursApplied?: number;
  paymentId?: string;
  paymentMethod?: string;
};

type AccessGrantSummary = {
  grantId: string;
  bookingId: string;
  doorName: string;
  startsAt: number;
  endsAt: number;
  grantStatus: string;
  codeStatus: string | null;
  codeLast2: string | null;
  codeId: string | null;
};

const getAccessGrants = httpsCallable<
  Record<string, never>,
  { grants: AccessGrantSummary[] }
>(functions, "access_getMyGrants");

function dateLabel(timestamp: number, long = false) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FACILITY_TIME_ZONE,
    ...(long
      ? { weekday: "long", month: "long", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" }),
  }).format(new Date(timestamp));
}

function timeLabel(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FACILITY_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function accessMessage(access?: AccessGrantSummary) {
  if (!access) {
    return "Access details will appear here after the facility credential is issued.";
  }
  if (access.grantStatus === "active" && access.codeStatus !== "failed") {
    return access.codeLast2
      ? `Your ${access.doorName} access code has been issued and ends in ${access.codeLast2}. The full code was sent securely.`
      : `Your ${access.doorName} access credential is active.`;
  }
  if (access.codeStatus === "failed") {
    return "Your booking is confirmed, but the access credential needs staff attention. Contact Hi Coworking before arrival.";
  }
  return "Your access credential is being prepared. Check again before arrival.";
}

export default function AccountBookingsPage() {
  return (
    <RequireAuth>
      <AccountBookingsContent />
    </RequireAuth>
  );
}

function AccountBookingsContent() {
  const { user, userDoc } = useAuth();
  const search = useLocationSearch();
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [bookings, setBookings] = useState<ManagedBooking[]>([]);
  const [accessGrants, setAccessGrants] = useState<AccessGrantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(true);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    getUserBookingsFromFirestore(user.uid)
      .then((records) => {
        if (active) setBookings(records as ManagedBooking[]);
      })
      .catch((error) => {
        console.error("Failed to load bookings", error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setAccessLoading(true);
    getAccessGrants({})
      .then((result) => {
        if (active) setAccessGrants(result.data.grants);
      })
      .catch((error) => {
        console.error("Failed to load access grants", error);
      })
      .finally(() => {
        if (active) setAccessLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const upcomingBookings = useMemo(
    () => bookings
      .filter((booking) => booking.status === "CONFIRMED" && booking.end > now)
      .sort((a, b) => a.start - b.start),
    [bookings, now],
  );
  const recentBookings = useMemo(
    () => bookings
      .filter((booking) => booking.status !== "CONFIRMED" || booking.end <= now)
      .sort((a, b) => b.start - a.start)
      .slice(0, 8),
    [bookings, now],
  );
  const accessByBooking = useMemo(
    () => new Map(
      accessGrants.map((grant) => [grant.bookingId, grant]),
    ),
    [accessGrants],
  );

  const userWithCredit = userDoc as (typeof userDoc & {
    accountCreditCents?: number;
  });
  const membershipTier = MEMBERSHIP_TIERS.find(
    (tier) => tier.id === userDoc?.plan,
  );
  const membershipActive = (
    userDoc?.membershipStatus === "active"
    || userDoc?.membershipStatus === "trial"
  );
  // Past-due members still have a Stripe subscription and need the portal
  // to fix their payment method.
  const hasBillingAccount = membershipActive || userDoc?.membershipStatus === "pastDue";
  const membershipEnds = membershipActive
    ? membershipEndsLabel(userDoc as { cancelAtPeriodEnd?: unknown; cancelAt?: unknown })
    : null;
  // Invoice failures flag pastDue on an active membership (access continues
  // while Stripe retries), so prompt the member to fix their card.
  const paymentRetrying = membershipActive
    && (userDoc as { pastDue?: unknown } | null | undefined)?.pastDue === true;
  const accountCreditCents = Math.max(
    0,
    Number(userWithCredit?.accountCreditCents || 0),
  );

  const returnParams = useMemo(() => new URLSearchParams(search), [search]);
  const showWelcome = returnParams.get("payment") === "success" && !welcomeDismissed;
  const welcomeCopy = welcomeBannerCopy({
    membershipActive,
    activeTier: membershipTier,
    returnedTier: MEMBERSHIP_TIERS.find((tier) => tier.id === returnParams.get("plan")),
  });
  const dismissWelcome = useCallback(() => {
    setWelcomeDismissed(true);
    // Drop the Checkout return parameters so a refresh doesn't show it again.
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-600">
              My Hi
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
              Your space at Hi Coworking
            </h1>
            <p className="mt-2 max-w-2xl text-slate-600">
              Book a coworking desk or the meeting room, see your upcoming
              visits, and find the access details for each one.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href={`#${MY_HI_BOOKINGS_ID}`}
              className={`inline-flex min-h-11 items-center justify-center rounded-full px-5 py-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-300 transition hover:bg-slate-100 ${FOCUS_RING}`}
            >
              Your bookings
            </a>
            <Link
              href="/book"
              className={`inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 ${FOCUS_RING}`}
            >
              Book a space
            </Link>
          </div>
        </div>

        {showWelcome && (
          <MembershipWelcomeBanner copy={welcomeCopy} onDismiss={dismissWelcome} />
        )}

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section
            id={MY_HI_BOOKINGS_ID}
            aria-labelledby="my-hi-bookings-heading"
            className="scroll-mt-24 space-y-5"
          >
            <h2
              id="my-hi-bookings-heading"
              className="flex items-center gap-2 text-sm font-semibold text-slate-900"
            >
              <Calendar aria-hidden="true" className="h-4 w-4" />
              Your upcoming bookings
            </h2>

            {loading ? (
              <div className="flex min-h-40 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                <Loader2 aria-hidden="true" className="h-6 w-6 text-slate-400 motion-safe:animate-spin" />
                <span className="sr-only">Loading your bookings…</span>
              </div>
            ) : upcomingBookings.length ? (
              upcomingBookings.map((booking, index) => {
                const access = accessByBooking.get(booking.id);
                return (
                  <article
                    key={booking.id}
                    className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {index === 0 ? "Next booking" : "Upcoming"}
                    </p>
                    <h2 className="mt-2 text-xl font-bold text-slate-900">
                      {booking.resourceName}
                    </h2>
                    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                      <span className="inline-flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-slate-400" />
                        {dateLabel(booking.start, true)}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <Clock className="h-4 w-4 text-slate-400" />
                        {timeLabel(booking.start)}–{timeLabel(booking.end)}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-slate-400" />
                        Carrollton, VA
                      </span>
                    </div>

                    <div className="mt-5 rounded-xl bg-slate-50 p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                        <KeyRound className="h-4 w-4" />
                        Access
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        {accessLoading
                          ? "Loading access details…"
                          : accessMessage(access)}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        Credentials are valid only for the confirmed booking
                        window, including the facility grace period.
                      </p>
                    </div>

                    <BookingManagementCard
                      bookingId={booking.id}
                      resourceId={booking.resourceId}
                      resourceName={booking.resourceName}
                      start={booking.start}
                      end={booking.end}
                      amountChargedCents={
                        booking.totalCents
                        ?? Math.round(Number(booking.totalPrice || 0) * 100)
                      }
                      subtotalCents={
                        booking.subtotalCents
                        ?? booking.totalCents
                        ?? Math.round(Number(booking.totalPrice || 0) * 100)
                      }
                      accountCreditAppliedCents={
                        booking.accountCreditAppliedCents || 0
                      }
                      paymentMethod={booking.paymentMethod || "STRIPE"}
                    />
                  </article>
                );
              })
            ) : (
              <div className="rounded-2xl bg-white py-12 text-center shadow-sm ring-1 ring-slate-200">
                <p className="font-medium text-slate-900">
                  No visits booked yet.
                </p>
                <p className="mx-auto mt-1 max-w-md px-4 text-sm text-slate-600">
                  Pick a date to see the open hours for a coworking desk or the
                  meeting room, with live availability.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <Link
                    href="/book"
                    className={`inline-flex min-h-11 items-center rounded-full bg-slate-900 px-5 text-sm font-semibold text-white transition hover:bg-slate-800 ${FOCUS_RING}`}
                  >
                    Book a desk
                  </Link>
                  <Link
                    href="/spaces"
                    className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold text-slate-900 underline underline-offset-4 ${FOCUS_RING}`}
                  >
                    See the space
                  </Link>
                </div>
              </div>
            )}

            {recentBookings.length > 0 && (
              <div className="pt-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <ReceiptText className="h-4 w-4" />
                  Recent booking history
                </div>
                <div className="mt-3 divide-y divide-slate-200 rounded-2xl bg-white px-5 shadow-sm ring-1 ring-slate-200">
                  {recentBookings.map((booking) => (
                    <div
                      key={booking.id}
                      className="flex flex-col justify-between gap-2 py-4 sm:flex-row sm:items-center"
                    >
                      <div>
                        <p className="font-medium text-slate-900">
                          {booking.resourceName}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">
                          {dateLabel(booking.start)} · {timeLabel(booking.start)}–
                          {timeLabel(booking.end)}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-sm font-medium text-slate-800">
                          {money(
                            booking.totalCents
                            ?? Math.round(Number(booking.totalPrice || 0) * 100),
                          )}
                        </p>
                        <p className="text-xs capitalize text-slate-500">
                          {booking.status.toLowerCase()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl bg-slate-900 p-6 text-white shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                <CreditCard className="h-4 w-4" />
                Membership
              </div>
              <p className="mt-4 text-xl font-bold">
                {membershipActive
                  ? membershipTier?.name ?? "Active membership"
                  : userDoc?.membershipStatus === "pastDue"
                    ? "Payment needed"
                    : "No active membership"}
              </p>
              {membershipEnds ? (
                <p className="mt-1 text-sm font-semibold text-amber-200">
                  {membershipEnds}
                </p>
              ) : null}
              {paymentRetrying ? (
                <p className="mt-1 text-sm font-semibold text-amber-200">
                  Your last payment didn&apos;t go through. Update your payment
                  method to keep your membership.
                </p>
              ) : null}
              {membershipActive && membershipTier ? (
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  {membershipSummary(membershipTier)}
                </p>
              ) : userDoc?.membershipStatus === "pastDue" ? (
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  Your last membership payment didn&apos;t go through. Update
                  your payment method to keep your membership.
                </p>
              ) : (
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  Book as a guest anytime, or choose a membership that fits how
                  often you work here.
                </p>
              )}
              {hasBillingAccount ? <BillingPortalButton /> : null}
              <Link
                href="/pricing"
                className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-white underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Compare plans
              </Link>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <h2 className="font-semibold text-slate-900">
                Need help?
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                We&apos;re here for anything about access, payments, bookings,
                or your membership.
              </p>
              <Link
                href="/contact"
                className={`mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-slate-900 underline underline-offset-4 ${FOCUS_RING}`}
              >
                Contact us
              </Link>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-sm font-medium text-slate-600">
                Account credit
              </h2>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {money(accountCreditCents)}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Credit from a late cancellation is applied automatically to
                your next eligible booking, before card payment.
                {membershipActive && membershipTier && membershipTier.includedHoursPerMonth > 0
                  ? " Eligible cancellations also restore included hours automatically."
                  : ""}
              </p>
            </div>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
