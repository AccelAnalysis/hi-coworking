import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPaymentDoc } from "../../apps/functions/src/payments/ledger";

function undefinedPaths(value: unknown, path = "doc"): string[] {
  if (value === undefined) return [path];
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => undefinedPaths(child, `${path}.${key}`));
  }
  return [];
}

describe("payment doc for Firestore without ignoreUndefinedProperties", () => {
  it("omits orgId for a member with no org (the $49 checkout case)", () => {
    const doc = buildPaymentDoc("pay_1", {
      uid: "member-without-org",
      provider: "stripe",
      amount: 4900,
      currency: "usd",
      purpose: "membership",
      purposeRefId: "virtual",
      status: "pending",
    }, 1_700_000_000_000);

    expect(undefinedPaths(doc)).toEqual([]);
    expect(doc).not.toHaveProperty("orgId");
    expect(doc).not.toHaveProperty("providerRefs");
    expect(doc).toMatchObject({
      id: "pay_1",
      uid: "member-without-org",
      amount: 4900,
      purpose: "membership",
      purposeRefId: "virtual",
      status: "pending",
    });
  });

  it("omits every unset optional field and undefined providerRefs entries", () => {
    const doc = buildPaymentDoc("pay_2", {
      uid: "u",
      orgId: undefined,
      provider: "stripe",
      amount: 100,
      purpose: "membership",
      purposeRefId: undefined,
      providerRefs: { stripeCustomerId: "cus_1", stripeSessionId: undefined as unknown as string },
    }, 1);

    expect(undefinedPaths(doc)).toEqual([]);
    expect(doc).not.toHaveProperty("purposeRefId");
    expect(doc.providerRefs).toEqual({ stripeCustomerId: "cus_1" });
    expect(doc.currency).toBe("USD");
    expect(doc.status).toBe("pending");
  });

  it("keeps orgId when it is provided", () => {
    const doc = buildPaymentDoc("pay_3", {
      uid: "org-member",
      orgId: "org_1",
      provider: "stripe",
      amount: 12900,
      purpose: "membership",
    }, 1);
    expect(doc.orgId).toBe("org_1");
  });

  it("createPayment writes the sanitized doc", () => {
    const ledger = readFileSync("apps/functions/src/payments/ledger.ts", "utf8");
    expect(ledger).toContain("const doc = buildPaymentDoc(ref.id, input, now);");
    expect(ledger).not.toContain("orgId: input.orgId,");
  });
});

describe("stripe_webhook legacy ticket registration", () => {
  it("does not write undefined optional fields", () => {
    const webhook = readFileSync("apps/functions/src/payments/stripeWebhook.ts", "utf8");
    expect(webhook).not.toContain("|| undefined");
  });
});
