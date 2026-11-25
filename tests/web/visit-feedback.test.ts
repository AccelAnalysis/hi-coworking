import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADMIN_ROUTES } from "../../apps/web/src/lib/adminNavigation";
import { visitFeedbackCsv, fromVisitFeedbackDoc, matchesVisitFeedbackSearch } from "../../apps/web/src/lib/adminVisitFeedback";

const form = readFileSync("apps/web/src/app/visit-feedback/VisitFeedbackForm.tsx", "utf8");
const admin = readFileSync("apps/web/src/app/admin/visit-feedback/page.tsx", "utf8");
const dashboard = readFileSync("apps/web/src/app/admin/dashboard/page.tsx", "utf8");

describe("visit feedback pages", () => {
  it("registers the Admin screen and a dashboard tile", () => {
    expect(ADMIN_ROUTES["/admin/visit-feedback"]?.label).toBe("Visit feedback");
    expect(dashboard).toContain('href: "/admin/visit-feedback"');
    expect(admin).toContain("<AppShell");
    expect(admin).toContain("Export CSV");
    expect(admin).toContain("Booking ID");
    expect(admin).toContain("NPS");
    expect(admin).toContain("do not start a personal follow-up");
  });

  it("keeps the public form branded and free of a Google review ask", () => {
    expect(form).toContain("#101D4B");
    expect(form).toContain("hi-coworking-mark-256.png");
    expect(form).toContain("How was your visit?");
    expect(form).not.toMatch(/Google Business|leave a review on Google/i);
    expect(form).toContain("/privacy");
  });

  it("exports CSV with booking ID, NPS, consent, and answers, and searches by booking ID", () => {
    const row = fromVisitFeedbackDoc("abc", {
      bookingId: "booking-99",
      email: "ada@example.com",
      firstName: "Ada",
      audience: "guest",
      visitStart: Date.parse("2026-11-23T15:00:00-05:00"),
      status: "submitted",
      nps: 9,
      followupConsent: true,
      followupEmail: "ada@example.com",
      answers: { purpose: "desk", nps: 9, comments: "Quiet and bright.", returnLikelihood: "definitely" },
      invitedAt: 1,
      submittedAt: 2,
      createdAt: 1,
    });
    const csv = visitFeedbackCsv([row]);
    expect(csv).toContain("Booking ID");
    expect(csv).toContain("booking-99");
    expect(csv).toContain("NPS");
    expect(csv).toContain("9");
    expect(csv).toContain("Follow-up consent");
    expect(csv).toContain("visitFeedback/abc");
    expect(matchesVisitFeedbackSearch(row, "booking-99")).toBe(true);
    expect(matchesVisitFeedbackSearch(row, "nobody")).toBe(false);
  });
});
