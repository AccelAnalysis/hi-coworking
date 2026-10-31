/**
 * Staff follow-up queue, web side. Jessica (Member & Event Operations) reads
 * it in Admin > Follow-ups. Server code writes the staffFollowUps collection;
 * admins can only read it and mark items done through admin_followUpSetStatus.
 * Items hold ids only (member, booking, visit), never contact details.
 */
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";

export const FOLLOW_UPS_COLLECTION = "staffFollowUps";

export type FollowUpType = "no_checkout" | "no_checkin" | "form1583_paperwork";
export type FollowUpStatus = "open" | "done";

export type FollowUpItem = {
  id: string;
  owner: string;
  ownerTeam?: string;
  type: FollowUpType;
  memberId: string;
  bookingId: string | null;
  visitId: string | null;
  reason: string;
  billingCapAt: number | null;
  status: FollowUpStatus;
  createdAt: number;
  resolvedAt: number | null;
  resolutionNote: string | null;
};

export const FOLLOW_UP_TYPE_LABELS: Record<FollowUpType, string> = {
  no_checkout: "No check-out",
  no_checkin: "No check-in",
  form1583_paperwork: "Form 1583 paperwork",
};

export const adminFollowUpSetStatus = httpsCallable<
  { id: string; status: FollowUpStatus; note?: string },
  { ok: boolean }
>(functions, "admin_followUpSetStatus");

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value && typeof (value as { toMillis: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return null;
}

export function toFollowUpItem(id: string, raw: Record<string, unknown>): FollowUpItem | null {
  const type = raw.type;
  if (type !== "no_checkout" && type !== "no_checkin" && type !== "form1583_paperwork") return null;
  return {
    id,
    owner: String(raw.owner ?? "jessica"),
    ownerTeam: typeof raw.ownerTeam === "string" ? raw.ownerTeam : undefined,
    type,
    memberId: String(raw.memberId ?? ""),
    bookingId: typeof raw.bookingId === "string" ? raw.bookingId : null,
    visitId: typeof raw.visitId === "string" ? raw.visitId : null,
    reason: String(raw.reason ?? ""),
    billingCapAt: asNumber(raw.billingCapAt),
    status: raw.status === "done" ? "done" : "open",
    createdAt: asNumber(raw.createdAt) ?? 0,
    resolvedAt: asNumber(raw.resolvedAt),
    resolutionNote: typeof raw.resolutionNote === "string" ? raw.resolutionNote : null,
  };
}

/** Open items first, oldest first, so nothing waits at the bottom. */
export function sortFollowUps(items: FollowUpItem[]): FollowUpItem[] {
  return [...items].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    return a.status === "open" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
  });
}
