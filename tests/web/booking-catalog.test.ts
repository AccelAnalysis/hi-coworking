import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LayoutVariant } from "@hi/shared";
import { compatibleAddOns, layoutForBooking, type PublishedCatalog } from "../../apps/web/src/lib/bookingCatalog";

const layout = (id: string, rules?: LayoutVariant["effectiveRules"], status: LayoutVariant["status"] = "PUBLISHED"): LayoutVariant => ({ id, name: id, floorId: "floor", status, updatedAt: 1, elements: [], effectiveRules: rules });
const rules = (values: Partial<NonNullable<LayoutVariant["effectiveRules"]>>): NonNullable<LayoutVariant["effectiveRules"]> => ({ precedence: "SCHEDULED", priority: 0, oneOffOverrideWindows: [], ...values });

describe("selected-date published layout", () => {
  it("resolves facility weekday/time for the selected date, not browser time or today", () => {
    const monday = layout("monday", rules({ daysOfWeek: [1], startTime: "09:00", endTime: "17:00" }));
    const tuesday = layout("tuesday", rules({ daysOfWeek: [2], startTime: "09:00", endTime: "17:00" }));
    expect(layoutForBooking([monday, tuesday], Date.parse("2030-01-07T14:00:00Z"))?.id).toBe("monday");
    expect(layoutForBooking([monday, tuesday], Date.parse("2030-01-08T14:00:00Z"))?.id).toBe("tuesday");
    expect(layoutForBooking([monday], Date.parse("2030-01-07T22:00:00Z"))).toBeNull();
  });
  it("honors one-off overrides and never substitutes a draft or out-of-schedule layout", () => {
    const start = Date.parse("2030-01-07T14:00:00Z");
    const override = layout("override", rules({ precedence: "OVERRIDE", oneOffOverrideWindows: [{ start, end: start + 3600000 }] }));
    const base = layout("default", rules({ precedence: "DEFAULT" }));
    expect(layoutForBooking([base, override], start)?.id).toBe("override");
    expect(layoutForBooking([base, override], start + 3600000)?.id).toBe("default");
    expect(layoutForBooking([override], start - 1)).toBeNull();
    expect(layoutForBooking([layout("draft", undefined, "DRAFT")], start)).toBeNull();
    expect(layoutForBooking([base], 0)).toBeNull();
  });
});

describe("published booking catalog", () => {
  it("only offers published explicitly permitted compatible add-ons with valid prices", () => {
    const setup = { id: "s", name: "Room", serviceType: "CONFERENCE" as const, resourceId: "mode-room", capacity: 10, addOnIds: ["free", "paid", "hidden", "desk", "invalid"], layoutPath: "locations/a/floors/b/layouts/c", published: true };
    const add = (id: string, overrides = {}) => ({ id, name: id, priceCents: 100, published: true, serviceTypes: ["CONFERENCE"], ...overrides });
    const catalog: PublishedCatalog = { setups: [setup], addOns: [add("free", { priceCents: 0 }), add("paid"), add("hidden", { published: false }), add("desk", { serviceTypes: ["DESK"] }), add("invalid", { priceCents: -1 }), add("not-allowed")] };
    expect(compatibleAddOns(catalog, setup).map((item) => item.id)).toEqual(["free", "paid"]);
    expect(compatibleAddOns(catalog)).toEqual([]);
  });
  it("sends catalog identifiers plus price-consent guard, renders server breakdown, and retains both entry paths", () => {
    const source = readFileSync("apps/web/src/components/BookingExperienceWithDeskChange.tsx", "utf8");
    expect(source).toContain("space_getPublishedCatalog");
    expect(source).toContain("expectedTotalCents: quote.totalCents");
    expect(source).toContain("{ setupId, addOnIds, attendeeCount }");
    expect(source).toContain("quote.spaceSubtotalCents ?? quote.subtotalCents");
    expect(source).toContain("quote.addOns?.map");
    expect(source).toContain("Seat / setup first");
    expect(source).toContain("Time first");
    expect(source).toContain("timestamp={bookingWindow.start}");
    expect(source).toContain("version !== quoteVersion.current");
  });
});

describe("confirmed purchase snapshots", () => {
  it("shows saved setup/add-ons in account and return, without consulting catalog", () => {
    const detail = readFileSync("apps/web/src/components/BookingCatalogDetails.tsx", "utf8");
    const account = readFileSync("apps/web/src/app/account/bookings/page.tsx", "utf8");
    const complete = readFileSync("apps/web/src/app/book/complete/page.tsx", "utf8");
    expect(account.match(/<BookingCatalogDetails booking={booking}/g)).toHaveLength(2);
    expect(complete).toContain("bookingDetails: result.data.bookingDetails");
    expect(complete).toContain("<BookingCatalogDetails booking={state.bookingDetails}");
    expect(detail).toContain("booking.addOns.map");
    expect(detail).toContain("item.priceCents / 100");
    expect(detail).not.toContain("space_getPublishedCatalog");
  });
});
