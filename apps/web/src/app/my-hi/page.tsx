"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Calendar, Clock, CreditCard, Loader2, MapPin } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { getUserBookingsFromFirestore } from "@/lib/firestore";
import { MEMBERSHIP_TIERS, type Booking } from "@hi/shared";

export default function MyHiPage() {
  return (
    <RequireAuth>
      <MyHiContent />
    </RequireAuth>
  );
}

function MyHiContent() {
  const { user, userDoc } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void getUserBookingsFromFirestore(user.uid)
      .then((next) => {
        if (active) setBookings(next);
      })
      .catch((error) => console.error("Failed to load bookings", error))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const upcomingBookings = useMemo(
    () =>
      bookings
        .filter((booking) => booking.status === "CONFIRMED" && booking.end > Date.now())
        .sort((a, b) => a.start - b.start),
    [bookings],
  );

  const nextBooking = upcomingBookings[0];
  const membershipTier = MEMBERSHIP_TIERS.find((tier) => tier.id === userDoc?.plan);
  const membershipActive = userDoc?.membershipStatus === "active" || userDoc?.membershipStatus === "trial";

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">My Hi</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
              Welcome back{user?.displayName ? `, ${user.displayName}` : ""}.
            </h1>
            <p className="mt-2 text-slate-600">Your workspace, bookings, and membership in one place.</p>
          </div>
          <Link
            href="/book"
            className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Book a space
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="lg:col-span-2">
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Calendar className="h-4 w-4" /> Next booking
              </div>

              {loading ? (
                <div className="flex min-h-36 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </div>
              ) : nextBooking ? (
                <div className="mt-5">
                  <h2 className="text-2xl font-bold text-slate-900">{nextBooking.resourceName}</h2>
                  <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                    <span className="inline-flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-slate-400" />
                      {new Date(nextBooking.start).toLocaleDateString("en-US", {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <Clock className="h-4 w-4 text-slate-400" />
                      {new Date(nextBooking.start).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      {" – "}
                      {new Date(nextBooking.end).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-slate-400" /> Carrollton, VA
                    </span>
                  </div>
                </div>
              ) : (
                <div className="py-10 text-center">
                  <p className="font-medium text-slate-900">Nothing booked yet.</p>
                  <p className="mt-1 text-sm text-slate-500">Choose a desk or space when you need it.</p>
                  <Link href="/book" className="mt-5 inline-flex text-sm font-semibold text-slate-900 underline underline-offset-4">
                    Find a space
                  </Link>
                </div>
              )}
            </div>

            {upcomingBookings.length > 1 && (
              <div className="mt-6">
                <h2 className="mb-3 text-sm font-semibold text-slate-900">More upcoming bookings</h2>
                <div className="divide-y divide-slate-200 rounded-2xl bg-white px-5 shadow-sm ring-1 ring-slate-200">
                  {upcomingBookings.slice(1, 4).map((booking) => (
                    <div key={booking.id} className="flex items-center justify-between gap-4 py-4">
                      <div>
                        <p className="font-medium text-slate-900">{booking.resourceName}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {new Date(booking.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          {" · "}
                          {new Date(booking.start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                        </p>
                      </div>
                      <Calendar className="h-4 w-4 text-slate-400" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl bg-slate-900 p-6 text-white shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                <CreditCard className="h-4 w-4" /> Membership
              </div>
              <p className="mt-4 text-xl font-bold">
                {membershipActive ? membershipTier?.name ?? "Active membership" : "No active membership"}
              </p>
              {membershipActive && membershipTier ? (
                <p className="mt-2 text-sm text-slate-300">
                  {membershipTier.includedHoursPerMonth} desk hours included each month.
                </p>
              ) : (
                <p className="mt-2 text-sm text-slate-300">Book as a guest or choose a membership that fits your routine.</p>
              )}
              <Link href="/pricing" className="mt-5 inline-flex text-sm font-semibold text-white underline underline-offset-4">
                View membership options
              </Link>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <h2 className="font-semibold text-slate-900">Around Hi</h2>
              <div className="mt-4 space-y-3 text-sm">
                <Link href="/events" className="block text-slate-600 hover:text-slate-900">Upcoming events</Link>
                <Link href="/bookstore" className="block text-slate-600 hover:text-slate-900">Browse the bookstore</Link>
                <Link href="/contact" className="block text-slate-600 hover:text-slate-900">Contact Hi Coworking</Link>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
