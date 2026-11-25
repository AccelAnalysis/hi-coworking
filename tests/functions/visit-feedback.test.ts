import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { visitFeedbackEnabled, visitFeedbackJobMaySend, visitFeedbackSendsEnabled } from "../../apps/functions/src/visitFeedback/config";
import {
  SITE_ORIGIN,
  renderVisitFeedbackEmail,
  visitFeedbackSurveyUrl,
  VISIT_FEEDBACK_SUBJECT,
} from "../../apps/functions/src/visitFeedback/email";
import {
  GUEST_REPEAT_DAYS,
  TIME_ZONE,
  alreadyInvited,
  audienceOf,
  eightAmOn,
  firstNameFrom,
  formatVisitDate,
  inInvitationWindow,
  invitationWindow,
  isCapped,
  isRefunded,
  mostRecentEightAm,
  recipientEmail,
  skipReason,
  zonedTimeToUtcMs,
  type BookingLike,
} from "../../apps/functions/src/visitFeedback/eligibility";
import { getVisitFeedbackInvitation, submitVisitFeedback } from "../../apps/functions/src/visitFeedback/http";
import {
  FOUND_US_OPTIONS,
  IMPROVE_OPTIONS,
  PURPOSE_OPTIONS,
  QUESTION_LABELS,
  RATING_ROWS,
  RATING_SCALE,
  RETURN_OPTIONS,
  SURVEY_INTRO,
  SURVEY_THANKS,
  VISIT_FEEDBACK_COLLECTION,
  VISIT_FEEDBACK_SOURCE,
  WORKED_OPTIONS,
  validateVisitFeedbackAnswers,
} from "../../apps/functions/src/visitFeedback/questions";
import { sendVisitFeedbackInvites } from "../../apps/functions/src/visitFeedback/sendInvites";
import { emailHash, type ClaimInviteInput, type InvitationLike, type VisitFeedbackRecord, type VisitFeedbackStore } from "../../apps/functions/src/visitFeedback/store";
import { isWellFormedVisitFeedbackToken, newVisitFeedbackToken, visitFeedbackTokenHash } from "../../apps/functions/src/visitFeedback/tokens";
import * as webQuestions from "../../apps/web/src/lib/visitFeedbackQuestions";
import { EMAIL_LOGO_URL, EMAIL_NAVY } from "../../apps/functions/src/payments/emailBrand";

const MONDAY_8AM = eightAmOn(2026, 11, 23); // Monday Nov 23, 2026 8:00 AM ET
const TUESDAY_8AM = eightAmOn(2026, 11, 24);
const WEDNESDAY_8AM = eightAmOn(2026, 11, 25);

function booking(overrides: Partial<BookingLike> & { id?: string } = {}): BookingLike {
  return {
    id: overrides.id ?? "booking-1",
    status: "CONFIRMED",
    userId: "user-1",
    guestEmail: "guest@example.com",
    start: MONDAY_8AM + 2 * 60 * 60 * 1000,
    end: MONDAY_8AM + 8 * 60 * 60 * 1000, // Monday 4 PM ET, in Tuesday 8am window
    resourceName: "Desk 3",
    ...overrides,
  };
}

function validAnswers(overrides: Record<string, unknown> = {}) {
  return {
    purpose: "desk",
    purposeOther: "",
    foundUs: "friend",
    foundUsOther: "",
    ratings: Object.fromEntries(RATING_ROWS.map((row) => [row.value, "good"])),
    worked: ["quiet"],
    workedOther: "",
    improve: ["nothing"],
    improveOther: "",
    returnLikelihood: "probably",
    nps: 9,
    comments: "Lovely space.",
    followupConsent: false,
    followupEmail: "",
    ...overrides,
  };
}

class MemoryStore implements VisitFeedbackStore {
  bookings = new Map<string, BookingLike>();
  users = new Map<string, Record<string, unknown>>();
  flags = new Map<string, string>();
  suppressed = new Set<string>();
  records = new Map<string, VisitFeedbackRecord>();
  unsubscribeCalls: string[] = [];

