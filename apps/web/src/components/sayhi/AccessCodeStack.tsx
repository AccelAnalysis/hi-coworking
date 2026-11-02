"use client";

import { KeyRound } from "lucide-react";
import { accessCodeView, type AccessGrantSummary } from "@/lib/accessCodeView";

type StackBooking = { id: string; resourceName: string; start: number; end: number };

const TZ = "America/New_York";
const day = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" }).format(new Date(ms));
const time = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(ms));

/**
 * One row per scheduled time, stacked, each with its own code
 * (approved Oct 30, 2026, 6:40 PM).
 */
export function AccessCodeStack({
  bookings,
  accessByBooking,
  loading,
  now,
}: {
  bookings: StackBooking[];
  accessByBooking: Map<string, AccessGrantSummary>;
  loading: boolean;
  now: number;
}) {
  if (!bookings.length) return null;
  return (
    <section aria-labelledby="sayhi-codes-heading" className="mb-8 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-[#C5CADB] sm:p-6">
      <h2 id="sayhi-codes-heading" className="flex items-center gap-2 text-lg font-semibold text-[#101D4B]">
        <KeyRound aria-hidden="true" className="h-5 w-5" />
        Your access codes
      </h2>
      <ul className="mt-4 divide-y divide-[#EEF0F6]" data-testid="access-code-stack">
        {bookings.map((booking) => {
          const view = accessCodeView(accessByBooking.get(booking.id), { loading, now });
          return (
            <li key={booking.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium text-[#101D4B]">{day(booking.start)} · {time(booking.start)}–{time(booking.end)}</p>
                <p className="text-sm text-[#4A5585]">{booking.resourceName}</p>
              </div>
              {view.kind === "code" ? (
                <p className="text-2xl font-bold tabular-nums tracking-[0.2em] text-[#101D4B]" aria-label={`Access code ${view.spoken}`}>
                  {view.code}
                </p>
              ) : (
                <p className="text-sm text-[#3A4675] sm:max-w-xs sm:text-right">{view.text}</p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm leading-6 text-[#3A4675]">
        Each code works only during its booking. Enter it on the door keypad to let yourself in; that also checks you in. Check out on the front-desk iPad when you leave.
      </p>
    </section>
  );
}
