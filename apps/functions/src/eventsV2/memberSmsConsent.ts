import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { adminEventCallableOptions } from "./adminEventCors";
import { db } from "./core";
import {
  HI_SMS_CONSENT_TEXT,
  HI_SMS_CONSENT_VERSION,
  normalizeUsMobile,
  type SmsConsentRecord,
} from "../providers/smsCompliance";

/**
 * Member SMS opt-in and opt-out (sign-up and /preferences).
 *
 * Writes users/{uid}.smsConsent with the server time, the source, the phone
 * the member consented with, and the exact consent wording and version.
 * Optional: nothing else in the account depends on it. It ships in the
 * admin-event-save bundle so it deploys without the Twilio, LinkedIn or X
 * secrets.
 */
export const MEMBER_SMS_SOURCES = ["member-signup", "preferences"] as const;
type MemberSmsSource = (typeof MEMBER_SMS_SOURCES)[number];

export function buildMemberSmsConsent(
  input: { optIn?: unknown; phone?: unknown; source?: unknown; textVersion?: unknown },
  now: number,
  previous?: SmsConsentRecord | null,
): SmsConsentRecord {
  const source = String(input.source || "") as MemberSmsSource;
  if (!MEMBER_SMS_SOURCES.includes(source)) {
    throw new HttpsError("invalid-argument", "Unknown consent source.");
  }
  if (input.optIn !== true) {
    return {
      optIn: false,
      phone: previous?.phone ?? null,
      source,
      textVersion: HI_SMS_CONSENT_VERSION,
      consentText: HI_SMS_CONSENT_TEXT,
      ...(previous?.consentedAt ? { consentedAt: previous.consentedAt } : {}),
      optedOutAt: now,
      optOutReason: "member-request",
      updatedAt: now,
    };
  }
  if (input.textVersion !== HI_SMS_CONSENT_VERSION) {
    throw new HttpsError("failed-precondition", "Please reload the page and try again.");
  }
  const phone = normalizeUsMobile(input.phone);
  if (!phone) {
    throw new HttpsError("invalid-argument", "Enter a 10-digit US mobile number.");
  }
  return {
    optIn: true,
    phone,
    source,
    textVersion: HI_SMS_CONSENT_VERSION,
    consentText: HI_SMS_CONSENT_TEXT,
    consentedAt: now,
    updatedAt: now,
  };
}

export const members_setSmsConsent = onCall(adminEventCallableOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to update text message preferences.");
  const ref = db().collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Your account is still being set up. Please try again in a moment.");
  const previous = (snap.data()?.smsConsent ?? null) as SmsConsentRecord | null;
  const now = Date.now();
  const smsConsent = buildMemberSmsConsent((request.data || {}) as Record<string, unknown>, now, previous);
  await ref.update({
    smsConsent,
    smsConsentHistory: FieldValue.arrayUnion({
      optIn: smsConsent.optIn,
      source: smsConsent.source,
      textVersion: smsConsent.textVersion,
      at: now,
    }),
    updatedAt: now,
  });
  return { optIn: smsConsent.optIn, phone: smsConsent.phone ?? null, updatedAt: now };
});
