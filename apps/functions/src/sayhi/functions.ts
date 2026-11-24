import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { queueFollowUp } from "../followUps/store";
import { virtualAddressEnabled } from "./config";
import {
  hasBusinessProfileInput,
  validateBusinessProfile,
  type BusinessProfile,
  type BusinessProfileInput,
} from "../providers/businessProfile";

/**
 * Create your account (step 3) and the profile page: phone plus the business
 * profile (renter screening). Stored server-side in accountDetails/{uid} so
 * the users doc keeps its existing provisioning transaction and client write
 * rules. Owner and staff can read it; clients can't write it directly.
 *
 * The business name reuses the existing `company` field. A legacy save that
 * only sends {company, phone} still works (company stays optional there), so
 * older web builds and existing members are not broken. Any save that carries
 * the new business fields must send the full, valid profile.
 */
export const ACCOUNT_DETAILS_COLLECTION = "accountDetails";

export type AccountDetailsUpdate = { company: string; phone: string } | ({ phone: string } & BusinessProfile);

function normalizePhone(raw: unknown): string {
  const rawPhone = typeof raw === "string" ? raw.trim() : "";
  const digits = rawPhone.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) throw new HttpsError("invalid-argument", "Enter a 10-digit phone number.");
  return `+1${national}`;
}

export function normalizeAccountDetails(data: unknown): AccountDetailsUpdate {
  const input = (data || {}) as Record<string, unknown>;
  if (hasBusinessProfileInput(input)) {
    const profile = validateBusinessProfile(input as BusinessProfileInput);
    if (!profile.ok) throw new HttpsError("invalid-argument", profile.message, { field: profile.field });
    return { ...profile.value, phone: normalizePhone(input.phone) };
  }
  const company = typeof input.company === "string" ? input.company.replace(/\s+/g, " ").trim() : "";
  if (company.length > 120) throw new HttpsError("invalid-argument", "Use a shorter company name.");
  return { company, phone: normalizePhone(input.phone) };
}

export const members_saveAccountDetails = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const details = normalizeAccountDetails(request.data);
  const now = Date.now();
  await admin.firestore().collection(ACCOUNT_DETAILS_COLLECTION).doc(request.auth.uid).set(
    {
      ...details,
      ...("role" in details ? { businessProfileUpdatedAt: now } : {}),
      updatedAt: now,
    },
    { merge: true },
  );
  return { ok: true, businessProfileComplete: "role" in details };
});

/**
 * Form 1583 paperwork (virtual address only, OFF by default). The customer
 * tells us their form and both IDs are ready; Jessica (Member & Event
 * Operations) gets a follow-up to schedule the live confirmation and check
 * the paperwork. The live signature confirmation is done by a person (the
 * owner, a staff member or a notary), never by software. Stores status only;
 * no form contents or ID images pass through here.
 */
export const VA_APPLICATIONS_COLLECTION = "vaApplications";

export const va_submitForm1583 = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  if (!virtualAddressEnabled()) {
    throw new HttpsError("failed-precondition", "This isn't available yet.");
  }
  const uid = request.auth.uid;
  const now = Date.now();
  await admin.firestore().collection(VA_APPLICATIONS_COLLECTION).doc(uid).set(
    { status: "paperwork_submitted", submittedAt: now, updatedAt: now },
    { merge: true },
  );
  await queueFollowUp({ type: "form1583_paperwork", memberId: uid, now });
  return { ok: true };
});
