import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  CLOSE_HOUR,
  LOCATION_TIME_ZONE,
  OPEN_HOUR,
  RESOURCE_CONFIG,
  enforceBookingHorizon,
  findDeskChangePlans,
  getBusy,
  quoteForChoice,
  resolveChoice,
  resourceConflicts,
  validateWindow,
} from "./bookingFlexShared";

function facilityWallTimeToTimestamp(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = targetAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const values = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: LOCATION_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
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

export const booking_getDayOccupancy = onCall(async (request) => {
  const date = String((request.data as { date?: string } | undefined)?.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpsError("invalid-argument", "Choose a valid date.");
  }
  const dayStart = facilityWallTimeToTimestamp(date, "00:00");
  const dayEnd = facilityWallTimeToTimestamp(date, "23:59");
  const raw = await getBusy(dayStart, dayEnd);
  return {
    date,
    timeZone: LOCATION_TIME_ZONE,
    resources: Object.entries(RESOURCE_CONFIG).map(([resourceId, resource]) => ({
      resourceId,
      name: resource.name,
      type: resource.type,
      busy: raw
        .filter((record) => resourceConflicts(resourceId, record.start, record.end, [record]))
        .map((record) => ({
          start: Math.max(record.start, dayStart),
          end: Math.min(record.end, dayEnd),
        }))
        .filter((record) => record.end > record.start),
    })),
  };
});

export const booking_getAvailability = onCall(async (request) => {
  const { start, end } = request.data as { start: number; end: number };
  validateWindow(start, end);
  await enforceBookingHorizon(start, request.auth?.uid);
  const busy = await getBusy(start, end);
  const options = Object.entries(RESOURCE_CONFIG).map(([resourceId, resource]) => ({
    resourceId,
    name: resource.name,
    type: resource.type,
    available: !resourceConflicts(resourceId, start, end, busy),
  }));
  const continuousDeskAvailable = options.some(
    (option) => option.type === "SEAT" && option.available,
  );

  return {
    start,
    end,
    operatingHours: {
      openHour: OPEN_HOUR,
      closeHour: CLOSE_HOUR,
      timeZone: LOCATION_TIME_ZONE,
    },
    options,
    deskChangeOptions: continuousDeskAvailable
      ? []
      : findDeskChangePlans(start, end, busy),
  };
});

export const booking_createQuote = onCall(async (request) => {
  const { resourceId, deskChangePlanId, start, end } = request.data as {
    resourceId?: string;
    deskChangePlanId?: string;
    start: number;
    end: number;
  };
  validateWindow(start, end);
  await enforceBookingHorizon(start, request.auth?.uid);
  const busy = await getBusy(start, end);
  const choice = resolveChoice({ resourceId, deskChangePlanId }, start, end, busy);
  return quoteForChoice(choice, start, end, request.auth?.uid);
});
