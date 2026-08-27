"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import {
  CalendarDays,
  Check,
  Clock3,
  Loader2,
  MapPin,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";

const FACILITY_TIME_ZONE = "America/New_York";

const getAvailability = httpsCallable<
  { start: number; end: number },
  {
    start: number;
    end: number;
    options: Array<{
      resourceId: string;
      name: string;
      type: "SEAT" | "MODE";
      available: boolean;
    }>;
  }
>(functions, "booking_getAvailability");

type Quote = {
  resourceId: string;
  resourceName: string;
  resourceType: "SEAT" | "MODE";
  durationHours: number;
  membershipName: string | null;
  includedHoursRemaining: number;
  includedHoursApplied: number;
  billableHours: number;
  hourlyRateCents: number;
  subtotalCents: number;
  accountCreditAvailableCents: number;
  accountCreditAppliedCents: number;
  totalCents: number;
  currency: string;
};

const createQuote = httpsCallable<
  { resourceId: string; start: number; end: number },
  Quote
>(functions, "booking_createQuote");

const beginCheckout = httpsCallable<
  {
    resourceId: string;
    start: number;
    end: number;
    successUrl: string;
    cancelUrl: string;
    guest?: {
      name: string;
      email: string;
      phone?: string;
    };
  },
  | {
      kind: "confirmed";
      bookingId: string;
      quote: Quote;
    }
  | {
      kind: "checkout";
      holdId: string;
      holdSecret: string;
      expiresAt: number;
      paymentId: string;
      checkoutUrl: string;
      quote: Quote;
    }
>(functions, "booking_beginCheckout");

type AvailabilityOption = {
  resourceId: string;
  name: string;
  type: "SEAT" | "MODE";
  available: boolean;
};

const DURATIONS = [1, 1.5, 2, 3, 4, 6, 8];

function facilityDateValue(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FACILITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function startTimes() {
  const values: string[] = [];
  for (let hour = 8; hour < 20; hour += 1) {
    values.push(`${String(hour).padStart(2, "0")}:00`);
    values.push(`${String(hour).padStart(2, "0")}:30`);
  }
  return values;
}

function facilityWallTimeToTimestamp(
  dateValue: string,
  timeValue: string,
) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const targetAsUtc = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    0,
    0,
  );
  let guess = targetAsUtc;

  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: FACILITY_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const values = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    const observedAsUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      0,
      0,
    );
    guess += targetAsUtc - observedAsUtc;
  }

  return guess;
}

function toWindow(
  dateValue: string,
  timeValue: string,
  durationHours: number,
) {
  const start = facilityWallTimeToTimestamp(dateValue, timeValue);
  const end = start + durationHours * 60 * 60 * 1000;
  return { start, end };
}

function formatFacilityTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FACILITY_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatFacilityDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FACILITY_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(timestamp));
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export default function BookPage() {
  const { user, loading: authLoading } = useAuth();
  const todayAtFacility = useMemo(() => facilityDateValue(), []);
  const [dateValue, setDateValue] = useState(todayAtFacility);
  const [timeValue, setTimeValue] = useState("09:00");
  const [duration, setDuration] = useState(2);
  const [preferredResourceId, setPreferredResourceId] = useState<
    string | null
  >(null);
  const [options, setOptions] = useState<AvailabilityOption[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<
    string | null
  >(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");

  const bookingWindow = useMemo(
    () => toWindow(dateValue, timeValue, duration),
    [dateValue, timeValue, duration],
  );
  const [startHour, startMinute] = timeValue.split(":").map(Number);
  const endWallMinutes = startHour * 60 + startMinute + duration * 60;
  const validEnd = endWallMinutes <= 20 * 60;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedDate = params.get("date");
    const requestedTime = params.get("time");
    const requestedDuration = Number(params.get("duration"));
    const requestedResource = params.get("resource");
    if (
      requestedDate
      && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      && requestedDate >= todayAtFacility
    ) {
      setDateValue(requestedDate);
    }
    if (requestedTime && startTimes().includes(requestedTime)) {
      setTimeValue(requestedTime);
    }
    if (DURATIONS.includes(requestedDuration)) {
      setDuration(requestedDuration);
    }
    if (requestedResource) {
      setPreferredResourceId(requestedResource);
    }
    if (params.get("checkout") === "cancelled") {
      setNotice(
        "Checkout was cancelled. The temporary hold will expire automatically; no booking was confirmed.",
      );
    }
  }, [todayAtFacility]);

  useEffect(() => {
    setSelectedResourceId(null);
    setQuote(null);
    setOptions([]);
  }, [dateValue, timeValue, duration]);

  async function loadQuote(option: AvailabilityOption) {
    setSelectedResourceId(option.resourceId);
    setLoadingQuote(true);
    setQuote(null);
    setError(null);
    try {
      const result = await createQuote({
        resourceId: option.resourceId,
        start: bookingWindow.start,
        end: bookingWindow.end,
      });
      setQuote(result.data);
    } catch (caught) {
      console.error(caught);
      setSelectedResourceId(null);
      setError(
        "That option just became unavailable. Check availability again.",
      );
    } finally {
      setLoadingQuote(false);
    }
  }

  async function checkAvailability() {
    if (!validEnd) {
      setError(
        "That duration runs past 8:00 PM. Choose an earlier time or shorter stay.",
      );
      return;
    }
    setLoadingAvailability(true);
    setError(null);
    setNotice(null);
    setSelectedResourceId(null);
    setQuote(null);
    try {
      const result = await getAvailability({
        start: bookingWindow.start,
        end: bookingWindow.end,
      });
      setOptions(result.data.options);
      const preferred = preferredResourceId
        ? result.data.options.find(
            (option) => (
              option.resourceId === preferredResourceId
              && option.available
            ),
          )
        : undefined;
      if (preferred) {
        await loadQuote(preferred);
      }
    } catch (caught) {
      console.error(caught);
      setOptions([]);
      setError(
        "We could not check live availability. Please try again.",
      );
    } finally {
      setLoadingAvailability(false);
    }
  }

  async function chooseOption(option: AvailabilityOption) {
    if (!option.available) return;
    await loadQuote(option);
  }

  async function checkout() {
    if (!selectedResourceId || !quote) return;
    if (!user && (!guestName.trim() || !guestEmail.trim())) {
      setError("Enter your name and email to continue as a guest.");
      return;
    }
    setCheckingOut(true);
    setError(null);
    try {
      const origin = window.location.origin;
      const result = await beginCheckout({
        resourceId: selectedResourceId,
        start: bookingWindow.start,
        end: bookingWindow.end,
        successUrl: `${origin}/book/complete`,
        cancelUrl: `${origin}/book?checkout=cancelled`,
        ...(!user
          ? {
              guest: {
                name: guestName.trim(),
                email: guestEmail.trim(),
                phone: guestPhone.trim(),
              },
            }
          : {}),
      });

      if (result.data.kind === "confirmed") {
        window.location.assign(
          `/book/complete?bookingId=${encodeURIComponent(
            result.data.bookingId,
          )}`,
        );
        return;
      }

      window.localStorage.setItem(
        "hi-coworking-booking-hold",
        JSON.stringify({
          holdId: result.data.holdId,
          holdSecret: result.data.holdSecret,
          expiresAt: result.data.expiresAt,
        }),
      );
      window.location.assign(result.data.checkoutUrl);
    } catch (caught) {
      console.error(caught);
      setError(
        "We could not start checkout. Your card has not been charged. Check availability and try again.",
      );
      setCheckingOut(false);
    }
  }

  const availableCount = options.filter(
    (option) => option.available,
  ).length;

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-slate-500">
            <Link
              href="/spaces"
              className="underline underline-offset-4 hover:text-slate-900"
            >
              Spaces
            </Link>
            {" · "}Book
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            When would you like to work?
          </h1>
          <p className="mt-3 text-base leading-7 text-slate-600">
            Choose your time first. Only desks and setups available for the
            full stay will be offered.
          </p>
        </div>

        <section className="mt-8 grid gap-4 rounded-2xl bg-slate-50 p-4 sm:grid-cols-3 sm:p-5">
          <label className="text-sm font-medium text-slate-800">
            <span className="mb-2 flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Date
            </span>
            <input
              type="date"
              min={todayAtFacility}
              value={dateValue}
              onChange={(event) => setDateValue(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-950"
            />
          </label>

          <label className="text-sm font-medium text-slate-800">
            <span className="mb-2 flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              Start
            </span>
            <select
              value={timeValue}
              onChange={(event) => setTimeValue(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-950"
            >
              {startTimes().map((value) => (
                <option key={value} value={value}>
                  {new Date(`2000-01-01T${value}`).toLocaleTimeString(
                    "en-US",
                    {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "UTC",
                    },
                  )}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm font-medium text-slate-800">
            <span className="mb-2 flex items-center gap-2">
              <Clock3 className="h-4 w-4" />
              Duration
            </span>
            <select
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-950"
            >
              {DURATIONS.map((value) => (
                <option key={value} value={value}>
                  {value} {value === 1 ? "hour" : "hours"}
                </option>
              ))}
            </select>
          </label>
        </section>

        <p className="mt-3 text-sm text-slate-500">
          Times are local to Hi Coworking in Carrollton, Virginia.
        </p>

        <button
          type="button"
          onClick={checkAvailability}
          disabled={loadingAvailability || !validEnd}
          className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {loadingAvailability && (
            <Loader2 className="h-5 w-5 animate-spin" />
          )}
          Check availability
        </button>

        {notice && (
          <div className="mt-5 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
            {notice}
          </div>
        )}
        {error && (
          <div className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
            {error}
          </div>
        )}

        {options.length > 0 && (
          <section className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  Live availability
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-950">
                  Choose your space
                </h2>
              </div>
              <p className="text-sm text-slate-500">
                {availableCount} option{availableCount === 1 ? "" : "s"} for
                the full stay
              </p>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {options.map((option) => {
                const selected = (
                  option.resourceId === selectedResourceId
                );
                return (
                  <button
                    key={option.resourceId}
                    type="button"
                    disabled={!option.available}
                    onClick={() => chooseOption(option)}
                    className={`min-h-28 rounded-2xl p-5 text-left transition ${
                      selected
                        ? "bg-slate-950 text-white"
                        : option.available
                          ? "bg-white ring-1 ring-slate-200 hover:ring-slate-400"
                          : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 text-lg font-semibold">
                          {option.type === "MODE"
                            ? <Users className="h-5 w-5" />
                            : <MapPin className="h-5 w-5" />}
                          {option.name}
                        </div>
                        <p
                          className={`mt-2 text-sm ${
                            selected
                              ? "text-slate-300"
                              : "text-slate-500"
                          }`}
                        >
                          {option.available
                            ? `${formatFacilityTime(
                                bookingWindow.start,
                              )}–${formatFacilityTime(
                                bookingWindow.end,
                              )} available`
                            : "Unavailable for this stay"}
                        </p>
                      </div>
                      {selected && <Check className="h-5 w-5" />}
                    </div>
                  </button>
                );
              })}
            </div>

            <p className="mt-4 text-sm text-slate-500">
              Prefer to see the layout?{" "}
              <Link
                href="/spaces"
                className="font-medium text-slate-900 underline underline-offset-4"
              >
                Return to Spaces
              </Link>
              . The floorplan is optional for booking.
            </p>
          </section>
        )}

        {selectedResourceId && (
          <section className="mt-10 border-t border-slate-200 pt-8">
            <p className="text-sm font-medium text-slate-500">
              Your booking
            </p>
            {loadingQuote ? (
              <div className="mt-4 flex items-center gap-2 text-slate-600">
                <Loader2 className="h-5 w-5 animate-spin" />
                Calculating the authoritative price…
              </div>
            ) : quote ? (
              <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_340px]">
                <div>
                  <h2 className="text-2xl font-semibold text-slate-950">
                    {quote.resourceName}
                  </h2>
                  <p className="mt-2 text-slate-600">
                    {formatFacilityDate(bookingWindow.start)} ·{" "}
                    {formatFacilityTime(bookingWindow.start)}–
                    {formatFacilityTime(bookingWindow.end)}
                  </p>

                  {!user && (
                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      <input
                        value={guestName}
                        onChange={(event) => setGuestName(event.target.value)}
                        placeholder="Name"
                        autoComplete="name"
                        className="rounded-xl border border-slate-200 px-4 py-3"
                      />
                      <input
                        value={guestEmail}
                        onChange={(event) => setGuestEmail(event.target.value)}
                        placeholder="Email"
                        type="email"
                        autoComplete="email"
                        className="rounded-xl border border-slate-200 px-4 py-3"
                      />
                      <input
                        value={guestPhone}
                        onChange={(event) => setGuestPhone(event.target.value)}
                        placeholder="Phone (optional)"
                        type="tel"
                        autoComplete="tel"
                        className="rounded-xl border border-slate-200 px-4 py-3 sm:col-span-2"
                      />
                      <p className="text-sm text-slate-500 sm:col-span-2">
                        No account is required before checkout. Your booking
                        creates the account record used for confirmation,
                        access, and future booking management.
                      </p>
                    </div>
                  )}
                </div>

                <aside className="rounded-2xl bg-slate-50 p-5">
                  <div className="flex items-center justify-between gap-4 text-sm">
                    <span>{quote.durationHours} hours</span>
                    <span>{money(quote.subtotalCents)}</span>
                  </div>
                  {quote.membershipName && (
                    <p className="mt-3 text-sm text-slate-600">
                      {quote.membershipName}
                    </p>
                  )}
                  {quote.includedHoursApplied > 0 && (
                    <p className="mt-2 text-sm text-slate-600">
                      {quote.includedHoursApplied} hour
                      {quote.includedHoursApplied === 1 ? "" : "s"} covered by
                      membership.{" "}
                      {Math.max(
                        0,
                        quote.includedHoursRemaining
                          - quote.includedHoursApplied,
                      )}{" "}
                      remain after this booking.
                    </p>
                  )}
                  {(
                    quote.billableHours > 0
                    && quote.includedHoursApplied > 0
                  ) && (
                    <p className="mt-2 text-sm text-slate-600">
                      {quote.billableHours} additional hours ×{" "}
                      {money(quote.hourlyRateCents)}
                    </p>
                  )}

                  {quote.accountCreditAppliedCents > 0 && (
                    <div className="mt-4 rounded-xl bg-white p-3 text-sm">
                      <div className="flex justify-between gap-4">
                        <span className="text-slate-600">
                          Account credit
                        </span>
                        <span className="font-medium text-slate-950">
                          −{money(quote.accountCreditAppliedCents)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        Applied automatically before payment. The amount is
                        reserved only after checkout begins.
                      </p>
                    </div>
                  )}

                  <div className="mt-5 flex items-baseline justify-between border-t border-slate-200 pt-4">
                    <span className="font-medium">Amount due</span>
                    <span className="text-2xl font-semibold text-slate-950">
                      {money(quote.totalCents)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={checkout}
                    disabled={checkingOut || authLoading}
                    className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {checkingOut && (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    )}
                    {quote.totalCents === 0
                      ? "Confirm booking"
                      : "Continue to payment"}
                  </button>
                  <p className="mt-3 text-center text-xs leading-5 text-slate-500">
                    The space, included hours, and account credit are held for
                    15 minutes when checkout begins. A booking is not confirmed
                    until payment or entitlements are accepted.
                  </p>
                </aside>
              </div>
            ) : null}
          </section>
        )}
      </main>
    </AppShell>
  );
}
