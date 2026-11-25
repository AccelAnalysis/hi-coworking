import { createHash } from "node:crypto";
import type { Audience, BookingLike, InvitationLike, UserLike } from "./eligibility";
import type { VisitFeedbackAnswers } from "./questions";

export type FeedbackStatus = "invited" | "sent" | "failed" | "submitted";

export type VisitFeedbackRecord = {
  id: string;
  bookingId: string;
  userId: string | null;
  email: string;
  emailHash: string;
  firstName: string;
  audience: Audience;
  visitStart: number;
  visitEnd: number;
  resourceName: string;
  status: FeedbackStatus;
  tokenHash: string;
  source: string;
  template: string;
  invitedAt: number;
  sentAt: number | null;
  submittedAt: number | null;
  messageId: string | null;
  errorCode: string | null;
  answers: VisitFeedbackAnswers | null;
  nps: number | null;
  followupConsent: boolean | null;
  followupEmail: string | null;
  hasBookingEmail: boolean;
  adminNotes: string;
  createdAt: number;
  updatedAt: number;
};

export type ClaimInviteInput = {
  booking: BookingLike;
  user: UserLike | null;
  email: string;
  firstName: string;
  audience: Audience;
  tokenHash: string;
  now: number;
  source: string;
  template: string;
};

export type VisitFeedbackStore = {
  loadBooking(bookingId: string): Promise<BookingLike | null>;
  loadUser(uid: string): Promise<UserLike | null>;
  loadNoShowFlag(bookingId: string): Promise<unknown>;
  isEmailSuppressed(email: string): Promise<boolean>;
  listPriorInvitations(identity: { userId: string; emailHash: string }): Promise<InvitationLike[]>;
  listBookingsEndingIn(window: { start: number; end: number }): Promise<BookingLike[]>;
  /** Atomically creates the invitation if this booking has not been invited. */
  claimInvitation(input: ClaimInviteInput): Promise<{ claimed: true; id: string } | { claimed: false; reason: "already_invited" | "not_found" }>;
  markSent(id: string, messageId: string, now: number): Promise<void>;
  markFailed(id: string, code: string, now: number): Promise<void>;
  getByTokenHash(tokenHash: string): Promise<VisitFeedbackRecord | null>;
  submitAnswers(input: {
    id: string;
    tokenHash: string;
    answers: VisitFeedbackAnswers;
    followupEmail: string | null;
    now: number;
  }): Promise<"submitted" | "used" | "not_found">;
  unsubscribeUrl(email: string, uid: string | undefined, now: number): Promise<string>;
};

export function emailHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}
