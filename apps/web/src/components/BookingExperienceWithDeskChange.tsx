"use client";

import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  Laptop,
  Loader2,
  MoveRight,
  Users,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";

const FACILITY_TIME_ZONE = "America/New_York";
const OPEN_MINUTES = 8 * 60;
const CLOSE_MINUTES = 20 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

type AvailabilityOption = {
  resourceId: string;
  name: string;
  type: "SEAT" | "MODE";
  available: boolean;
};

type DeskSegment = {
  resourceId: string;
  resourceName: string;
  start: number;
  end: number;
};

type DeskChangePlan = {
  planId: string;
  kind: "desk_change";
  changeAt: number;
  segments: [DeskSegment, DeskSegment];
};

type Quote = {
  resourceId: string;
  resourceName: string;
  resourceType: "SEAT" | "MODE";
  bookingKind: "single" | "desk_change";
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
  deskChangePlanId?: string;
  segments?: [DeskSegment, DeskSegment];
};

type Selection =
  | { kind: "single"; option: AvailabilityOption }
  | { kind: "desk_change"; plan: DeskChangePlan };

const getAvailability = httpsCallable<
  { start: number; end: number },
  {
    start: number;
    end: number;
    options: AvailabilityOption[];
    deskChangeOptions: DeskChangePlan[];
  }
>(functions, "booking_getAvailability");

const createQuote = httpsCallable<
  {
    resourceId?: string;
    deskChangePlanId?: string;
    start: number;
    end: number;
  },
  Quote
>(functions, "booking_createQuote");