  constructor(items: BookingLike[] = []) {
    for (const item of items) this.bookings.set(item.id, item);
  }

  async loadBooking(bookingId: string) {
    return this.bookings.get(bookingId) ?? null;
  }
  async loadUser(uid: string) {
    return (this.users.get(uid) as never) ?? null;
  }
  async loadNoShowFlag(bookingId: string) {
    return this.flags.get(bookingId) ?? null;
  }
  async isEmailSuppressed(email: string) {
    return this.suppressed.has(email.toLowerCase());
  }
  async listPriorInvitations(identity: { userId: string; emailHash: string }) {
    const out: InvitationLike[] = [];
    for (const record of this.records.values()) {
      const byUser = identity.userId && !identity.userId.startsWith("guest:") && record.userId === identity.userId;
      const byEmail = identity.emailHash && record.emailHash === identity.emailHash;
      if (byUser || byEmail) out.push({ userId: record.userId, emailHash: record.emailHash, invitedAt: record.invitedAt, bookingId: record.bookingId });
    }
    return out;
  }
  async listBookingsEndingIn(window: { start: number; end: number }) {
    return [...this.bookings.values()].filter((item) => Number(item.end) >= window.start && Number(item.end) < window.end);
  }
  async claimInvitation(input: ClaimInviteInput) {
    const current = this.bookings.get(input.booking.id);
    if (!current) return { claimed: false as const, reason: "not_found" as const };
    if (alreadyInvited(current)) return { claimed: false as const, reason: "already_invited" as const };
    const id = input.tokenHash;
    current.visitFeedbackInvitedAt = input.now;
    current.visitFeedbackId = id;
    this.records.set(id, {
      id,
      bookingId: current.id,
      userId: typeof current.userId === "string" && !current.userId.startsWith("guest:") ? current.userId : null,
      email: input.email,
      emailHash: emailHash(input.email),
      firstName: input.firstName,
      audience: input.audience,
      visitStart: Number(current.start || 0),
      visitEnd: Number(current.end || 0),
      resourceName: String(current.resourceName || ""),
      status: "invited",
      tokenHash: input.tokenHash,
      source: input.source,
      template: input.template,
      invitedAt: input.now,
      sentAt: null,
      submittedAt: null,
      messageId: null,
      errorCode: null,
      answers: null,
      nps: null,
      followupConsent: null,
      followupEmail: null,
      hasBookingEmail: true,
      adminNotes: "",
      createdAt: input.now,
      updatedAt: input.now,
    });
    return { claimed: true as const, id };
  }
  async markSent(id: string, messageId: string, now: number) {
    const record = this.records.get(id);
    if (!record) return;
    record.status = "sent";
    record.sentAt = now;
    record.messageId = messageId;
    record.updatedAt = now;
  }
  async markFailed(id: string, code: string, now: number) {
    const record = this.records.get(id);
    if (!record) return;
    record.status = "failed";
    record.errorCode = code;
    record.updatedAt = now;
  }
  async getByTokenHash(tokenHash: string) {
    return this.records.get(tokenHash) ?? null;
  }
  async submitAnswers(input: { id: string; tokenHash: string; answers: VisitFeedbackRecord["answers"] extends infer A ? A : never; followupEmail: string | null; now: number }) {
    const record = this.records.get(input.id);
    if (!record || record.tokenHash !== input.tokenHash) return "not_found" as const;
    if (record.status === "submitted") return "used" as const;
    record.status = "submitted";
    record.submittedAt = input.now;
    record.answers = input.answers;
    record.nps = input.answers?.nps ?? null;
    record.followupConsent = input.answers?.followupConsent ?? null;
    record.followupEmail = input.followupEmail;
    record.updatedAt = input.now;
    return "submitted" as const;
  }
  async unsubscribeUrl(email: string) {
    this.unsubscribeCalls.push(email);
    return `https://example.test/unsubscribe?e=${encodeURIComponent(email)}`;
  }
}

