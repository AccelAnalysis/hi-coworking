import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_LEADS_URL,
  DEFAULT_LEAD_ALERT_TO,
  buildIntakeLeadAlert,
  buildWebLeadAlert,
  isQuietLead,
  leadAlertRecipient,
  leadAlertsEnabled,
  sendLeadAlert,
} from "../../apps/functions/src/leadAlerts";
import { DEFAULT_EMAIL_FROM, DEFAULT_EMAIL_REPLY_TO, type EmailProvider } from "../../apps/functions/src/providers/emailProvider";

const read = (path: string) => readFileSync(path, "utf8");

function fakeProvider() {
  const send = vi.fn(async () => ({ messageId: "m1" }));
  const provider: EmailProvider = { send, sendBatch: vi.fn(async () => ({ sent: 0, failed: 0 })) };
  return { provider, send };
}

const webLead = {
  type: "early_access",
  name: "Ada Example",
  email: "Ada@Example.org",
  interests: ["Hot desk"],
  intent: "soon",
  message: "<b>hi</b>",
  source: "web-coming-soon",
};

describe("lead alert flag and recipient", () => {
  it("is off unless LEAD_ALERTS_ENABLED is exactly true", () => {
    expect(leadAlertsEnabled({})).toBe(false);
    expect(leadAlertsEnabled({ LEAD_ALERTS_ENABLED: "false" })).toBe(false);
    expect(leadAlertsEnabled({ LEAD_ALERTS_ENABLED: "1" })).toBe(false);
    expect(leadAlertsEnabled({ LEAD_ALERTS_ENABLED: " TRUE " })).toBe(true);
  });

  it("defaults the recipient to the existing public business inbox", () => {
    expect(DEFAULT_LEAD_ALERT_TO).toBe(DEFAULT_EMAIL_REPLY_TO);
    expect(leadAlertRecipient({})).toBe(DEFAULT_EMAIL_REPLY_TO);
    expect(leadAlertRecipient({ LEAD_ALERT_TO: "team@example.org" })).toBe("team@example.org");
    expect(leadAlertRecipient({ LEAD_ALERT_TO: "nobody@survey.local" })).toBeNull();
  });

  it("keeps imported and exempt leads quiet", () => {
    expect(isQuietLead({ nurtureExempt: true })).toBe(true);
    expect(isQuietLead({ source: "sheets-backfill" })).toBe(true);
    expect(isQuietLead({ importBatch: "2026-11" })).toBe(true);
    expect(isQuietLead(webLead)).toBe(false);
  });
});

describe("sendLeadAlert", () => {
  it("sends nothing while the flag is off", async () => {
    const { provider, send } = fakeProvider();
    const factory = vi.fn(() => provider);
    await expect(sendLeadAlert({ leadKey: "leads/a", data: webLead, build: buildWebLeadAlert, provider: factory, env: {} })).resolves.toBe("disabled");
    expect(factory).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("sends nothing for a backfilled lead even with the flag on", async () => {
    const { provider, send } = fakeProvider();
    const outcome = await sendLeadAlert({
      leadKey: "leads/b",
      data: { ...webLead, source: "sheets-backfill", nurtureExempt: true },
      build: buildWebLeadAlert,
      provider: () => provider,
      env: { LEAD_ALERTS_ENABLED: "true" },
    });
    expect(outcome).toBe("quiet");
    expect(send).not.toHaveBeenCalled();
  });

  it("emails the team from the default sender with reply-to the lead", async () => {
    const { provider, send } = fakeProvider();
    const outcome = await sendLeadAlert({
      leadKey: "leads/c",
      data: webLead,
      build: buildWebLeadAlert,
      provider: () => provider,
      env: { LEAD_ALERTS_ENABLED: "true" },
    });
    expect(outcome).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message.to).toBe(DEFAULT_EMAIL_REPLY_TO);
    expect(message.from).toBeUndefined(); // provider default
    expect(DEFAULT_EMAIL_FROM).toContain("hello@hi-coworking.com");
    expect(message.replyTo).toBe("ada@example.org");
    expect(message.subject).toBe("New Early Access lead: Ada Example");
    expect(message.idempotencyKey).toBe("lead-alert:leads/c");
    expect(message.categories).toEqual(["lead_alert"]);
  });

  it("never throws when the provider fails", async () => {
    const provider: EmailProvider = {
      send: vi.fn(async () => {
        throw new Error("boom");
      }),
      sendBatch: vi.fn(async () => ({ sent: 0, failed: 0 })),
    };
    await expect(
      sendLeadAlert({ leadKey: "leads/d", data: webLead, build: buildWebLeadAlert, provider: () => provider, env: { LEAD_ALERTS_ENABLED: "true" } }),
    ).resolves.toBe("failed");
  });
});

describe("alert content", () => {
  it("escapes lead text in HTML and links to Admin", () => {
    const message = buildWebLeadAlert(webLead);
    expect(message.html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(message.html).not.toContain("<b>hi</b>");
    expect(message.text).toContain(ADMIN_LEADS_URL);
  });

  it("labels anonymous surveys and contact leads, with no placeholder reply-to", () => {
    const survey = buildWebLeadAlert({ type: "survey", name: "", email: "", surveyAnswers: { 1: "x", 2: "y" } });
    expect(survey.subject).toBe("New Survey lead: Anonymous");
    expect(survey.text).toContain("Survey answers: 2 answered");
    expect(survey.replyTo).toBeUndefined();
    expect(buildWebLeadAlert({ type: "contact", name: "C" }).subject).toBe("New Contact lead: C");
  });

  it("keeps the subject on one line", () => {
    expect(buildWebLeadAlert({ type: "contact", name: "A\r\nBcc: x" }).subject).toBe("New Contact lead: A Bcc: x");
  });

  it("describes expo and Power NOW intake leads", () => {
    const expo = buildIntakeLeadAlert({ kind: "expo", fullName: "Eve", email: "eve@example.org", organization: "Org", interests: { coworking: true, x: false } });
    expect(expo.subject).toBe("New Expo booth lead: Eve");
    expect(expo.text).toContain("Interests: coworking");
    const pn = buildIntakeLeadAlert({ kind: "power-now", fullName: "Pat", email: "pat@example.org", opportunityLabel: "Pitch" });
    expect(pn.subject).toBe("New Power NOW lead: Pat");
    expect(pn.text).toContain("Opportunity: Pitch");
  });
});

describe("alert wiring", () => {
  it("defaults the flag param to false and uses the existing Resend secret only", () => {
    const params = read("apps/functions/src/leadAlertParams.ts");
    expect(params).toMatch(/defineString\(LEAD_ALERTS_ENABLED_PARAM, \{\s*default: "false"/);
    expect(params).not.toContain("defineSecret");
    const triggers = read("apps/functions/src/leadAlertTriggers.ts");
    expect(triggers).toContain('document: "intakeLeads/{leadId}"');
    expect(triggers).toContain("secrets: [resendApiKey]");
    const index = read("apps/functions/src/index.ts");
    expect(index).toContain('{ document: "leads/{leadId}", secrets: [resendApiKey] }');
    expect(index).toContain("build: buildWebLeadAlert");
  });

  it("adds no new email address literals", () => {
    for (const file of ["apps/functions/src/leadAlerts.ts", "apps/functions/src/leadAlertParams.ts", "apps/functions/src/leadAlertTriggers.ts"]) {
      expect(read(file).split("hello@hi-coworking.com").join("")).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
    }
  });
});
