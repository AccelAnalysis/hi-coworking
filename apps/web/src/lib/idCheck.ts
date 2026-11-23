import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

/**
 * Staff/admin-only: records the first-visit in-person photo ID check.
 * Sends ONLY { uid, checked, staffInitials }. Never an ID image, ID number,
 * ID type or note; the server rejects any other field.
 */
export type IdCheckView = { checked: boolean; checkedAt: number | null; staffInitials: string | null };

export const setIdCheck = httpsCallable<
  { uid: string; checked: boolean; staffInitials: string },
  { idCheck: IdCheckView | null }
>(functions, "staff_setIdCheck");

export function cleanInitials(value: string) {
  return value.replace(/[^A-Za-z]/g, "").slice(0, 4).toUpperCase();
}
