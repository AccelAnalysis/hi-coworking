import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { billingAddressFromStripe } from "../../apps/functions/src/sayhi/billingAddress";

describe("SayHi billing-address readback", () => {
  it("normalizes the Stripe Checkout address", () => {
    expect(billingAddressFromStripe({
      line1: "  100  Example Way ", line2: null, city: "Sampletown", state: "VA", postal_code: "00000", country: "us",
    })).toEqual({ line1: "100 Example Way", line2: "", city: "Sampletown", state: "VA", postalCode: "00000", country: "US" });
  });

  it("ignores an empty address", () => {
    expect(billingAddressFromStripe(null)).toBeNull();
    expect(billingAddressFromStripe({ city: "Sampletown" })).toBeNull();
  });

  it("is written by the webhook only when the flag is on, to the server-only doc", () => {
    const webhook = readFileSync("apps/functions/src/payments/stripeWebhook.ts", "utf8");
    expect(webhook).toContain("if (uid && result.billingAddress && sayhiFlowEnabled())");
    expect(webhook).toContain("BILLING_ACCOUNT_DETAILS_COLLECTION");
    const rules = readFileSync("firestore.rules", "utf8");
    expect(rules).toMatch(/match \/accountDetails\/\{uid\} \{\s*allow read: if isOwner\(uid\) \|\| isStaff\(\);\s*allow write: if false;/);
  });
});
