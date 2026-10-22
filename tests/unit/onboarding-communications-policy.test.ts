import { accessResourceForBooking } from "../../apps/functions/src/accessBookingPolicy";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { nurtureEpisode, inactiveEpisode, hasMarketingConsent } from "../../apps/functions/src/nurturePolicy";
import { validateSeamSignature } from "../../apps/functions/src/providers/seamProvider";
import { accessMessage } from "../../apps/web/src/lib/accessStatus";

describe("nurture policy", () => {
  it("enrolls first-booking nurture once per contact, not each booking", () => {
    expect(nurtureEpisode("BOOKING_CONFIRMED", "booking1")).toBe(nurtureEpisode("BOOKING_CONFIRMED", "booking2"));
  });
  it("inactivity is tied to last activity, never scan date", () => {
    expect(inactiveEpisode(123)).toBe("inactive:123");
    expect(inactiveEpisode(123)).not.toBe(inactiveEpisode(456));
  });
  it("requires explicit consent and honors suppression", () => {
    for (const value of [{}, { marketingOptIn: "true" }, { marketingOptIn: true, marketingOptOut: true }, { marketingOptIn: true, doNotContact: true }]) expect(hasMarketingConsent(value)).toBe(false);
    expect(hasMarketingConsent({ marketingOptIn: true })).toBe(true);
  });
});

describe("Seam Svix signatures", () => {
  const now = 1700000000000;
  const payload = '{ "event_type": "access_code.set" }';
  const secret = "whsec_" + Buffer.from("test-only-signing-secret").toString("base64");
  const headers = { id: "msg_test", timestamp: String(now / 1000), signature: "v1," + createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`msg_test.${now / 1000}.${payload}`).digest("base64") };
  it("accepts exact raw bytes signed with the documented scheme", () => expect(validateSeamSignature(payload, headers, secret, now)).toBe(true));
  it("rejects missing, forged, stale, or reformatted requests", () => {
    expect(validateSeamSignature(payload, {}, secret, now)).toBe(false);
    expect(validateSeamSignature(payload, { ...headers, signature: "v1,forged" }, secret, now)).toBe(false);
    expect(validateSeamSignature(payload, headers, secret, now + 301000)).toBe(false);
    expect(validateSeamSignature(JSON.stringify(JSON.parse(payload)), headers, secret, now)).toBe(false);
  });
});

describe("truthful access presentation", () => {
  const access = { grantStatus: "active", codeStatus: "active", doorName: "Front door", startsAt: 1000, endsAt: 5000, deliveryStatus: "queued" };
  it("never calls programming ready or claims queue is delivered", () => {
    expect(accessMessage({ ...access, codeStatus: "programming" }, 2000)).toContain("not yet ready");
    expect(accessMessage(access, 2000)).toContain("delivery is not confirmed");
  });
  it("separates upcoming activation window and expired credentials", () => {
    expect(accessMessage(access, 500)).toContain("upcoming access window");
    expect(accessMessage(access, 6000)).toContain("no longer valid");
  });
  it("shows actionable staff escalation for blocked provisioning", () => expect(accessMessage({ ...access, staffAttentionRequired: true }, 2000)).toContain("Contact Hi Coworking before arrival"));
});


describe("physical access resource selection", () => {
  it("leaves ordinary bookings unchanged and resolves desk-change virtual inventory", () => {
    expect(accessResourceForBooking({ resourceId: "desk1" })).toBe("desk1");
    expect(accessResourceForBooking({ bookingKind: "desk_change", resourceId: "seat-flex", segments: [{ resourceId: "desk1" }] })).toBe("desk1");
    expect(accessResourceForBooking({ bookingKind: "desk_change", resourceId: "seat-flex", segments: [] })).toBeNull();
  });
});