describe("visit feedback flags", () => {
  it("is off by default, and sends stay off unless both flags are true", () => {
    expect(visitFeedbackEnabled({})).toBe(false);
    expect(visitFeedbackSendsEnabled({})).toBe(false);
    expect(visitFeedbackJobMaySend({})).toBe(false);
    expect(visitFeedbackJobMaySend({ VISIT_FEEDBACK_ENABLED: "true" })).toBe(false);
    expect(visitFeedbackJobMaySend({ VISIT_FEEDBACK_SENDS_ENABLED: "true" })).toBe(false);
    expect(visitFeedbackJobMaySend({ VISIT_FEEDBACK_ENABLED: "true", VISIT_FEEDBACK_SENDS_ENABLED: "true" })).toBe(true);
    expect(visitFeedbackEnabled({ VISIT_FEEDBACK_ENABLED: "TRUE" })).toBe(true);
  });
});

describe("invitation window (8:00 AM ET the morning after the end)", () => {
  it("places a weekday afternoon visit in the next morning's window", () => {
    const window = invitationWindow(TUESDAY_8AM + 5_000);
    expect(window.start).toBe(MONDAY_8AM);
    expect(window.end).toBe(TUESDAY_8AM);
    expect(inInvitationWindow(MONDAY_8AM + 8 * 60 * 60 * 1000, window)).toBe(true);
    expect(inInvitationWindow(MONDAY_8AM - 1, window)).toBe(false);
    expect(inInvitationWindow(TUESDAY_8AM, window)).toBe(false);
  });

  it("sends the same morning for a visit that ended after midnight and before 8 AM", () => {
    const lateNight = zonedTimeToUtcMs(2026, 11, 24, 1, 0, 0); // Tuesday 1 AM ET
    const window = invitationWindow(TUESDAY_8AM);
    expect(inInvitationWindow(lateNight, window)).toBe(true);
  });

  it("holds a visit that is still in progress at 8 AM until the next morning", () => {
    const window = invitationWindow(TUESDAY_8AM);
    expect(inInvitationWindow(TUESDAY_8AM, window)).toBe(false);
    expect(inInvitationWindow(TUESDAY_8AM, invitationWindow(WEDNESDAY_8AM))).toBe(true);
  });

  it("computes the most recent 8 AM across the November 2026 EST period", () => {
    expect(mostRecentEightAm(TUESDAY_8AM)).toBe(TUESDAY_8AM);
    expect(mostRecentEightAm(TUESDAY_8AM - 1)).toBe(MONDAY_8AM);
    expect(TIME_ZONE).toBe("America/New_York");
  });
});

