"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  Loader2,
  MapPin,
  Monitor,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";

const FACILITY_TIME_ZONE = "America/New_York";
const OPEN_MINUTES = 8 * 60;
const CLOSE_MINUTES = 20 * 60;
const HALF_HOUR_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    guest?: { name: string; email: string; phone?: string };
  },
  | { kind: "confirmed"; bookingId: string; quote: Quote }
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

const visualPositions: Record<string, string> = {
  "seat-1": "col-start-1 row-start-1",
  "seat-2": "col-start-2 row-start-1",
  "seat-3": "col-start-3 row-start-1",
  "seat-4": "col-start-1 row-start-2",
  "seat-5": "col-start-2 row-start-2",
  "seat-6": "col-start-3 row-start-2",
  "mode-conference": "col-span-3 col-start-1 row-start-3",
};

function facilityDateValue(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FACILITY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function facilityClockMinutes(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FACILITY_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function minutesToValue(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeValueToMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function timeValues(includeClose = false) {
  const values: string[] = [];
  const end = includeClose ? CLOSE_MINUTES : CLOSE_MINUTES - 30;
  for (let minutes = OPEN_MINUTES; minutes <= end; minutes += 30) {
    values.push(minutesToValue(minutes));
  }
  return values;
}

function defaultBookingValues() {
  const now = Date.now();
  const currentMinutes = facilityClockMinutes(now);
  if (currentMinutes >= CLOSE_MINUTES - 30) {
    return {
      date: facilityDateValue(now + DAY_MS),
      start: "09:00",
      end: "11:00",
    };
  }
  const rounded = Math.ceil((currentMinutes + 1) / 30) * 30;
  const startMinutes = Math.max(OPEN_MINUTES, rounded);
  const endMinutes = Math.min(CLOSE_MINUTES, startMinutes + 120);
  return {
    date: facilityDateValue(now),
    start: minutesToValue(startMinutes),
    end: minutesToValue(endMinutes),
  };
}

function facilityWallTimeToTimestamp(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
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
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
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

function toWindow(dateValue: string, startValue: string, endValue: string) {
  return {
    start: facilityWallTimeToTimestamp(dateValue, startValue),
    end: facilityWallTimeToTimestamp(dateValue, endValue),
  };
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

function stepClass(active: boolean) {
  return active
    ? "bg-slate-900 text-white"
    : "bg-slate-100 text-slate-500";
}

export default function BookingExperience() {
  const { user, loading: authLoading } = useAuth();
  const defaults = useMemo(() => defaultBookingValues(), []);
  const todayAtFacility = useMemo(() => facilityDateValue(), []);
  const [dateValue, setDateValue] = useState(defaults.date);
  const [startValue, setStartValue] = useState(defaults.start);
  const [endValue, setEndValue] = useState(defaults.end);
  const [preferredResourceId, setPreferredResourceId] = useState<string | null>(null);
  const [options, setOptions] = useState<AvailabilityOption[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");

  const bookingWindow = useMemo(
    () => toWindow(dateValue, startValue, endValue),
    [dateValue, startValue, endValue],
  );
  const durationHours = (bookingWindow.end - bookingWindow.start) / (60 * 60 * 1000);
  const validRange = bookingWindow.end > bookingWindow.start;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedDate = params.get("date");
    const requestedTime = params.get("time");
    const requestedDuration = Number(params.get("duration"));
    const requestedResource = params.get("resource");

    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate >= todayAtFacility) {
      setDateValue(requestedDate);
    }
    if (requestedTime && timeValues().includes(requestedTime)) {
      setStartValue(requestedTime);
      if (Number.isFinite(requestedDuration) && requestedDuration > 0) {
        const proposedEnd = timeValueToMinutes(requestedTime) + requestedDuration * 60;
        if (proposedEnd <= CLOSE_MINUTES && proposedEnd % 30 === 0) {
          setEndValue(minutesToValue(proposedEnd));
        }
      }
    }
    if (requestedResource) setPreferredResourceId(requestedResource);
    if (params.get("checkout") === "cancelled") {
      setNotice("Checkout was cancelled. No booking was confirmed.");
    }
  }, [todayAtFacility]);

  useEffect(() => {
    setSelectedResourceId(null);
    setQuote(null);
    setReviewOpen(false);
    setOptions([]);
  }, [dateValue, startValue, endValue]);

  function changeStart(nextStart: string) {
    setStartValue(nextStart);
    const startMinutes = timeValueToMinutes(nextStart);
    if (timeValueToMinutes(endValue) <= startMinutes) {
      setEndValue(minutesToValue(Math.min(CLOSE_MINUTES, startMinutes + 60)));
    }
  }

  async function loadQuote(option: AvailabilityOption) {
    setSelectedResourceId(option.resourceId);
    setReviewOpen(false);
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
      setError("That spot just became unavailable. Check availability again.");
    } finally {
      setLoadingQuote(false);
    }
  }

  async function checkAvailability() {
    if (!validRange) {
      setError("Choose an end time after your start time.");
      return;
    }
    setLoadingAvailability(true);
    setError(null);
    setNotice(null);
    setSelectedResourceId(null);
    setQuote(null);
    setReviewOpen(false);
    try {
      const result = await getAvailability({
        start: bookingWindow.start,
        end: bookingWindow.end,
      });
      setOptions(result.data.options);
      const preferred = preferredResourceId
        ? result.data.options.find(
            (option) => option.resourceId === preferredResourceId && option.available,
          )
        : undefined;
      if (preferred) await loadQuote(preferred);
    } catch (caught) {
      console.error(caught);
      setOptions([]);
      setError("We could not check live availability. Please try again.");
    } finally {
      setLoadingAvailability(false);
    }
  }

  async function chooseOption(option: AvailabilityOption) {
    if (!option.available) return;
    await loadQuote(option);
  }

  function continueToReview() {
    if (!selectedResourceId || !quote) return;
    setReviewOpen(true);
    window.setTimeout(() => {
      document.getElementById("booking-review")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
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
        window.location.assign(`/book/complete?bookingId=${encodeURIComponent(result.data.bookingId)}`);
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
      setError("We could not start checkout. Your card has not been charged. Check availability and try again.");
      setCheckingOut(false);
    }
  }

  const availableCount = options.filter((option) => option.available).length;
  const selectedOption = options.find((option) => option.resourceId === selectedResourceId);
  const positionedOptions = options.filter((option) => visualPositions[option.resourceId]);
  const unpositionedOptions = options.filter((option) => !visualPositions[option.resourceId]);
  const endOptions = timeValues(true).filter(
    (value) => timeValueToMinutes(value) > timeValueToMinutes(startValue),
  );

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:py-11">
        <header className="max-w-3xl">
          <p className="text-sm font-medium text-slate-500">Book a space</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Choose when. Pick your spot. You&apos;re ready.
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
            See live availability for your full stay, then choose the desk or meeting setup you want.
          </p>
        </header>

        <div className="mt-7 flex max-w-xl items-center gap-2 text-xs font-semibold sm:text-sm">
          <span className={`rounded-full px-3 py-1.5 ${stepClass(true)}`}>1 · When</span>
          <span className={`rounded-full px-3 py-1.5 ${stepClass(options.length > 0)}`}>2 · Pick a spot</span>
          <span className={`rounded-full px-3 py-1.5 ${stepClass(reviewOpen)}`}>3 · Review</span>
        </div>

        <section className="mt-8 border-y border-slate-200 py-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm font-medium text-slate-800">
              <span className="mb-2 flex items-center gap-2">
                <CalendarDays className="h-4 w-4" /> Date
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
                <Clock3 className="h-4 w-4" /> Start
              </span>
              <select
                value={startValue}
                onChange={(event) => changeStart(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-950"
              >
                {timeValues().map((value) => (
                  <option key={value} value={value}>
                    {new Date(`2000-01-01T${value}`).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "UTC",
                    })}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium text-slate-800">
              <span className="mb-2 flex items-center gap-2">
                <Clock3 className="h-4 w-4" /> End
              </span>
              <select
                value={endValue}
                onChange={(event) => setEndValue(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-950"
              >
                {endOptions.map((value) => (
                  <option key={value} value={value}>
                    {new Date(`2000-01-01T${value}`).toLocaleTimeString("en-US", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "UTC",
                    })}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-500">
              {durationHours > 0 ? `${durationHours} hour${durationHours === 1 ? "" : "s"}` : "Choose a valid range"} · Carrollton local time
            </p>
            <button
              type="button"
              onClick={checkAvailability}
              disabled={loadingAvailability || !validRange}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingAvailability && <Loader2 className="h-5 w-5 animate-spin" />}
              Show available spaces
            </button>
          </div>
        </section>

        {notice && (
          <div className="mt-5 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">{notice}</div>
        )}
        {error && (
          <div className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">{error}</div>
        )}

        {options.length > 0 && (
          <section className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500">Live availability</p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-950">Pick your spot</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Select an available desk or the meeting setup for the entire {durationHours}-hour stay.
                </p>
              </div>
              <p className="text-sm text-slate-500">
                {availableCount} available option{availableCount === 1 ? "" : "s"}
              </p>
            </div>

            <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50/80 p-4 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <MapPin className="h-4 w-4" /> Workspace picker
                </div>
                <span className="text-xs text-slate-500">Schematic layout · not to scale</span>
              </div>

              <div className="mt-5 grid min-h-[410px] grid-cols-3 grid-rows-[repeat(2,minmax(100px,1fr))_minmax(120px,1fr)] gap-3 rounded-2xl border border-slate-300 bg-[#f5f9fc] p-3 sm:gap-4 sm:p-5">
                {positionedOptions.map((option) => {
                  const selected = option.resourceId === selectedResourceId;
                  const isMode = option.type === "MODE";
                  return (
                    <button
                      key={option.resourceId}
                      type="button"
                      disabled={!option.available}
                      onClick={() => chooseOption(option)}
                      className={`${visualPositions[option.resourceId]} group flex min-h-24 flex-col items-center justify-center rounded-2xl border p-3 text-center transition sm:p-4 ${
                        selected
                          ? "border-slate-900 bg-slate-900 text-white shadow-lg"
                          : option.available
                            ? "border-blue-200 bg-white text-slate-900 shadow-sm hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md"
                            : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 opacity-70"
                      }`}
                    >
                      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${selected ? "bg-white/10" : "bg-slate-100"}`}>
                        {isMode ? <Users className="h-5 w-5" /> : <Monitor className="h-5 w-5" />}
                      </span>
                      <span className="mt-2 text-sm font-semibold sm:text-base">{option.name}</span>
                      <span className={`mt-1 text-[11px] sm:text-xs ${selected ? "text-slate-300" : "text-slate-500"}`}>
                        {selected ? "Selected" : option.available ? "Available" : "Unavailable"}
                      </span>
                      {selected && <Check className="mt-2 h-4 w-4" />}
                    </button>
                  );
                })}
              </div>

              {unpositionedOptions.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {unpositionedOptions.map((option) => (
                    <button
                      key={option.resourceId}
                      type="button"
                      disabled={!option.available}
                      onClick={() => chooseOption(option)}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm disabled:opacity-50"
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full border border-blue-300 bg-white" /> Available</span>
                <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-slate-900" /> Selected</span>
                <span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-slate-200" /> Unavailable</span>
              </div>
            </div>

            {selectedResourceId && (
              <div className="mt-5 flex flex-col gap-4 border-y border-slate-200 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm text-slate-500">Your spot</p>
                  <p className="mt-1 font-semibold text-slate-950">{selectedOption?.name}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatFacilityDate(bookingWindow.start)} · {formatFacilityTime(bookingWindow.start)}–{formatFacilityTime(bookingWindow.end)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={continueToReview}
                  disabled={loadingQuote || !quote}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {loadingQuote ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                  Continue with {selectedOption?.name || "this spot"}
                  {!loadingQuote && <ArrowRight className="h-4 w-4" />}
                </button>
              </div>
            )}
          </section>
        )}

        {reviewOpen && quote && (
          <section id="booking-review" className="scroll-mt-24 mt-10 border-t border-slate-200 pt-8">
            <p className="text-sm font-medium text-slate-500">Review & checkout</p>
            <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_360px]">
              <div>
                <h2 className="text-2xl font-semibold text-slate-950">{quote.resourceName}</h2>
                <p className="mt-2 text-slate-600">
                  {formatFacilityDate(bookingWindow.start)} · {formatFacilityTime(bookingWindow.start)}–{formatFacilityTime(bookingWindow.end)}
                </p>
                <button
                  type="button"
                  onClick={() => setReviewOpen(false)}
                  className="mt-3 text-sm font-medium text-slate-700 underline underline-offset-4"
                >
                  Change spot
                </button>

                {!user && (
                  <div className="mt-7 grid gap-3 sm:grid-cols-2">
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
                      No account is required before checkout. Your booking creates the account record used for confirmation, access, and future booking management.
                    </p>
                  </div>
                )}
              </div>

              <aside className="rounded-2xl bg-slate-50 p-5">
                <div className="flex items-center justify-between gap-4 text-sm">
                  <span>{quote.durationHours} hours</span>
                  <span>{money(quote.subtotalCents)}</span>
                </div>
                {quote.membershipName && <p className="mt-3 text-sm text-slate-600">{quote.membershipName}</p>}
                {quote.includedHoursApplied > 0 && (
                  <p className="mt-2 text-sm text-slate-600">
                    {quote.includedHoursApplied} hour{quote.includedHoursApplied === 1 ? "" : "s"} covered by membership. {Math.max(0, quote.includedHoursRemaining - quote.includedHoursApplied)} remain after this booking.
                  </p>
                )}
                {quote.billableHours > 0 && quote.includedHoursApplied > 0 && (
                  <p className="mt-2 text-sm text-slate-600">
                    {quote.billableHours} additional hours × {money(quote.hourlyRateCents)}
                  </p>
                )}
                {quote.accountCreditAppliedCents > 0 && (
                  <div className="mt-4 rounded-xl bg-white p-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-slate-600">Account credit</span>
                      <span className="font-medium text-slate-950">−{money(quote.accountCreditAppliedCents)}</span>
                    </div>
                  </div>
                )}
                <div className="mt-5 flex items-baseline justify-between border-t border-slate-200 pt-4">
                  <span className="font-medium">Amount due</span>
                  <span className="text-2xl font-semibold text-slate-950">{money(quote.totalCents)}</span>
                </div>
                <button
                  type="button"
                  onClick={checkout}
                  disabled={checkingOut || authLoading}
                  className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {checkingOut && <Loader2 className="h-5 w-5 animate-spin" />}
                  {quote.totalCents === 0 ? "Confirm booking" : "Continue to payment"}
                </button>
                <p className="mt-3 text-center text-xs leading-5 text-slate-500">
                  Your spot is held for 15 minutes when checkout begins. A booking is not confirmed until payment or included entitlements are accepted.
                </p>
              </aside>
            </div>
          </section>
        )}

        <div className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
          Looking for rates or membership details? <Link href="/pricing" className="font-medium text-slate-900 underline underline-offset-4">View pricing</Link>.
        </div>
      </main>
    </AppShell>
  );
}
