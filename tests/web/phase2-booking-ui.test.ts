import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AFTER_HOURS_CONFERENCE_SLOT_PRICE_CENTS,
  PRIVATE_OFFICE_RATES,
  afterHoursSlotsOverlap,
  isResourceOffered,
  validateAfterHoursConferenceWindow,
} from "../../packages/shared/src/index.ts";

const read = (path: string) => readFileSync(path, "utf8");

describe("Phase 2 booking and pricing UI", () => {
  it("lists private office rates on the pricing page and books from /book", () => {
    const pricing = read("apps/web/src/app/pricing/page.tsx");
    expect(pricing).toMatch(/PRIVATE_OFFICE_RATES/);
    expect(pricing).toContain('data-testid="private-office-rates"');
    expect(pricing).toContain("/book?resource=private-office");
    expect(PRIVATE_OFFICE_RATES).toMatchObject({
      guestHourlyCents: 3900,
      guestHalfDayCents: 9900,
      guestDayCents: 14900,
    });
    expect(pricing).toContain("/book?resource=mode-conference#after-hours");
    expect(pricing).toContain("officeOffered");
    expect(pricing).toContain("conferenceOffered");
    expect(pricing).toContain("useResourceOffering");
  });

  it("adds the office to the floor-plan picker and the booking flow", () => {
    const picker = read("apps/web/src/components/booking/SeatMapPicker.tsx");
    const plan = read("apps/web/src/components/booking/ArchitecturalFloorPlan.tsx");
    const booking = read("apps/web/src/components/BookingExperienceWithDeskChange.tsx");
    expect(picker).toContain("data-office-hit-target");
    expect(picker).toContain("PRIVATE_OFFICE_RESOURCE_ID");
    expect(plan).toContain('data-plan-zone="private-office"');
    expect(plan).not.toContain("Not bookable");
    expect(booking).toContain("AfterHoursConferenceRequest");
    expect(booking).toMatch(/option\.type === "SEAT" \|\| option\.type === "ROOM"/);
    expect(booking).toContain("Show available spaces");
    expect(booking).toContain("Choose a coworking desk or the meeting room first.");
    expect(booking).not.toContain("Choose a coworking desk, the private office, or the meeting room first.");
    expect(plan).not.toMatch(/>\s*LOUNGE\s*</);
    expect(picker).toContain("officeOffered");
    expect(plan).toContain('"unoffered"');
    expect(booking).toContain("useResourceOffering");
  });

  it("lets an admin turn the private office off and back on", () => {
    const offerings = read("apps/web/src/app/admin/spaces/offerings/page.tsx");
    const dashboard = read("apps/web/src/app/admin/dashboard/page.tsx");
    const nav = read("apps/web/src/lib/adminNavigation.ts");
    expect(offerings).toContain('data-testid={`offered-space-${resource.id}`}');
    expect(offerings).toContain("Offered spaces");
    expect(offerings).toContain("Private Office stays off");
    expect(dashboard).toContain('href: "/admin/spaces/offerings"');
    expect(nav).toContain('"/admin/spaces/offerings"');
    expect(isResourceOffered("private-office")).toBe(false);
    expect(isResourceOffered("seat-1")).toBe(true);
    expect(isResourceOffered("private-office", { "private-office": true })).toBe(true);
  });

  it("surfaces evening and weekend requests and the full-day upgrade action", () => {
    const request = read("apps/web/src/components/booking/AfterHoursConferenceRequest.tsx");
    const upgrade = read("apps/web/src/components/booking/FullDayUpgradeAction.tsx");
    const card = read("apps/web/src/components/BookingManagementCard.tsx");
    const admin = read("apps/web/src/app/admin/conference-requests/page.tsx");
    expect(request).toContain("booking_requestAfterHoursConference");
    expect(request).toContain("id=\"after-hours\"");
    expect(upgrade).toContain("Upgrade to Full Day");
    expect(upgrade).toContain("$0 with included hours");
    expect(card).toContain("FullDayUpgradeAction");
    expect(admin).toContain("admin_reviewConferenceSlotRequest");
    expect(admin).toContain("Approve");
    expect(AFTER_HOURS_CONFERENCE_SLOT_PRICE_CENTS).toBe(29900);
  });

  it("documents the weekend overlap rule used by the request UI", () => {
    const pmOne = validateAfterHoursConferenceWindow("2030-01-05", "13:00", "17:00");
    const eveFour = validateAfterHoursConferenceWindow("2030-01-05", "16:00", "20:00");
    const pmNoon = validateAfterHoursConferenceWindow("2030-01-05", "12:00", "16:00");
    const eveFive = validateAfterHoursConferenceWindow("2030-01-05", "17:00", "21:00");
    expect(pmOne.ok && eveFour.ok && pmNoon.ok && eveFive.ok).toBe(true);
    if (pmOne.ok && eveFour.ok && pmNoon.ok && eveFive.ok) {
      expect(afterHoursSlotsOverlap(pmOne.slot, eveFour.slot)).toBe(true);
      expect(afterHoursSlotsOverlap(pmNoon.slot, eveFour.slot)).toBe(false);
      expect(afterHoursSlotsOverlap(pmOne.slot, eveFive.slot)).toBe(false);
    }
  });
});