describe("eligibility skips and caps", () => {
  const window = invitationWindow(TUESDAY_8AM);
  const now = TUESDAY_8AM;

  it("skips cancelled, refunded, no-show, already invited, and missing email", () => {
    expect(skipReason({ booking: booking({ status: "CANCELLED" }), window, noShow: false, user: null, email: "a@example.com", suppressed: false, audience: "guest", invitations: [], now })).toBe("not_confirmed");
    expect(isRefunded(booking({ stripeRefundId: "re_123" }))).toBe(true);
    expect(skipReason({ booking: booking({ stripeRefundId: "re_123" }), window, noShow: false, user: null, email: "a@example.com", suppressed: false, audience: "guest", invitations: [], now })).toBe("refunded");
    expect(skipReason({ booking: booking({ cancellationRefundCents: 1500 }), window, noShow: false, user: null, email: "a@example.com", suppressed: false, audience: "guest", invitations: [], now })).toBe("refunded");
    expect(skipReason({ booking: booking(), window, noShow: true, user: null, email: "a@example.com", suppressed: false, audience: "guest", invitations: [], now })).toBe("no_show");
    expect(skipReason({ booking: booking({ visitFeedbackInvitedAt: now }), window, noShow: false, user: null, email: "a@example.com", suppressed: false, audience: "guest", invitations: [], now })).toBe("already_invited");
    expect(skipReason({ booking: booking(), window, noShow: false, user: null, email: "", suppressed: false, audience: "guest", invitations: [], now })).toBe("no_recipient");
    expect(skipReason({ booking: booking(), window, noShow: false, user: { marketingOptOut: true }, email: "a@example.com", suppressed: false, audience: "guest", invitations: [], now })).toBe("suppressed");
    expect(skipReason({ booking: booking(), window, noShow: false, user: null, email: "a@example.com", suppressed: true, audience: "guest", invitations: [], now })).toBe("suppressed");
  });

  it("allows a first completed visit, then caps guests at 30 days and members at the calendar month", () => {
    expect(isCapped({ audience: "guest", now, invitations: [] })).toBe(false);
    expect(isCapped({ audience: "guest", now, invitations: [{ invitedAt: now - (GUEST_REPEAT_DAYS * 24 * 60 * 60 * 1000) + 1 }] })).toBe(true);
    expect(isCapped({ audience: "guest", now, invitations: [{ invitedAt: now - (GUEST_REPEAT_DAYS * 24 * 60 * 60 * 1000) }] })).toBe(false);
    expect(isCapped({ audience: "member", now, invitations: [{ invitedAt: eightAmOn(2026, 11, 2) }] })).toBe(true);
    expect(isCapped({ audience: "member", now, invitations: [{ invitedAt: eightAmOn(2026, 10, 31) }] })).toBe(false);
    expect(audienceOf({ membershipStatus: "active" }, "user-1")).toBe("member");
    expect(audienceOf({ membershipStatus: "active" }, "guest:abc")).toBe("guest");
    expect(audienceOf({ membershipStatus: "none" }, "user-1")).toBe("guest");
  });

  it("prefers the booking email and a real first name", () => {
    expect(recipientEmail(booking({ guestEmail: "Ada@Example.com" }), { email: "other@example.com" })).toBe("ada@example.com");
    expect(firstNameFrom({ displayName: "Ada Lovelace" }, booking())).toBe("Ada");
    expect(firstNameFrom({ displayName: "guest@example.com" }, booking({ userName: "Guest" }))).toBe("");
  });
});

describe("answer validation", () => {
  it("accepts a complete response and rejects Coming Soon-style numeric keys as the required fields", () => {
    const ok = validateVisitFeedbackAnswers(validAnswers(), true);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.answers.nps).toBe(9);
    expect(validateVisitFeedbackAnswers({ 1: "desk", 7: 9 }, true).ok).toBe(false);
    expect(validateVisitFeedbackAnswers(validAnswers({ improve: ["nothing", "wifi"] }), true).ok).toBe(false);
    expect(validateVisitFeedbackAnswers(validAnswers({ purpose: "other", purposeOther: "" }), true).ok).toBe(false);
    expect(validateVisitFeedbackAnswers(validAnswers({ followupConsent: true, followupEmail: "" }), false).ok).toBe(false);
    expect(validateVisitFeedbackAnswers(validAnswers({ followupConsent: true, followupEmail: "" }), true).ok).toBe(true);
    expect(VISIT_FEEDBACK_COLLECTION).toBe("visitFeedback");
    expect(VISIT_FEEDBACK_SOURCE).toBe("post-attendance-v1");
  });
});

