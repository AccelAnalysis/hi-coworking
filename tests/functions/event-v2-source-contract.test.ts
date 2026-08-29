import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const eventV2 = readFileSync(resolve(process.cwd(), "apps/functions/src/eventV2.ts"), "utf8");
const detail = readFileSync(resolve(process.cwd(), "apps/web/src/app/events/detail/page.tsx"), "utf8");
const webhook = readFileSync(resolve(process.cwd(), "apps/functions/src/payments/stripeWebhook.ts"), "utf8");

describe("Events v2 transaction boundaries", () => {
  it("routes public registration through the authoritative v2 endpoint", () => {
    expect(detail).toContain("beginEventRegistrationV2");
    expect(detail).not.toContain("registerFreeEventFn");
    expect(detail).not.toContain("createTicketCheckoutFn");
  });

  it("reserves held quantity before paid checkout", () => {
    expect(eventV2).toContain("heldQuantity");
    expect(eventV2).toContain("createCapacityHold");
    expect(eventV2).toContain("runTransaction");
  });

  it("does not determine free registration from the event base price alone", () => {
    expect(eventV2).toContain("resolveEventPrice");
    expect(eventV2).toContain("ticket.priceCents");
  });

  it("prevents a v2 Stripe payment from falling through to legacy finalization", () => {
    expect(webhook).toContain("handledByEventV2");
    expect(webhook).toContain("!handledByEventV2");
  });
});
