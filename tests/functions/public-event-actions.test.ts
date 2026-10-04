import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publicDescription, publicEvent } from "../../apps/functions/src/eventsV2/core";
import type { EventDocV2 } from "../../apps/functions/src/eventsV2/types";

const BOOKINGS_URL = "https://bookings.cloud.microsoft/book/PowerNOWPitchCompetition1@NETORGFT15328873.onmicrosoft.com/s/KPe0I4_0kECVOZwUFW3xsQ2?ismsaljsauthenabled";

const DESCRIPTION = `Virtual Pitch
The competition will be conducted virtually. Select an available pitch time below to participate.

Register: ${BOOKINGS_URL}`;

function event(overrides: Partial<EventDocV2> = {}): EventDocV2 {
  return {
    id: "evt_1791078442311_hwuqg",
    slug: "power-now-pitch-competition",
    title: "Power NOW Pitch Competition",
    description: DESCRIPTION,
    format: "virtual",
    location: "15373 Carrollton Blvd, Carrollton, VA",
    startTime: 1792796400000,
    endTime: 1792800000000,
    status: "published",
    ...overrides,
  };
}

describe("public Power NOW event actions", () => {
  it("strips the raw registration URL from the public description", () => {
    const description = publicDescription(DESCRIPTION);
    expect(description).not.toContain("bookings.cloud.microsoft");
    expect(description).not.toContain("Register:");
    expect(description).toContain("Virtual Pitch");
    expect(description).toContain("Select an available pitch time below to participate.");

    const projected = publicEvent(event());
    expect(projected.description).toBe(description);
    expect(JSON.stringify(projected)).not.toContain("Carrollton");
    expect(JSON.stringify(projected)).not.toContain("bookings.cloud.microsoft");
    expect(projected.startTime).toBe(1792796400000);
    expect(projected.endTime).toBe(1792800000000);
    expect(projected.format).toBe("virtual");
  });

  it("keeps an in-person address and a description that has no registration link", () => {
    const projected = publicEvent(event({
      format: "in-person",
      description: "Meet at the hub.",
      location: "15373 Carrollton Blvd, Carrollton, VA",
    }));
    expect(projected.location).toBe("15373 Carrollton Blvd, Carrollton, VA");
    expect(projected.description).toBe("Meet at the hub.");
  });

  it("deploys registration and interest actions without the SendGrid mail worker", () => {
    const registration = readFileSync("apps/functions/src/eventsV2/publicRegistration.ts", "utf8");
    expect(registration).toContain("export const events_v2BeginRegistration");
    expect(registration).toContain("export const events_v2SubmitEventInterest");
    expect(registration).toContain('kind !== "pitch" && kind !== "prize"');
    expect(registration).not.toContain("SENDGRID_API_KEY");
    expect(registration).not.toContain('from "./notifications"');
    expect(registration).not.toMatch(/startTime\s*:/);
    expect(registration).not.toContain("pre-screen date");

    const detail = readFileSync("apps/web/src/app/events/detail/page.tsx", "utf8");
    expect(detail).toContain("aspect-video");
    expect(detail).toContain("object-contain");
    expect(detail).toContain("PitchEventActions");
    expect(detail).toContain("publicEventDescription");

    const actions = readFileSync("apps/web/src/components/events/PitchEventActions.tsx", "utf8");
    expect(actions).toContain("Attend the event");
    expect(actions).toContain("Offer your business’s product as a prize");
    expect(actions).toContain("Apply to pitch");
    expect(actions).toContain("does not reserve a pitch slot");
    expect(actions).not.toContain("bookings.cloud.microsoft");
    expect(actions).not.toMatch(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b/);
  });
});
