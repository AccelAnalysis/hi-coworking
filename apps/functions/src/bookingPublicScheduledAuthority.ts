import { onCall } from "firebase-functions/v2/https";
import * as bookingPublic from "./bookingFlexPublic";
import { assertWindowWithinOperatingCalendar } from "./bookingOperatingCalendar";

type RunnableCallable = {
  run: (request: unknown) => Promise<unknown>;
};

type AvailabilityResult = {
  start: number;
  end: number;
  operatingHours?: Record<string, unknown>;
  options: Array<{
    resourceId: string;
    name: string;
    type: "SEAT" | "MODE";
    available: boolean;
  }>;
  deskChangeOptions?: unknown[];
};

async function runCallable(callable: unknown, request: unknown) {
  return (callable as RunnableCallable).run(request);
}

async function validateRequestedWindow(request: { data?: unknown }) {
  const data = (request.data || {}) as { start?: number; end?: number };
  await assertWindowWithinOperatingCalendar(Number(data.start), Number(data.end));
}

export const booking_getAvailability = onCall(async (request) => {
  await validateRequestedWindow(request);
  const result = await runCallable(
    bookingPublic.booking_getAvailability,
    request,
  ) as AvailabilityResult;
  const resourceType = (request.data as { resourceType?: "SEAT" | "MODE" }).resourceType;
  return {
    ...result,
    options: resourceType
      ? result.options.filter((option) => option.type === resourceType)
      : result.options,
    deskChangeOptions: resourceType === "MODE"
      ? []
      : result.deskChangeOptions || [],
  };
});

export const booking_createQuote = onCall(async (request) => {
  await validateRequestedWindow(request);
  return runCallable(bookingPublic.booking_createQuote, request);
});

export const booking_getDayOccupancy = onCall(async (request) => {
  return runCallable(bookingPublic.booking_getDayOccupancy, request);
});
