import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

/**
 * Front-desk iPad kiosk client. Every read and write goes through these
 * callables; the kiosk collections are closed to clients in firestore.rules.
 */

export type KioskSettings = { idleLogoMinutes: number; logoSeconds: number };
export type BookedWindow = { start: number; end: number } | null;

export type KioskSession = { deviceLabel: string; settings: KioskSettings; serverNow: number };
export type KioskLookup = { lookupId: string; memberLabel: string; checkedIn: boolean; checkedInAt: number | null };

export type CheckInResult =
  | {
      status: "checked_in";
      visitId: string;
      firstName: string;
      memberLabel: string;
      checkInAt: number;
      planName: string | null;
      remainingMonthlyMinutes: number | null;
      bookedWindow: BookedWindow;
    }
  | { status: "already_checked_in"; firstName: string; memberLabel: string; checkInAt: number };

export type CheckOutResult =
  | {
      status: "checked_out";
      visitId: string;
      firstName: string;
      memberLabel: string;
      checkInAt: number;
      checkOutAt: number;
      actualMinutes: number;
      allowanceSource: "booking" | "monthly" | "none";
      allowanceMinutes: number;
      overageMinutes: number;
    }
  | { status: "not_checked_in"; firstName: string; memberLabel: string };

export type VisitSummary = {
  visitId: string;
  status: "open" | "closed" | "auto_closed" | "staff_closed";
  memberLabel: string;
  uid: string;
  dayKey: string;
  checkInAt: number;
  checkOutAt: number | null;
  allowanceSource: "booking" | "monthly" | "none";
  allowanceMinutes: number;
  bookedWindow: BookedWindow;
  actualMinutes: number | null;
  overageMinutes: number | null;
  rateCents: number;
  rateSource: "plan" | "guest" | null;
  needsReview: boolean;
  reviewReason: string | null;
  closeReason: string | null;
  alertReason: string | null;
};

export type KioskOverview = {
  today: string;
  openVisits: VisitSummary[];
  needsReview: VisitSummary[];
  todayVisits: VisitSummary[];
  alerts: Array<{ alertId: string; visitId: string; uid: string; memberLabel: string; reason: string; label: string; createdAt: number }>;
  flags: Array<{ bookingId: string; uid: string; memberLabel: string; status: "late" | "no_show" | "arrived_late"; start: number; end: number }>;
  settings: KioskSettings;
  devices: Array<{ uid: string; label: string; enabled: boolean }> | null;
};

export type MemberKioskSummary = {
  monthKey: string;
  visits: Array<{ visitId: string; status: string; checkInAt: number; checkOutAt: number | null; actualMinutes: number | null; overageMinutes: number | null; needsReview: boolean }>;
  totalOverageMinutes: number;
};

type Empty = Record<string, never>;

export const kioskSession = httpsCallable<Empty, KioskSession>(functions, "kiosk_session");
export const kioskLookupMember = httpsCallable<{ query: string }, KioskLookup>(functions, "kiosk_lookupMember");
export const kioskCheckIn = httpsCallable<{ lookupId: string; requestId: string }, CheckInResult>(functions, "kiosk_checkIn");
export const kioskCheckOut = httpsCallable<{ lookupId: string; requestId: string }, CheckOutResult>(functions, "kiosk_checkOut");

export const adminKioskOverview = httpsCallable<Empty, KioskOverview>(functions, "admin_kioskOverview");
export const adminKioskCloseVisit = httpsCallable<{ visitId: string; checkOutAt: number; reason: string }, { ok: true; overageMinutes: number; actualMinutes: number }>(functions, "admin_kioskCloseVisit");
export const adminKioskResolveAlert = httpsCallable<{ alertId: string; note?: string }, { ok: true }>(functions, "admin_kioskResolveAlert");
export const adminKioskSetSettings = httpsCallable<KioskSettings, { ok: true; settings: KioskSettings }>(functions, "admin_kioskSetSettings");
export const adminKioskDeviceSet = httpsCallable<{ uid: string; action: "enroll" | "revoke"; label?: string }, { ok: true }>(functions, "admin_kioskDeviceSet");

export const membersKioskSummary = httpsCallable<Empty, MemberKioskSummary>(functions, "members_kioskSummary");

export * from "./frontDeskKioskFormat";
