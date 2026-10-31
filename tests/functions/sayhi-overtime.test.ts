import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NO_CHECKOUT_CAP_MINUTES,
  overtimeForVisit,
  shouldChargeOvertime,
} from "../../apps/functions/src/sayhi/overtime";
import { SAYHI_FLOW_ENABLED_PARAM, sayhiFlowEnabled } from "../../apps/functions/src/sayhi/config";

const MIN = 60_000;
const end = Date.UTC(2026, 10, 2, 17, 0);
const visit = (overMinutes: number, extra: Record<string, unknown> = {}) => ({
  status: "closed",
  allowanceSource: "booking",
  bookedWindow: { start: end - 120 * MIN, end },
  checkOutAt: end + overMinutes * MIN,
  rateCents: 1750,
  chargeStatus: "not_charged",
  ...extra,
});

describe("SayHi overtime policy", () => {
  it("is off unless SAYHI_FLOW_ENABLED is exactly true", () => {
    expect(sayhiFlowEnabled({})).toBe(false);
    expect(sayhiFlowEnabled({ [SAYHI_FLOW_ENABLED_PARAM]: "false" })).toBe(false);
    expect(sayhiFlowEnabled({ [SAYHI_FLOW_ENABLED_PARAM]: "yes" })).toBe(false);
    expect(sayhiFlowEnabled({ [SAYHI_FLOW_ENABLED_PARAM]: "true" })).toBe(true);
  });

  it("does not charge up to 15 minutes past the booked end, or for leaving early", () => {
    expect(overtimeForVisit(visit(-30)).cents).toBe(0);
    expect(overtimeForVisit(visit(0)).cents).toBe(0);
    expect(overtimeForVisit(visit(15)).cents).toBe(0);
  });

  it("charges the time past the end in 15-minute steps at the visit rate", () => {
    expect(overtimeForVisit(visit(16))).toEqual({ minutes: 30, cents: 875 });
    expect(overtimeForVisit(visit(45))).toEqual({ minutes: 45, cents: 1313 });
    expect(overtimeForVisit(visit(61, { rateCents: 1200 }))).toEqual({ minutes: 75, cents: 1500 });
  });

  it("caps a no-check-out visit at one hour past the booking", () => {
    expect(overtimeForVisit(visit(180, { billingCapApplied: true })).minutes).toBe(NO_CHECKOUT_CAP_MINUTES);
  });

  it("leaves walk-ins on monthly hours as record-only", () => {
    expect(overtimeForVisit(visit(90, { allowanceSource: "monthly", bookedWindow: null })).cents).toBe(0);
  });

  it("charges once, only when a visit is checked out or staff-closed", () => {
    const open = { ...visit(60), status: "open" };
    expect(shouldChargeOvertime(open, visit(60))).toBe(true);
    expect(shouldChargeOvertime(open, visit(60, { status: "staff_closed" }))).toBe(true);
    expect(shouldChargeOvertime(open, visit(60, { status: "auto_closed" }))).toBe(false);
    expect(shouldChargeOvertime({ ...visit(60), status: "auto_closed" }, visit(60, { status: "staff_closed" }))).toBe(true);
    expect(shouldChargeOvertime(visit(60), visit(60))).toBe(false);
    expect(shouldChargeOvertime(open, visit(60, { chargeStatus: "charged" }))).toBe(false);
    expect(shouldChargeOvertime(open, visit(10))).toBe(false);
  });

  it("is wired into the booking-transactions source only, behind the flag", () => {
    const index = readFileSync("firebase/booking-transaction-functions/src/index.ts", "utf8");
    expect(index).toContain("sayhi_chargeOvertime");
    expect(index).toContain("sayhi_onMembershipEnded");
    const triggers = readFileSync("apps/functions/src/sayhi/billingTriggers.ts", "utf8");
    expect(triggers.match(/if \(!sayhiFlowEnabled\(\)\)/g)?.length).toBe(2);
    expect(triggers).toContain("idempotencyKey: `sayhi-overtime-${input.visitId}`");
    for (const env of ["apps/functions/.env.hi-coworking-plat", "apps/functions/.env.demo-hi-coworking"]) {
      expect(readFileSync(env, "utf8")).toMatch(/^SAYHI_FLOW_ENABLED=false$/m);
    }
    const coreIndex = readFileSync("apps/functions/src/index.ts", "utf8");
    expect(coreIndex).not.toContain("sayhi_chargeOvertime");
    expect(coreIndex).not.toContain("billingTriggers");
  });

  it("only asks Checkout to keep the card when the flag is on", () => {
    const flex = readFileSync("apps/functions/src/bookingFlexTransaction.ts", "utf8");
    expect(flex).toContain("saveCardForLaterCharges: sayhiFlowEnabled()");
    const provider = readFileSync("apps/functions/src/payments/stripeProvider.ts", "utf8");
    expect(provider).toContain('input.saveCardForLaterCharges ? { setup_future_usage: "off_session" as const } : {}');
    expect(provider).not.toMatch(/price_[A-Za-z0-9]{8,}/);
  });
});
