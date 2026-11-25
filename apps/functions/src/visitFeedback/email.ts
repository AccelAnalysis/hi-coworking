/**
 * Invitation email for the post-attendance visit feedback survey.
 * Hi Navy, Fraunces headings, DM Sans body, PNG logo. No name or email
 * in the survey URL. Includes one-click unsubscribe.
 */
import {
  EMAIL_BODY_FONT,
  EMAIL_BUTTON_STYLE,
  EMAIL_HEADLINE_FONT,
  EMAIL_LOGO_HTML,
  EMAIL_NAVY,
} from "../payments/emailBrand";
import { NURTURE_POSTAL_ADDRESS } from "../nurtureLinks";

export const VISIT_FEEDBACK_SUBJECT = "How was your visit to Hi Coworking?";
export const VISIT_FEEDBACK_EMAIL_CATEGORY = "visit_feedback";
export const SITE_ORIGIN = "https://hi-coworking.com";

export function visitFeedbackSurveyUrl(token: string, origin = SITE_ORIGIN): string {
  return `${origin}/visit-feedback?t=${encodeURIComponent(token)}`;
}

export function visitFeedbackSiteOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.HI_COWORKING_SITE_ORIGIN?.trim();
  return raw && /^https:\/\//.test(raw) ? raw.replace(/\/+$/, "") : SITE_ORIGIN;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export type VisitFeedbackEmailInput = {
  firstName?: string;
  visitDate: string;
  surveyUrl: string;
  unsubscribeUrl: string;
};

export type VisitFeedbackEmailCopy = { subject: string; html: string; text: string };

export function renderVisitFeedbackEmail(input: VisitFeedbackEmailInput): VisitFeedbackEmailCopy {
  const greeting = input.firstName ? `Hi ${input.firstName},` : "Hi,";
  const subject = VISIT_FEEDBACK_SUBJECT;
  const link = `color:${EMAIL_NAVY};font-weight:600`;
  const html = [
    `<!doctype html><html lang="en"><body style="margin:0;background:#f8fafc;color:#0f172a;font-family:${EMAIL_BODY_FONT}">`,
    `<div style="max-width:620px;margin:0 auto;padding:40px 24px">`,
    EMAIL_LOGO_HTML,
    `<h1 style="margin:24px 0 12px;font-family:${EMAIL_HEADLINE_FONT};font-weight:600;font-size:28px;line-height:1.2;color:${EMAIL_NAVY}">How was your visit?</h1>`,
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#334155">${escapeHtml(greeting)}</p>`,
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#334155">Thank you for coming to Hi Coworking on ${escapeHtml(input.visitDate)}. We'd love to hear how it went. This short survey takes about two minutes.</p>`,
    `<p style="margin:28px 0"><a href="${escapeHtml(input.surveyUrl)}" style="${EMAIL_BUTTON_STYLE};font-family:${EMAIL_BODY_FONT}">Share your feedback</a></p>`,
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.7;color:#334155">Thanks,<br>The Hi Coworking team</p>`,
    `<p style="margin-top:36px;padding-top:20px;border-top:1px solid #e2e8f0;font-size:11px;line-height:1.6;color:#64748b">You're receiving this email because of a recent visit to Hi Coworking. <a href="${escapeHtml(input.unsubscribeUrl)}" style="${link}">Unsubscribe</a><br>${escapeHtml(NURTURE_POSTAL_ADDRESS)}</p>`,
    `</div></body></html>`,
  ].join("");

  const text = [
    greeting,
    "",
    `Thank you for coming to Hi Coworking on ${input.visitDate}. We'd love to hear how it went. This short survey takes about two minutes.`,
    "",
    `Share your feedback: ${input.surveyUrl}`,
    "",
    "Thanks,",
    "The Hi Coworking team",
    "",
    `You're receiving this email because of a recent visit to Hi Coworking.`,
    `Unsubscribe: ${input.unsubscribeUrl}`,
    NURTURE_POSTAL_ADDRESS,
  ].join("\n");

  return { subject, html, text };
}
