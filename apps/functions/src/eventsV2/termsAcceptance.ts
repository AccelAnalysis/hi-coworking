import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { adminEventCallableOptions } from "./adminEventCors";
import { db } from "./core";
import {
  HI_TERMS_TEXT,
  HI_TERMS_VERSION,
  TERMS_ACCEPTANCE_SOURCES,
  type TermsAcceptanceRecord,
  type TermsAcceptanceSource,
} from "../providers/termsCompliance";

/**
 * Records that a member accepted the Terms of Service and Privacy Policy.
 *
 * /register calls this right after the Firebase Auth account is created.
 * The server checks the version and writes users/{uid}.termsAcceptance with
 * the server time. Members cannot write these fields themselves
 * (firestore.rules limits owner updates to displayName and membershipTrack).
 *
 * It writes with merge, so it works whether or not authProvisionOnCreate has
 * created users/{uid} yet. That trigger only fills fields that are missing,
 * so neither write overwrites the other. Ships in the admin-event-save bundle
 * next to members_setSmsConsent (no Twilio, LinkedIn or X secrets).
 */
export function buildTermsAcceptance(
  input: { accepted?: unknown; version?: unknown; source?: unknown },
  now: number,
): TermsAcceptanceRecord {
  if (input.accepted !== true) {
    throw new HttpsError("invalid-argument", "Please accept the Terms of Service and Privacy Policy.");
  }
  const source = String(input.source || "") as TermsAcceptanceSource;
  if (!TERMS_ACCEPTANCE_SOURCES.includes(source)) {
    throw new HttpsError("invalid-argument", "Unknown acceptance source.");
  }
  if (input.version !== HI_TERMS_VERSION) {
    throw new HttpsError("failed-precondition", "Please reload the page and try again.");
  }
  return { version: HI_TERMS_VERSION, text: HI_TERMS_TEXT, source, acceptedAt: now };
}

export function termsAcceptanceUpdate(record: TermsAcceptanceRecord, uid: string, now: number) {
  return {
    uid,
    termsAcceptance: record,
    termsAcceptanceHistory: FieldValue.arrayUnion({
      version: record.version,
      source: record.source,
      at: record.acceptedAt,
    }),
    updatedAt: now,
  };
}

export const members_acceptTerms = onCall(adminEventCallableOptions, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in to accept the Terms of Service.");
  const now = Date.now();
  const record = buildTermsAcceptance((request.data || {}) as Record<string, unknown>, now);
  await db().collection("users").doc(uid).set(termsAcceptanceUpdate(record, uid, now), { merge: true });
  return { version: record.version, acceptedAt: record.acceptedAt };
});
