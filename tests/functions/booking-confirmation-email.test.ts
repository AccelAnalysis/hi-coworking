import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logs = vi.hoisted(() => ({ info: [] as unknown[][], error: [] as unknown[][], warn: [] as unknown[][] }));
vi.mock("firebase-functions/logger", () => ({
  info: (...args: unknown[]) => { logs.info.push(args); },
  warn: (...args: unknown[]) => { logs.warn.push(args); },
  error: (...args: unknown[]) => { logs.error.push(args); },
}));

import {
  BOOKING_CONFIRMATION_CATEGORY,
  DISABLE_ENV_VAR,
  MAX_SEND_ATTEMPTS,
  evaluateClaim,
  formatTimeWindow,
  paymentLines,
  postAttendanceFollowUpCandidate,
  renderBookingConfirmationEmail,
  sendBookingConfirmationEmail,
  type BookingConfirmationInput,
  type BookingConfirmationStore,
  type ClaimResult,
  type ConfirmableBooking,
} from "../../apps/functions/src/bookingConfirmationEmail";
import { STALE_CLAIM_MS } from "../../apps/functions/src/payments/membershipWelcomeEmail";
import { EMAIL_LOGO_URL, EMAIL_NAVY } from "../../apps/functions/src/payments/emailBrand";
import { EmailSendError, type EmailMessage, type EmailProvider } from "../../apps/functions/src/providers/emailProvider";

const ORIGIN = "https://hi-coworking.com";
// Tue Dec 1, 2026, 9:00 AM to 1:00 PM Eastern (EST, UTC-5).
const START = Date.UTC(2026, 11, 1, 14, 0);
const END = Date.UTC(2026, 11, 1, 18, 0);

function input(overrides: Partial<BookingConfirmationInput> = {}): BookingConfirmationInput {
  return {
    firstName: "Alex",
    resourceName: "Desk 3",
    start: START,
    end: END,
    totalCents: 4000,
    subtotalCents: 4000,
    origin: ORIGIN,
    ...overrides,
  };
}

function bookingDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "booking_1",
    status: "CONFIRMED",
    userId: "user-1",
    userName: "Alex Rivera",
    guestEmail: "alex@example.com",
    resourceName: "Desk 3",
    start: START,
    end: END,
    totalCents: 4000,
    subtotalCents: 4000,
    accountCreditAppliedCents: 0,
    includedHoursApplied: 0,
    paymentId: "pay_internal_123",
    ...overrides,
  };
}

/** In-memory twin of firestoreBookingConfirmationStore, using the same claim rules. */
function memoryStore(
  docs: Record<string, Record<string, unknown>> = { booking_1: bookingDoc() },
  user: { email?: string; displayName?: string } | null = { email: "alex@example.com", displayName: "Alex Rivera" },
) {
  const map = new Map(Object.entries(docs));
  const calls = { markFailed: [] as string[] };
  const store: BookingConfirmationStore = {
    async claim(bookingId, now) {
      const data = map.get(bookingId) ?? null;
      const verdict = evaluateClaim(data, now);
      if (!verdict.claimed || !data) return verdict as ClaimResult;
      const marker = (data.confirmationEmail || {}) as Record<string, unknown>;
      map.set(bookingId, {
        ...data,
        confirmationEmail: { ...marker, status: "sending", claimedAt: now, attempts: Number(marker.attempts || 0) + 1 },
      });
      return { claimed: true, booking: { ...(data as ConfirmableBooking), id: bookingId } };
    },
    async markSent(bookingId, messageId, now) {
      const data = map.get(bookingId) || {};
      map.set(bookingId, {
        ...data,
        confirmationEmailSentAt: now,
        confirmationEmail: { ...(data.confirmationEmail as object), status: "sent", sentAt: now, messageId },
      });
    },
    async markFailed(bookingId, code, now) {
      calls.markFailed.push(code);
      const data = map.get(bookingId) || {};
      map.set(bookingId, {
        ...data,
        confirmationEmail: { ...(data.confirmationEmail as object), status: "failed", failedAt: now, errorCode: code },
      });
    },
    async loadUser() {
      return user;
    },
  };
  return { store, map, calls };
}

function fakeProvider(fail?: Error) {
  const sent: EmailMessage[] = [];
  const provider: EmailProvider = {
    async send(message) {
      sent.push(message);
      if (fail) throw fail;
      return { messageId: `msg_${sent.length}` };
    },
    async sendBatch() {
      return { sent: 0, failed: 0 };
    },
  };
  return { provider, sent };
}