describe("invitation email", () => {
  it("uses the approved wording, Hi Navy, Fraunces, DM Sans, and a PNG logo, with no PII in the URL", () => {
    const token = "a".repeat(48);
    const url = visitFeedbackSurveyUrl(token);
    expect(url).toBe(`${SITE_ORIGIN}/visit-feedback?t=${token}`);
    expect(url).not.toMatch(/@|Ada|example.com/i);
    const copy = renderVisitFeedbackEmail({
      firstName: "Ada",
      visitDate: formatVisitDate(MONDAY_8AM + 2 * 60 * 60 * 1000),
      surveyUrl: url,
      unsubscribeUrl: "https://hi-coworking.com/unsub?t=abc",
    });
    expect(copy.subject).toBe(VISIT_FEEDBACK_SUBJECT);
    expect(copy.text).toContain("Hi Ada,");
    expect(copy.text).toContain("Thank you for coming to Hi Coworking on Monday, November 23.");
    expect(copy.text).toContain("Share your feedback:");
    expect(copy.text).toContain("Unsubscribe:");
    expect(copy.html).toContain(EMAIL_NAVY);
    expect(copy.html).toContain("Fraunces");
    expect(copy.html).toContain("DM Sans");
    expect(copy.html).toContain(EMAIL_LOGO_URL);
    expect(EMAIL_LOGO_URL).toMatch(/\.png$/);
    expect(copy.html).toContain("Share your feedback");
    expect(copy.html).not.toMatch(/Firestore|Admin|token/i);
    expect(copy.html).not.toMatch(/type['"]:\s*['"]survey['"]/);
  });
});

