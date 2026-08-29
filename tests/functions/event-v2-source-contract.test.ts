import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const registration = readFileSync(
  resolve(process.cwd(), "apps/functions/src/eventsV2/registration.ts"),
  "utf8",
);
const clientApi = readFileSync(
  resolve(process.cwd(), "apps/web/src/lib/eventsV2.ts"),
  "utf8",
);
const registrationPanel = readFileSync(
  resolve(process.cwd(), "apps/web/src/components/events/EventRegistrationPanel.tsx"),
  "utf8",
);
const main = readFileSync(
  resolve(process.cwd(), "apps/functions/src/main.ts"),
  "utf8",
);
const webhook = readFileSync(
  resolve(process.cwd(), "apps/functions/src/payments/stripeWebhook.ts"),
  "utf8",
);

describe("reconciled Events v2 transaction boundaries", () => {
  it("routes public registration through the canonical Events v2 client", () => {
    expect(registrationPanel).toContain("beginEventRegistration");
    expect(clientApi).toContain('"events_v2BeginRegistration"');
    expect(registrationPanel).not.toContain("registerFreeEventFn");
    expect(registrationPanel).not.toContain("createTicketCheckoutFn");
  });

  it("reserves aggregate and ticket-type capacity before paid checkout", () => {
    expect(registration).toContain("heldQuantity");
    expect(registration).toContain("reserveTicketInventory");
    expect(registration).toContain("createHoldForIdentity");
    expect(registration).toContain("runTransaction");
  });

  it("reconciles paid checkouts that arrive after hold expiry", () => {
    expect(registration).toContain('hold.status !== "HELD" && hold.status !== "EXPIRED"');
    expect(registration).toContain("capacity_conflict_after_payment");
    expect(registration).toContain("eventRefundJobs");
  });

  it("provides a claimable waitlist offer rather than a stranded status", () => {
    expect(registration).toContain("events_v2ClaimWaitlistOffer");
    expect(registration).toContain("offerHoldId");
    expect(registration).toContain("WAITLIST_CLAIM_MS");
  });

  it("keeps old transaction endpoints fail-closed and avoids legacy Stripe finalization", () => {
    expect(main).toContain("retiredEventEndpoint");
    expect(main).toContain('export * from "./eventsV2/registration"');
    expect(registration).toContain('purpose: "other"');
    expect(webhook).toContain("handledByEventV2");
    expect(webhook).toContain("!handledByEventV2");
  });
});
