import { describe, expect, it } from "vitest";
import {
  evaluateMarketingRecipient,
  hasAdminMarketingEmailCapability,
  normalizeAdminMarketingConfig,
  normalizeEmail,
  renderSafeMarketingHtml,
} from "../../apps/functions/src/adminMarketingEmail";

const developmentConfig = normalizeAdminMarketingConfig({
  enabled: true,
  environment: "development",
  tenantId: "tenant",
  clientId: "client",
  mailboxUpn: "marketing@hi-coworking.com",
  senderAliases: ["hello@hi-coworking.com"],
  defaultSenderAlias: "hello@hi-coworking.com",
  approvedReplyTo: ["hello@hi-coworking.com"],
  developmentRecipientAllowlist: ["allowed@example.test"],
  unsubscribeBaseUrl: "https://hi-coworking.com/email-preferences",
});

describe("administrative marketing-email authorization", () => {
  it("allows master and a separately granted marketing capability", () => {
    expect(hasAdminMarketingEmailCapability({ role: "master" })).toBe(true);
    expect(hasAdminMarketingEmailCapability({ role: "admin", adminMarketingEmail: true })).toBe(true);
  });

  it("does not infer marketing authority from admin or review authority", () => {
    expect(hasAdminMarketingEmailCapability({ role: "admin" })).toBe(false);
    expect(hasAdminMarketingEmailCapability({ role: "admin", reviewAdmin: true })).toBe(false);
    expect(hasAdminMarketingEmailCapability({ role: "staff" })).toBe(false);
    expect(hasAdminMarketingEmailCapability({ role: "member" })).toBe(false);
  });
});

describe("administrative marketing-email configuration", () => {
  it("is disabled by default and allowlists aliases", () => {
    const config = normalizeAdminMarketingConfig({
      enabled: true,
      environment: "disabled",
      senderAliases: ["Hello@Hi-Coworking.com", "not-an-email"],
      defaultSenderAlias: "unknown@hi-coworking.com",
    });
    expect(config.enabled).toBe(false);
    expect(config.senderAliases).toEqual(["hello@hi-coworking.com"]);
    expect(config.defaultSenderAlias).toBe("hello@hi-coworking.com");
  });

  it("normalizes but never invents email addresses", () => {
    expect(normalizeEmail(" Allowed@Example.Test ")).toBe("allowed@example.test");
    expect(normalizeEmail("not an email")).toBe("");
  });
});

describe("marketing consent and suppression", () => {
  it("requires explicit subscribed status and recorded source", () => {
    expect(evaluateMarketingRecipient(
      "member",
      { email: "allowed@example.test", role: "member", marketingEmail: { status: "subscribed" } },
      "all_eligible_members",
      developmentConfig,
      new Set(),
    ).recipient).toBeUndefined();

    expect(evaluateMarketingRecipient(
      "member",
      {
        email: "allowed@example.test",
        displayName: "Allowed Member",
        role: "member",
        marketingEmail: {
          status: "subscribed",
          source: "documented_opt_in",
          evidenceReference: "consent-record-1",
        },
      },
      "all_eligible_members",
      developmentConfig,
      new Set(),
    ).recipient).toMatchObject({ uid: "member", email: "allowed@example.test" });
  });

  it("excludes unsubscribed, suppressed, bounced, administrative, and non-allowlisted recipients", () => {
    for (const status of ["unsubscribed", "suppressed", "bounced"] as const) {
      expect(evaluateMarketingRecipient(
        status,
        {
          email: "allowed@example.test",
          role: "member",
          marketingEmail: { status, source: "recorded" },
        },
        "all_eligible_members",
        developmentConfig,
        new Set(),
      ).recipient).toBeUndefined();
    }

    expect(evaluateMarketingRecipient(
      "admin",
      {
        email: "allowed@example.test",
        role: "admin",
        marketingEmail: { status: "subscribed", source: "recorded" },
      },
      "all_eligible_members",
      developmentConfig,
      new Set(),
    ).exclusion).toBe("administrator_excluded");

    expect(evaluateMarketingRecipient(
      "member",
      {
        email: "outside@example.test",
        role: "member",
        marketingEmail: { status: "subscribed", source: "recorded" },
      },
      "all_eligible_members",
      developmentConfig,
      new Set(),
    ).exclusion).toBe("development_allowlist");
  });
});

describe("safe content rendering", () => {
  it("escapes administrator input rather than accepting arbitrary HTML", () => {
    const html = renderSafeMarketingHtml("Hello <script>alert('x')</script>", {
      unsubscribeUrl: "https://hi-coworking.com/email-preferences?token=safe",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Unsubscribe");
  });
});
