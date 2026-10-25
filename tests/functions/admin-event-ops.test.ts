import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADMIN_REVIEW_REFUND_STATUS,
  eventCancellationOutcome,
  rosterRegistration,
} from "../../apps/functions/src/eventsV2/adminEventOps";
import {
  PAID_EVENT_REGISTRATION_LIVE,
  isPaidEvent,
} from "../../apps/functions/src/eventsV2/adminEventSave";

const opsSource = readFileSync("apps/functions/src/eventsV2/adminEventOps.ts", "utf8");
const saveSource = readFileSync("apps/functions/src/eventsV2/adminEventSave.ts", "utf8");
const managementSource = readFileSync("apps/functions/src/eventsV2/management.ts", "utf8");

describe("admin event operations (audit P0-4)", () => {
  it("cancels free seats outright and holds paid seats for admin refund review", () => {
    expect(eventCancellationOutcome({ status: "CONFIRMED", amountPaidCents: 0 })).toBe("cancelled");
    expect(eventCancellationOutcome({ status: "CONFIRMED", amountPaidCents: 2500, paymentId: "pay" })).toBe("refund_review");
    expect(eventCancellationOutcome({ status: "CANCELLED", amountPaidCents: 2500, paymentId: "pay" })).toBe("unchanged");
    expect(eventCancellationOutcome({ status: "REFUNDED", amountPaidCents: 2500, paymentId: "pay" })).toBe("unchanged");
    expect(ADMIN_REVIEW_REFUND_STATUS).toBe("needs_admin_review");
  });

  it("never returns manage secrets on the staff roster", () => {
    const row = rosterRegistration({ id: "r1", manageSecretHash: "secret", displayName: "Guest" } as never);
    expect(row).not.toHaveProperty("manageSecretHash");
    expect(row).toMatchObject({ id: "r1", displayName: "Guest" });
  });

  it("sends no member email and issues no refund from cancel or walk-in", () => {
    expect(opsSource).not.toContain("enqueueNotification");
    expect(opsSource).not.toContain("enqueueRegistrationNotifications");
    expect(opsSource).not.toContain("./notifications");
    expect(opsSource).not.toContain("stripeProvider");
    expect(opsSource).not.toContain("refundPayment");
    expect(opsSource).not.toContain('status: "pending"');
    expect(opsSource).toContain("emailsSent: 0");
    expect(opsSource).toContain("refundsIssued: 0");
  });

  it("keeps one implementation: the main codebase re-exports the admin operations", () => {
    expect(managementSource).toContain('from "./adminEventOps"');
    expect(managementSource).not.toMatch(/export const events_v2AdminCancelEvent\s*=/);
    expect(managementSource).not.toMatch(/export const events_v2StaffWalkIn\s*=/);
  });
});

describe("paid publish guard (audit P1-2)", () => {
  it("detects a paid event from its base price or any paid ticket type", () => {
    expect(isPaidEvent({ price: 0, ticketTypes: [] })).toBe(false);
    expect(isPaidEvent({ price: 1500, ticketTypes: [] })).toBe(true);
    expect(isPaidEvent({ price: 0, ticketTypes: [{ priceCents: 0 }, { priceCents: 900 }] as never })).toBe(true);
  });

  it("blocks publishing, or saving a published event, with paid tickets until paid registration ships", () => {
    expect(PAID_EVENT_REGISTRATION_LIVE).toBe(false);
    expect(saveSource).toContain("if (!PAID_EVENT_REGISTRATION_LIVE) throw new HttpsError(\"failed-precondition\", PAID_EVENT_NOT_LIVE_MESSAGE);");
    expect(saveSource).toContain('event.status === "published" && isPaidEvent(event) && !PAID_EVENT_REGISTRATION_LIVE');
  });
});
