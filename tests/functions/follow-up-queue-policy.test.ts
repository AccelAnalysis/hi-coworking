import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFollowUp,
  FOLLOW_UP_REASONS,
  FOLLOW_UPS_COLLECTION,
  needsNoCheckinFollowUp,
  noCheckoutBillingCap,
  normalizeResolutionNote,
} from "../../apps/functions/src/followUps/policy";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 20, 17);

describe("Jessica's follow-up queue", () => {
  it("routes every item to Jessica (Member & Event Operations) with a deterministic id", () => {
    const item = buildFollowUp({ type: "no_checkin", memberId: "member-1", bookingId: "booking-1", now: NOW });
    expect(item).toMatchObject({
      id: "no_checkin_booking-1", owner: "jessica", ownerTeam: "Member & Event Operations",
      type: "no_checkin", memberId: "member-1", bookingId: "booking-1", status: "open", createdAt: NOW,
    });
    expect(buildFollowUp({ type: "no_checkout", memberId: "m", visitId: "visit-9", now: NOW }).id).toBe("no_checkout_visit-9");
    expect(buildFollowUp({ type: "form1583_paperwork", memberId: "m", now: NOW }).id).toBe("form1583_paperwork_m");
  });

  it("stores ids and a fixed reason only, no names, emails or phone numbers", () => {
    const item = buildFollowUp({ type: "no_checkout", memberId: "uid-1", visitId: "v1", billingCapAt: NOW, now: NOW });
    expect(Object.keys(item).sort()).toEqual([
      "billingCapAt", "bookingId", "createdAt", "id", "memberId", "owner", "ownerTeam", "reason",
      "resolutionNote", "resolvedAt", "resolvedBy", "status", "type", "updatedAt", "visitId",
    ]);
    expect(JSON.stringify(item)).not.toMatch(/@|\+1|\d{3}-\d{3}-\d{4}/);
    expect(() => buildFollowUp({ type: "no_checkin", memberId: "someone@example.test", bookingId: "b", now: NOW })).toThrow();
    expect(() => buildFollowUp({ type: "no_checkin", memberId: "m", now: NOW })).toThrow();
  });

  it("caps billing for a visit with no check-out at the booked end plus one hour", () => {
    const checkInAt = NOW;
    const bookedEnd = NOW + 2 * HOUR;
    expect(noCheckoutBillingCap({ checkInAt, autoCloseAt: NOW + 8 * HOUR, bookedEnd })).toBe(bookedEnd + HOUR);
    expect(noCheckoutBillingCap({ checkInAt, autoCloseAt: NOW + 2.5 * HOUR, bookedEnd })).toBe(NOW + 2.5 * HOUR);
    expect(noCheckoutBillingCap({ checkInAt: NOW + 5 * HOUR, autoCloseAt: NOW + 8 * HOUR, bookedEnd })).toBe(NOW + 5 * HOUR);
    expect(noCheckoutBillingCap({ checkInAt, autoCloseAt: NOW + 8 * HOUR, bookedEnd: null })).toBe(NOW + 8 * HOUR);
  });

  it("flags no check-in only when the door code was never used and there was no iPad check-in", () => {
    expect(needsNoCheckinFollowUp({ flagStatus: "no_show", hasVisit: false, doorUnlocked: false })).toBe(true);
    expect(needsNoCheckinFollowUp({ flagStatus: "no_show", hasVisit: false, doorUnlocked: true })).toBe(false);
    expect(needsNoCheckinFollowUp({ flagStatus: "no_show", hasVisit: true, doorUnlocked: false })).toBe(false);
    expect(needsNoCheckinFollowUp({ flagStatus: "late", hasVisit: false, doorUnlocked: false })).toBe(false);
  });

  it("says the Form 1583 confirmation is done by a person, never automated", () => {
    const reason = FOLLOW_UP_REASONS.form1583_paperwork;
    expect(reason).toMatch(/staff member or a notary/);
    expect(reason).not.toMatch(/\b(AI|bot|automated|assistant)\b/i);
    expect(normalizeResolutionNote("  a   note ")).toBe("a note");
    expect(normalizeResolutionNote("x".repeat(900))).toHaveLength(500);
    expect(normalizeResolutionNote(5)).toBeNull();
  });

  it("is written only by server code: no client writes, no emails, no webhooks", () => {
    const rules = readFileSync(resolve("firestore.rules"), "utf8");
    const block = rules.slice(rules.indexOf(`match /${FOLLOW_UPS_COLLECTION}/{docId}`));
    expect(block).toMatch(/allow read: if isAdmin\(\);\s*allow write: if false;/);
    const store = readFileSync(resolve("apps/functions/src/followUps/store.ts"), "utf8");
    expect(store).not.toMatch(/fetch\(|resend|sendMail|collection\("mail"\)|webhook/i);
    const kiosk = readFileSync(resolve("apps/functions/src/frontDeskKiosk/functions.ts"), "utf8");
    expect(kiosk).toMatch(/type: "no_checkout"/);
    expect(kiosk).toMatch(/type: "no_checkin"/);
  });
});
