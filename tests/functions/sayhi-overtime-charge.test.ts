/**
 * End-to-end check of the SayHi extra-time charge against the Firestore
 * emulator, with Stripe replaced by a fake that answers the way Stripe test
 * cards do (pm_card_visa succeeds; chargeDeclined and authenticationRequired
 * fail an off-session charge). Covers: card saved at the booking checkout,
 * overtime detected on check-out, off-session charge, decline, 3DS, no card,
 * plan hours first, one charge only, and the flag being off.
 * Emulator-only. Every record here is fake test data.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "demo-hi-coworking";
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8081";

const stripeCalls = vi.hoisted(() => ({
  paymentIntentsCreate: [] as Array<{ params: Record<string, any>; options?: Record<string, any> }>,
  checkoutCreate: [] as Array<{ params: Record<string, any> }>,
}));

vi.mock("stripe", () => {
  // The booking checkout's PaymentIntent: which saved test card it used.
  const BOOKING_INTENTS: Record<string, { customer: string | null; payment_method: string | null }> = {
    pi_booking_visa: { customer: "cus_guest", payment_method: "pm_card_visa" },
    pi_booking_declined: { customer: "cus_guest", payment_method: "pm_card_chargeDeclined" },
    pi_booking_3ds: { customer: "cus_guest", payment_method: "pm_card_authenticationRequired" },
    pi_booking_processing: { customer: "cus_guest", payment_method: "pm_processing" },
    // Paid before the flag was on: Checkout made no Customer, card not saved.
    pi_booking_not_saved: { customer: null, payment_method: "pm_card_visa" },
  };
  function cardError(code: string, message: string, intentId: string, declineCode?: string) {
    return Object.assign(new Error(message), {
      type: "StripeCardError",
      code,
      ...(declineCode ? { decline_code: declineCode } : {}),
      raw: { payment_intent: { id: intentId, status: "requires_payment_method" } },
    });
  }
  class FakeStripe {
    paymentIntents = {
      retrieve: async (id: string) => ({ id, ...(BOOKING_INTENTS[id] || { customer: null, payment_method: null }) }),
      create: async (params: Record<string, any>, options?: Record<string, any>) => {
        stripeCalls.paymentIntentsCreate.push({ params, options });
        switch (params.payment_method) {
          case "pm_card_chargeDeclined":
            throw cardError("card_declined", "Your card was declined.", "pi_ot_declined", "generic_decline");
          case "pm_card_authenticationRequired":
            throw cardError("authentication_required", "This payment requires authentication.", "pi_ot_3ds");
          case "pm_processing":
            return { id: "pi_ot_processing", status: "processing" };
          default:
            return { id: `pi_ot_${stripeCalls.paymentIntentsCreate.length}`, status: "succeeded" };
        }
      },
    };
    subscriptions = {
      retrieve: async (id: string) => ({ id, customer: "cus_member", metadata: { uid: "" }, default_payment_method: "pm_card_visa" }),
    };
    customers = {
      retrieve: async (id: string) => ({ id, invoice_settings: { default_payment_method: null } }),
    };
    checkout = {
      sessions: {
        create: async (params: Record<string, any>) => {
          stripeCalls.checkoutCreate.push({ params });
          return { id: "cs_test_fake", url: "https://checkout.stripe.com/c/pay/cs_test_fake" };
        },
      },
    };
  }
  return { default: FakeStripe };
});

import * as admin from "firebase-admin";
import { chargeOvertimeForVisit } from "../../apps/functions/src/sayhi/billingTriggers";
import { StripeProvider } from "../../apps/functions/src/payments/stripeProvider";
import { localMonthKey } from "../../apps/functions/src/bookingFlexShared";

const MIN = 60_000;
const db = () => admin.firestore();
const bookedEnd = Date.UTC(2026, 10, 30, 17, 0); // Mon Nov 30, 12:00 PM ET

// Unique ids per run instead of clearing the emulator, which other suites'
// triggers may be using at the same time.
const RUN = `ot${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const id = (name: string) => `${RUN}-${name}`;

async function seedGuestVisit(name: string, bookingIntent: string, overMinutes: number, extra: Record<string, unknown> = {}) {
  const visitId = id(name);
  const uid = `guest-${visitId}`;
  await db().collection("users").doc(uid).set({ uid, role: "member", membershipStatus: "none" });
  await db().collection("payments").doc(`pay-${visitId}`).set({ status: "paid", providerRefs: { stripePaymentIntentId: bookingIntent } });
  await db().collection("bookings").doc(`bk-${visitId}`).set({ userId: uid, paymentId: `pay-${visitId}`, status: "CONFIRMED" });
  const open = {
    uid,
    status: "open",
    allowanceSource: "booking",
    bookingIds: [`bk-${visitId}`],
    bookedWindow: { start: bookedEnd - 120 * MIN, end: bookedEnd },
    checkInAt: bookedEnd - 125 * MIN,
    rateCents: 1750, // guest hourly rate
    chargeStatus: "not_charged",
    ...extra,
  };
  await db().collection("kioskVisits").doc(visitId).set(open);
  return { visitId, open, closed: { ...open, status: "closed", checkOutAt: bookedEnd + overMinutes * MIN } };
}

/** Close the visit the way kiosk check-out does, then run the trigger. */
async function checkOutAndTrigger(visitId: string, open: Record<string, unknown>, closed: Record<string, unknown>) {
  await db().collection("kioskVisits").doc(visitId).set(closed);
  await chargeOvertimeForVisit({
    visitId,
    before: open as never,
    after: closed as never,
    stripeSecretKey: () => "sk_test_fake",
    stripeWebhookSecret: () => "whsec_fake",
  });
  return (await db().collection("kioskVisits").doc(visitId).get()).data() || {};
}

