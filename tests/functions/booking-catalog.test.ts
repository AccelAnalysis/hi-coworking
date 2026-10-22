import { beforeEach, describe, expect, it, vi } from "vitest";
const memory = vi.hoisted(() => ({ docs: new Map<string, any>() }));
vi.mock("../../apps/functions/node_modules/firebase-admin", () => {
  const doc = (path: string) => ({ path, get: async () => ({ exists: memory.docs.has(path), data: () => memory.docs.get(path) }) });
  return { apps: [{}], firestore: () => ({ doc, collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`), where: () => ({ get: async () => ({ docs: [...memory.docs.entries()].filter(([path, value]) => path.startsWith(`${name}/`) && path.split("/").length === name.split("/").length + 1 && value.status === "PUBLISHED").map(([path, value]) => ({ id: path.split("/").at(-1), data: () => value })) }) }) }) }) };
});
import { assertCatalogReschedule, loadBookingCatalog } from "../../apps/functions/src/bookingCatalog";
import { quoteForChoice, type BookingChoice } from "../../apps/functions/src/bookingFlexShared";
const choice: BookingChoice = { kind: "single", resourceId: "mode-conference", resourceName: "Meeting setup", resourceType: "MODE" };
const layoutPath = "locations/main/floors/first/layouts/meeting";
beforeEach(() => {
  memory.docs.clear();
  memory.docs.set("spaceSetups/meeting", { published: true, name: "Boardroom", resourceId: "mode-conference", serviceType: "CONFERENCE", capacity: 8, layoutPath, addOnIds: ["screen", "coffee"] });
  memory.docs.set(layoutPath, { status: "PUBLISHED", elements: [{ resourceId: "mode-conference" }] });
  memory.docs.set("spaceAddOns/screen", { published: true, name: "Screen", priceCents: 1500, serviceTypes: ["CONFERENCE"] });
  memory.docs.set("spaceAddOns/coffee", { published: true, name: "Coffee", priceCents: 0, serviceTypes: ["CONFERENCE"] });
});

describe("published booking catalog pricing", () => {
  it("snapshots only authoritative server prices once per selected add-on", async () => {
    expect(await loadBookingCatalog(choice, { setupId: "meeting", addOnIds: ["screen", "screen", "coffee"], attendeeCount: 5 })).toMatchObject({
      setup: { id: "meeting", name: "Boardroom", capacity: 8 }, attendeeCount: 5,
      addOns: [{ id: "screen", priceCents: 1500 }, { id: "coffee", priceCents: 0 }], addOnTotalCents: 1500,
    });
  });
  it("includes extras in total before applying account credit", async () => {
    const now = Date.UTC(2026, 9, 26, 12);
    vi.spyOn(Date, "now").mockReturnValue(now);
    memory.docs.set("users/member", { accountCreditCents: 1000 });
    const quote = await quoteForChoice(choice, now + 2 * 3600000, now + 4 * 3600000, "member", { setupId: "meeting", addOnIds: ["screen"] });
    expect(quote).toMatchObject({ spaceSubtotalCents: 19800, addOnTotalCents: 1500, subtotalCents: 21300, accountCreditAppliedCents: 1000, totalCents: 20300 });
  });
  it("keeps legacy no-selection prices and rejects extras without a setup", async () => {
    expect(await loadBookingCatalog(choice)).toEqual({ setup: null, addOns: [], addOnTotalCents: 0, attendeeCount: 1 });
    await expect(loadBookingCatalog(choice, { addOnIds: ["screen"] })).rejects.toThrow(/setup/);
  });
  it("rejects unpublished setup, layout, resource mismatch, and unsupported service", async () => {
    const setup = { ...memory.docs.get("spaceSetups/meeting") };
    for (const change of [{ published: false }, { resourceId: "seat-1" }, { serviceType: "DESK" }]) {
      memory.docs.set("spaceSetups/meeting", { ...setup, ...change });
      await expect(loadBookingCatalog(choice, { setupId: "meeting" })).rejects.toThrow(/not currently available/);
    }
    memory.docs.set("spaceSetups/meeting", setup);
    memory.docs.set(layoutPath, { status: "DRAFT", elements: [{ resourceId: "mode-conference" }] });
    await expect(loadBookingCatalog(choice, { setupId: "meeting" })).rejects.toThrow(/published layout/);
    memory.docs.set(layoutPath, { status: "PUBLISHED", elements: [{ resourceId: "seat-1" }] });
    await expect(loadBookingCatalog(choice, { setupId: "meeting" })).rejects.toThrow(/published layout/);
  });
  it("rejects unoffered, unpublished, incompatible, and missing-price add-ons", async () => {
    await expect(loadBookingCatalog(choice, { setupId: "meeting", addOnIds: ["unlisted"] })).rejects.toThrow(/not offered/);
    const addon = { ...memory.docs.get("spaceAddOns/screen") };
    for (const change of [{ published: false }, { serviceTypes: ["DESK"] }, { priceCents: undefined }, { priceCents: -1 }, { priceCents: 1.5 }, { priceCents: "1500" }]) {
      memory.docs.set("spaceAddOns/screen", { ...addon, ...change });
      await expect(loadBookingCatalog(choice, { setupId: "meeting", addOnIds: ["screen"] })).rejects.toThrow();
    }
  });
  it("enforces setup and physical capacity and validates selection identifiers", async () => {
    await expect(loadBookingCatalog(choice, { setupId: "meeting", attendeeCount: 9 })).rejects.toThrow(/capacity/);
    memory.docs.get("spaceSetups/meeting").capacity = 100;
    await expect(loadBookingCatalog(choice, { setupId: "meeting", attendeeCount: 11 })).rejects.toThrow(/capacity/);
    for (const attendeeCount of [0, -1, 1.5, NaN]) await expect(loadBookingCatalog(choice, { attendeeCount })).rejects.toThrow(/attendee/);
    await expect(loadBookingCatalog(choice, { setupId: "../other" })).rejects.toThrow(/valid setup/);
    await expect(loadBookingCatalog(choice, { addOnIds: ["../other"] })).rejects.toThrow(/valid add-ons/);
  });
  it("uses the injected transaction reader for setup/layout/addon authority", async () => {
    const read = vi.fn(async (ref: any) => ({ data: () => memory.docs.get(ref.path) }) as any);
    await loadBookingCatalog(choice, { setupId: "meeting", addOnIds: ["screen"] }, read);
    expect(read.mock.calls.map(([ref]) => ref.path)).toEqual(["spaceSetups/meeting", layoutPath, "spaceAddOns/screen"]);
    memory.docs.get("spaceAddOns/screen").priceCents = 2300;
    expect((await loadBookingCatalog(choice, { setupId: "meeting", addOnIds: ["screen"] }, read)).addOnTotalCents).toBe(2300);
  });
});


import { effectiveLayoutId, layoutCoversBooking } from "../../apps/functions/src/bookingLayoutRules";
describe("effective layout dates and safe catalog rescheduling", () => {
  const monday = Date.UTC(2026, 9, 26, 14); // 10:00 facility time
  it("resolves facility weekday and rejects scheduled layout beyond its window", () => {
    const layouts = [
      { id: "default", status: "PUBLISHED", effectiveRules: { precedence: "DEFAULT" } },
      { id: "meeting", status: "PUBLISHED", effectiveRules: { daysOfWeek: [1], startTime: "09:00", endTime: "11:00" } },
    ];
    expect(effectiveLayoutId(layouts, monday)).toBe("meeting");
    expect(layoutCoversBooking(layouts, "meeting", monday, monday + 3600000)).toBe(true);
    expect(layoutCoversBooking(layouts, "meeting", monday, monday + 2 * 3600000)).toBe(false);
    expect(effectiveLayoutId(layouts, monday + 24 * 3600000)).toBe("default");
  });
  it("rejects mid-booking override even at a sub-minute boundary; expired override never falls back", () => {
    const layouts = [
      { id: "meeting", status: "PUBLISHED" },
      { id: "override", status: "PUBLISHED", effectiveRules: { precedence: "OVERRIDE", oneOffOverrideWindows: [{ start: monday + 30001, end: monday + 45000 }] } },
    ];
    expect(layoutCoversBooking(layouts, "meeting", monday, monday + 3600000)).toBe(false);
    expect(effectiveLayoutId(layouts, monday + 60000)).toBe("meeting");
    expect(effectiveLayoutId([layouts[1]], monday + 60000)).toBe(null);
  });
  it("permits same configured paid setup, but changed price or layout requires staff/requote", async () => {
    const snapshot = await loadBookingCatalog(choice, { setupId: "meeting", addOnIds: ["screen"] });
    const booking = { ...snapshot, resourceId: "mode-conference" };
    await expect(assertCatalogReschedule(booking, monday, monday + 3600000)).resolves.toBeUndefined();
    memory.docs.get("spaceAddOns/screen").priceCents = 1600;
    await expect(assertCatalogReschedule(booking, monday, monday + 3600000)).rejects.toThrow(/new quote/);
    memory.docs.get("spaceAddOns/screen").priceCents = 1500;
    memory.docs.get(layoutPath).effectiveRules = { daysOfWeek: [2] };
    await expect(assertCatalogReschedule(booking, monday, monday + 3600000)).rejects.toThrow(/Contact staff/);
    expect(booking.addOnTotalCents).toBe(1500);
  });
  it("rejects price quote against an inactive selected layout", async () => {
    memory.docs.get(layoutPath).effectiveRules = { daysOfWeek: [2] };
    await expect(loadBookingCatalog(choice, { setupId: "meeting" }, undefined, { start: monday, end: monday + 3600000 })).rejects.toThrow(/entire selected time/);
  });
});

import { layoutForBooking } from "../../apps/web/src/lib/bookingCatalog";
it("keeps server and customer layout precedence, override edges and DST resolution in parity", () => {
  const fallBack = Date.UTC(2026, 10, 1, 5, 30); // first 01:30 in New York
  const layouts = [
    { id: "default", status: "PUBLISHED", updatedAt: 1, effectiveRules: { precedence: "DEFAULT" } },
    { id: "scheduled-low", status: "PUBLISHED", updatedAt: 2, effectiveRules: { daysOfWeek: [0], startTime: "01:00", endTime: "02:00", priority: 1 } },
    { id: "scheduled-high", status: "PUBLISHED", updatedAt: 3, effectiveRules: { daysOfWeek: [0], startTime: "01:00", endTime: "02:00", priority: 2 } },
    { id: "override", status: "PUBLISHED", updatedAt: 4, effectiveRules: { precedence: "OVERRIDE", oneOffOverrideWindows: [{ start: fallBack + 10000, end: fallBack + 30000, priority: 4 }] } },
    { id: "draft", status: "DRAFT", updatedAt: 100, effectiveRules: { priority: 999 } },
  ];
  for (const instant of [fallBack - 3 * 3600000, fallBack, fallBack + 10000, fallBack + 29999, fallBack + 30000, fallBack + 3600000, fallBack + 2 * 3600000]) {
    expect(effectiveLayoutId(layouts, instant)).toBe(layoutForBooking(layouts as any, instant)?.id || null);
  }
  expect(effectiveLayoutId(layouts, fallBack)).toBe("scheduled-high");
  expect(effectiveLayoutId(layouts, fallBack + 3600000)).toBe("scheduled-high");
});
