import { describe, expect, it } from "vitest";
import { renderMembershipWelcomeEmail } from "../../apps/functions/src/payments/membershipWelcomeEmail";
import { renderMembershipEndedEmail } from "../../apps/functions/src/payments/memberNoticeEmails";
import { EMAIL_LOGO_URL } from "../../apps/functions/src/payments/emailBrand";

describe("member email branding", () => {
  it("uses the PNG mark, Hi Navy buttons and no SVG", () => {
    const welcome = renderMembershipWelcomeEmail({ planId: "coworking", firstName: "Jordan", origin: "https://example.test" })!;
    expect(EMAIL_LOGO_URL).toMatch(/\.png$/);
    for (const html of [welcome.html]) {
      expect(html).toContain(`src="${EMAIL_LOGO_URL}"`);
      expect(html).toContain('alt="Hi Coworking"');
      expect(html).toContain("background:#101D4B;color:#ffffff");
      expect(html).not.toMatch(/\.svg/);
      expect(html).not.toMatch(/background:#0f172a/);
    }
  });
  it("brands the membership notices too", () => {
    const ended = renderMembershipEndedEmail({ endedAtMs: Date.UTC(2026, 10, 20), planId: "member", origin: "https://example.test" });
    expect(ended.html).toContain(`src="${EMAIL_LOGO_URL}"`);
    expect(ended.html).toContain("background:#101D4B;color:#ffffff");
  });
});
