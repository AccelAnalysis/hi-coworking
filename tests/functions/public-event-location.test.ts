import { readFileSync } from "node:fs";
import { FieldValue } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import { locationWriteForSave } from "../../apps/functions/src/eventsV2/adminEventSave";
import { publicEvent } from "../../apps/functions/src/eventsV2/core";
import type { EventDocV2 } from "../../apps/functions/src/eventsV2/types";

const CARROLLTON = "15373 Carrollton Blvd, Carrollton, VA";

function event(overrides: Partial<EventDocV2>): EventDocV2 {
  return {
    id: "evt",
    slug: "power-now-pitch-competition",
    title: "Power NOW Pitch Competition",
    description: "Pitch",
    format: "virtual",
    startTime: 1,
    endTime: 2,
    status: "published",
    ...overrides,
  };
}

describe("online event location", () => {
  it("omits a stored street address from the public projection of an online event", () => {
    const projected = publicEvent(event({ format: "virtual", location: CARROLLTON }));
    expect(projected.format).toBe("virtual");
    expect(projected.location).toBeUndefined();
    expect(projected.title).toBe("Power NOW Pitch Competition");
    expect(JSON.stringify(projected)).not.toContain("Carrollton");
  });

  it("keeps a real address on in-person and hybrid public projections", () => {
    expect(publicEvent(event({ format: "in-person", location: CARROLLTON })).location).toBe(CARROLLTON);
    expect(publicEvent(event({ format: "hybrid", location: "Hi Coworking" })).location).toBe("Hi Coworking");
  });

  it("does not persist the hidden default address when the format is online", () => {
    const cleared = locationWriteForSave("virtual", CARROLLTON);
    expect((cleared as { isEqual?: (other: unknown) => boolean }).isEqual?.(FieldValue.delete())).toBe(true);
    expect(locationWriteForSave("in-person", CARROLLTON)).toBe(CARROLLTON);
    expect(locationWriteForSave("hybrid", "  Room A  ")).toBe("Room A");
    expect(locationWriteForSave("in-person", "   ")).toBeUndefined();

    const save = readFileSync("apps/functions/src/eventsV2/adminEventSave.ts", "utf8");
    expect(save).toContain("location: locationWriteForSave(format, input.location)");
    const form = readFileSync("apps/web/src/app/admin/events/new/page.tsx", "utf8");
    expect(form).toContain('location: format === "virtual" ? undefined : (location.trim() || undefined)');
  });
});
