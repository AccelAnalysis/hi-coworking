import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isFlagOn,
  membershipCheckoutExtras,
  virtualAddressEnabled,
  virtualAddressPriceId,
} from "../../apps/functions/src/sayhi/config";
import { normalizeAccountDetails } from "../../apps/functions/src/sayhi/functions";

const read = (path: string) => readFileSync(path, "utf8");

describe("virtual address switch (built, OFF)", () => {
  it("is off unless exactly true", () => {
    expect(virtualAddressEnabled({})).toBe(false);
    for (const value of ["", "false", "1", "yes", "on"]) expect(virtualAddressEnabled({ VIRTUAL_ADDRESS_ENABLED: value })).toBe(false);
    expect(virtualAddressEnabled({ VIRTUAL_ADDRESS_ENABLED: "true" })).toBe(true);
    expect(isFlagOn(" TRUE ")).toBe(true);
  });
  it("adds nothing to Stripe Checkout while off", () => {
    const priceId = "price_TESTONLY123";
    expect(membershipCheckoutExtras({ enabled: false, priceId, chosen: true })).toEqual({ lineItems: [], optionalItems: [] });
    expect(membershipCheckoutExtras({ enabled: true, priceId: "", chosen: true })).toEqual({ lineItems: [], optionalItems: [] });
    expect(membershipCheckoutExtras({ enabled: true, priceId, chosen: true }).lineItems).toHaveLength(1);
    expect(membershipCheckoutExtras({ enabled: true, priceId, chosen: false }).optionalItems).toHaveLength(1);
  });
  it("only accepts a Stripe price id", () => {
    expect(virtualAddressPriceId({ VIRTUAL_ADDRESS_STRIPE_PRICE_ID: "not-a-price" })).toBe("");
    expect(virtualAddressPriceId({ VIRTUAL_ADDRESS_STRIPE_PRICE_ID: "price_ABC123def" })).toBe("price_ABC123def");
  });
  it("is set to false in the committed functions env files", () => {
    for (const file of ["apps/functions/.env.hi-coworking-plat", "apps/functions/.env.demo-hi-coworking"]) {
      expect(read(file)).toMatch(/^VIRTUAL_ADDRESS_ENABLED=false$/m);
      expect(read(file)).toMatch(/^VIRTUAL_ADDRESS_STRIPE_PRICE_ID=$/m);
    }
  });
  it("checks the switch before va_submitForm1583 writes anything or queues Jessica", () => {
    const source = read("apps/functions/src/sayhi/functions.ts");
    const body = source.slice(source.indexOf("export const va_submitForm1583"));
    const gate = body.indexOf("if (!virtualAddressEnabled())");
    expect(gate).toBeGreaterThan(0);
    expect(body.indexOf(".set(")).toBeGreaterThan(gate);
    expect(body.indexOf("queueFollowUp(")).toBeGreaterThan(gate);
  });
  it("membership checkout only passes extras when the switch is on", () => {
    const index = read("apps/functions/src/index.ts");
    expect(index).toMatch(/membershipCheckoutExtras\(\{\s*enabled: virtualAddressEnabled\(\)/);
  });
});

describe("Create your account details", () => {
  it("requires a 10-digit US phone and trims company", () => {
    expect(normalizeAccountDetails({ company: "  Acme   Co ", phone: "(555) 010-0199" })).toEqual({ company: "Acme Co", phone: "+15550100199" });
    expect(normalizeAccountDetails({ phone: "1-555-010-0199" }).phone).toBe("+15550100199");
    expect(() => normalizeAccountDetails({ phone: "12345" })).toThrow();
    expect(() => normalizeAccountDetails({ phone: "5550100199", company: "x".repeat(121) })).toThrow();
  });
});
