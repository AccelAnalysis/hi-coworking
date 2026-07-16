import { describe, expect, it } from "vitest";

import { businessReferralCompensationSchema } from "../../apps/functions/src/exchange/contracts";

describe("Run 3 direct referral compensation contract", () => {
  it("keeps no compensation first-class and rejects hidden monetary fields", () => {
    expect(businessReferralCompensationSchema.parse({ type: "none" })).toEqual({ type: "none" });
    expect(businessReferralCompensationSchema.safeParse({
      type: "none",
      currency: "USD",
    }).success).toBe(false);
  });

  it("requires an explicit percentage basis and currency context", () => {
    expect(businessReferralCompensationSchema.safeParse({
      type: "percentage",
      percentageBasisPoints: 1_000,
    }).success).toBe(false);

    expect(businessReferralCompensationSchema.parse({
      type: "percentage",
      percentageBasisPoints: 1_000,
      percentageBasis: "first_collected_invoice",
      currency: "usd",
    })).toEqual({
      type: "percentage",
      percentageBasisPoints: 1_000,
      percentageBasis: "first_collected_invoice",
      currency: "USD",
    });
  });

  it("represents benefits as descriptive, non-cash compensation", () => {
    expect(businessReferralCompensationSchema.safeParse({
      type: "benefit",
      currency: "USD",
    }).success).toBe(false);
    expect(businessReferralCompensationSchema.parse({
      type: "benefit",
      currency: "USD",
      benefitDescription: "One month of workspace access",
    })).toMatchObject({
      type: "benefit",
      benefitDescription: "One month of workspace access",
    });
  });
});