describe("sendVisitFeedbackInvites", () => {
  const env = { VISIT_FEEDBACK_ENABLED: "true", VISIT_FEEDBACK_SENDS_ENABLED: "true" };

  it("does nothing when the feature flag or the sends flag is off", async () => {
    const store = new MemoryStore([booking()]);
    const sent: unknown[] = [];
    const provider = { send: async (message: { to: string }) => { sent.push(message); return { messageId: "1" }; }, sendBatch: async () => ({ sent: 0, failed: 0 }) };
    expect((await sendVisitFeedbackInvites({ store, provider, now: TUESDAY_8AM, env: {} })).skipped).toEqual({ disabled: 1 });
    expect((await sendVisitFeedbackInvites({ store, provider, now: TUESDAY_8AM, env: { VISIT_FEEDBACK_ENABLED: "true" } })).skipped).toEqual({ sends_disabled: 1 });
    expect(sent).toEqual([]);
    expect(store.records.size).toBe(0);
  });

  it("sends one branded invitation, then refuses a second send for the same booking", async () => {
    const store = new MemoryStore([booking()]);
    const sent: Array<{ to: string; subject: string; html: string; headers?: Record<string, string> }> = [];
    const provider = {
      send: async (message: { to: string; subject: string; html: string; headers?: Record<string, string> }) => {
        sent.push(message);
        return { messageId: "msg_1" };
      },
      sendBatch: async () => ({ sent: 0, failed: 0 }),
    };
    const first = await sendVisitFeedbackInvites({ store, provider, now: TUESDAY_8AM, env });
    expect(first.sent).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("guest@example.com");
    expect(sent[0].subject).toBe(VISIT_FEEDBACK_SUBJECT);
    expect(sent[0].html).toContain("/visit-feedback?t=");
    expect(sent[0].html).not.toContain("guest@example.com");
    expect(sent[0].headers?.["List-Unsubscribe"]).toBeTruthy();
    const record = [...store.records.values()][0];
    expect(record.status).toBe("sent");
    expect(record.source).toBe(VISIT_FEEDBACK_SOURCE);
    expect(store.bookings.get("booking-1")?.visitFeedbackInvitedAt).toBe(TUESDAY_8AM);

    const second = await sendVisitFeedbackInvites({ store, provider, now: TUESDAY_8AM, env });
    expect(second.sent).toBe(0);
    expect(second.skipped.already_invited).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it("skips a no-show and an unsubscribed address", async () => {
    const noShow = booking({ id: "no-show", guestEmail: "a@example.com" });
    const unsub = booking({ id: "unsub", guestEmail: "b@example.com", userId: "user-b" });
    const store = new MemoryStore([noShow, unsub]);
    store.flags.set("no-show", "no_show");
    store.suppressed.add("b@example.com");
    const sent: unknown[] = [];
    const provider = { send: async (message: unknown) => { sent.push(message); return { messageId: "x" }; }, sendBatch: async () => ({ sent: 0, failed: 0 }) };
    const result = await sendVisitFeedbackInvites({ store, provider, now: TUESDAY_8AM, env });
    expect(result.sent).toBe(0);
    expect(result.skipped.no_show).toBe(1);
    expect(result.skipped.suppressed).toBe(1);
    expect(sent).toEqual([]);
  });
});

describe("token get and submit", () => {
  it("issues a 192-bit token and allows a single submission", async () => {
    const token = newVisitFeedbackToken();
    expect(isWellFormedVisitFeedbackToken(token)).toBe(true);
    const store = new MemoryStore([booking()]);
    const hash = visitFeedbackTokenHash(token);
    await store.claimInvitation({
      booking: booking(),
      user: { displayName: "Ada" },
      email: "guest@example.com",
      firstName: "Ada",
      audience: "guest",
      tokenHash: hash,
      now: TUESDAY_8AM,
      source: VISIT_FEEDBACK_SOURCE,
      template: "visit-feedback-invite-v1",
    });
    expect(await getVisitFeedbackInvitation(token, store)).toEqual({
      ok: true,
      visitDate: "Monday, November 23",
      hasEmail: true,
    });
    expect(await getVisitFeedbackInvitation("deadbeef", store)).toEqual({ ok: false, reason: "invalid" });
    const first = await submitVisitFeedback({ token, answers: validAnswers() }, store, TUESDAY_8AM + 1);
    expect(first).toEqual({ ok: true });
    expect(await submitVisitFeedback({ token, answers: validAnswers() }, store, TUESDAY_8AM + 2)).toEqual({ ok: false, reason: "used" });
    expect(await getVisitFeedbackInvitation(token, store)).toEqual({ ok: false, reason: "used" });
    const record = await store.getByTokenHash(hash);
    expect(record?.nps).toBe(9);
    expect(record?.followupConsent).toBe(false);
    expect(record?.followupEmail).toBeNull();
  });
});

describe("copy stays in lockstep and is not the Coming Soon survey", () => {
  it("matches the web question module and never reuses type survey", () => {
    expect(webQuestions.QUESTION_LABELS).toEqual(QUESTION_LABELS);
    expect(webQuestions.PURPOSE_OPTIONS).toEqual(PURPOSE_OPTIONS);
    expect(webQuestions.FOUND_US_OPTIONS).toEqual(FOUND_US_OPTIONS);
    expect(webQuestions.RATING_ROWS).toEqual(RATING_ROWS);
    expect(webQuestions.RATING_SCALE).toEqual(RATING_SCALE);
    expect(webQuestions.WORKED_OPTIONS).toEqual(WORKED_OPTIONS);
    expect(webQuestions.IMPROVE_OPTIONS).toEqual(IMPROVE_OPTIONS);
    expect(webQuestions.RETURN_OPTIONS).toEqual(RETURN_OPTIONS);
    expect(webQuestions.SURVEY_INTRO).toBe(SURVEY_INTRO);
    expect(webQuestions.SURVEY_THANKS).toBe(SURVEY_THANKS);
    expect(webQuestions.VISIT_FEEDBACK_COLLECTION).toBe("visitFeedback");
    const form = readFileSync("apps/web/src/app/visit-feedback/VisitFeedbackForm.tsx", "utf8");
    expect(form).toContain("{SURVEY_INTRO}");
    expect(form).toContain("{SURVEY_THANKS}");
    expect(form).not.toMatch(/leave a review on Google/i);
    expect(form).toContain("#101D4B");
    expect(form).toContain("hi-coworking-mark-256.png");
    expect(form).toContain("font-fraunces");
    expect(form).toContain("font-dm-sans");
    const http = readFileSync("apps/functions/src/visitFeedback/http.ts", "utf8");
    const send = readFileSync("apps/functions/src/visitFeedback/sendInvites.ts", "utf8");
    const store = readFileSync("apps/functions/src/visitFeedback/firestoreStore.ts", "utf8");
    for (const source of [http, send, store, form]) {
      expect(source).not.toMatch(/type:\s*["']survey["']/);
      expect(source).not.toContain('collection("leads")');
    }
    expect(send).toContain('schedule: "0 8 * * *"');
    expect(send).toContain('timeZone: "America/New_York"');
  });
});