const beginCheckout = httpsCallable<
  {
    resourceId?: string;
    deskChangePlanId?: string;
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

function selectionInput(selection: Selection) {
  return selection.kind === "single"
    ? { resourceId: selection.option.resourceId }
    : { deskChangePlanId: selection.plan.planId };
}

function selectionKey(selection: Selection | null) {
  if (!selection) return null;
  return selection.kind === "single"
    ? `single:${selection.option.resourceId}`
    : `change:${selection.plan.planId}`;
}

export default function BookingExperienceWithDeskChange() {
  const { user, loading: authLoading } = useAuth();
  const defaults = useMemo(() => defaultBookingValues(), []);
  const todayAtFacility = useMemo(() => facilityDateValue(), []);
  const [dateValue, setDateValue] = useState(defaults.date);
  const [startValue, setStartValue] = useState(defaults.start);
  const [endValue, setEndValue] = useState(defaults.end);
  const [preferredResourceId, setPreferredResourceId] = useState<string | null>(null);
  const [options, setOptions] = useState<AvailabilityOption[]>([]);
  const [deskChangeOptions, setDeskChangeOptions] = useState<DeskChangePlan[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
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
  const durationHours = (bookingWindow.end - bookingWindow.start) / 3_600_000;
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
    setSelection(null);
    setQuote(null);
    setReviewOpen(false);
    setOptions([]);
    setDeskChangeOptions([]);
  }, [dateValue, startValue, endValue]);

  function changeStart(nextStart: string) {
    setStartValue(nextStart);
    const startMinutes = timeValueToMinutes(nextStart);
    if (timeValueToMinutes(endValue) <= startMinutes) {
      setEndValue(minutesToValue(Math.min(CLOSE_MINUTES, startMinutes + 60)));
    }
  }

  async function loadQuote(nextSelection: Selection) {
    setSelection(nextSelection);
    setReviewOpen(false);
    setLoadingQuote(true);
    setQuote(null);
    setError(null);
    try {
      const result = await createQuote({
        ...selectionInput(nextSelection),
        start: bookingWindow.start,
        end: bookingWindow.end,
      });
      setQuote(result.data);
    } catch (caught) {
      console.error(caught);
      setSelection(null);
      setError("That option just became unavailable. Check availability again.");
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
    setSelection(null);
    setQuote(null);
    setReviewOpen(false);
    try {
      const result = await getAvailability({
        start: bookingWindow.start,
        end: bookingWindow.end,
      });
      setOptions(result.data.options);
      setDeskChangeOptions(result.data.deskChangeOptions || []);
      const preferred = preferredResourceId
        ? result.data.options.find(
            (option) => option.resourceId === preferredResourceId && option.available,
          )
        : undefined;
      if (preferred) {
        await loadQuote({ kind: "single", option: preferred });
      }
    } catch (caught) {
      console.error(caught);
      setOptions([]);
      setDeskChangeOptions([]);
      setError("We could not check live availability. Please try again.");
    } finally {
      setLoadingAvailability(false);
    }
  }

  function continueToReview() {
    if (!selection || !quote) return;
    setReviewOpen(true);
    window.setTimeout(() => {
      document.getElementById("booking-review")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
  }

  async function checkout() {
    if (!selection || !quote) return;
    if (!user && (!guestName.trim() || !guestEmail.trim())) {
      setError("Enter your name and email to continue as a guest.");
      return;
    }
    setCheckingOut(true);
    setError(null);
    try {
      const origin = window.location.origin;
      const result = await beginCheckout({
        ...selectionInput(selection),
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

  const availableOptions = options.filter((option) => option.available);
  const selectedKey = selectionKey(selection);
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
            We look for one desk that stays yours for the whole visit. If the day is fragmented, we can also show an optional plan with one desk change.
          </p>
        </header>

        {notice ? (
          <div className="mt-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">
            {error}
          </div>
        ) : null}

        <section className="mt-8 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
          <div className="flex items-start gap-3">
            <CalendarDays className="mt-0.5 h-5 w-5 text-slate-500" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold text-slate-950">When do you need a desk?</h2>
              <p className="mt-1 text-sm text-slate-600">Choose one continuous stay. Hours shown are local to Hi Coworking.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <label className="text-sm font-medium text-slate-700">
              Date
              <input
                type="date"
                min={todayAtFacility}
                value={dateValue}
                onChange={(event) => setDateValue(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-950"
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Start
              <select
                value={startValue}
                onChange={(event) => changeStart(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-950"
              >
                {timeValues().map((value) => (
                  <option key={value} value={value}>{formatFacilityTime(toWindow(dateValue, value, minutesToValue(Math.min(CLOSE_MINUTES, timeValueToMinutes(value) + 30))).start)}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-700">
              End
              <select
                value={endValue}
                onChange={(event) => setEndValue(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-950"
              >
                {endOptions.map((value) => (
                  <option key={value} value={value}>{formatFacilityTime(toWindow(dateValue, startValue, value).end)}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Clock3 className="h-4 w-4" aria-hidden="true" />
              {validRange ? `${durationHours} hour${durationHours === 1 ? "" : "s"}` : "Choose a valid range"}
            </div>
            <button
              type="button"
              onClick={checkAvailability}
              disabled={loadingAvailability || !validRange}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loadingAvailability ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Check availability
            </button>
          </div>
        </section>

        {options.length > 0 || deskChangeOptions.length > 0 ? (
          <section className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Choose your setup</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {availableOptions.length > 0
                    ? "Continuous options keep you in the same spot for your entire stay."
                    : "No single desk is open for the full stay."}
                </p>
              </div>
              <p className="text-sm text-slate-500">
                {availableOptions.length} continuous option{availableOptions.length === 1 ? "" : "s"}
              </p>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {options.map((option) => {
                const key = `single:${option.resourceId}`;
                const selected = selectedKey === key;
                return (
                  <button
                    key={option.resourceId}
                    type="button"
                    disabled={!option.available || loadingQuote}
                    onClick={() => loadQuote({ kind: "single", option })}
                    className={`min-h-32 rounded-2xl p-4 text-left ring-1 transition ${
                      selected
                        ? "bg-slate-900 text-white ring-slate-900"
                        : option.available
                          ? "bg-white text-slate-950 ring-slate-200 hover:ring-slate-400"
                          : "cursor-not-allowed bg-slate-50 text-slate-400 ring-slate-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                        {option.type === "MODE" ? <Users className="h-4 w-4" /> : <Laptop className="h-4 w-4" />}
                      </div>
                      <span className="text-xs font-semibold uppercase tracking-wide">
                        {option.available ? "Available" : "Unavailable"}
                      </span>
                    </div>
                    <p className="mt-4 font-semibold">{option.name}</p>
                    <p className={`mt-1 text-sm ${selected ? "text-slate-300" : "text-slate-500"}`}>
                      {option.type === "MODE" ? "Meeting setup for the full stay" : "Same desk for the full stay"}
                    </p>
                  </button>
                );
              })}
            </div>

            {deskChangeOptions.length > 0 ? (
              <div className="mt-7 rounded-3xl bg-amber-50 p-5 ring-1 ring-amber-200 sm:p-6">
                <div className="max-w-3xl">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-800">Optional one-change plan</p>
                  <h3 className="mt-2 text-xl font-semibold text-slate-950">Stay for the full time with one desk change</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    No single desk is available for your entire stay, but we can keep the visit intact by reserving two desks. You will move once at the time shown. This is never selected automatically.
                  </p>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-3">
                  {deskChangeOptions.map((plan) => {
                    const key = `change:${plan.planId}`;
                    const selected = selectedKey === key;
                    return (
                      <button
                        key={plan.planId}
                        type="button"
                        disabled={loadingQuote}
                        onClick={() => loadQuote({ kind: "desk_change", plan })}
                        className={`rounded-2xl p-4 text-left ring-1 transition ${
                          selected
                            ? "bg-slate-900 text-white ring-slate-900"
                            : "bg-white text-slate-950 ring-amber-200 hover:ring-amber-400"
                        }`}
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <span>{plan.segments[0].resourceName}</span>
                          <MoveRight className="h-4 w-4" aria-hidden="true" />
                          <span>{plan.segments[1].resourceName}</span>
                        </div>
                        <div className={`mt-4 space-y-2 text-sm ${selected ? "text-slate-300" : "text-slate-600"}`}>
                          <p>{formatFacilityTime(plan.segments[0].start)}–{formatFacilityTime(plan.segments[0].end)} · {plan.segments[0].resourceName}</p>
                          <p className="font-semibold">Move once at {formatFacilityTime(plan.changeAt)}</p>
                          <p>{formatFacilityTime(plan.segments[1].start)}–{formatFacilityTime(plan.segments[1].end)} · {plan.segments[1].resourceName}</p>
                        </div>
                        <p className={`mt-4 text-xs font-semibold uppercase tracking-wide ${selected ? "text-white" : "text-amber-800"}`}>
                          {selected ? "Selected" : "Choose this plan"}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {loadingQuote ? (
              <div className="mt-5 flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" /> Preparing your live price…
              </div>
            ) : null}

            {selection && quote && !reviewOpen ? (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-slate-50 px-5 py-4 ring-1 ring-slate-200">
                <div>
                  <p className="font-semibold text-slate-950">{quote.resourceName}</p>
                  <p className="mt-1 text-sm text-slate-600">{money(quote.totalCents)} total for this stay</p>
                </div>
                <button
                  type="button"
                  onClick={continueToReview}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
                >
                  Continue to review <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {reviewOpen && selection && quote ? (
          <section id="booking-review" className="mt-9 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-7">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">Review your booking</p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-950">{quote.resourceName}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {formatFacilityDate(bookingWindow.start)} · {formatFacilityTime(bookingWindow.start)}–{formatFacilityTime(bookingWindow.end)}
                </p>
              </div>
            </div>

            {quote.bookingKind === "desk_change" && quote.segments ? (
              <div className="mt-6 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
                <p className="font-semibold text-slate-950">Your one desk change</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                  <div>
                    <p className="font-medium text-slate-900">{quote.segments[0].resourceName}</p>
                    <p className="mt-1 text-sm text-slate-600">{formatFacilityTime(quote.segments[0].start)}–{formatFacilityTime(quote.segments[0].end)}</p>
                  </div>
                  <MoveRight className="hidden h-5 w-5 text-amber-700 sm:block" />
                  <div>
                    <p className="font-medium text-slate-900">{quote.segments[1].resourceName}</p>
                    <p className="mt-1 text-sm text-slate-600">{formatFacilityTime(quote.segments[1].start)}–{formatFacilityTime(quote.segments[1].end)}</p>
                  </div>
                </div>
                <p className="mt-3 text-sm font-medium text-amber-900">
                  You&apos;ll move once at {formatFacilityTime(quote.segments[0].end)}.
                </p>
              </div>
            ) : null}

            <dl className="mt-6 divide-y divide-slate-200 rounded-2xl bg-slate-50 px-4 ring-1 ring-slate-200">
              <div className="flex justify-between gap-4 py-3 text-sm">
                <dt className="text-slate-600">Duration</dt>
                <dd className="font-medium text-slate-950">{quote.durationHours} hour{quote.durationHours === 1 ? "" : "s"}</dd>
              </div>
              {quote.membershipName ? (
                <div className="flex justify-between gap-4 py-3 text-sm">
                  <dt className="text-slate-600">Membership</dt>
                  <dd className="font-medium text-slate-950">{quote.membershipName}</dd>
                </div>
              ) : null}
              {quote.includedHoursApplied > 0 ? (
                <div className="flex justify-between gap-4 py-3 text-sm">
                  <dt className="text-slate-600">Included hours applied</dt>
                  <dd className="font-medium text-slate-950">−{quote.includedHoursApplied} hr</dd>
                </div>
              ) : null}
              {quote.accountCreditAppliedCents > 0 ? (
                <div className="flex justify-between gap-4 py-3 text-sm">
                  <dt className="text-slate-600">Account credit</dt>
                  <dd className="font-medium text-slate-950">−{money(quote.accountCreditAppliedCents)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4 py-4">
                <dt className="font-semibold text-slate-950">Total</dt>
                <dd className="text-lg font-semibold text-slate-950">{money(quote.totalCents)}</dd>
              </div>
            </dl>

            {!authLoading && !user ? (
              <div className="mt-6">
                <h3 className="font-semibold text-slate-950">Your contact information</h3>
                <p className="mt-1 text-sm text-slate-600">We&apos;ll use this for your booking confirmation and access details.</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium text-slate-700">
                    Name
                    <input
                      value={guestName}
                      onChange={(event) => setGuestName(event.target.value)}
                      autoComplete="name"
                      className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-700">
                    Email
                    <input
                      type="email"
                      value={guestEmail}
                      onChange={(event) => setGuestEmail(event.target.value)}
                      autoComplete="email"
                      className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                    />
                  </label>
                  <label className="text-sm font-medium text-slate-700 sm:col-span-2">
                    Phone <span className="font-normal text-slate-500">(optional)</span>
                    <input
                      type="tel"
                      value={guestPhone}
                      onChange={(event) => setGuestPhone(event.target.value)}
                      autoComplete="tel"
                      className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5"
                    />
                  </label>
                </div>
              </div>
            ) : null}

            <div className="mt-7 flex flex-wrap items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => setReviewOpen(false)}
                className="text-sm font-semibold text-slate-600 hover:text-slate-950"
              >
                Change selection
              </button>
              <button
                type="button"
                onClick={checkout}
                disabled={checkingOut || authLoading}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {checkingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {quote.totalCents === 0 ? "Confirm booking" : `Continue to payment · ${money(quote.totalCents)}`}
              </button>
            </div>
          </section>
        ) : null}
      </main>
    </AppShell>
  );
}
