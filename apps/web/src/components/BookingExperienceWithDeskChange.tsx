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
import { AppShell } from "@/components/AppShell";
import { SeatMap, type SeatVisualStatus } from "@/components/booking/SeatMap";
import { functions } from "@/lib/firebase";
import { getFloors, getLocations, getShell, resolvePublishedLayout } from "@/lib/firestore";
import { useAuth } from "@/lib/authContext";
import {
  defaultCoworkingFloor,
  freeBlocksForSeats,
  isKnownBookableSeat,
  resolveBookingSelection,
  seatsFromLayoutElements,
  type FloorSeat,
  type FloorShape,
  type OccupancyInterval,
} from "@hi/shared";

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
  dailyCapApplied: boolean;
  currency: string;
  deskChangePlanId?: string;
  segments?: [DeskSegment, DeskSegment];
};

type Selection =
  | { kind: "single"; option: AvailabilityOption }
  | { kind: "desk_change"; plan: DeskChangePlan };

type SelectionOrder = "seats" | "times";

type PublishedFloor = {
  canvasWidth: number;
  canvasHeight: number;
  shell: FloorShape[];
  seats: FloorSeat[];
  fromLayout: boolean;
};

type DayOccupancy = {
  date: string;
  resources: Array<{
    resourceId: string;
    busy: Array<{ start: number; end: number }>;
  }>;
};

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

const getDayOccupancy = httpsCallable<{ date: string }, DayOccupancy>(
  functions,
  "booking_getDayOccupancy",
);

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

function shellShapes(elements: Array<{
  id: string;
  type: string;
  label?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  fill?: string;
}>): FloorShape[] {
  return elements
    .filter((element) => element.type === "WALL" || element.type === "DOOR" || element.type === "WINDOW")
    .map((element) => ({
      id: element.id,
      type: element.type,
      label: element.label,
      x: element.x,
      y: element.y,
      width: element.width ?? 80,
      height: element.height ?? 16,
      rotation: element.rotation ?? 0,
      fill: element.fill,
    }));
}

