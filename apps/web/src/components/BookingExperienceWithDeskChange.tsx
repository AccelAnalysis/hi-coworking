"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Laptop,
  Loader2,
  MoveRight,
  Users,
} from "lucide-react";
import { PublishedBookingMap } from "@/components/booking/PublishedBookingMap";
import { compatibleAddOns, type PublishedCatalog } from "@/lib/bookingCatalog";
import { AppShell } from "@/components/AppShell";
import { functions } from "@/lib/firebase";
import { bookingHoldKey, LEGACY_HOLD_KEY } from "@/lib/bookingRecovery";
import { useAuth } from "@/lib/authContext";

const FACILITY_TIME_ZONE = "America/New_York";
const PUBLIC_DESK_RATE_CENTS = 1750;

type ResourceIntent = "DESK" | "MEETING";

type DaySchedule = {
  date: string;
  timeZone: string;
  isOpen: boolean;
  intervals: Array<{ startTime: string; endTime: string }>;
  hasException: boolean;
};

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

type CatalogSelection = { setupId?: string; addOnIds?: string[]; attendeeCount?: number };

type Quote = {
  setup?: { id: string; name: string; capacity: number } | null;
  addOns?: Array<{ id: string; name: string; priceCents: number }>;
  addOnTotalCents?: number;
  spaceSubtotalCents?: number;
  attendeeCount?: number;
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
  dailyCapApplied: boolean;
  currency: string;
  deskChangePlanId?: string;
  segments?: [DeskSegment, DeskSegment];
};

type Selection =
  | { kind: "single"; option: AvailabilityOption }
  | { kind: "desk_change"; plan: DeskChangePlan };

const getDaySchedule = httpsCallable<{ date: string }, DaySchedule>(
  functions,
  "booking_getDaySchedule",
);

const getAvailability = httpsCallable<
  { start: number; end: number; resourceType: "SEAT" | "MODE" },
  {
    start: number;
    end: number;
    options: AvailabilityOption[];
    deskChangeOptions: DeskChangePlan[];
  }
>(functions, "booking_getAvailability");

const getPublishedCatalog = httpsCallable<Record<string, never>, PublishedCatalog>(functions, "space_getPublishedCatalog");

const createQuote = httpsCallable<
  CatalogSelection & {
    resourceId?: string;
    deskChangePlanId?: string;
    start: number;
    end: number;
  },
  Quote
>(functions, "booking_createQuote");

