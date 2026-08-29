import { describe, expect, it } from "vitest";
import {
  findDeskChangePlans,
  resolveChoice,
  resourceConflicts,
  type BusyRecord,
} from "../../apps/functions/src/bookingFlexShared";

const HOUR = 60 * 60 * 1_000;
const start = Date.UTC(2030, 0, 2, 14, 0, 0, 0);
const end = start + 6 * HOUR;

function fragmentedBusy(): BusyRecord[] {
  return [
    {
      resourceId: "seat-1",
      start: start + 3 * HOUR,
      end,
      status: "CONFIRMED",
    },
    {
      resourceId: "seat-2",
      start,
      end: start + 3 * HOUR,
      status: "CONFIRMED",
    },
    ...["seat-3", "seat-4", "seat-5", "seat-6"].map((resourceId) => ({
      resourceId,
      start,
      end,
      status: "CONFIRMED",
    })),
  ];
}

describe("desk-change booking plans", () => {
  it("offers one explicit change when no single desk covers the whole stay", () => {
    const plans = findDeskChangePlans(start, end, fragmentedBusy());

    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      kind: "desk_change",
      changeAt: start + 3 * HOUR,
      segments: [
        {
          resourceId: "seat-1",
          start,
          end: start + 3 * HOUR,
        },
        {
          resourceId: "seat-2",
          start: start + 3 * HOUR,
          end,
        },
      ],
    });
  });

  it("keeps the continuous single-desk option preferred when one exists", () => {
    const busy = fragmentedBusy().filter((record) => record.resourceId !== "seat-3");

    expect(resourceConflicts("seat-3", start, end, busy)).toBe(false);
    expect(findDeskChangePlans(start, end, busy)).toEqual([]);
  });

  it("treats confirmed occupancy records as authoritative desk conflicts", () => {
    const busy: BusyRecord[] = [{
      resourceId: "seat-2",
      start: start + HOUR,
      end: start + 2 * HOUR,
      status: "CONFIRMED_OCCUPANCY",
      expiresAt: end,
    }];

    expect(resourceConflicts("seat-2", start, end, busy)).toBe(true);
    expect(resourceConflicts("seat-1", start, end, busy)).toBe(false);
  });

  it("re-resolves a plan ID against live availability instead of trusting client segments", () => {
    const originalBusy = fragmentedBusy();
    const plan = findDeskChangePlans(start, end, originalBusy)[0];
    expect(plan).toBeDefined();

    const newlyBusy: BusyRecord[] = [
      ...originalBusy,
      {
        resourceId: "seat-1",
        start,
        end: start + HOUR,
        status: "CONFIRMED",
      },
    ];

    expect(() => resolveChoice(
      { deskChangePlanId: plan.planId },
      start,
      end,
      newlyBusy,
    )).toThrow(/no longer available/i);
  });
});
