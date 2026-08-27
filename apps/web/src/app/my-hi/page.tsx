"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Calendar, Clock, CreditCard, Loader2, MapPin } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BookingManagementCard } from "@/components/BookingManagementCard";
import { RequireAuth } from "@/components/RequireAuth";
import { useAuth } from "@/lib/authContext";
import { getUserBookingsFromFirestore } from "@/lib/firestore";
import { MEMBERSHIP_TIERS, type Booking } from "@hi/shared";

const TZ = "America/New_York";
function dateLabel(timestamp: number, long = false) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    ...(long ? { weekday: "long", month: "long", day: "numeric" } : { month: "short", day: "numeric" }),
  }).format(new Date(timestamp));
}
function timeLabel(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

export default function MyHiPage() {
  return <RequireAuth><MyHiContent /></RequireAuth>;
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
        if (!active) return;
        const now = Date.now();
        setBookings(next.filter((booking) => booking.status === "CONFIRMED" && booking.end > now));
      })
      .catch((error) => console.error("Failed to load bookings", error))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

  const upcomingBookings = useMemo(() => [...bookings].sort((a, b) => a.start - b.start), [bookings]);
  const membershipTier = MEMBERSHIP_TIERS.find((tier) => tier.id === userDoc?.plan);
  const membershipActive = userDoc?.membershipStatus === "active" || userDoc?.membershipStatus === "trial";

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500">My Hi</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">Welcome back{user?.displayName ? `, ${user.displayName}` : ""}.</h1>
            <p className="mt-2 text-slate-600">Your bookings, membership, and access start here.</p>
          </div>
          <Link href="/book" className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">Book a space</Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <section className="space-y-5 lg:col-span-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Calendar className="h-4 w-4" /> Upcoming bookings</div>
            {loading ? (
              <div className="flex min-h-36 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : upcomingBookings.length ? upcomingBookings.map((booking, index) => (
              <article key={booking.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{index === 0 ? "Next booking" : "Upcoming"}</p>
                <h2 className="mt-2 text-xl font-bold text-slate-900">{booking.resourceName}</h2>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                  <span className="inline-flex items-center gap-2"><Calendar className="h-4 w-4 text-slate-400" />{dateLabel(booking.start, true)}</span>
                  <span className="inline-flex items-center gap-2"><Clock className="h-4 w-4 text-slate-400" />{timeLabel(booking.start)} – {timeLabel(booking.end)}</span>
                  <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4 text-slate-400" />Carrollton, VA</span>
                </div>
                <BookingManagementCard bookingId={booking.id} resourceName={booking.resourceName} start={booking.start} end={booking.end} />
              </article>
            )) : (
              <div className="rounded-2xl bg-white py-12 text-center shadow-sm ring-1 ring-slate-200">
                <p className="font-medium text-slate-900">Nothing booked yet.</p>
                <p className="mt-1 text-sm text-slate-500">Choose a desk or space when you need it.</p>
                <Link href="/book" className="mt-5 inline-flex text-sm font-semibold text-slate-900 underline underline-offset-4">Find a space</Link>
              </div>
            )}
          </section>

          <aside className="space-y-6">
            <div className="rounded-2xl bg-slate-900 p-6 text-white shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-300"><CreditCard className="h-4 w-4" /> Membership</div>
              <p className="mt-4 text-xl font-bold">{membershipActive ? membershipTier?.name ?? "Active membership" : "No active membership"}</p>
              {membershipActive && membershipTier ? <p className="mt-2 text-sm text-slate-300">{membershipTier.includedHoursPerMonth} desk hours included each month. Booking changes automatically restore eligible hours under the cancellation policy.</p> : <p className="mt-2 text-sm text-slate-300">Book as a guest or choose a membership that fits your routine.</p>}
              <Link href="/pricing" className="mt-5 inline-flex text-sm font-semibold text-white underline underline-offset-4">View membership options</Link>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <h2 className="font-semibold text-slate-900">Booking policy</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Before you cancel, My Hi shows the exact refund, account credit, and membership hours that will be restored. Your original booking remains unchanged if a reschedule attempt cannot secure the new time.</p>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
