import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

if (admin.apps.length === 0) admin.initializeApp();

/**
 * First-visit in-person photo ID check (renter screening, Nov 2026).
 *
 * Staff look at a photo ID in person on the first visit and record ONLY:
 *   users/{uid}.idCheck = { checked, checkedAt, staffInitials, staffUid }
 *
 * Never store an ID image, an ID number, an ID type, an expiry date, a date of
 * birth or a note. The callable accepts exactly { uid, checked, staffInitials }
 * and rejects anything else, so a client cannot slip extra fields in.
 *
 * Writes go through this staff/admin-only callable (Admin SDK); firestore.rules
 * already limits a member's own users/{uid} updates to displayName and
 * membershipTrack. Customer pages never render idCheck.
 *
 * This does not gate bookings or door codes. Staffed-hours gating for a guest's
 * first booking and holding door codes until the check are not built: staffed
 * hours are not modeled, and door/Seam code is off-limits without Jonathan's OK.
 */

export const ID_CHECK_STAFF_ROLES = new Set(["staff", "admin", "master"]);
const ALLOWED_KEYS = new Set(["uid", "checked", "staffInitials"]);
const INITIALS = /^[A-Z]{2,4}$/;

export type IdCheckRecord = {
  checked: boolean;
  checkedAt: number;
  staffInitials: string;
  staffUid: string;
};

export function requireIdCheckStaff(request: Pick<CallableRequest, "auth">): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  const role = String(request.auth.token.role || "");
  if (!ID_CHECK_STAFF_ROLES.has(role)) {
    throw new HttpsError("permission-denied", "Only front-desk staff and admins can record ID checks.");
  }
  return request.auth.uid;
}

/** Strict schema: rejects unknown keys (images, URLs, ID numbers, notes) outright. */
export function parseIdCheckInput(data: unknown): { uid: string; checked: boolean; staffInitials: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpsError("invalid-argument", "Send the member and the check result.");
  }
  const input = data as Record<string, unknown>;
  const extra = Object.keys(input).filter((key) => !ALLOWED_KEYS.has(key));
  if (extra.length) {
    throw new HttpsError("invalid-argument", "Only checked yes/no and staff initials can be recorded. Never send an ID image, number or note.");
  }
  const uid = typeof input.uid === "string" ? input.uid.trim() : "";
  if (!uid || uid.length > 128 || uid.includes("/")) throw new HttpsError("invalid-argument", "A member id is required.");
  if (typeof input.checked !== "boolean") throw new HttpsError("invalid-argument", "Say whether the ID was checked.");
  const staffInitials = typeof input.staffInitials === "string" ? input.staffInitials.trim().toUpperCase() : "";
  if (!INITIALS.test(staffInitials)) {
    throw new HttpsError("invalid-argument", "Enter your initials (2 to 4 letters).");
  }
  return { uid, checked: input.checked, staffInitials };
}

export function buildIdCheck(input: { checked: boolean; staffInitials: string }, staffUid: string, now: number): IdCheckRecord {
  return { checked: input.checked, checkedAt: now, staffInitials: input.staffInitials, staffUid };
}

/** Admin view: yes/no, when and who. Drops anything else that might be on the doc. */
export function idCheckView(raw: unknown): { checked: boolean; checkedAt: number | null; staffInitials: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const initials = typeof value.staffInitials === "string" && INITIALS.test(value.staffInitials) ? value.staffInitials : null;
  return {
    checked: value.checked === true,
    checkedAt: typeof value.checkedAt === "number" && Number.isFinite(value.checkedAt) ? value.checkedAt : null,
    staffInitials: initials,
  };
}

export const staff_setIdCheck = onCall(async (request) => {
  const staffUid = requireIdCheckStaff(request);
  const input = parseIdCheckInput(request.data);
  const db = admin.firestore();
  const userRef = db.collection("users").doc(input.uid);
  const auditRef = db.collection("memberOperationAudit").doc();
  const now = Date.now();
  const idCheck = buildIdCheck(input, staffUid, now);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new HttpsError("not-found", "No member has that id.");
    tx.update(userRef, { idCheck, updatedAt: now });
    tx.create(auditRef, {
      id: auditRef.id,
      action: input.checked ? "id_check_recorded" : "id_check_cleared",
      memberUid: input.uid,
      adminUid: staffUid,
      details: { toStatus: input.checked ? "checked" : "not_checked" },
      createdAt: now,
    });
  });
  return { idCheck: idCheckView(idCheck) };
});
