import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REFUND_NOTICE_DAYS, refundNoticeCopy } from "../../apps/web/src/lib/refundCopy";

const REFUNDED_AT = Date.UTC(2026, 9, 24, 22, 1);
const DAY = 24 * 60 * 60 * 1000;

describe("SayHi refund notice copy", () => {
  it("shows an issued refund with its date and timing", () => {
    expect(refundNoticeCopy({ amountCents: 4900, currency: "usd", refundedAt: REFUNDED_AT, full: true, status: "issued" }, REFUNDED_AT + DAY))
      .toEqual({
        title: "Refund issued",
        body: "We issued a refund of $49.00 on October 24, 2026. It usually takes 5–10 business days to appear on your statement.",
        tone: "info",
      });
  });

  it("says when a refund is partial", () => {
    expect(refundNoticeCopy({ amountCents: 2000, refundedAt: REFUNDED_AT, full: false }, REFUNDED_AT)?.body)
      .toContain("a partial refund of $20.00");
  });

  it("explains a failed refund without relying on color", () => {
    const copy = refundNoticeCopy({ amountCents: 4900, refundedAt: REFUNDED_AT, status: "failed" }, REFUNDED_AT)!;
    expect(copy.title).toBe("Refund didn't go through");
    expect(copy.tone).toBe("warning");
  });

  it("hides missing, malformed, old or not-yet-timed refunds", () => {
    expect(refundNoticeCopy(undefined, REFUNDED_AT)).toBeNull();
    expect(refundNoticeCopy({ amountCents: "x", refundedAt: REFUNDED_AT }, REFUNDED_AT)).toBeNull();
    expect(refundNoticeCopy({ amountCents: 4900, refundedAt: REFUNDED_AT }, REFUNDED_AT + (REFUND_NOTICE_DAYS + 1) * DAY)).toBeNull();
    expect(refundNoticeCopy({ amountCents: 4900, refundedAt: REFUNDED_AT }, 0)).toBeNull();
  });

  it("renders as a polite status region inside the Membership card", () => {
    const component = readFileSync("apps/web/src/components/MembershipRefundNotice.tsx", "utf8");
    const page = readFileSync("apps/web/src/app/account/bookings/page.tsx", "utf8");
    expect(component).toContain('role="status"');
    expect(component).toContain('aria-hidden="true"');
    expect(page).toContain("<MembershipRefundNotice");
  });
});
