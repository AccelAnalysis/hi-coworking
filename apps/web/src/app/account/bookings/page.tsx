"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
import { BookingManagementCard } from "@/components/BookingManagementCard";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { functions } from "@/lib/firebase";
import { getUserBookingsFromFirestore } from "@/lib/firestore";
import { MEMBERSHIP_TIERS, type Booking } from "@hi/shared";

const FACILITY_TIME_ZONE = "America/New_York";

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
  const [bookings, setBookings] = useState<ManagedBooking[]>([]);
  const [accessGrants, setAccessGrants] = useState<AccessGrantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(true);

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

  const now = Date.now();
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
  const accountCreditCents = Math.max(
    0,
    Number(userWithCredit?.accountCreditCents || 0),
  );

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">
              Account · Bookings
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
              Your bookings
            </h1>
            <p className="mt-2 max-w-2xl text-slate-600">
              View access, add reservations to your calendar, and see the exact
              consequences before cancelling or rescheduling.
            </p>
          </div>
          <Link
            href="/spaces"
            className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Find a space
          </Link>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
          <section className="space-y-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Calendar className="h-4 w-4" />
              Upcoming
            </div>

            {loading ? (
              <div className="flex min-h-40 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
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
                  Nothing booked yet.
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Start from Spaces to see the place, then check live availability.
                </p>
                <Link
                  href="/spaces"
                  className="mt-5 inline-flex text-sm font-semibold text-slate-900 underline underline-offset-4"
                >
                  Explore Spaces
                </Link>
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
                  : "No active membership"}
              </p>
              {membershipActive && membershipTier ? (
                <p className="mt-2 text-sm text-slate-300">
                  {membershipTier.includedHoursPerMonth} desk hours are included
                  each month. Eligible cancellations restore hours automatically.
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-300">
                  Book as a guest or choose a membership that fits your routine.
                </p>
              )}
              <Link
                href="/pricing"
                className="mt-5 inline-flex text-sm font-semibold text-white underline underline-offset-4"
              >
                View pricing
              </Link>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm font-medium text-slate-500">
                Account credit
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {money(accountCreditCents)}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Late-cancellation credit is applied automatically to the next
                eligible booking before Stripe payment.
              </p>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <h2 className="font-semibold text-slate-900">
                Need help?
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Contact Hi Coworking if access has not arrived, a payment needs
                reconciliation, or a booking change cannot be completed.
              </p>
              <Link
                href="/contact"
                className="mt-4 inline-flex text-sm font-semibold text-slate-900 underline underline-offset-4"
              >
                Contact us
              </Link>
            </div>
          </aside>
        </div>
      </main>
    </AppShell>
  );
}
