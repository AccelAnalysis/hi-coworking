"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { PublishedSetupDetails } from "@/components/booking/PublishedSetupDetails";
import { DeskOptionList, type DeskListOption } from "@/components/booking/DeskOptionList";
import { SeatMapPicker } from "@/components/booking/SeatMapPicker";
import { AfterHoursConferenceRequest } from "@/components/booking/AfterHoursConferenceRequest";
import { bookingServiceType } from "@/lib/publishedSetups";
import { functions } from "@/lib/firebase";
import { useAuth } from "@/lib/authContext";
import { fallbackSeatMap, loadPublishedSeatMap, type SeatMapLayoutView } from "@/lib/seatMapLayout";
import { SEAT_MAP_PICKER } from "@/lib/seatMapPickerFlag";
import {
  CONFERENCE_ROOM_CONFIG,
  CONFERENCE_ROOM_SLOTS,
  DESK_DURATION_PRESETS,
  MEMBERSHIP_TIERS,
  SEAT_CATALOG,
  STAFF_ONLY_SEAT_RESOURCE_ID,
  PRIVATE_OFFICE_RESOURCE_ID,
  getSeatByResourceId,
} from "@hi/shared";
import { useResourceOffering } from "@/lib/resourceOffering";
import {
  INTENDED_USE_MAX,
  validateGuestScreening,
} from "../../../functions/src/providers/guestCheckoutScreening";
import { INDEPENDENT_LABEL } from "../../../functions/src/providers/businessProfile";
import { HI_TERMS_VERSION, PRIVACY_PATH, TERMS_PATH } from "../../../functions/src/providers/termsCompliance";
import { HIG_CANVAS, HIG_CARD, HIG_FIELD, HIG_LABEL, HIG_LINK, HIG_PRIMARY, HigSwitch, NearLimitCount } from "@/components/forms/HigControls";

const FACILITY_TIME_ZONE = "America/New_York";
const GUEST_LABEL = `${HIG_LABEL} mb-1.5`;
const INTENDED_USE_WARN_AT = INTENDED_USE_MAX - 30;

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
  type: "SEAT" | "MODE" | "ROOM";
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
  resourceType: "SEAT" | "MODE" | "ROOM";
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
  capApplied?: "half_day" | "day" | null;
  segmentPricing?: Array<{
    resourceId: string;
    tierId: "basic" | "window" | "equipped";
    hours: number;
    includedHoursApplied: number;
    billableHours: number;
    hourlyRateCents: number;
    subtotalCents: number;
    capApplied: "half_day" | "day" | null;
  }>;
  conferenceSlot?: "morning" | "afternoon";
  currency: string;
  deskChangePlanId?: string;
  segments?: [DeskSegment, DeskSegment];
};

/** Plain-language label for the cap the server applied, if any. */
function capLabel(cap: Quote["capApplied"]) {
  if (cap === "half_day") return "Half-day price";
  if (cap === "day") return "Day price";
  return null;
}

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
    guest?: {
      name: string;
      email: string;
      phone: string;
      businessName: string;
      isIndependent: boolean;
      intendedUse: string;
      termsAccepted: boolean;
      termsVersion: string;
    };
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

const BOOKING_HOURS_MESSAGE = "Hi Coworking is open Monday to Friday, 8 AM to 5 PM.";

function isWeekendDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function closedDayMessage(dateValue: string, schedule: DaySchedule | null) {
  if (isWeekendDate(dateValue)) return `Hi Coworking is closed on weekends. ${BOOKING_HOURS_MESSAGE}`;
  if (schedule?.isOpen) return "There are no remaining booking times on this date.";
  return `Hi Coworking is closed for bookings on this date. ${BOOKING_HOURS_MESSAGE}`;
}

function errorMessage(caught: unknown, fallback: string) {
  const raw = caught as { message?: string };
  if (!raw?.message) return fallback;
  const split = raw.message.split(": ");
  return split[split.length - 1] || fallback;
}

function rangeOpen(schedule: DaySchedule | null, dateValue: string, start: string, end: string) {
  if (!schedule) return false;
  return intervalStartValues(schedule, dateValue).includes(start)
    && endValuesForStart(schedule, start).includes(end);
}

