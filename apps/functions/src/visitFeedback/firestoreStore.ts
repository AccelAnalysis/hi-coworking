import * as admin from "firebase-admin";
import { isMarketingSuppressed, oneClickUnsubscribeUrl } from "../providers/marketingPreferences";
import { alreadyInvited, bookingEnd, bookingStart, bookingUserId, type BookingLike, type InvitationLike, type UserLike } from "./eligibility";
import { VISIT_FEEDBACK_COLLECTION } from "./questions";
import { emailHash, type ClaimInviteInput, type VisitFeedbackRecord, type VisitFeedbackStore } from "./store";

const FLAGS = "kioskBookingFlags";

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toBooking(id: string, data: FirebaseFirestore.DocumentData): BookingLike {
  return {
    id,
    status: data.status,
    userId: data.userId,
    guestEmail: data.guestEmail,
    email: data.email,
    userName: data.userName,
    resourceName: data.resourceName,
    start: data.start,
    end: data.end,
    stripeRefundId: data.stripeRefundId,
    cancellationRefundCents: data.cancellationRefundCents,
    refundedAt: data.refundedAt,
    paymentStatus: data.paymentStatus,
    visitFeedbackInvitedAt: data.visitFeedbackInvitedAt,
    visitFeedbackId: data.visitFeedbackId,
  };
}

function toRecord(id: string, data: FirebaseFirestore.DocumentData): VisitFeedbackRecord {
  return {
    id,
    bookingId: str(data.bookingId) || "",
    userId: str(data.userId) ?? null,
    email: str(data.email) || "",
    emailHash: str(data.emailHash) || "",
    firstName: str(data.firstName) || "",
    audience: data.audience === "member" ? "member" : "guest",
    visitStart: num(data.visitStart) || 0,
    visitEnd: num(data.visitEnd) || 0,
    resourceName: str(data.resourceName) || "",
    status: data.status === "sent" || data.status === "failed" || data.status === "submitted" ? data.status : "invited",
    tokenHash: str(data.tokenHash) || id,
    source: str(data.source) || "",
    template: str(data.template) || "",
    invitedAt: num(data.invitedAt) || 0,
    sentAt: num(data.sentAt) ?? null,
    submittedAt: num(data.submittedAt) ?? null,
    messageId: str(data.messageId) ?? null,
    errorCode: str(data.errorCode) ?? null,
    answers: data.answers && typeof data.answers === "object" ? data.answers as VisitFeedbackRecord["answers"] : null,
    nps: num(data.nps) ?? null,
    followupConsent: typeof data.followupConsent === "boolean" ? data.followupConsent : null,
    followupEmail: str(data.followupEmail) ?? null,
    hasBookingEmail: Boolean(data.hasBookingEmail),
    adminNotes: str(data.adminNotes) || "",
    createdAt: num(data.createdAt) || 0,
    updatedAt: num(data.updatedAt) || 0,
  };
}