async function probeSeatOccupancy(dateValue: string, schedule: DaySchedule) {
  const starts = intervalStartValues(schedule, dateValue);
  const busy: OccupancyInterval[] = [];
  for (let index = 0; index < starts.length; index += 6) {
    const slice = starts.slice(index, index + 6);
    const results = await Promise.all(slice.map(async (startValue) => {
      const endValue = minutesToValue(timeValueToMinutes(startValue) + 30);
      const window = toWindow(dateValue, startValue, endValue);
      const result = await getAvailability({
        start: window.start,
        end: window.end,
        resourceType: "SEAT",
      });
      return { window, options: result.data.options };
    }));
    for (const result of results) {
      for (const option of result.options) {
        if (option.type === "SEAT" && !option.available) {
          busy.push({
            resourceId: option.resourceId,
            start: result.window.start,
            end: result.window.end,
          });
        }
      }
    }
  }
  return busy;
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
  const suppressResetRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const [intent, setIntent] = useState<ResourceIntent | null>(null);
  const [selectionOrder, setSelectionOrder] = useState<SelectionOrder>("seats");
  const [floorPlan, setFloorPlan] = useState<PublishedFloor | null>(null);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [occupancy, setOccupancy] = useState<OccupancyInterval[]>([]);
  const [occupancyReady, setOccupancyReady] = useState(false);
  const [loadingOccupancy, setLoadingOccupancy] = useState(false);
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
    if (suppressResetRef.current) {
      suppressResetRef.current = false;
      return;
    }
    setOptions([]);
    setDeskChangeOptions([]);
    setSelection(null);
    setQuote(null);
    setReviewOpen(false);
  }, [intent, dateValue, startValue, endValue, selectionOrder]);

  useEffect(() => {
    let active = true;
    const fallback = defaultCoworkingFloor();
    void (async () => {
      try {
        const locations = await getLocations();
        const location = locations[0];
        if (!location) throw new Error("No location");
        const floors = await getFloors(location.id);
        const floor = [...floors].sort((a, b) => a.levelIndex - b.levelIndex)[0];
        if (!floor) throw new Error("No floor");
        const [shell, layout] = await Promise.all([
          getShell(location.id, floor.id),
          resolvePublishedLayout(location.id, floor.id),
        ]);
        const seats = seatsFromLayoutElements(layout?.elements ?? []);
        if (!seats.length) throw new Error("Layout has no seats");
        if (!active) return;
        setFloorPlan({
          canvasWidth: floor.canvasWidth || fallback.canvasWidth,
          canvasHeight: floor.canvasHeight || fallback.canvasHeight,
          shell: shellShapes(shell?.elements ?? []),
          seats,
          fromLayout: true,
        });
      } catch (caught) {
        console.warn("Using the default floor plan.", caught);
        if (!active) return;
        setFloorPlan({ ...fallback, fromLayout: false });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated || intent !== "DESK") return;
    let active = true;
    setLoadingOccupancy(true);
    setOccupancyReady(false);
    void (async () => {
      try {
        const result = await getDayOccupancy({ date: dateValue });
        if (!active) return;
        setOccupancy(result.data.resources.flatMap((resource) => (
          resource.busy.map((interval) => ({
            resourceId: resource.resourceId,
            start: interval.start,
            end: interval.end,
          }))
        )));
        setOccupancyReady(true);
      } catch (caught) {
        console.warn("Day occupancy is unavailable. Checking each open slot.", caught);
        if (!schedule) return;
        try {
          const busy = await probeSeatOccupancy(dateValue, schedule);
          if (!active) return;
          setOccupancy(busy);
          setOccupancyReady(true);
        } catch (probeError) {
          console.error(probeError);
          if (!active) return;
          setOccupancy([]);
          setOccupancyReady(false);
        }
      } finally {
        if (active) setLoadingOccupancy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [dateValue, hydrated, intent, schedule]);

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
      setError(errorMessage(caught, "We could not start checkout. Your card has not been charged. Check availability and try again."));
      setCheckingOut(false);
    }
  }

  const availableOptions = options.filter((option) => option.available);
  const selectedKey = selectionKey(selection);
  const meetingOption = options.find((option) => option.type === "MODE");
  const bookableSeats = (floorPlan?.seats ?? []).filter((seat) => isKnownBookableSeat(seat.resourceId));
  const namedSeats = bookableSeats.map((seat) => ({ resourceId: seat.resourceId, name: seat.label }));
  const openWindows = useMemo(() => {
    if (!schedule) return [];
    return schedule.intervals
      .map((interval) => ({
        start: facilityWallTimeToTimestamp(dateValue, interval.startTime),
        end: facilityWallTimeToTimestamp(dateValue, interval.endTime),
      }))
      .filter((window) => window.end > window.start);
  }, [dateValue, schedule]);
  const selectedFreeBlocks = useMemo(() => (
    selectionOrder === "seats"
      ? freeBlocksForSeats(selectedSeatIds, openWindows, occupancy)
      : []
  ), [occupancy, openWindows, selectedSeatIds, selectionOrder]);
  const seatResolution = useMemo(() => {
    if (selectionOrder !== "seats" || !validRange || namedSeats.length === 0) return null;
    return resolveBookingSelection({
      seats: namedSeats,
      preferredSeatIds: selectedSeatIds,
      start: bookingWindow.start,
      end: bookingWindow.end,
      busy: occupancy,
    });
  }, [bookingWindow.end, bookingWindow.start, namedSeats, occupancy, selectedSeatIds, selectionOrder, validRange]);

  function toggleSeat(resourceId: string) {
    if (!isKnownBookableSeat(resourceId)) return;
    if (selectionOrder === "times") {
      if (options.length === 0) {
        setNotice("Set the time first, then tap a green seat. Amber seats are the one-move plan when no single seat is free.");
        return;
      }
      const option = options.find((candidate) => candidate.resourceId === resourceId);
      if (option?.available) {
        void loadQuote({ kind: "single", option });
        return;
      }
      const plan = deskChangeOptions.find((candidate) => (
        candidate.segments.some((segment) => segment.resourceId === resourceId)
      ));
      if (plan) void loadQuote({ kind: "desk_change", plan });
      return;
    }
    setSelectedSeatIds((current) => (
      current.includes(resourceId)
        ? current.filter((id) => id !== resourceId)
        : [...current, resourceId]
    ));
    setSelection(null);
    setQuote(null);
    setReviewOpen(false);
  }

  async function bookResolvedStay() {
    if (!validRange) {
      setError("Choose a start and end time first.");
      return;
    }
    setLoadingAvailability(true);
    setError(null);
    setNotice(null);
    try {
      const result = await getAvailability({
        start: bookingWindow.start,
        end: bookingWindow.end,
        resourceType: "SEAT",
      });
      setOptions(result.data.options);
      setDeskChangeOptions(result.data.deskChangeOptions || []);
      const resolution = resolveBookingSelection({
        seats: namedSeats,
        preferredSeatIds: selectedSeatIds,
        start: bookingWindow.start,
        end: bookingWindow.end,
        busy: occupancyReady ? occupancy : result.data.options
          .filter((option) => option.type === "SEAT" && !option.available)
          .map((option) => ({
            resourceId: option.resourceId,
            start: bookingWindow.start,
            end: bookingWindow.end,
          })),
      });
      if (resolution.kind === "single") {
        const option = result.data.options.find((candidate) => (
          candidate.resourceId === resolution.resourceId && candidate.available
        ));
        if (!option) {
          setError("That seat is no longer free for the whole stay.");
          return;
        }
        await loadQuote({ kind: "single", option });
        return;
      }
      if (resolution.kind === "desk_change") {
        const plan = (result.data.deskChangeOptions || []).find((candidate) => candidate.planId === resolution.plan.planId)
          || (result.data.deskChangeOptions || []).find((candidate) => (
            selectedSeatIds.includes(candidate.segments[0].resourceId)
            || selectedSeatIds.includes(candidate.segments[1].resourceId)
          ))
          || result.data.deskChangeOptions?.[0];
        if (!plan) {
          setError("No single seat covers that stay, and no seat change is available either.");
          return;
        }
        await loadQuote({ kind: "desk_change", plan });
        return;
      }
      const fallbackPlan = (result.data.deskChangeOptions || []).find((candidate) => (
        selectedSeatIds.length === 0
        || selectedSeatIds.includes(candidate.segments[0].resourceId)
        || selectedSeatIds.includes(candidate.segments[1].resourceId)
      )) || result.data.deskChangeOptions?.[0];
      if (fallbackPlan) {
        await loadQuote({ kind: "desk_change", plan: fallbackPlan });
        return;
      }
      setError("Those seats cannot cover that stay, and no other combination is open.");
    } catch (caught) {
      console.error(caught);
      setError(errorMessage(caught, "We could not check live availability. Please try again."));
    } finally {
      setLoadingAvailability(false);
    }
  }

  async function bookFreeBlock(resourceId: string, start: number, end: number) {
    const startDate = new Date(start);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: FACILITY_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(startDate);
    const endParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: FACILITY_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(end));
    const read = (list: Intl.DateTimeFormatPart[], type: string) => list.find((part) => part.type === type)?.value || "00";
    const nextStart = `${read(parts, "hour")}:${read(parts, "minute")}`;
    const nextEnd = `${read(endParts, "hour")}:${read(endParts, "minute")}`;
    suppressResetRef.current = true;
    setStartValue(nextStart);
    setEndValue(nextEnd);
    setSelectedSeatIds([resourceId]);
    const option = {
      resourceId,
      name: namedSeats.find((seat) => seat.resourceId === resourceId)?.name || resourceId,
      type: "SEAT" as const,
      available: true,
    };
    const window = toWindow(dateValue, nextStart, nextEnd);
    setLoadingQuote(true);
    setSelection({ kind: "single", option });
    setQuote(null);
    setReviewOpen(false);
    setError(null);
    try {
      const result = await createQuote({
        resourceId,
        start: window.start,
        end: window.end,
      });
      setQuote(result.data);
    } catch (caught) {
      console.error(caught);
      setSelection(null);
      setError(errorMessage(caught, "That time was just taken. Choose another open block."));
    } finally {
      setLoadingQuote(false);
    }
  }
  const remainingAfterBooking = quote
    ? Math.max(0, quote.includedHoursRemaining - quote.includedHoursApplied)
    : 0;
  const memberDiscountPercent = quote?.membershipName && quote.resourceType === "SEAT"
    ? Math.max(0, Math.round((1 - quote.hourlyRateCents / PUBLIC_DESK_RATE_CENTS) * 100))
    : 0;
  const comboPlan = selection?.kind === "desk_change"
    ? selection.plan
    : selectionOrder === "times" && availableOptions.length === 0
      ? deskChangeOptions[0]
      : seatResolution?.kind === "desk_change"
        ? seatResolution.plan
        : undefined;
  const comboMarks: Record<string, string> = {};
  if (comboPlan) {
    comboMarks[comboPlan.segments[0].resourceId] = "First";
    comboMarks[comboPlan.segments[1].resourceId] = "Then";
  }
  const seatStatus: Record<string, SeatVisualStatus> = {};
  for (const seat of floorPlan?.seats ?? []) {
    if (!isKnownBookableSeat(seat.resourceId)) {
      seatStatus[seat.resourceId] = "taken";
      continue;
    }
    if (
      (selection?.kind === "single" && selection.option.resourceId === seat.resourceId)
      || (selectionOrder === "seats" && selectedSeatIds.includes(seat.resourceId) && selection?.kind !== "desk_change")
    ) {
      seatStatus[seat.resourceId] = "selected";
      continue;
    }
    if (selection?.kind === "desk_change" && comboMarks[seat.resourceId]) {
      seatStatus[seat.resourceId] = "selected";
      continue;
    }
    if (selectionOrder === "times" && options.length > 0) {
      const option = options.find((candidate) => candidate.resourceId === seat.resourceId);
      if (option?.available) seatStatus[seat.resourceId] = "open";
      else if (comboMarks[seat.resourceId]) seatStatus[seat.resourceId] = "combo";
      else seatStatus[seat.resourceId] = "taken";
      continue;
    }
    if (selectionOrder === "seats" && occupancyReady && validRange) {
      const blocked = occupancy.some((record) => (
        record.resourceId === seat.resourceId
        && record.start < bookingWindow.end
        && record.end > bookingWindow.start
      ));
      if (!blocked) seatStatus[seat.resourceId] = "open";
      else if (comboMarks[seat.resourceId]) seatStatus[seat.resourceId] = "combo";
      else seatStatus[seat.resourceId] = "taken";
      continue;
    }
    if (comboMarks[seat.resourceId] && selectionOrder === "seats") {
      seatStatus[seat.resourceId] = "combo";
      continue;
    }
    seatStatus[seat.resourceId] = "idle";
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl overflow-x-hidden px-4 py-7 sm:px-6 lg:py-11">
        <header className="max-w-3xl">
          <p className="text-sm font-medium text-slate-500">Book a space</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
            Pick a seat on the floor plan.
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
            Choose the seats first and see when they are open, or choose the time first and see which seats are free. If one seat cannot cover the whole stay, we offer a single seat change that does.
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
              className={`flex min-h-20 items-start gap-4 rounded-2xl border p-4 text-left transition ${
                intent === "DESK"
                  ? "border-slate-950 bg-slate-950 text-white"
                  : "border-slate-200 bg-white text-slate-950 hover:border-slate-400"
              }`}
            >
              <Laptop className="mt-0.5 h-6 w-6 shrink-0" />
              <span>
                <span className="block text-lg font-semibold">Coworking desk</span>
                <span className={`mt-1 block text-sm leading-6 ${intent === "DESK" ? "text-slate-300" : "text-slate-600"}`}>
                  Choose seats on the floor plan, or start with the time you need.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => chooseIntent("MEETING")}
              className={`flex min-h-20 items-start gap-4 rounded-2xl border p-4 text-left transition ${
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

        {intent === "DESK" ? (
          <section className="mt-9 border-t border-slate-200 pt-7">
            <h2 className="text-xl font-semibold text-slate-950">2. How do you want to choose?</h2>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSelectionOrder("seats")}
                className={`min-h-12 rounded-2xl border px-3 py-3 text-sm font-semibold ${
                  selectionOrder === "seats" ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-900"
                }`}
              >
                Seats, then times
              </button>
              <button
                type="button"
                onClick={() => setSelectionOrder("times")}
                className={`min-h-12 rounded-2xl border px-3 py-3 text-sm font-semibold ${
                  selectionOrder === "times" ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white text-slate-900"
                }`}
              >
                Times, then seats
              </button>
            </div>
            {floorPlan ? (
              <div className="mt-5">
                <SeatMap
                  canvasWidth={floorPlan.canvasWidth}
                  canvasHeight={floorPlan.canvasHeight}
                  shell={floorPlan.shell}
                  seats={floorPlan.seats}
                  status={seatStatus}
                  comboMarks={comboMarks}
                  onToggle={toggleSeat}
                />
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {floorPlan.fromLayout
                    ? `This is the published floor layout${bookableSeats.length < 6 ? ` (${bookableSeats.length} bookable ${bookableSeats.length === 1 ? "seat" : "seats"}). Add the other desks in the layout editor and publish to show them here.` : "."}`
                    : "Showing the standard six-seat floor until an admin publishes a layout."}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">Loading the floor plan…</p>
            )}
          </section>
        ) : null}

        {intent ? (
          <section className="mt-9 border-t border-slate-200 pt-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">
                  {intent === "DESK" && selectionOrder === "seats" ? "3. When are those seats free?" : "3. When do you need it?"}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {intent === "DESK" && selectionOrder === "seats"
                    ? "Open blocks for the seats you tapped are listed first. You can also set your own start and end."
                    : "Times come from the current operating calendar, including closures and special hours."}
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
              <div className="mt-5 space-y-4">
                {intent === "DESK" && selectionOrder === "seats" ? (
                  <div>
                    {loadingOccupancy ? (
                      <p className="flex items-center gap-2 text-sm text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" /> Checking which times those seats are open…
                      </p>
                    ) : selectedSeatIds.length === 0 ? (
                      <p className="text-sm text-slate-600">Tap one or more seats on the floor plan to see their open times.</p>
                    ) : selectedFreeBlocks.length === 0 ? (
                      <p className="text-sm text-slate-600">Those seats have no open block on this date. Try another date or another seat.</p>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {selectedFreeBlocks.map((block) => (
                          <button
                            key={`${block.resourceId}-${block.start}`}
                            type="button"
                            onClick={() => bookFreeBlock(block.resourceId, block.start, block.end)}
                            className="min-h-12 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-left text-sm font-medium text-emerald-950"
                          >
                            {namedSeats.find((seat) => seat.resourceId === block.resourceId)?.name || block.resourceId}
                            <span className="mt-1 block text-emerald-800">
                              {formatFacilityTime(block.start)}–{formatFacilityTime(block.end)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-slate-500">{hoursLabel(durationHours)} · Carrollton local time</p>
                  <button
                    type="button"
                    onClick={intent === "DESK" && selectionOrder === "seats" ? bookResolvedStay : checkAvailability}
                    disabled={loadingAvailability || !validRange || (intent === "DESK" && selectionOrder === "seats" && selectedSeatIds.length === 0)}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loadingAvailability ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                    {intent === "MEETING"
                      ? "Check meeting room"
                      : selectionOrder === "seats"
                        ? "Use this time"
                        : "Show seats for this time"}
                  </button>
                </div>
                {intent === "DESK" && selectionOrder === "seats" && seatResolution?.kind === "desk_change" ? (
                  <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-950 ring-1 ring-amber-200">
                    <p className="font-semibold">One seat cannot cover that whole stay.</p>
                    <p className="mt-1">
                      {seatResolution.plan.segments[0].resourceName} from {formatFacilityTime(seatResolution.plan.segments[0].start)} to {formatFacilityTime(seatResolution.plan.changeAt)}, then {seatResolution.plan.segments[1].resourceName} until {formatFacilityTime(seatResolution.plan.segments[1].end)}.
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </section>
        ) : null}

        {intent === "DESK" && selectionOrder === "times" && (options.length > 0 || deskChangeOptions.length > 0) ? (
          <section className="mt-10 border-t border-slate-200 pt-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">4. Seats for this time</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Green seats are free the whole time. Amber seats are part of a one-move plan when no single seat can cover it.
                </p>
              </div>
              <p className="text-sm text-slate-500">{availableOptions.length} continuous option{availableOptions.length === 1 ? "" : "s"}</p>
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

          </section>
        ) : null}

        {intent === "DESK" && loadingQuote ? (
          <div className="mt-5 flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Preparing your live price…</div>
        ) : null}

        {intent === "DESK" && selection && quote && !reviewOpen ? (
          <div className="mt-6 flex flex-col gap-4 border-y border-slate-200 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-slate-950">{quote.resourceName}</p>
              <p className="mt-1 text-sm text-slate-600">{money(quote.totalCents)} due for this stay</p>
            </div>
            <button
              type="button"
              onClick={continueToReview}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-3 font-semibold text-white"
            >
              Review booking <ArrowRight className="h-4 w-4" />
            </button>
          </div>
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
          <section id="booking-review" className="scroll-mt-24 mt-10 border-t border-slate-200 pt-8">
            <p className="text-sm font-medium text-slate-500">Review & checkout</p>
            <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,390px)]">
              <div className="order-2 min-w-0 lg:order-1">
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
                    <p className="mt-1 text-sm text-slate-600">We&apos;ll use this for the booking confirmation and access details.</p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <label className="text-sm font-medium text-slate-700">
                        Name
                        <input
                          value={guestName}
                          onChange={(event) => setGuestName(event.target.value)}
                          autoComplete="name"
                          className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base"
                        />
                      </label>
                      <label className="text-sm font-medium text-slate-700">
                        Email
                        <input
                          type="email"
                          value={guestEmail}
                          onChange={(event) => setGuestEmail(event.target.value)}
                          autoComplete="email"
                          className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base"
                        />
                      </label>
                      <label className="text-sm font-medium text-slate-700 sm:col-span-2">
                        Phone <span className="font-normal text-slate-500">(optional)</span>
                        <input
                          type="tel"
                          value={guestPhone}
                          onChange={(event) => setGuestPhone(event.target.value)}
                          autoComplete="tel"
                          className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base"
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>

              <aside className="order-1 min-w-0 rounded-2xl bg-slate-50 p-5 lg:order-2">
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
                          <span className="font-medium text-slate-950">{money(quote.subtotalCents)}</span>
                        </div>
                      ) : null}
                    </>
                  ) : quote.dailyCapApplied && quote.resourceType === "SEAT" ? (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-slate-600">
                        Desk daily cap<br />
                        <span className="text-xs">Lower than the uncapped hourly total</span>
                      </span>
                      <span className="font-medium text-slate-950">{money(quote.subtotalCents)}</span>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-slate-600">
                        Space charge<br />
                        <span className="text-xs">{hoursLabel(quote.durationHours)} × {money(quote.hourlyRateCents)}</span>
                      </span>
                      <span className="font-medium text-slate-950">{money(quote.subtotalCents)}</span>
                    </div>
                  )}

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