export default function BookingExperienceWithDeskChange() {
  const { user, loading: authLoading } = useAuth();
  const { isOffered } = useResourceOffering();
  const officeOffered = isOffered(PRIVATE_OFFICE_RESOURCE_ID);
  const todayAtFacility = useMemo(() => facilityDateValue(), []);
  const requestedStartRef = useRef<string | null>(null);
  const requestedDurationRef = useRef<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
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
  const [seatMap, setSeatMap] = useState<SeatMapLayoutView>(() => fallbackSeatMap());
  // Renter screening (guest checkout): business use only, same for everyone.
  const [guestBusinessName, setGuestBusinessName] = useState("");
  const [guestIndependent, setGuestIndependent] = useState(false);
  const [guestIntendedUse, setGuestIntendedUse] = useState("");
  const [guestTermsAccepted, setGuestTermsAccepted] = useState(false);
  const [guestInvalidField, setGuestInvalidField] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedDate = params.get("date");
    const requestedTime = params.get("time");
    const requestedDuration = Number(params.get("duration"));
    const requestedResource = params.get("resource");

    if (requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && requestedDate >= todayAtFacility) {
      setDateValue(requestedDate);
    } else if (isWeekendDate(todayAtFacility)) {
      // Closed on weekends: start on the next weekday instead.
      let next = addDaysToDateKey(todayAtFacility, 1);
      while (isWeekendDate(next)) next = addDaysToDateKey(next, 1);
      setDateValue(next);
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
    if (!SEAT_MAP_PICKER) return;
    let active = true;
    void loadPublishedSeatMap().then((view) => {
      if (active) setSeatMap(view);
    });
    return () => {
      active = false;
    };
  }, []);

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

  // Meeting room: weekday 4-hour slots only. Snap to the first open slot.
  useEffect(() => {
    if (intent !== "MEETING" || !schedule) return;
    const current = CONFERENCE_ROOM_SLOTS.find((slot) => slot.start === startValue && slot.end === endValue);
    if (current && rangeOpen(schedule, dateValue, current.start, current.end)) return;
    const firstOpen = CONFERENCE_ROOM_SLOTS.find((slot) => rangeOpen(schedule, dateValue, slot.start, slot.end));
    setStartValue(firstOpen?.start ?? "");
    setEndValue(firstOpen?.end ?? "");
  }, [intent, schedule, dateValue, startValue, endValue]);

  useEffect(() => {
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

  const activeDeskPreset = DESK_DURATION_PRESETS.find(
    (preset) => preset.start === startValue && preset.end === endValue,
  );
  const meetingSlotOpen = CONFERENCE_ROOM_SLOTS.some((slot) => rangeOpen(schedule, dateValue, slot.start, slot.end));

  function applyRange(start: string, end: string) {
    setStartValue(start);
    setEndValue(end);
  }

  function chooseIntent(nextIntent: ResourceIntent) {
    setIntent(nextIntent);
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
      setError(errorMessage(caught, "That option just became unavailable. Check availability again."));
    } finally {
      setLoadingQuote(false);
    }
  }

  async function checkAvailability() {
    if (!intent || !validRange) {
      setError("Choose a space type and a valid start and end time.");
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
        resourceType: intent === "DESK" ? "SEAT" : "MODE",
      });
      setOptions(result.data.options);
      setDeskChangeOptions(intent === "DESK" ? result.data.deskChangeOptions || [] : []);

      if (intent === "MEETING") {
        const meeting = result.data.options.find((option) => option.available);
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
      console.error(caught);
      setOptions([]);
      setDeskChangeOptions([]);
      setError(errorMessage(caught, "We could not check live availability. Please try again."));
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
      setGuestInvalidField(!guestName.trim() ? "name" : "email");
      setError("Enter your name and email to continue as a guest.");
      return;
    }
    if (!user) {
      const screening = validateGuestScreening({
        phone: guestPhone,
        businessName: guestBusinessName,
        isIndependent: guestIndependent,
        intendedUse: guestIntendedUse,
        termsAccepted: guestTermsAccepted,
        termsVersion: HI_TERMS_VERSION,
      }, Date.now());
      if (!screening.ok) {
        setGuestInvalidField(screening.field);
        setError(screening.message);
        return;
      }
    }
    setGuestInvalidField(null);
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
                businessName: guestIndependent ? "" : guestBusinessName.trim(),
                isIndependent: guestIndependent,
                intendedUse: guestIntendedUse.trim(),
                termsAccepted: guestTermsAccepted,
                termsVersion: HI_TERMS_VERSION,
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
      setError(errorMessage(caught, "We could not start checkout. Your card has not been charged. Check availability and try again."));
      setCheckingOut(false);
    }
  }

  const availableOptions = options.filter((option) => option.available);
  const deskListOptions: DeskListOption[] = SEAT_MAP_PICKER
    ? [
        ...options
          .filter((option) => option.type === "SEAT" || option.type === "ROOM")
          .map((option) => ({
            resourceId: option.resourceId,
            name: getSeatByResourceId(option.resourceId)?.name || option.name,
            available: option.available,
          })),
        {
          resourceId: STAFF_ONLY_SEAT_RESOURCE_ID,
          name: SEAT_CATALOG[STAFF_ONLY_SEAT_RESOURCE_ID].name,
          available: false,
          staffOnly: true,
        },
      ]
    : options.map((option) => ({
        resourceId: option.resourceId,
        name: option.name,
        available: option.available,
      }));

  function selectDeskOption(option: DeskListOption) {
    const availability = options.find((item) => item.resourceId === option.resourceId);
    if (availability?.available) void loadQuote({ kind: "single", option: availability });
  }

  function deskLabel(resourceId: string, fallback: string) {
    if (!SEAT_MAP_PICKER) return fallback;
    const seat = getSeatByResourceId(resourceId);
    return seat ? seat.displayId : fallback;
  }
  const selectedKey = selectionKey(selection);
  const meetingOption = options.find((option) => option.type === "MODE");
  const remainingAfterBooking = quote
    ? Math.max(0, quote.includedHoursRemaining - quote.includedHoursApplied)
    : 0;
  const memberDiscountPercent = quote?.membershipName && quote.resourceType === "SEAT"
    ? MEMBERSHIP_TIERS.find((tier) => tier.name === quote.membershipName)?.overageDiscountPercent ?? 0
    : 0;
  const quoteCapLabel = quote && quote.resourceType !== "MODE" ? capLabel(quote.capApplied) : null;

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:py-11">
        <header className="max-w-3xl">
          <p className="text-sm font-medium text-slate-500">Book a space</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Start with the space you need.
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
            Choose a coworking desk, the private office, or the meeting room first. We will show only the booking hours currently open for that date, then check live availability for your full stay.
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
                  {officeOffered
                    ? "Book a desk or the private office by the hour, half-day, or full day. If no single desk covers the whole stay, an optional one-change plan can still be offered."
                    : "Book a desk by the hour, half-day, or full day. If no single desk covers the whole stay, an optional one-change plan can still be offered."}
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
                  Weekday 4-hour slots, {money(CONFERENCE_ROOM_CONFIG.slotPriceCents)} each. Seats {CONFERENCE_ROOM_CONFIG.maxCapacity}.
                </span>
              </span>
            </button>
          </div>
        </section>

        {intent ? (
          <section className="mt-9 border-t border-slate-200 pt-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">2. When do you need it?</h2>
                <p id="booking-hours-note" className="mt-1 text-sm text-slate-600">
                  {BOOKING_HOURS_MESSAGE} Times come from the current operating calendar, including closures.
                </p>
              </div>
              {schedule ? <p className="text-sm font-medium text-slate-700">{scheduleSummary(schedule)}</p> : null}
            </div>

            <div className={`mt-5 grid gap-4 ${intent === "MEETING" ? "sm:grid-cols-1 sm:max-w-xs" : "sm:grid-cols-3"}`}>
              <label className="text-sm font-medium text-slate-800">
                <span className="mb-2 flex items-center gap-2"><CalendarDays className="h-4 w-4" /> Date</span>
                <input
                  type="date"
                  min={todayAtFacility}
                  value={dateValue}
                  aria-describedby="booking-hours-note booking-day-status"
                  aria-invalid={isWeekendDate(dateValue) || undefined}
                  onChange={(event) => setDateValue(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base text-slate-950"
                />
              </label>

              {intent === "DESK" ? (<>
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
              </>) : null}
            </div>

            {intent === "DESK" && !loadingSchedule && startOptions.length > 0 ? (
              <fieldset className="mt-5" data-testid="desk-duration-presets">
                <legend className="text-sm font-medium text-slate-800">Quick select</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DESK_DURATION_PRESETS.map((preset) => {
                    const open = rangeOpen(schedule, dateValue, preset.start, preset.end);
                    const active = activeDeskPreset?.id === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        aria-pressed={active}
                        disabled={!open}
                        onClick={() => applyRange(preset.start, preset.end)}
                        className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#101D4B] disabled:cursor-not-allowed disabled:opacity-40 ${
                          active
                            ? "border-[#101D4B] bg-[#101D4B] text-white"
                            : "border-[#C5CADB] bg-white text-[#101D4B] hover:bg-[#EEF0F6]"
                        }`}
                      >
                        {preset.label}
                        <span className={`font-normal ${active ? "text-white/80" : "text-slate-500"}`}>({preset.detail})</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    aria-pressed={!activeDeskPreset}
                    onClick={() => {
                      if (activeDeskPreset) changeStart(startValue);
                    }}
                    className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-semibold transition focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#101D4B] ${
                      !activeDeskPreset
                        ? "border-[#101D4B] bg-[#101D4B] text-white"
                        : "border-[#C5CADB] bg-white text-[#101D4B] hover:bg-[#EEF0F6]"
                    }`}
                  >
                    Custom hours
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Up to 4 hours never costs more than the half-day price; longer stays never more than the day price.
                </p>
              </fieldset>
            ) : null}

            {intent === "MEETING" && !loadingSchedule && schedule?.isOpen ? (
              <fieldset className="mt-5" data-testid="conference-slot-picker">
                <legend className="text-sm font-medium text-slate-800">Choose a 4-hour slot</legend>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {CONFERENCE_ROOM_SLOTS.map((slot) => {
                    const open = rangeOpen(schedule, dateValue, slot.start, slot.end);
                    const active = startValue === slot.start && endValue === slot.end;
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        aria-pressed={active}
                        disabled={!open}
                        onClick={() => applyRange(slot.start, slot.end)}
                        className={`flex min-h-16 items-center justify-between gap-3 rounded-2xl border p-4 text-left transition focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#101D4B] disabled:cursor-not-allowed disabled:opacity-40 ${
                          active
                            ? "border-[#101D4B] bg-[#101D4B] text-white"
                            : "border-[#C5CADB] bg-white text-[#101D4B] hover:bg-[#EEF0F6]"
                        }`}
                      >
                        <span>
                          <span className="block font-semibold">{slot.label}</span>
                          <span className={`block text-sm ${active ? "text-white/80" : "text-slate-600"}`}>{slot.timeLabel}</span>
                        </span>
                        <span className="font-semibold tabular-nums">{money(CONFERENCE_ROOM_CONFIG.slotPriceCents)}</span>
                      </button>
                    );
                  })}
                </div>
                {!meetingSlotOpen ? (
                  <p className="mt-2 text-sm text-slate-600">No 4-hour meeting slot is still open on this date. Choose another weekday.</p>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">
                    Or request an evening or weekend 4-hour slot below.
                  </p>
                )}
              </fieldset>
            ) : null}

            {loadingSchedule ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading available hours…</p>
            ) : startOptions.length === 0 ? (
              <div className="mt-4 flex flex-col gap-3 border-l-2 border-slate-300 pl-4 sm:flex-row sm:items-center sm:justify-between">
                <p id="booking-day-status" role="status" className="text-sm text-slate-600">
                  {closedDayMessage(dateValue, schedule)}
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
                  {intent === "MEETING" ? "Check meeting room" : "Show available spaces"}
                </button>
              </div>
            )}
          {intent === "MEETING" && dateValue ? (
            <AfterHoursConferenceRequest date={dateValue} />
          ) : null}
          </section>
        ) : null}

        {intent === "DESK" && (options.length > 0 || deskChangeOptions.length > 0) ? (
          <section className="mt-10 border-t border-slate-200 pt-7">
            {SEAT_MAP_PICKER ? (
              <SeatMapPicker
                spots={seatMap.spots}
                backgroundUrl={seatMap.backgroundUrl}
                availability={options}
                officeOffered={officeOffered}
                selectedResourceId={selection?.kind === "single" ? selection.option.resourceId : undefined}
                loadingQuote={loadingQuote}
                onSelectSeat={(resourceId) => {
                  const option = options.find((item) => item.resourceId === resourceId);
                  if (option?.available) void loadQuote({ kind: "single", option });
                }}
                list={
                  <>
                    <p className="mb-4 text-sm text-[#4A5585]">
                      {availableOptions.length} continuous option{availableOptions.length === 1 ? "" : "s"}
                    </p>
                    <DeskOptionList
                      options={deskListOptions}
                      selectedResourceId={selection?.kind === "single" ? selection.option.resourceId : undefined}
                      loadingQuote={loadingQuote}
                      showCatalogDetails
                      onSelect={selectDeskOption}
                    />
                  </>
                }
                summary={
                  selection && quote && !reviewOpen ? (
                    <div>
                      <p className="text-sm font-bold text-[#101D4B]">{deskLabel(quote.resourceId, quote.resourceName)}</p>
                      <p className="mt-0.5 text-sm text-slate-600">{money(quote.totalCents)} due for this stay</p>
                      {quoteCapLabel ? (
                        <p className="mt-0.5 text-xs text-slate-500">{quoteCapLabel} applied</p>
                      ) : null}
                      <button
                        type="button"
                        onClick={continueToReview}
                        className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-[#101D4B] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#1B2A63] focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#101D4B]"
                      >
                        Review booking <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  ) : null
                }
              />
            ) : (
              <>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-950">3. Choose your desk</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      A continuous desk keeps you in the same spot for the full stay.
                    </p>
                  </div>
                  <p className="text-sm text-slate-500">{availableOptions.length} continuous option{availableOptions.length === 1 ? "" : "s"}</p>
                </div>

                <div className="mt-5">
                  <DeskOptionList
                    options={deskListOptions}
                    selectedResourceId={selection?.kind === "single" ? selection.option.resourceId : undefined}
                    loadingQuote={loadingQuote}
                    onSelect={selectDeskOption}
                  />
                </div>
              </>
            )}

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
                        aria-pressed={selected}
                        onClick={() => loadQuote({ kind: "desk_change", plan })}
                        className={`rounded-2xl p-4 text-left ring-1 transition focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-[#101D4B] ${
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

            {!SEAT_MAP_PICKER && selection && quote && !reviewOpen ? (
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

        {reviewOpen && selection && quote ? (
          <section id="booking-review" className={`scroll-mt-24 mt-10 -mx-4 ${HIG_CANVAS} px-4 py-8 sm:mx-0 sm:rounded-3xl sm:p-8`}>
            <p className="text-sm font-medium text-slate-600">Review & checkout</p>
            <div className="mt-4 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
              <div className="grid gap-6">
                <div className={`${HIG_CARD} p-5 sm:p-6`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-display text-2xl font-semibold text-[#101D4B]">{intent === "MEETING" ? "Meeting room" : deskLabel(quote.resourceId, quote.resourceName)}</h2>
                      <p className="mt-1 text-[15px] text-slate-600">
                        {formatFacilityDate(bookingWindow.start)} · {formatFacilityTime(bookingWindow.start)}–{formatFacilityTime(bookingWindow.end)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setReviewOpen(false)}
                      className="-mx-3 min-h-11 rounded-full px-3 text-sm font-medium text-[#101D4B] hover:bg-[#101D4B]/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#101D4B]"
                    >
                      Change booking
                    </button>
                  </div>

                  <PublishedSetupDetails
                    resourceId={selection.kind === "single" ? selection.option.resourceId : undefined}
                    serviceType={bookingServiceType(intent)}
                  />

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
                    <div className="mt-6 border-t border-slate-100 pt-5">
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
                          The additional {hoursLabel(quote.billableHours)} automatically use your {memberDiscountPercent}% member discount at {money(quote.hourlyRateCents)}/hour{quoteCapLabel ? `, capped at the ${quoteCapLabel.toLowerCase()}` : ""}.
                          {quote.membershipName === "Coworking Member" && quote.segmentPricing?.some((segment) => segment.tierId === "equipped") ? (
                            <> Equipped seats (D5–D6) are not covered by Coworking Member hours.</>
                          ) : null}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {!authLoading && !user ? (
                  <section className={`${HIG_CARD} p-5 sm:p-6`} data-testid="guest-checkout-details" aria-labelledby="guest-details-heading">
                    <h3 id="guest-details-heading" className="font-display text-lg font-semibold text-[#101D4B]">Your details</h3>
                    <p className="mt-1 text-sm text-slate-600">For your confirmation and access details. Hi Coworking is a workspace for business use.</p>
                    <div className="mt-5 grid gap-x-5 gap-y-5 sm:grid-cols-2">
                      <div>
                        <label className={GUEST_LABEL} htmlFor="guest-name">Name</label>
                        <input
                          id="guest-name"
                          value={guestName}
                          onChange={(event) => setGuestName(event.target.value)}
                          autoComplete="name"
                          required
                          aria-invalid={guestInvalidField === "name" ? true : undefined}
                          className={HIG_FIELD}
                        />
                      </div>
                      <div>
                        <label className={GUEST_LABEL} htmlFor="guest-email">Email</label>
                        <input
                          id="guest-email"
                          type="email"
                          value={guestEmail}
                          onChange={(event) => setGuestEmail(event.target.value)}
                          autoComplete="email"
                          required
                          aria-invalid={guestInvalidField === "email" ? true : undefined}
                          className={HIG_FIELD}
                        />
                      </div>
                      <div>
                        <div className="mb-1.5 flex h-6 items-center">
                          <label className={HIG_LABEL} htmlFor="guest-phone">Phone</label>
                        </div>
                        <input
                          id="guest-phone"
                          type="tel"
                          inputMode="tel"
                          value={guestPhone}
                          onChange={(event) => setGuestPhone(event.target.value)}
                          autoComplete="tel"
                          required
                          aria-invalid={guestInvalidField === "phone" ? true : undefined}
                          placeholder="(555) 555-5555"
                          className={HIG_FIELD}
                        />
                      </div>
                      <div>
                        <div className="mb-1.5 flex h-6 items-center justify-between gap-3">
                          <label className={HIG_LABEL} htmlFor="guest-business-name">Business name</label>
                          <HigSwitch id="guest-independent" label="Independent" checked={guestIndependent} onChange={setGuestIndependent} />
                        </div>
                        <input
                          id="guest-business-name"
                          value={guestIndependent ? "" : guestBusinessName}
                          onChange={(event) => setGuestBusinessName(event.target.value)}
                          autoComplete="organization"
                          maxLength={120}
                          required={!guestIndependent}
                          disabled={guestIndependent}
                          aria-invalid={guestInvalidField === "businessName" ? true : undefined}
                          placeholder={guestIndependent ? INDEPENDENT_LABEL : "Your company or organization"}
                          className={HIG_FIELD}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className={GUEST_LABEL} htmlFor="guest-intended-use">How you&apos;ll use the space</label>
                        <input
                          id="guest-intended-use"
                          value={guestIntendedUse}
                          onChange={(event) => setGuestIntendedUse(event.target.value)}
                          maxLength={INTENDED_USE_MAX}
                          required
                          aria-invalid={guestInvalidField === "intendedUse" ? true : undefined}
                          aria-describedby="guest-intended-use-hint"
                          placeholder="e.g. Client calls and focused work"
                          className={HIG_FIELD}
                        />
                        <NearLimitCount id="guest-intended-use-hint" length={guestIntendedUse.length} max={INTENDED_USE_MAX} warnAt={INTENDED_USE_WARN_AT} />
                      </div>
                    </div>
                    {/* TODO(jonathan-copy): add the house rules and member agreement here once Jonathan approves the wording; bump the terms version with it. */}
                    <div className="mt-2 flex items-start gap-3 border-t border-slate-100 pt-5 text-[15px] leading-6 text-slate-700">
                      <input
                        id="guest-terms-acceptance"
                        type="checkbox"
                        required
                        checked={guestTermsAccepted}
                        onChange={(event) => setGuestTermsAccepted(event.target.checked)}
                        aria-invalid={guestInvalidField === "terms" ? true : undefined}
                        className="mt-0.5 h-5 w-5 shrink-0 accent-[#101D4B]"
                      />
                      <label htmlFor="guest-terms-acceptance">
                        I agree to the{" "}
                        <Link href={TERMS_PATH} target="_blank" className={HIG_LINK}>
                          Terms of Service
                        </Link>{" "}
                        and{" "}
                        <Link href={PRIVACY_PATH} target="_blank" className={HIG_LINK}>
                          Privacy Policy
                        </Link>
                        .
                      </label>
                    </div>
                  </section>
                ) : null}
              </div>

              <aside className={`${HIG_CARD} p-5 sm:p-6 lg:sticky lg:top-24`} aria-labelledby="price-summary-heading">
                <h3 id="price-summary-heading" className="font-display text-lg font-semibold text-[#101D4B]">Summary</h3>
                <div className="mt-4 space-y-3 text-[15px]">
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-slate-600">Booking length</span>
                    <span className="font-medium tabular-nums text-slate-950">{hoursLabel(quote.durationHours)}</span>
                  </div>

                  {quote.membershipName && quote.resourceType === "SEAT" ? (
                    <>
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-slate-600">Included membership time</span>
                        <span className="font-medium tabular-nums text-slate-950">{hoursLabel(quote.includedHoursApplied)} · $0.00</span>
                      </div>
                      {quote.billableHours > 0 ? (
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-600">
                            Additional member time<br />
                            <span className="text-xs">
                              {quoteCapLabel
                                ? `${hoursLabel(quote.billableHours)} · ${quoteCapLabel}`
                                : `${hoursLabel(quote.billableHours)} × ${money(quote.hourlyRateCents)} (${memberDiscountPercent}% off)`}
                            </span>
                          </span>
                          <span className="font-medium tabular-nums text-slate-950">{money(quote.subtotalCents)}</span>
                        </div>
                      ) : null}
                    </>
                  ) : quoteCapLabel ? (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-slate-600">
                        {quoteCapLabel}<br />
                        <span className="text-xs">Lower than {hoursLabel(quote.durationHours)} at the hourly rate</span>
                      </span>
                      <span className="font-medium tabular-nums text-slate-950">{money(quote.subtotalCents)}</span>
                    </div>
                  ) : quote.resourceType === "MODE" ? (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-slate-600">
                        Meeting room<br />
                        <span className="text-xs">
                          {quote.conferenceSlot === "afternoon" ? "Afternoon 1:00 PM–5:00 PM" : "Morning 8:00 AM–12:00 PM"} · 4-hour slot
                        </span>
                      </span>
                      <span className="font-medium tabular-nums text-slate-950">{money(quote.subtotalCents)}</span>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-slate-600">
                        Space charge<br />
                        <span className="text-xs">{hoursLabel(quote.durationHours)} × {money(quote.hourlyRateCents)}</span>
                      </span>
                      <span className="font-medium tabular-nums text-slate-950">{money(quote.subtotalCents)}</span>
                    </div>
                  )}

                  {quote.accountCreditAppliedCents > 0 ? (
                    <div className="flex items-start justify-between gap-4 border-t border-slate-200 pt-3">
                      <span className="text-slate-600">Account credit</span>
                      <span className="font-medium tabular-nums text-slate-950">−{money(quote.accountCreditAppliedCents)}</span>
                    </div>
                  ) : null}
                </div>

                <div className="mt-5 flex items-baseline justify-between border-t border-slate-200 pt-4">
                  <span className="font-semibold text-slate-950">Amount due</span>
                  <span className="text-2xl font-semibold tabular-nums text-slate-950">{money(quote.totalCents)}</span>
                </div>

                {quote.totalCents === 0 ? (
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    No card payment is required. Confirming the booking commits the membership hours and/or account credit shown above.
                  </p>
                ) : null}

                <button
                  type="button"
                  onClick={checkout}
                  disabled={checkingOut || authLoading || (!user && !guestTermsAccepted)}
                  className={`${HIG_PRIMARY} mt-5 w-full`}
                >
                  {checkingOut ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : null}
                  {quote.totalCents === 0 ? "Confirm booking" : `Pay ${money(quote.totalCents)}`}
                </button>
                <p className="mt-3 text-center text-xs leading-5 text-slate-600" data-testid="checkout-hold-note">
                  {user && (quote.includedHoursApplied > 0 || quote.accountCreditAppliedCents > 0)
                    ? "Your space is held for 15 minutes when confirmation begins. Membership hours and account credit are committed only when the booking is confirmed."
                    : "Your space is held for 15 minutes while you complete checkout."}
                </p>
              </aside>
            </div>
          </section>
        ) : null}
      </main>
    </AppShell>
  );
}
