import { onCall } from "firebase-functions/v2/https";
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