export function firestoreVisitFeedbackStore(
  db: FirebaseFirestore.Firestore = admin.firestore(),
  env: NodeJS.ProcessEnv = process.env,
): VisitFeedbackStore {
  const bookings = db.collection("bookings");
  const feedback = db.collection(VISIT_FEEDBACK_COLLECTION);
  return {
    async loadBooking(bookingId) {
      const snap = await bookings.doc(bookingId).get();
      return snap.exists ? toBooking(snap.id, snap.data() || {}) : null;
    },
    async loadUser(uid) {
      const snap = await db.collection("users").doc(uid).get();
      return snap.exists ? (snap.data() as UserLike) : null;
    },
    async loadNoShowFlag(bookingId) {
      const snap = await db.collection(FLAGS).doc(bookingId).get();
      return snap.exists ? snap.data()?.status : null;
    },
    async isEmailSuppressed(email) {
      return isMarketingSuppressed(db, email);
    },
    async listPriorInvitations(identity) {
      const seen = new Set<string>();
      const out: InvitationLike[] = [];
      const add = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => {
        for (const doc of docs) {
          if (seen.has(doc.id)) continue;
          seen.add(doc.id);
          const data = doc.data();
          const invitedAt = num(data.invitedAt) || 0;
          if (!invitedAt) continue;
          out.push({
            userId: str(data.userId) ?? null,
            emailHash: str(data.emailHash) ?? null,
            invitedAt,
            bookingId: str(data.bookingId),
          });
        }
      };
      if (identity.userId && !identity.userId.startsWith("guest:")) {
        add((await feedback.where("userId", "==", identity.userId).get()).docs);
      }
      if (identity.emailHash) {
        add((await feedback.where("emailHash", "==", identity.emailHash).get()).docs);
      }
      return out;
    },
    async listBookingsEndingIn(window) {
      const snap = await bookings
        .where("end", ">=", window.start)
        .where("end", "<", window.end)
        .get();
      return snap.docs.map((doc) => toBooking(doc.id, doc.data()));
    },
    async claimInvitation(input: ClaimInviteInput) {
      const bookingRef = bookings.doc(input.booking.id);
      const feedbackRef = feedback.doc(input.tokenHash);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(bookingRef);
        if (!snap.exists) return { claimed: false as const, reason: "not_found" as const };
        const booking = toBooking(snap.id, snap.data() || {});
        if (alreadyInvited(booking)) return { claimed: false as const, reason: "already_invited" as const };
        const now = input.now;
        tx.set(bookingRef, {
          visitFeedbackInvitedAt: now,
          visitFeedbackId: feedbackRef.id,
        }, { merge: true });
        tx.set(feedbackRef, {
          bookingId: booking.id,
          userId: bookingUserId(booking) && !bookingUserId(booking).startsWith("guest:") ? bookingUserId(booking) : null,
          email: input.email,
          emailHash: emailHash(input.email),
          firstName: input.firstName,
          audience: input.audience,
          visitStart: bookingStart(booking),
          visitEnd: bookingEnd(booking),
          resourceName: str(booking.resourceName) || "",
          status: "invited",
          tokenHash: input.tokenHash,
          source: input.source,
          template: input.template,
          invitedAt: now,
          sentAt: null,
          submittedAt: null,
          messageId: null,
          errorCode: null,
          answers: null,
          nps: null,
          followupConsent: null,
          followupEmail: null,
          hasBookingEmail: true,
          adminNotes: "",
          createdAt: now,
          updatedAt: now,
        });
        return { claimed: true as const, id: feedbackRef.id };
      });
    },
    async markSent(id, messageId, now) {
      await feedback.doc(id).set({ status: "sent", sentAt: now, messageId, errorCode: null, updatedAt: now }, { merge: true });
    },
    async markFailed(id, code, now) {
      await feedback.doc(id).set({ status: "failed", errorCode: code, updatedAt: now }, { merge: true });
    },
    async getByTokenHash(tokenHash) {
      const snap = await feedback.doc(tokenHash).get();
      return snap.exists ? toRecord(snap.id, snap.data() || {}) : null;
    },
    async submitAnswers(input) {
      const ref = feedback.doc(input.id);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return "not_found" as const;
        const data = snap.data() || {};
        if (str(data.tokenHash) !== input.tokenHash && snap.id !== input.tokenHash) return "not_found" as const;
        if (data.status === "submitted" || num(data.submittedAt)) return "used" as const;
        tx.set(ref, {
          status: "submitted",
          submittedAt: input.now,
          updatedAt: input.now,
          answers: input.answers,
          nps: input.answers.nps,
          followupConsent: input.answers.followupConsent,
          followupEmail: input.answers.followupConsent ? (input.followupEmail || str(data.email) || null) : null,
        }, { merge: true });
        return "submitted" as const;
      });
    },
    async unsubscribeUrl(email, uid, now) {
      return oneClickUnsubscribeUrl(db, { email, ...(uid ? { uid } : {}) }, now, env);
    },
  };
}
