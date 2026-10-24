/**
 * Hi Coworking SMS program rules (US A2P 10DLC).
 *
 * Pure helpers with no Firebase imports, so the web app, the send path and
 * the tests all read the same consent wording and footer.
 *
 * - Every SMS names the sender ("Hi Coworking") and ends with the opt-out
 *   footer. enforceSmsCompliance() is applied by the SMS provider at send
 *   time, so admin-edited copy can't drop either one.
 * - SMS only goes to people with a recorded opt-in (smsConsent.optIn true and
 *   a phone number). Mobile numbers and SMS consent are never shared with
 *   third parties for marketing.
 */

export const SMS_SENDER_NAME = "Hi Coworking";
export const SMS_SENDER_PREFIX = `${SMS_SENDER_NAME}: `;
export const SMS_OPT_OUT_FOOTER = "Reply STOP to opt out. Msg & data rates may apply.";

/** Exact checkbox wording (A2P registration pack §3.3). Links render next to it. */
export const HI_SMS_CONSENT_TEXT =
  "I agree to receive event invitations, reminders and updates by text from Hi Coworking (Accel Analysis LLC). Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of membership or purchase. See SMS Terms and Privacy Policy.";
export const HI_SMS_CONSENT_VERSION = "HC-SMS-CONSENT-v1";

export const SMS_TERMS_PATH = "/sms-terms";
export const SMS_SUPPORT_EMAIL = "hicoworking@accelanalysis.com";

export const SMS_CONSENT_SOURCES = ["member-signup", "preferences", "event-pitch-form", "event-prize-form"] as const;
export type SmsConsentSource = (typeof SMS_CONSENT_SOURCES)[number];

/** Twilio error 21610: the recipient replied STOP (or is otherwise unsubscribed). */
export const TWILIO_OPTED_OUT_ERROR_CODE = 21610;

export type SmsConsentRecord = {
  optIn: boolean;
  phone?: string | null;
  source?: string;
  textVersion?: string;
  consentText?: string;
  consentedAt?: number;
  optedOutAt?: number;
  optOutReason?: string;
  updatedAt?: number;
};

function collapse(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

const FOOTER_PATTERN = /\s*Reply\s+STOP\s+to\s+opt\s+out\.?\s*Msg\s*(?:&|and)\s*data\s+rates\s+may\s+apply\.?/gi;

/**
 * Adds the "Hi Coworking:" sender name when the body doesn't already open
 * with it, and makes the opt-out footer the last sentence exactly once.
 * Idempotent: running it twice returns the same text.
 */
export function enforceSmsCompliance(body: string): string {
  let text = collapse(String(body ?? "").replace(FOOTER_PATTERN, " "));
  if (!text.toLowerCase().startsWith(SMS_SENDER_NAME.toLowerCase())) {
    text = `${SMS_SENDER_PREFIX}${text}`.trim();
  }
  return `${text} ${SMS_OPT_OUT_FOOTER}`.trim();
}

/** US mobile number in E.164 (+1XXXXXXXXXX), or null when it isn't one. */
export function normalizeUsMobile(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null;
  return `+1${ten}`;
}

/** True only for a recorded, current opt-in with a phone number. */
export function hasSmsOptIn(consent: unknown): consent is SmsConsentRecord & { optIn: true; phone: string } {
  if (!consent || typeof consent !== "object") return false;
  const record = consent as SmsConsentRecord;
  return record.optIn === true && typeof record.phone === "string" && record.phone.trim().length > 0;
}

export type SmsCandidate = { uid?: string; phone?: string; smsConsent?: unknown };

/**
 * Send-time gate. Keeps only recipients with a recorded SMS opt-in and
 * returns them with the phone number they consented with. A profile phone
 * alone never qualifies, for announcements, reminders or follow-ups alike.
 */
export function smsEligibleRecipients<T extends SmsCandidate>(recipients: T[]): Array<T & { phone: string }> {
  const seen = new Set<string>();
  const eligible: Array<T & { phone: string }> = [];
  for (const recipient of recipients) {
    if (!hasSmsOptIn(recipient.smsConsent)) continue;
    const phone = normalizeUsMobile(recipient.smsConsent.phone) || recipient.smsConsent.phone.trim();
    if (seen.has(phone)) continue;
    seen.add(phone);
    eligible.push({ ...recipient, phone });
  }
  return eligible;
}

/** The users/{uid}.smsConsent update written when Twilio reports 21610. */
export function twilioOptOutUpdate(now: number): Record<string, unknown> {
  return {
    "smsConsent.optIn": false,
    "smsConsent.optedOutAt": now,
    "smsConsent.optOutReason": `twilio-${TWILIO_OPTED_OUT_ERROR_CODE}`,
    "smsConsent.updatedAt": now,
  };
}