describe("SayHi extra-time charge, end to end on the emulator", () => {
  beforeAll(() => {
    if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
  });
  afterAll(async () => {
    delete process.env.SAYHI_FLOW_ENABLED;
  });
  beforeEach(async () => {
    process.env.SAYHI_FLOW_ENABLED = "true";
    stripeCalls.paymentIntentsCreate.length = 0;
    stripeCalls.checkoutCreate.length = 0;
  });

  it("booking checkout saves the card for off-session use only when the flag is on", async () => {
    const provider = new StripeProvider("sk_test_fake", "whsec_fake");
    const base = {
      uid: "guest-1", amount: 3500, currency: "usd", purpose: "booking", purposeRefId: "hold-1",
      successUrl: "https://hi-coworking.com/ok", cancelUrl: "https://hi-coworking.com/no", mode: "payment",
      collectBillingAddress: true, metadata: { paymentId: "pay-1" },
    } as const;
    await provider.createCheckoutSession({ ...base, saveCardForLaterCharges: true } as never);
    await provider.createCheckoutSession({ ...base, saveCardForLaterCharges: false } as never);
    const [on, off] = stripeCalls.checkoutCreate.map((c) => c.params);
    expect(on.payment_intent_data.setup_future_usage).toBe("off_session");
    expect(on.customer_creation).toBe("always");
    expect(on.payment_method_types).toEqual(["card"]);
    expect(on.billing_address_collection).toBe("required");
    expect(off.payment_intent_data.setup_future_usage).toBeUndefined();
    expect(off.customer_creation).toBeUndefined();
    expect(off.payment_method_types).toBeUndefined();
  });

  it("guest: 16 minutes over is charged as 30 minutes at the guest rate, off-session, to the booking card", async () => {
    const { visitId, open, closed } = await seedGuestVisit("v-ok", "pi_booking_visa", 16);
    const visit = await checkOutAndTrigger(visitId, open, closed);
    expect(stripeCalls.paymentIntentsCreate).toHaveLength(1);
    const { params, options } = stripeCalls.paymentIntentsCreate[0];
    expect(params).toMatchObject({
      amount: 875, currency: "usd", customer: "cus_guest", payment_method: "pm_card_visa",
      off_session: true, confirm: true,
      description: "Hi Coworking extra time: 30 minutes past your booking",
      metadata: { visitId, purpose: "overtime" },
    });
    expect(options).toEqual({ idempotencyKey: `sayhi-overtime-${visitId}` });
    expect(visit).toMatchObject({
      chargeStatus: "charged", overtimeBilling: "guest", overtimeMinutes: 30, overtimeChargedMinutes: 30, overtimeCents: 875,
      overtimeCharge: { method: "payment_intent", status: "succeeded" },
    });
    expect(visit.needsReview).toBeUndefined();
  });

  it("within the 15-minute grace there is no charge", async () => {
    const { visitId, open, closed } = await seedGuestVisit("v-grace", "pi_booking_visa", 15);
    const visit = await checkOutAndTrigger(visitId, open, closed);
    expect(stripeCalls.paymentIntentsCreate).toHaveLength(0);
    expect(visit.chargeStatus).toBe("not_charged");
  });

  it("a repeated trigger never charges twice", async () => {
    const { visitId, open, closed } = await seedGuestVisit("v-dup", "pi_booking_visa", 40);
    await checkOutAndTrigger(visitId, open, closed);
    await chargeOvertimeForVisit({
      visitId, before: open as never, after: closed as never,
      stripeSecretKey: () => "sk_test_fake", stripeWebhookSecret: () => "whsec_fake",
    });
    expect(stripeCalls.paymentIntentsCreate).toHaveLength(1);
    expect(stripeCalls.paymentIntentsCreate[0].params.amount).toBe(1313); // 45 min at $17.50/h
  });

  it("declined card: flagged for staff review with the decline code", async () => {
    const { visitId, open, closed } = await seedGuestVisit("v-decl", "pi_booking_declined", 30);
    const visit = await checkOutAndTrigger(visitId, open, closed);
    expect(stripeCalls.paymentIntentsCreate).toHaveLength(1);
    expect(visit).toMatchObject({
      chargeStatus: "charge_failed", needsReview: true, reviewReason: "overtime_charge_failed",
      overtimeChargeError: "card_declined", overtimeDeclineCode: "generic_decline", overtimeFailedPaymentIntentId: "pi_ot_declined",
    });
  });

  it("card that needs 3D Secure off-session: flagged as authentication required", async () => {
    const { visitId, open, closed } = await seedGuestVisit("v-3ds", "pi_booking_3ds", 30);
    const visit = await checkOutAndTrigger(visitId, open, closed);
    expect(visit).toMatchObject({
      chargeStatus: "charge_failed", needsReview: true, reviewReason: "overtime_authentication_required",
      overtimeChargeError: "authentication_required", overtimeFailedPaymentIntentId: "pi_ot_3ds",
    });
  });

  it("a charge that has not settled is not recorded as charged", async () => {
    const { visitId, open, closed } = await seedGuestVisit("v-proc", "pi_booking_processing", 30);
    const visit = await checkOutAndTrigger(visitId, open, closed);
    expect(visit).toMatchObject({ chargeStatus: "charge_pending", needsReview: true, reviewReason: "overtime_charge_pending" });
  });

  it("booking paid without a saved card: no Stripe call, flagged no card", async () => {
    const { visitId, open, closed } = await seedGuestVisit("v-nocard", "pi_booking_not_saved", 30);
    const visit = await checkOutAndTrigger(visitId, open, closed);
    expect(stripeCalls.paymentIntentsCreate).toHaveLength(0);
    expect(visit).toMatchObject({ chargeStatus: "no_card_on_file", needsReview: true, reviewReason: "overtime_no_card" });
  });

  it("no check-out: capped at one hour and only charged once staff close it", async () => {
    const { visitId, open } = await seedGuestVisit("v-cap", "pi_booking_visa", 0);
    const autoClosed = { ...open, status: "auto_closed", checkOutAt: bookedEnd + 60 * MIN, billingCapApplied: true, needsReview: true };
    let visit = await checkOutAndTrigger(visitId, open, autoClosed);
    expect(stripeCalls.paymentIntentsCreate).toHaveLength(0);
    const staffClosed = { ...autoClosed, status: "staff_closed", checkOutAt: bookedEnd + 180 * MIN, needsReview: false };
    visit = await checkOutAndTrigger(visitId, autoClosed, staffClosed);
    expect(stripeCalls.paymentIntentsCreate).toHaveLength(1);
    expect(stripeCalls.paymentIntentsCreate[0].params.amount).toBe(1750);
    expect(visit).toMatchObject({ chargeStatus: "charged", overtimeMinutes: 60 });
  });

  it("member: plan hours first, the rest charged right away to the membership card", async () => {
    const uid = id("member");
    const visitId = id("v-mem");
    const monthKey = localMonthKey(bookedEnd);
    await db().collection("users").doc(uid).set({
      uid, role: "member", membershipStatus: "active", plan: "coworking",
      stripeSubscriptionId: "sub_test_member", stripeCustomerId: "cus_member",
    });
    // 36 h plan, 35.75 h used: 15 included minutes left.
    await db().collection("membershipUsage").doc(`${uid}_${monthKey}`).set({ uid, monthKey, usedHours: 35.75, reservations: {} });
    const open = {
      uid, status: "open", allowanceSource: "booking", bookingIds: [],
      bookedWindow: { start: bookedEnd - 120 * MIN, end: bookedEnd }, checkInAt: bookedEnd - 120 * MIN,
      rateCents: 1400, chargeStatus: "not_charged",
    };
    await db().collection("kioskVisits").doc(visitId).set(open);
    const visit = await checkOutAndTrigger(visitId, open, { ...open, status: "closed", checkOutAt: bookedEnd + 40 * MIN });
    expect(stripeCalls.paymentIntentsCreate).toHaveLength(1);
    expect(stripeCalls.paymentIntentsCreate[0].params).toMatchObject({
      amount: 700, customer: "cus_member", payment_method: "pm_card_visa", off_session: true, confirm: true,
      description: "Hi Coworking extra time: 45 minutes past your booking (15 from included hours)",
    });
    expect(visit).toMatchObject({
      chargeStatus: "charged", overtimeBilling: "plan", overtimeMinutes: 45, overtimeIncludedMinutes: 15,
      overtimeChargedMinutes: 30, overtimeCents: 700, overtimeCharge: { method: "member_default_payment_method" },
    });
    const usage = (await db().collection("membershipUsage").doc(`${uid}_${monthKey}`).get()).data();
    expect(usage?.usedHours).toBe(36);
  });

  it("flag off: nothing is charged or written", async () => {
    process.env.SAYHI_FLOW_ENABLED = "false";
    const { visitId, open, closed } = await seedGuestVisit("v-off", "pi_booking_visa", 60);
    const visit = await checkOutAndTrigger(visitId, open, closed);
    expect(stripeCalls.paymentIntentsCreate).toHaveLength(0);
    expect(visit.chargeStatus).toBe("not_charged");
  });
});