const beginCheckout = httpsCallable<
  CatalogSelection & {
    expectedTotalCents: number;
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
  if (!value) return Number.NaN;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function formatClockValue(value: string) {
  if (!value) return "";
  return new Date(`2000-01-01T${value}:00Z`).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

function intervalStartValues(schedule: DaySchedule | null, dateValue: string) {
  if (!schedule) return [] as string[];
  const today = facilityDateValue();
  const currentMinutes = facilityClockMinutes();
  const nextHalfHour = Math.ceil((currentMinutes + 1) / 30) * 30;
  const values: string[] = [];
  for (const interval of schedule.intervals) {
    const start = timeValueToMinutes(interval.startTime);
    const end = timeValueToMinutes(interval.endTime);
    for (let minutes = start; minutes <= end - 30; minutes += 30) {
      if (dateValue === today && minutes < nextHalfHour) continue;
      values.push(minutesToValue(minutes));
    }
  }
  return values;
}

function intervalForStart(schedule: DaySchedule | null, startValue: string) {
  if (!schedule || !startValue) return null;
  const start = timeValueToMinutes(startValue);
  return schedule.intervals.find((interval) => (
    start >= timeValueToMinutes(interval.startTime)
    && start < timeValueToMinutes(interval.endTime)
  )) || null;
}

function endValuesForStart(schedule: DaySchedule | null, startValue: string) {
  const interval = intervalForStart(schedule, startValue);
  if (!interval) return [] as string[];
  const start = timeValueToMinutes(startValue);
  const end = timeValueToMinutes(interval.endTime);
  const values: string[] = [];
  for (let minutes = start + 30; minutes <= end; minutes += 30) {
    values.push(minutesToValue(minutes));
  }
  return values;
}

function addDaysToDateKey(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return date.toISOString().slice(0, 10);
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
  if (!startValue || !endValue) return { start: 0, end: 0 };
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

function hoursLabel(hours: number) {
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function scheduleSummary(schedule: DaySchedule | null) {
  if (!schedule || schedule.intervals.length === 0) return "Closed for bookings";
  return schedule.intervals
    .map((interval) => `${formatClockValue(interval.startTime)}–${formatClockValue(interval.endTime)}`)
    .join(" · ");
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

function errorMessage(caught: unknown, fallback: string) {
  const raw = caught as { message?: string };
  if (!raw?.message) return fallback;
  const split = raw.message.split(": ");
  return split[split.length - 1] || fallback;
}

export default function BookingExperienceWithDeskChange() {
  const { user, loading: authLoading } = useAuth();
  const todayAtFacility = useMemo(() => facilityDateValue(), []);
  const requestedStartRef = useRef<string | null>(null);
  const requestedDurationRef = useRef<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [catalog, setCatalog] = useState<PublishedCatalog>({ setups: [], addOns: [] });
  const [catalogError, setCatalogError] = useState(false);
  const [setupId, setSetupId] = useState("");
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const [attendeeCount, setAttendeeCount] = useState(1);
  const [selectionOrder, setSelectionOrder] = useState<"time" | "seat">("time");
  const quoteVersion = useRef(0);
  const availabilityVersion = useRef(0);
  const selectedSetup = catalog.setups.find((setup) => setup.id === setupId);
  const availableAddOns = compatibleAddOns(catalog, selectedSetup);
  useEffect(() => {
    let active = true;
    void getPublishedCatalog({}).then((result) => { if (active) setCatalog(result.data); })
      .catch(() => { if (active) setCatalogError(true); });
    return () => { active = false; };
  }, []);
  const [intent, setIntent] = useState<ResourceIntent | null>(null);
  const [dateValue, setDateValue] = useState(todayAtFacility);
  const [startValue, setStartValue] = useState("");
  const [endValue, setEndValue] = useState("");
  const [schedule, setSchedule] = useState<DaySchedule | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [findingNextOpen, setFindingNextOpen] = useState(false);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedDate = params.get("date");
    const requestedTime = params.get("time");
    const requestedDuration = Number(params.get("duration"));
    const requestedResource = params.get("resource");

    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate >= todayAtFacility) {
      setDateValue(requestedDate);
    }
    if (requestedTime && /^\d{2}:\d{2}$/.test(requestedTime)) {
      requestedStartRef.current = requestedTime;
    }
    if (Number.isFinite(requestedDuration) && requestedDuration > 0) {
      requestedDurationRef.current = requestedDuration;
    }
    if (requestedResource) {
      setPreferredResourceId(requestedResource);
      setIntent(requestedResource.startsWith("mode-") ? "MEETING" : "DESK");
    }
    if (params.get("checkout") === "cancelled") {
      setNotice("Checkout was cancelled. No booking was confirmed.");
    }
    setHydrated(true);
  }, [todayAtFacility]);

  useEffect(() => {
    if (!catalog.setups.length) return;
    const params = new URLSearchParams(window.location.search);
    const setup = catalog.setups.find((item) => item.id === params.get("setup") && item.published);
    if (!setup) return;
    const allowed = compatibleAddOns(catalog, setup).map((item) => item.id);
    setSetupId(setup.id);
    setAddOnIds((params.get("addons") || "").split(",").filter((id) => allowed.includes(id)));
    setAttendeeCount(Math.max(1, Math.min(setup.capacity, Number(params.get("people")) || 1)));
    setIntent(setup.serviceType === "DESK" ? "DESK" : "MEETING");
    setPreferredResourceId(setup.resourceId);
  }, [catalog]);

  useEffect(() => {
    if (!hydrated || !intent) return;
    let active = true;
    setLoadingSchedule(true);
    setSchedule(null);
    setError(null);
    void getDaySchedule({ date: dateValue })
      .then((result) => {
        if (!active) return;
        const nextSchedule = result.data;
        setSchedule(nextSchedule);
        const starts = intervalStartValues(nextSchedule, dateValue);
        if (starts.length === 0) {
          setStartValue("");
          setEndValue("");
          return;
        }
        const requestedStart = requestedStartRef.current;
        const nextStart = requestedStart && starts.includes(requestedStart)
          ? requestedStart
          : starts[0];
        requestedStartRef.current = null;
        setStartValue(nextStart);
        const ends = endValuesForStart(nextSchedule, nextStart);
        const requestedDuration = requestedDurationRef.current;
        requestedDurationRef.current = null;
        const preferredEnd = requestedDuration && Number.isFinite(requestedDuration)
          ? minutesToValue(timeValueToMinutes(nextStart) + requestedDuration * 60)
          : minutesToValue(timeValueToMinutes(nextStart) + 120);
        setEndValue(
          ends.includes(preferredEnd)
            ? preferredEnd
            : ends[Math.min(ends.length - 1, 3)] || ends[0] || "",
        );
      })
      .catch((caught) => {
        if (!active) return;
        console.error(caught);
        setStartValue("");
        setEndValue("");
        setError("We could not load the available hours for this date. Please try again.");
      })
      .finally(() => {
        if (active) setLoadingSchedule(false);
      });
    return () => {
      active = false;
    };
  }, [dateValue, hydrated, intent]);

  useEffect(() => {
    quoteVersion.current += 1;
    availabilityVersion.current += 1;
    setLoadingQuote(false);
    setLoadingAvailability(false);
    setOptions([]);
    setDeskChangeOptions([]);
    setSelection(null);
    setQuote(null);
    setReviewOpen(false);
  }, [intent, dateValue, startValue, endValue]);

  const startOptions = useMemo(
    () => intervalStartValues(schedule, dateValue),
    [schedule, dateValue],
  );
  const endOptions = useMemo(
    () => endValuesForStart(schedule, startValue),
    [schedule, startValue],
  );
  const bookingWindow = useMemo(
    () => toWindow(dateValue, startValue, endValue),
    [dateValue, startValue, endValue],
  );
  const durationHours = bookingWindow.end > bookingWindow.start
    ? (bookingWindow.end - bookingWindow.start) / 3_600_000
    : 0;
  const validRange = Boolean(intent && startValue && endValue && bookingWindow.end > bookingWindow.start);

  function chooseIntent(nextIntent: ResourceIntent) {
    setIntent(nextIntent);
    setSetupId("");
    setAddOnIds([]);
    setAttendeeCount(1);
    setPreferredResourceId(null);
    setNotice(null);
    setError(null);
  }

  function changeStart(nextStart: string) {
    setStartValue(nextStart);
    const ends = endValuesForStart(schedule, nextStart);
    const preferredEnd = minutesToValue(timeValueToMinutes(nextStart) + 120);
    setEndValue(
      ends.includes(preferredEnd)
        ? preferredEnd
        : ends[Math.min(ends.length - 1, 3)] || ends[0] || "",
    );
  }

  async function findNextOpenDay() {
    setFindingNextOpen(true);
    setError(null);
    try {
      for (let offset = 1; offset <= 14; offset += 1) {
        const candidate = addDaysToDateKey(dateValue, offset);
        const result = await getDaySchedule({ date: candidate });
        if (result.data.isOpen && intervalStartValues(result.data, candidate).length > 0) {
          setDateValue(candidate);
          return;
        }
      }
      setError("No open booking date was found in the next two weeks.");
    } catch (caught) {
      console.error(caught);
      setError("We could not find the next open date. Please choose another date.");
    } finally {
      setFindingNextOpen(false);
    }
  }

  function chooseSetup(nextId: string) {
    const next = catalog.setups.find((setup) => setup.id === nextId);
    quoteVersion.current += 1;
    availabilityVersion.current += 1;
    setLoadingQuote(false); setLoadingAvailability(false);
    setSetupId(nextId); setAddOnIds([]); setAttendeeCount(1);
    setPreferredResourceId(next?.resourceId ?? null);
    setSelection(null); setQuote(null); setReviewOpen(false); setOptions([]); setDeskChangeOptions([]);
  }

  async function loadQuote(nextSelection: Selection, overrides: CatalogSelection = {}) {
    const version = ++quoteVersion.current;
    const compatibleSetup = nextSelection.kind === "single" && selectedSetup?.resourceId === nextSelection.option.resourceId;
    const catalogInput: CatalogSelection = nextSelection.kind === "desk_change" || !compatibleSetup
      ? { addOnIds: [], attendeeCount: 1 }
      : { setupId, addOnIds, attendeeCount, ...overrides };
    if (!compatibleSetup) { setSetupId(""); setAddOnIds([]); setAttendeeCount(1); }
    setSelection(nextSelection);
    setReviewOpen(false);
    setLoadingQuote(true);
    setQuote(null);
    setError(null);
    try {
      const result = await createQuote({
        ...selectionInput(nextSelection),
        ...catalogInput,
        start: bookingWindow.start,
        end: bookingWindow.end,
      });
      if (version !== quoteVersion.current) return;
      setQuote(result.data);
    } catch (caught) {
      if (version !== quoteVersion.current) return;
      console.error(caught);
      setSelection(null);
      setError(errorMessage(caught, "That option just became unavailable. Check availability again."));
    } finally {
      if (version === quoteVersion.current) setLoadingQuote(false);
    }
  }

  async function checkAvailability() {
    if (!intent || !validRange) {
      setError("Choose a space type and a valid start and end time.");
      return;
    }
    const version = ++availabilityVersion.current;
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
        resourceType: intent === "DESK" ? "SEAT" : "MODE",
      });
      if (version !== availabilityVersion.current) return;
      setOptions(result.data.options);
      setDeskChangeOptions(intent === "DESK" ? result.data.deskChangeOptions || [] : []);

      if (intent === "MEETING") {
        const meeting = result.data.options.find((option) => option.available && (!selectedSetup || option.resourceId === selectedSetup.resourceId));
        if (meeting) await loadQuote({ kind: "single", option: meeting });
        return;
      }

      const preferred = preferredResourceId
        ? result.data.options.find(
            (option) => option.resourceId === preferredResourceId && option.available,
          )
        : undefined;
      if (preferred) await loadQuote({ kind: "single", option: preferred });
    } catch (caught) {
      if (version !== availabilityVersion.current) return;
      console.error(caught);
      setOptions([]);
      setDeskChangeOptions([]);
      setError(errorMessage(caught, "We could not check live availability. Please try again."));
    } finally {
      if (version === availabilityVersion.current) setLoadingAvailability(false);
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
        ...(selection.kind === "single" && setupId ? { setupId, addOnIds, attendeeCount } : {}),
        expectedTotalCents: quote.totalCents,
        start: bookingWindow.start,
        end: bookingWindow.end,
        successUrl: `${origin}/book/complete`,
        cancelUrl: `${origin}/book?${new URLSearchParams({ checkout: "cancelled", date: dateValue, time: startValue, ...(setupId ? { setup: setupId, addons: addOnIds.join(","), people: String(attendeeCount) } : {}), duration: String((bookingWindow.end - bookingWindow.start) / 3_600_000), ...(selection.kind === "single" ? { resource: selection.option.resourceId } : {}) })}`,
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

      const savedHold = JSON.stringify({
        holdId: result.data.holdId,
        holdSecret: result.data.holdSecret,
        expiresAt: result.data.expiresAt,
      });
      window.localStorage.setItem(bookingHoldKey(result.data.holdId), savedHold);
      // Retain legacy compatibility for checkouts created before holdId return URLs.
      window.localStorage.setItem(LEGACY_HOLD_KEY, savedHold);
      window.location.assign(result.data.checkoutUrl);
    } catch (caught) {
      console.error(caught);
      setError(errorMessage(caught, "We could not start checkout. Your card has not been charged. Check availability and try again."));
      setCheckingOut(false);
    }
  }

  const availableOptions = options.filter((option) => option.available);
  const selectedKey = selectionKey(selection);
  const meetingOption = options.find((option) => option.type === "MODE");
  const remainingAfterBooking = quote
    ? Math.max(0, quote.includedHoursRemaining - quote.includedHoursApplied)
    : 0;
  const memberDiscountPercent = quote?.membershipName && quote.resourceType === "SEAT"
    ? Math.max(0, Math.round((1 - quote.hourlyRateCents / PUBLIC_DESK_RATE_CENTS) * 100))
    : 0;

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:py-11">
        <header className="max-w-3xl">
          <p className="text-sm font-medium text-slate-500">Book a space</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Choose your seat or start with a time.
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
            Start with a published seat or setup, or choose a time first. Live availability and prices are checked for your entire stay before payment.
          </p>
        </header>

        {notice ? (
          <div className="mt-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{notice}</div>
        ) : null}
        {error ? (
          <div className="mt-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</div>
        ) : null}

        <section className="mt-8 border-t border-slate-200 pt-7">
          <h2 className="text-xl font-semibold text-slate-950">1. What are you booking?</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => chooseIntent("DESK")}
              className={`flex min-h-28 items-start gap-4 rounded-2xl border p-5 text-left transition ${
                intent === "DESK"
                  ? "border-slate-950 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-950 hover:border-slate-400"
              }`}
            >
              <Laptop className="mt-0.5 h-6 w-6 shrink-0" />
              <span>
                <span className="block text-lg font-semibold">Coworking desk</span>
                <span className={`mt-1 block text-sm leading-6 ${intent === "DESK" ? "text-slate-300" : "text-slate-600"}`}>
                  Pick an available desk. If no single desk covers the whole stay, an optional one-change plan can still be offered.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => chooseIntent("MEETING")}
              className={`flex min-h-28 items-start gap-4 rounded-2xl border p-5 text-left transition ${
                intent === "MEETING"
                  ? "border-slate-950 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-950 hover:border-slate-400"
              }`}
            >
              <Users className="mt-0.5 h-6 w-6 shrink-0" />
              <span>
                <span className="block text-lg font-semibold">Meeting room</span>
                <span className={`mt-1 block text-sm leading-6 ${intent === "MEETING" ? "text-slate-300" : "text-slate-600"}`}>
                  Check the meeting room directly for the exact time you need.
                </span>
              </span>
            </button>
          </div>
        </section>

        {intent && <section className="mt-7 rounded-2xl border border-slate-200 p-5">
          <h2 className="text-lg font-semibold">How would you like to choose?</h2>
          <div className="mt-3 flex gap-3">
            <button type="button" aria-pressed={selectionOrder === "time"} onClick={() => setSelectionOrder("time")} className={`rounded-full border px-4 py-2 ${selectionOrder === "time" ? "bg-slate-950 text-white" : "bg-white"}`}>Time first</button>
            <button type="button" aria-pressed={selectionOrder === "seat"} onClick={() => setSelectionOrder("seat")} className={`rounded-full border px-4 py-2 ${selectionOrder === "seat" ? "bg-slate-950 text-white" : "bg-white"}`}>Seat / setup first</button>
          </div>
          {catalogError && <p role="alert" className="mt-3 text-sm text-amber-800">Published setups and add-ons could not be loaded. Standard resource booking remains available; no unpublished offers are substituted.</p>}
          <label className="mt-4 block text-sm font-medium">Published setup (optional)
            <select value={setupId} onChange={(event) => chooseSetup(event.target.value)} className="mt-2 block w-full rounded-xl border border-slate-300 bg-white p-3">
              <option value="">Standard resource — no setup or add-ons</option>
              {catalog.setups.filter((setup) => setup.published && setup.serviceType === (intent === "DESK" ? "DESK" : "CONFERENCE")).map((setup) => <option key={setup.id} value={setup.id}>{setup.name} · up to {setup.capacity} people</option>)}
            </select>
          </label>
          {selectedSetup && <p className="mt-2 text-sm text-slate-600">{selectedSetup.description} {selectedSetup.arrangement} · Live availability and current pricing will be verified for {selectedSetup.resourceId}.</p>}
          {selectionOrder === "seat" && <PublishedBookingMap timestamp={bookingWindow.start || toWindow(dateValue, "12:00", "13:00").start} resourceType={intent === "DESK" ? "SEAT" : "MODE_ZONE"} selectedResource={preferredResourceId} availability={options} onSelect={(resourceId) => {
            const setup = catalog.setups.find((item) => item.published && item.resourceId === resourceId && item.serviceType === (intent === "DESK" ? "DESK" : "CONFERENCE"));
            chooseSetup(setup?.id ?? ""); setPreferredResourceId(resourceId);
          }} />}
          {preferredResourceId && <p role="status" className="mt-3 text-sm font-medium">Preferred resource: {preferredResourceId}. Choose your date and time, then check availability.</p>}
        </section>}

        {intent ? (
          <section className="mt-9 border-t border-slate-200 pt-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">2. When do you need it?</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Times come from the current operating calendar, including closures and special hours.
                </p>
              </div>
              {schedule ? <p className="text-sm font-medium text-slate-700">{scheduleSummary(schedule)}</p> : null}
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-3">
              <label className="text-sm font-medium text-slate-800">
                <span className="mb-2 flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Date</span>
                <input
                  type="date"
                  min={todayAtFacility}
                  value={dateValue}
                  onChange={(event) => setDateValue(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-950"
                />
              </label>

              <label className="text-sm font-medium text-slate-800">
                <span className="mb-2 flex items-center gap-2"><Clock3 className="h-4 w-4" /> Start</span>
                <select
                  value={startValue}
                  onChange={(event) => changeStart(event.target.value)}
                  disabled={loadingSchedule || startOptions.length === 0}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-950 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {startOptions.length === 0 ? <option value="">No start times</option> : null}
                  {startOptions.map((value) => <option key={value} value={value}>{formatClockValue(value)}</option>)}
                </select>
              </label>

              <label className="text-sm font-medium text-slate-800">
                <span className="mb-2 flex items-center gap-2"><Clock3 className="h-4 w-4" /> End</span>
                <select
                  value={endValue}
                  onChange={(event) => setEndValue(event.target.value)}
                  disabled={loadingSchedule || endOptions.length === 0}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-950 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  {endOptions.length === 0 ? <option value="">No end times</option> : null}
                  {endOptions.map((value) => <option key={value} value={value}>{formatClockValue(value)}</option>)}
                </select>
              </label>
            </div>

            {loadingSchedule ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading available hours…</p>
            ) : startOptions.length === 0 ? (
              <div className="mt-4 flex flex-col gap-3 border-l-2 border-slate-300 pl-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-600">
                  {schedule?.isOpen ? "There are no remaining booking times on this date." : "Hi Coworking is closed for bookings on this date."}
                </p>
                <button
                  type="button"
                  onClick={findNextOpenDay}
                  disabled={findingNextOpen}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50"
                >
                  {findingNextOpen ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Find next open day
                </button>
              </div>
            ) : (
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">{hoursLabel(durationHours)} · Carrollton local time</p>
                <button
                  type="button"
                  onClick={checkAvailability}
                  disabled={loadingAvailability || !validRange}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loadingAvailability ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                  {intent === "MEETING" ? "Check meeting room" : "Show available desks"}
                </button>
              </div>
            )}
          </section>
        ) : null}

        {intent === "DESK" && (options.length > 0 || deskChangeOptions.length > 0) ? (
          <section className="mt-10 border-t border-slate-200 pt-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">3. Choose your desk</h2>
                <p className="mt-1 text-sm text-slate-600">
                  A continuous desk keeps you in the same spot for the full stay.
                </p>
              </div>
              <p className="text-sm text-slate-500">{availableOptions.length} continuous option{availableOptions.length === 1 ? "" : "s"}</p>
            </div>

            {selectionOrder === "time" && <PublishedBookingMap timestamp={bookingWindow.start} resourceType="SEAT" selectedResource={selection?.kind === "single" ? selection.option.resourceId : preferredResourceId} availability={options} onSelect={(resourceId) => {
              const option = options.find((item) => item.resourceId === resourceId && item.available);
              if (option) void loadQuote({ kind: "single", option });
            }} />}
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
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><Laptop className="h-4 w-4" /></div>
                      <span className="text-xs font-semibold uppercase tracking-wide">{option.available ? "Available" : "Unavailable"}</span>
                    </div>
                    <p className="mt-4 font-semibold">{option.name}</p>
                    <p className={`mt-1 text-sm ${selected ? "text-slate-300" : "text-slate-500"}`}>Same desk for the full stay</p>
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
                    No single desk is free for your entire stay, but the system can reserve two desks with one move. This option is never selected automatically.
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
                          selected ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-950 ring-amber-200 hover:ring-amber-400"
                        }`}
                      >
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <span>{plan.segments[0].resourceName}</span>
                          <MoveRight className="h-4 w-4" />
                          <span>{plan.segments[1].resourceName}</span>
                        </div>
                        <div className={`mt-4 space-y-2 text-sm ${selected ? "text-slate-300" : "text-slate-600"}`}>
                          <p>{formatFacilityTime(plan.segments[0].start)}–{formatFacilityTime(plan.segments[0].end)} · {plan.segments[0].resourceName}</p>
                          <p className="font-semibold">Move once at {formatFacilityTime(plan.changeAt)}</p>
                          <p>{formatFacilityTime(plan.segments[1].start)}–{formatFacilityTime(plan.segments[1].end)} · {plan.segments[1].resourceName}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {loadingQuote ? (
              <div className="mt-5 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Preparing your live price…</div>
            ) : null}

            {selection && quote && !reviewOpen ? (
              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-y border-slate-200 py-5">
                <div>
                  <p className="font-semibold text-slate-950">{quote.resourceName}</p>
                  <p className="mt-1 text-sm text-slate-600">{money(quote.totalCents)} due for this stay</p>
                </div>
                <button
                  type="button"
                  onClick={continueToReview}
                  className="inline-flex min-h-12 items-center gap-2 rounded-full bg-slate-900 px-5 py-3 font-semibold text-white"
                >
                  Review booking <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {intent === "MEETING" && options.length > 0 ? (
          <section className="mt-10 border-t border-slate-200 pt-7">
            <h2 className="text-xl font-semibold text-slate-950">3. Meeting room availability</h2>
            {meetingOption?.available && quote ? (
              <div className="mt-4 flex flex-col gap-4 border-y border-slate-200 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-slate-950">Available for your full meeting</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {formatFacilityDate(bookingWindow.start)} · {formatFacilityTime(bookingWindow.start)}–{formatFacilityTime(bookingWindow.end)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={continueToReview}
                  disabled={loadingQuote}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3 font-medium text-white disabled:opacity-50"
                >
                  {loadingQuote ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                  Review meeting room <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="mt-4 border-l-2 border-amber-300 pl-4 text-sm text-slate-700">
                The meeting room is not available for that full time range. Choose another time and check again.
              </div>
            )}
          </section>
        ) : null}

        {selection?.kind === "single" && selectedSetup && <section className="mt-8 rounded-2xl border border-slate-200 p-5">
          <h2 className="text-lg font-semibold">Setup details and add-ons</h2>
          <label className="mt-3 block text-sm font-medium">People (maximum {quote?.setup?.capacity ?? selectedSetup.capacity})
            <select value={attendeeCount} disabled={loadingQuote || checkingOut} onChange={(event) => { const count = Number(event.target.value); setAttendeeCount(count); void loadQuote(selection, { attendeeCount: count }); }} className="ml-3 rounded-lg border p-2">
              {Array.from({ length: Math.min(100, quote?.setup?.capacity ?? selectedSetup.capacity) }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <p className="mt-3 text-sm text-slate-600">Optional extras are charged once per booking. The server verifies eligibility and recalculates the total before checkout.</p>
          {availableAddOns.map((item) => <label key={item.id} className="mt-3 flex items-start gap-3 rounded-xl border p-3 text-sm">
            <input type="checkbox" checked={addOnIds.includes(item.id)} disabled={loadingQuote || checkingOut} onChange={(event) => { const ids = event.target.checked ? [...addOnIds, item.id] : addOnIds.filter((id) => id !== item.id); setAddOnIds(ids); void loadQuote(selection, { addOnIds: ids }); }} />
            <span><strong>{item.name} · {money(item.priceCents)}</strong><span className="block text-slate-600">{item.description}</span></span>
          </label>)}
          {availableAddOns.length === 0 && <p className="mt-3 text-sm text-slate-500">No published add-ons are available for this setup.</p>}
        </section>}

        {reviewOpen && selection && quote ? (
          <section id="booking-review" className="scroll-mt-24 mt-10 border-t border-slate-200 pt-8">
            <p className="text-sm font-medium text-slate-500">Review & checkout</p>
            <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_390px]">
              <div>
                <h2 className="text-2xl font-semibold text-slate-950">{intent === "MEETING" ? "Meeting room" : quote.resourceName}</h2>
                <p className="mt-2 text-slate-600">
                  {formatFacilityDate(bookingWindow.start)} · {formatFacilityTime(bookingWindow.start)}–{formatFacilityTime(bookingWindow.end)}
                </p>
                <button
                  type="button"
                  onClick={() => setReviewOpen(false)}
                  className="mt-3 text-sm font-medium text-slate-700 underline underline-offset-4"
                >
                  Change booking
                </button>

                {quote.bookingKind === "desk_change" && quote.segments ? (
                  <div className="mt-7 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
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
                    <p className="mt-3 text-sm font-medium text-amber-900">Move once at {formatFacilityTime(quote.segments[0].end)}.</p>
                  </div>
                ) : null}

                {quote.membershipName && quote.resourceType === "SEAT" ? (
                  <div className="mt-7 border-y border-slate-200 py-5">
                    <p className="text-sm font-semibold text-slate-950">Membership hours</p>
                    <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
                      <div>
                        <p className="text-slate-500">Available before</p>
                        <p className="mt-1 font-semibold text-slate-950">{hoursLabel(quote.includedHoursRemaining)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Used by this booking</p>
                        <p className="mt-1 font-semibold text-slate-950">{hoursLabel(quote.includedHoursApplied)}</p>
                      </div>
                      <div>
                        <p className="text-slate-500">Remaining after</p>
                        <p className="mt-1 font-semibold text-slate-950">{hoursLabel(remainingAfterBooking)}</p>
                      </div>
                    </div>
                    {quote.billableHours > 0 ? (
                      <p className="mt-4 text-sm leading-6 text-slate-600">
                        {quote.includedHoursRemaining === 0
                          ? "No included desk hours remain for this month."
                          : `The first ${hoursLabel(quote.includedHoursApplied)} use your remaining monthly allowance.`}{" "}
                        The additional {hoursLabel(quote.billableHours)} automatically use your {memberDiscountPercent}% member discount at {money(quote.hourlyRateCents)}/hour.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {!authLoading && !user ? (
                  <div className="mt-7">
                    <h3 className="font-semibold text-slate-950">Your contact information</h3>
                    <p className="mt-1 text-sm text-slate-600">Use an email inbox you can access. After payment, use that email to sign in or request a password-reset link to claim your booking account. Booking confirmation and door access are separate; check Account for access readiness.</p>
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
              </div>

              <aside className="rounded-2xl bg-slate-50 p-5">
                <p className="text-sm font-semibold text-slate-950">Price calculation</p>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-slate-600">Booking length</span>
                    <span className="font-medium text-slate-950">{hoursLabel(quote.durationHours)}</span>
                  </div>

                  {quote.membershipName && quote.resourceType === "SEAT" ? (
                    <>
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-slate-600">Included membership time</span>
                        <span className="font-medium text-slate-950">{hoursLabel(quote.includedHoursApplied)} · $0.00</span>
                      </div>
                      {quote.billableHours > 0 ? (
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-600">
                            Additional member time<br />
                            <span className="text-xs">{hoursLabel(quote.billableHours)} × {money(quote.hourlyRateCents)} ({memberDiscountPercent}% off)</span>
                          </span>
                          <span className="font-medium text-slate-950">{money(quote.spaceSubtotalCents ?? quote.subtotalCents)}</span>
                        </div>
                      ) : null}
                    </>
                  ) : quote.dailyCapApplied && quote.resourceType === "SEAT" ? (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-slate-600">
                        Desk daily cap<br />
                        <span className="text-xs">Lower than the uncapped hourly total</span>
                      </span>
                      <span className="font-medium text-slate-950">{money(quote.spaceSubtotalCents ?? quote.subtotalCents)}</span>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-slate-600">
                        Space charge<br />
                        <span className="text-xs">{hoursLabel(quote.durationHours)} × {money(quote.hourlyRateCents)}</span>
                      </span>
                      <span className="font-medium text-slate-950">{money(quote.spaceSubtotalCents ?? quote.subtotalCents)}</span>
                    </div>
                  )}

                  {quote.setup && <div className="border-t border-slate-200 pt-3"><span className="font-medium">Setup: {quote.setup.name}</span><p className="text-xs text-slate-500">{quote.attendeeCount ?? 1} people · capacity {quote.setup.capacity}</p></div>}
                  {quote.addOns?.map((item) => <div key={item.id} className="flex justify-between gap-4"><span className="text-slate-600">{item.name} · once per booking</span><span>{money(item.priceCents)}</span></div>)}
                  {quote.accountCreditAppliedCents > 0 ? (
                    <div className="flex items-start justify-between gap-4 border-t border-slate-200 pt-3">
                      <span className="text-slate-600">Account credit</span>
                      <span className="font-medium text-slate-950">−{money(quote.accountCreditAppliedCents)}</span>
                    </div>
                  ) : null}
                </div>

                <div className="mt-5 flex items-baseline justify-between border-t border-slate-300 pt-4">
                  <span className="font-semibold">Amount due</span>
                  <span className="text-2xl font-semibold text-slate-950">{money(quote.totalCents)}</span>
                </div>

                {quote.totalCents === 0 ? (
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    No card payment is required. Confirming the booking commits the membership hours and/or account credit shown above.
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={checkout}
                  disabled={checkingOut || authLoading}
                  className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {checkingOut ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                  {quote.totalCents === 0 ? "Confirm booking" : `Pay ${money(quote.totalCents)}`}
                </button>
                <p className="mt-3 text-center text-xs leading-5 text-slate-500">
                  Your space is held for 15 minutes when confirmation begins. Membership hours and account credit are committed only when the booking is confirmed.
                </p>
              </aside>
            </div>
          </section>
        ) : null}
      </main>
    </AppShell>
  );
}
