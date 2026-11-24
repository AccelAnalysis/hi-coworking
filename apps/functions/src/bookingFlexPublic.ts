import { onCall } from "firebase-functions/v2/https";
import {
  CLOSE_HOUR,
  HOURS_MESSAGE,
  LOCATION_TIME_ZONE,
  OPEN_DAYS,
  OPEN_HOUR,
  RESOURCE_CONFIG,
  enforceBookingHorizon,
  DESK_RESOURCE_IDS,
  findDeskChangePlans,
  getBusy,
  quoteForChoice,
  resolveChoice,
  resourceConflicts,
  validateWindow,
} from "./bookingFlexShared";
import {
  assertResourceOffered,
  isResourceOffered,
  loadResourceOfferingMap,
} from "./resourceOffering";

export const booking_getAvailability = onCall(async (request) => {
  const { start, end } = request.data as { start: number; end: number };
  validateWindow(start, end);
  await enforceBookingHorizon(start, request.auth?.uid);
  const busy = await getBusy(start, end);
  const offered = await loadResourceOfferingMap();
  const options = Object.entries(RESOURCE_CONFIG)
    .filter(([resourceId]) => isResourceOffered(resourceId, offered))
    .map(([resourceId, resource]) => ({
      resourceId,
      name: resource.name,
      type: resource.type,
      available: !resourceConflicts(resourceId, start, end, busy),
    }));
  const offeredDeskIds = DESK_RESOURCE_IDS.filter((resourceId) => isResourceOffered(resourceId, offered));
  const continuousDeskAvailable = offeredDeskIds.some(
    (resourceId) => !resourceConflicts(resourceId, start, end, busy),
  );

  return {
    start,
    end,
    operatingHours: {
      openHour: OPEN_HOUR,
      closeHour: CLOSE_HOUR,
      openDays: OPEN_DAYS,
      summary: HOURS_MESSAGE,
      timeZone: LOCATION_TIME_ZONE,
    },
    options,
    deskChangeOptions: continuousDeskAvailable
      ? []
      : findDeskChangePlans(start, end, busy, offeredDeskIds),
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
  const offered = await loadResourceOfferingMap();
  if (resourceId) assertResourceOffered(resourceId, offered);
  const busy = await getBusy(start, end);
  const offeredDeskIds = DESK_RESOURCE_IDS.filter((id) => isResourceOffered(id, offered));
  const choice = resolveChoice({ resourceId, deskChangePlanId }, start, end, busy, offeredDeskIds);
  if (choice.kind === "desk_change") {
    for (const segment of choice.segments) assertResourceOffered(segment.resourceId, offered);
  } else {
    assertResourceOffered(choice.resourceId, offered);
  }
  return quoteForChoice(choice, start, end, request.auth?.uid);
});
