import * as admin from "firebase-admin";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { queueFollowUp } from "../followUps/store";
import { virtualAddressEnabled } from "./config";

/**
 * Create your account (step 3): company name and phone. Stored server-side
 * in accountDetails/{uid} so the users doc keeps its existing provisioning
 * transaction and client write rules. Owner and staff can read it; clients
 * can't write it directly.
 */
export const ACCOUNT_DETAILS_COLLECTION = "accountDetails";

export function normalizeAccountDetails(data: unknown): { company: string; phone: string } {
  const input = (data || {}) as { company?: unknown; phone?: unknown };
  const company = typeof input.company === "string" ? input.company.replace(/\s+/g, " ").trim() : "";
  const rawPhone = typeof input.phone === "string" ? input.phone.trim() : "";
  const digits = rawPhone.replace(/\D/g, "");
  if (company.length > 120) throw new HttpsError("invalid-argument", "Use a shorter company name.");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) throw new HttpsError("invalid-argument", "Enter a 10-digit phone number.");
  return { company, phone: `+1${national}` };
}

export const members_saveAccountDetails = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const details = normalizeAccountDetails(request.data);
  await admin.firestore().collection(ACCOUNT_DETAILS_COLLECTION).doc(request.auth.uid).set(
    { ...details, updatedAt: Date.now() },
    { merge: true },
  );
  return { ok: true };
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