beforeEach(() => {
  logs.info.length = 0;
  logs.warn.length = 0;
  logs.error.length = 0;
});

describe("renderBookingConfirmationEmail", () => {
  const copy = renderBookingConfirmationEmail(input());

  it("shows the renter's name, date, ET time window, space, address and amount", () => {
    expect(copy.subject).toBe("You're booked: Desk 3 on Tuesday, December 1, 2026");
    for (const body of [copy.html, copy.text]) {
      expect(body).toContain("Hi Alex,");
      expect(body).toContain("Tuesday, December 1, 2026");
      expect(body).toContain("9:00 AM – 1:00 PM ET");
      expect(body).toContain("4 hours");
      expect(body).toContain("Desk 3");
      expect(body).toContain("15373 Carrollton Blvd, Carrollton, VA 23314");
      expect(body).toContain("Paid by card");
      expect(body).toContain("$40.00");
      expect(body).toContain("hicoworking@accelanalysis.com");
      expect(body).toContain(`${ORIGIN}/my-hi`);
    }
  });

  it("uses the Hi Coworking brand: Hi Navy, Fraunces SemiBold headline, DM Sans body, PNG logo", () => {
    expect(EMAIL_NAVY).toBe("#101D4B");
    expect(copy.html).toContain(EMAIL_NAVY);
    expect(copy.html).toMatch(/<h1[^>]*font-family:Fraunces[^>]*font-weight:600/);
    expect(copy.html).toContain("font-family:'DM Sans'");
    expect(copy.html).toContain(`<img src="${EMAIL_LOGO_URL}"`);
    expect(EMAIL_LOGO_URL).toMatch(/\.png$/);
    expect(copy.html).not.toMatch(/<svg|\.svg/i);
    expect(copy.html).toContain("Booking confirmed");
  });

  it("uses no cream or warm off-white backgrounds", () => {
    const backgrounds = [...copy.html.matchAll(/background:(#[0-9a-fA-F]{3,6})/g)].map((m) => m[1].toLowerCase());
    expect(backgrounds.length).toBeGreaterThan(0);
    const allowed = new Set(["#f1f5f9", "#ffffff", "#f8fafc", EMAIL_NAVY.toLowerCase()]);
    for (const color of backgrounds) expect(allowed.has(color)).toBe(true);
    expect(copy.html).not.toMatch(/cream|#fff8|#fdf|#faf[0-9a-f]{3}|#fef|ivory|beige/i);
  });

  it("spells SayHi as one word and names Hi Coworking and Accel Analysis", () => {
    for (const body of [copy.html, copy.text]) {
      expect(body).toContain("SayHi");
      expect(body).not.toMatch(/Say Hi|Say-Hi|sayhi\b/);
      expect(body).toContain("Hi Coworking");
      expect(body).toContain("Accel Analysis");
    }
  });

  it("contains no internal ids or behind-the-scenes wording", () => {
    for (const body of [copy.html, copy.text]) {
      expect(body).not.toMatch(/hold|finaliz|firestore|stripe|webhook|bookingId|paymentId|pay_|cs_|pi_|resend|seam|idempoten|transactional|metadata/i);
      expect(body).not.toMatch(/TODO|lorem|placeholder|\{\{|\}\}/i);
    }
  });

  it("is honest about door access: never promises a code by email", () => {
    expect(copy.text).toContain("Everything for your visit is on your SayHi page: your booking, arrival details, and any door access details.");
    expect(copy.text).not.toMatch(/we('| wi)ll email you (your|a) (door|access) code/i);
  });

  it("points the renter to the monitored inbox for help in the arrival section", () => {
    const arrival = copy.text.slice(copy.text.indexOf("WHEN YOU ARRIVE"), copy.text.indexOf("See you soon"));
    expect(arrival).toContain("Need a hand? Reply to this email or write to us at hicoworking@accelanalysis.com.");
    expect(copy.html).toContain('<a href="mailto:hicoworking@accelanalysis.com"');
  });

  it("never claims staff or team on-site hours, or promises someone at the front desk (Jonathan, Nov 23)", () => {
    for (const body of [copy.html, copy.text, copy.subject]) {
      expect(body).not.toMatch(/on site|on-site|onsite|staffed|front desk|our team is|team (is )?(here|available)|staff/i);
      expect(body).not.toMatch(/Monday to Friday|Mon(day)?\s?[-–]\s?Fri(day)?|weekdays?|\b\d{1,2}\s?(AM|PM) to \d{1,2}\s?(AM|PM)\b|business hours|opening hours|open (from|daily|weekdays)/i);
    }
    const source = readFileSync("apps/functions/src/bookingConfirmationEmail.ts", "utf8");
    expect(source).not.toContain("SPACE_HOURS");
  });

  it("escapes HTML in names and space labels", () => {
    const evil = renderBookingConfirmationEmail(input({ firstName: "<script>x</script>", resourceName: "Desk \"3\" & <b>" }));
    expect(evil.html).not.toContain("<script>");
    expect(evil.html).not.toContain("<b>");
    expect(evil.html).toContain("&lt;script&gt;");
    expect(evil.html).toContain("Desk &quot;3&quot; &amp; &lt;b&gt;");
  });

  it("strips line breaks from the subject", () => {
    const copy2 = renderBookingConfirmationEmail(input({ resourceName: "Desk 3\r\nBcc: x@example.com" }));
    expect(copy2.subject).not.toMatch(/[\r\n]/);
  });

  it("falls back to a neutral greeting with no name", () => {
    const copy2 = renderBookingConfirmationEmail(input({ firstName: "" }));
    expect(copy2.text.startsWith("Hi there,")).toBe(true);
  });

  it("lists both desks with their times for a desk-change booking", () => {
    const mid = Date.UTC(2026, 11, 1, 16, 0);
    const copy2 = renderBookingConfirmationEmail(input({
      resourceName: "Desk 1 → Desk 2",
      segments: [
        { resourceName: "Desk 1", start: START, end: mid },
        { resourceName: "Desk 2", start: mid, end: END },
      ],
    }));
    expect(copy2.subject).toContain("Desk 1 and Desk 2");
    expect(copy2.text).toContain("- Desk 1, 9:00 AM – 11:00 AM ET");
    expect(copy2.text).toContain("- Desk 2, 11:00 AM – 1:00 PM ET");
  });

  it("formats times in Eastern time across the DST change", () => {
    // Jul 1, 2026 9:00 AM EDT = 13:00 UTC.
    expect(formatTimeWindow(Date.UTC(2026, 6, 1, 13, 0), Date.UTC(2026, 6, 1, 14, 30))).toBe("9:00 AM – 10:30 AM ET");
  });

  it("summarises membership hours, credit and card payment without internal terms", () => {
    expect(paymentLines(input({ totalCents: 0, includedHoursApplied: 2 }))).toEqual([
      { label: "Membership hours used", value: "2 hours" },
      { label: "Amount due", value: "$0.00", strong: true },
    ]);
    expect(paymentLines(input({ totalCents: 2500, accountCreditAppliedCents: 1500 }))).toEqual([
      { label: "Account credit applied", value: "$15.00" },
      { label: "Paid by card", value: "$25.00", strong: true },
    ]);
  });
});

describe("sendBookingConfirmationEmail", () => {
  it("sends one transactional email with the booking idempotency key and records it on the booking", async () => {
    const { store, map } = memoryStore();
    const { provider, sent } = fakeProvider();
    const outcome = await sendBookingConfirmationEmail("booking_1", { provider, store, now: () => 1000, origin: ORIGIN });
    expect(outcome).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("alex@example.com");
    expect(sent[0].categories).toEqual([BOOKING_CONFIRMATION_CATEGORY, "transactional"]);
    expect(sent[0].idempotencyKey).toBe("booking-confirmation/booking_1");
    // Transactional: no marketing unsubscribe header.
    expect(sent[0].headers?.["List-Unsubscribe"]).toBeUndefined();
    const doc = map.get("booking_1")!;
    expect(doc.confirmationEmailSentAt).toBe(1000);
    expect(doc.confirmationEmail).toMatchObject({ status: "sent", messageId: "msg_1", attempts: 1 });
  });

  it("never sends twice when the callable or webhook retries", async () => {
    const { store } = memoryStore();
    const { provider, sent } = fakeProvider();
    expect(await sendBookingConfirmationEmail("booking_1", { provider, store, now: () => 1000 })).toBe("sent");
    expect(await sendBookingConfirmationEmail("booking_1", { provider, store, now: () => 2000 })).toBe("skipped_already_sent");
    expect(await sendBookingConfirmationEmail("booking_1", { provider, store, now: () => 3000 + STALE_CLAIM_MS * 10 })).toBe("skipped_already_sent");
    expect(sent).toHaveLength(1);
  });

  it("skips a concurrent call while another send is in progress", async () => {
    const { store, map } = memoryStore({
      booking_1: bookingDoc({ confirmationEmail: { status: "sending", claimedAt: 1000, attempts: 1 } }),
    });
    const { provider, sent } = fakeProvider();
    expect(await sendBookingConfirmationEmail("booking_1", { provider, store, now: () => 2000 })).toBe("skipped_in_progress");
    expect(sent).toHaveLength(0);
    // A claim abandoned for longer than STALE_CLAIM_MS is retried.
    expect(await sendBookingConfirmationEmail("booking_1", { provider, store, now: () => 1000 + STALE_CLAIM_MS + 1 })).toBe("sent");
    expect((map.get("booking_1")!.confirmationEmail as Record<string, unknown>).attempts).toBe(2);
  });

  it("does not throw when Resend fails, records the failure, and a later retry sends", async () => {
    const { store, map } = memoryStore();
    const down = fakeProvider(new EmailSendError(503, "service_unavailable"));
    await expect(sendBookingConfirmationEmail("booking_1", { provider: down.provider, store, now: () => 1000 })).resolves.toBe("failed");
    expect(map.get("booking_1")!.confirmationEmail).toMatchObject({ status: "failed", errorCode: "503_service_unavailable" });
    expect(map.get("booking_1")!.confirmationEmailSentAt).toBeUndefined();
    // The booking itself is untouched.
    expect(map.get("booking_1")!.status).toBe("CONFIRMED");
    const up = fakeProvider();
    expect(await sendBookingConfirmationEmail("booking_1", { provider: up.provider, store, now: () => 2000 })).toBe("sent");
    expect(up.sent).toHaveLength(1);
  });

  it("does not throw when the store itself fails", async () => {
    const { provider, sent } = fakeProvider();
    const broken: BookingConfirmationStore = {
      claim: async () => { throw new Error("firestore unavailable"); },
      markSent: async () => undefined,
      markFailed: async () => undefined,
      loadUser: async () => null,
    };
    await expect(sendBookingConfirmationEmail("booking_1", { provider, store: broken })).resolves.toBe("failed");
    expect(sent).toHaveLength(0);
  });

  it("still reports sent when only the marker update fails after a successful send", async () => {
    const { store } = memoryStore();
    store.markSent = async () => { throw new Error("write failed"); };
    const { provider } = fakeProvider();
    expect(await sendBookingConfirmationEmail("booking_1", { provider, store })).toBe("sent");
    expect(logs.error.some((entry) => String(entry[0]).includes("marker update failed"))).toBe(true);
  });

  it("stops retrying after MAX_SEND_ATTEMPTS", async () => {
    const { store } = memoryStore({
      booking_1: bookingDoc({ confirmationEmail: { status: "failed", attempts: MAX_SEND_ATTEMPTS } }),
    });
    const { provider, sent } = fakeProvider();
    expect(await sendBookingConfirmationEmail("booking_1", { provider, store })).toBe("skipped_too_many_attempts");
    expect(sent).toHaveLength(0);
  });

  it("skips bookings that are not confirmed or do not exist", async () => {
    const { store } = memoryStore({ booking_1: bookingDoc({ status: "CANCELLED" }) });
    const { provider, sent } = fakeProvider();
    expect(await sendBookingConfirmationEmail("booking_1", { provider, store })).toBe("skipped_not_confirmed");
    expect(await sendBookingConfirmationEmail("missing", { provider, store })).toBe("skipped_not_found");
    expect(sent).toHaveLength(0);
  });

  it("uses the member's account email when the booking has no guest email", async () => {
    const { store } = memoryStore({ booking_1: bookingDoc({ guestEmail: null, userName: "member@example.com" }) },
      { email: "member@example.com", displayName: "Jordan Lee" });
    const { provider, sent } = fakeProvider();
    expect(await sendBookingConfirmationEmail("booking_1", { provider, store })).toBe("sent");
    expect(sent[0].to).toBe("member@example.com");
    expect(sent[0].text.startsWith("Hi Jordan,")).toBe(true);
  });

  it("never greets someone by their email address", async () => {
    const { store } = memoryStore({ booking_1: bookingDoc({ userName: "alex@example.com" }) }, { email: "alex@example.com" });
    const { provider, sent } = fakeProvider();
    await sendBookingConfirmationEmail("booking_1", { provider, store });
    expect(sent[0].text.startsWith("Hi there,")).toBe(true);
  });

  it("skips with no valid recipient and records why", async () => {
    const { store, calls } = memoryStore({ booking_1: bookingDoc({ guestEmail: "not-an-email" }) }, null);
    const { provider, sent } = fakeProvider();
    expect(await sendBookingConfirmationEmail("booking_1", { provider, store })).toBe("skipped_no_recipient");
    expect(calls.markFailed).toEqual(["no_recipient"]);
    expect(sent).toHaveLength(0);
  });

  it("skips without an API key and when the kill switch is on", async () => {
    const { store } = memoryStore();
    expect(await sendBookingConfirmationEmail("booking_1", { store })).toBe("skipped_no_api_key");
    const { provider, sent } = fakeProvider();
    expect(await sendBookingConfirmationEmail("booking_1", { provider, store, env: { [DISABLE_ENV_VAR]: "true" } })).toBe("skipped_disabled");
    expect(sent).toHaveLength(0);
  });

  it("never logs the recipient address", async () => {
    const { store } = memoryStore();
    await sendBookingConfirmationEmail("booking_1", { provider: fakeProvider().provider, store });
    await sendBookingConfirmationEmail("booking_1", { provider: fakeProvider(new EmailSendError(500, "x")).provider, store: memoryStore().store });
    const all = JSON.stringify([...logs.info, ...logs.warn, ...logs.error]);
    expect(all).not.toContain("alex@example.com");
  });
});

describe("postAttendanceFollowUpCandidate (seam only)", () => {
  const sentBooking = { ...bookingDoc(), id: "booking_1", confirmationEmailSentAt: START - 1000 };

  it("is eligible only after the booking ends and the confirmation went out", () => {
    expect(postAttendanceFollowUpCandidate(sentBooking, END - 1)).toBeNull();
    expect(postAttendanceFollowUpCandidate(sentBooking, END + 1)).toEqual({
      bookingId: "booking_1",
      userId: "user-1",
      resourceName: "Desk 3",
      start: START,
      end: END,
      confirmationEmailSentAt: START - 1000,
    });
    expect(postAttendanceFollowUpCandidate({ ...sentBooking, confirmationEmailSentAt: null }, END + 1)).toBeNull();
    expect(postAttendanceFollowUpCandidate({ ...sentBooking, status: "CANCELLED" }, END + 1)).toBeNull();
    expect(postAttendanceFollowUpCandidate({ ...sentBooking, postAttendanceFollowUpSentAt: END + 5 }, END + 10)).toBeNull();
  });
});

describe("wiring (source contract)", () => {
  const flex = readFileSync("apps/functions/src/bookingFlexTransaction.ts", "utf8");
  const authority = readFileSync("apps/functions/src/bookingTransactionScheduledAuthority.ts", "utf8");
  const module = readFileSync("apps/functions/src/bookingConfirmationEmail.ts", "utf8");

  it("sends after every finalize, including the already-finalized retry path", () => {
    expect(flex).toContain("const result = await finalizeHeldBookingRecord(...args);\n  await sendConfirmationEmailSafely(result.bookingId);");
    expect(flex).toContain("await sendConfirmationEmailSafely(hold.bookingId);");
  });

  it("binds the Hi Coworking Resend secret on both booking callables", () => {
    expect(flex).toContain("secrets: [stripeSecretKey, stripeWebhookSecret, seamApiKey, resendApiKey]");
    expect(flex).toContain("secrets: [seamApiKey, resendApiKey]");
    expect(authority).toContain("secrets: [stripeSecretKey, stripeWebhookSecret, seamApiKey, resendApiKey]");
  });

  it("is transactional: never checks the marketing opt-out", () => {
    const imports = module.split("\n").filter((line) => line.startsWith("import") || line.startsWith("} from"));
    expect(imports.join("\n")).not.toMatch(/nurture|marketing|unsubscribe|suppress/i);
    expect(module).not.toMatch(/marketingOptOut|isSuppressed|List-Unsubscribe/);
  });

  it("does not touch door or Seam code", () => {
    expect(module).not.toMatch(/from "\.\/access"|from "\.\/accessCodes|seamApiKey|createAccessGrant/);
  });
});
