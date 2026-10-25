import { describe, expect, it } from "vitest";
import { addOnPriceLabel, bookingServiceType, setupForResource, type PublishedCatalog } from "../../apps/web/src/lib/publishedSetups";

const catalog: PublishedCatalog = {
  setups: [
    { id: "b", name: "Workshop", serviceType: "CONFERENCE", resourceId: "room-1", layoutPath: "l", capacity: 12, description: "", arrangement: "Rows", addOnIds: ["coffee", "desk-lamp"] },
    { id: "a", name: "Boardroom", serviceType: "CONFERENCE", resourceId: "room-1", layoutPath: "l", capacity: 8, description: "", arrangement: "Table", addOnIds: ["coffee", "missing"] },
    { id: "c", name: "Focus desk", serviceType: "DESK", resourceId: "desk-1", layoutPath: "l", capacity: 1, description: "", arrangement: "", addOnIds: ["desk-lamp"] },
  ],
  addOns: [
    { id: "coffee", name: "Coffee service", description: "", priceCents: 2500, serviceTypes: ["CONFERENCE"] },
    { id: "desk-lamp", name: "Desk lamp", description: "", priceCents: 0, serviceTypes: ["DESK"] },
  ],
};

describe("published setups on the booking review", () => {
  it("maps the booking intent to the catalog service type", () => {
    expect(bookingServiceType("MEETING")).toBe("CONFERENCE");
    expect(bookingServiceType("WORK")).toBe("DESK");
    expect(bookingServiceType(null)).toBe("DESK");
  });

  it("picks the first setup by name and only add-ons for that service", () => {
    const match = setupForResource(catalog, "room-1", "CONFERENCE");
    expect(match?.setup.id).toBe("a");
    expect(match?.addOns.map((addOn) => addOn.id)).toEqual(["coffee"]);
    expect(setupForResource(catalog, "desk-1", "DESK")?.addOns.map((addOn) => addOn.id)).toEqual(["desk-lamp"]);
  });

  it("shows nothing when there is no catalog, resource, or matching setup", () => {
    expect(setupForResource(null, "room-1", "CONFERENCE")).toBeNull();
    expect(setupForResource(catalog, undefined, "DESK")).toBeNull();
    expect(setupForResource(catalog, "room-1", "DESK")).toBeNull();
  });

  it("labels add-on prices", () => {
    expect(addOnPriceLabel(2500)).toBe("$25.00");
    expect(addOnPriceLabel(0)).toBe("No extra charge");
  });
});
