/**
 * New-lead alert email for the Hi Coworking team.
 *
 * Off unless the LEAD_ALERTS_ENABLED param is the string "true". The
 * recipient is the LEAD_ALERT_TO param, which defaults to the existing public
 * business inbox (DEFAULT_EMAIL_REPLY_TO). Mail goes from the default app
 * sender (hello@hi-coworking.com) through the existing
 * HI_COWORKING_RESEND_API_KEY secret.
 *
 * Imported leads (sheets backfill, nurtureExempt) never alert. This module
 * has no firebase-admin import so tests can load it without emulators. Logs
 * carry the lead id and a reason only, never a name or address.
 */
import * as logger from "firebase-functions/logger";
import { isDeliverableLeadEmail } from "./leadContact";
import { DEFAULT_EMAIL_REPLY_TO, type EmailProvider } from "./providers/emailProvider";

export const LEAD_ALERTS_ENABLED_PARAM = "LEAD_ALERTS_ENABLED";
export const LEAD_ALERT_TO_PARAM = "LEAD_ALERT_TO";
export const DEFAULT_LEAD_ALERT_TO = DEFAULT_EMAIL_REPLY_TO;
export const ADMIN_LEADS_URL = "https://hi-coworking.com/admin/leads";
export const LEAD_ALERT_CATEGORY = "lead_alert";

export function leadAlertsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LEAD_ALERTS_ENABLED_PARAM]?.trim().toLowerCase() === "true";
}

export function leadAlertRecipient(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env[LEAD_ALERT_TO_PARAM]?.trim().toLowerCase() || DEFAULT_LEAD_ALERT_TO;
  return isDeliverableLeadEmail(configured) ? configured : null;
}

/** Imported or exempt leads never alert. */
export function isQuietLead(data: Record<string, unknown>): boolean {
  if (data.nurtureExempt === true) return true;
  if (data.source === "sheets-backfill") return true;
  if (typeof data.importBatch === "string" && data.importBatch.trim()) return true;
  return false;
}

export type LeadAlertMessage = { subject: string; text: string; html: string; replyTo?: string };

function text(value: unknown, max = 2000): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Keep header-safe: one line, no control characters. */
function headerText(value: string, max = 120): string {
  return value.replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const WEB_TYPE_LABELS: Record<string, string> = {
  early_access: "Early Access",
  survey: "Survey",
  contact: "Contact",
};

const INTAKE_KIND_LABELS: Record<string, string> = {
  expo: "Expo booth",
  "power-now": "Power NOW",
};

function render(label: string, rows: Array<[string, string]>, replyEmail: string): LeadAlertMessage {
  const filled = rows.filter(([, value]) => value);
  const who = headerText(filled.find(([key]) => key === "Name")?.[1] || "") || "Anonymous";
  const subject = headerText(`New ${label} lead: ${who}`);
  const textBody = [
    `New ${label} lead`,
    "",
    ...filled.map(([key, value]) => `${key}: ${value}`),
    "",
    `Open in Admin: ${ADMIN_LEADS_URL}`,
  ].join("\n");
  const html = [
    `<p><strong>New ${escapeHtml(label)} lead</strong></p>`,
    "<table cellpadding=\"4\" style=\"border-collapse:collapse\">",
    ...filled.map(
      ([key, value]) =>
        `<tr><td style="color:#64748b;vertical-align:top">${escapeHtml(key)}</td><td style="white-space:pre-wrap">${escapeHtml(value)}</td></tr>`,
    ),
    "</table>",
    `<p><a href="${ADMIN_LEADS_URL}">Open in Admin</a></p>`,
  ].join("");
  return {
    subject,
    text: textBody,
    html,
    ...(isDeliverableLeadEmail(replyEmail) ? { replyTo: replyEmail.trim().toLowerCase() } : {}),
  };
}

export function buildWebLeadAlert(data: Record<string, unknown>): LeadAlertMessage {
  const type = typeof data.type === "string" ? data.type : "";
  const label = WEB_TYPE_LABELS[type] || "website";
  const email = text(data.email, 320);
  const interests = Array.isArray(data.interests) ? data.interests.filter((i) => typeof i === "string").join(", ") : "";
  const answers = data.surveyAnswers && typeof data.surveyAnswers === "object" ? Object.keys(data.surveyAnswers).length : 0;
  return render(
    label,
    [
      ["Name", text(data.name, 200)],
      ["Email", email],
      ["Interests", interests],
      ["Intent", text(data.intent, 200)],
      ["Message", text(data.message)],
      ["Survey answers", answers ? `${answers} answered (see Admin)` : ""],
      ["Source", text(data.source, 200)],
    ],
    email,
  );
}

export function buildIntakeLeadAlert(data: Record<string, unknown>): LeadAlertMessage {
  const kind = typeof data.kind === "string" ? data.kind : "";
  const label = INTAKE_KIND_LABELS[kind] || "intake";
  const email = text(data.email, 320);
  const interestsRaw = data.interests && typeof data.interests === "object" ? (data.interests as Record<string, unknown>) : {};
  const interests = Object.keys(interestsRaw).filter((key) => interestsRaw[key] === true).join(", ");
  return render(
    label,
    [
      ["Name", text(data.fullName, 200)],
      ["Email", email],
      ["Phone", text(data.phoneOriginal, 60)],
      ["Organization", text(data.organization, 200) || text(data.companyName, 200)],
      ["Role", text(data.roleTitle, 200)],
      ["Need", text(data.need)],
      ["Opportunity", text(data.opportunityLabel, 200)],
      ["Interests", interests],
      ["Event", text(data.event, 200)],
    ],
    email,
  );
}

export type LeadAlertOutcome = "sent" | "disabled" | "quiet" | "no_recipient" | "failed";

/**
 * Decide and send. Never throws: an alert failure must not retry the trigger
 * or affect the lead.
 */
export async function sendLeadAlert(options: {
  leadKey: string;
  data: Record<string, unknown>;
  build: (data: Record<string, unknown>) => LeadAlertMessage;
  provider: () => EmailProvider;
  env?: NodeJS.ProcessEnv;
}): Promise<LeadAlertOutcome> {
  const env = options.env ?? process.env;
  if (!leadAlertsEnabled(env)) {
    logger.info("lead alert skipped", { lead: options.leadKey, reason: "disabled" });
    return "disabled";
  }
  if (isQuietLead(options.data)) {
    logger.info("lead alert skipped", { lead: options.leadKey, reason: "quiet" });
    return "quiet";
  }
  const to = leadAlertRecipient(env);
  if (!to) {
    logger.warn("lead alert skipped", { lead: options.leadKey, reason: "no_recipient" });
    return "no_recipient";
  }
  try {
    const message = options.build(options.data);
    await options.provider().send({
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      categories: [LEAD_ALERT_CATEGORY],
      idempotencyKey: `lead-alert:${options.leadKey}`,
    });
    logger.info("lead alert sent", { lead: options.leadKey });
    return "sent";
  } catch {
    logger.error("lead alert failed", { lead: options.leadKey });
    return "failed";
  }
}
