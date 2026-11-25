/**
 * Public callables for the post-attendance survey page.
 * Token in, visit date out. No name or email is returned. Single-use submit.
 * These functions do not bind the Resend secret so they can ship in core.
 */
import { HttpsError, onCall } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { formatVisitDate } from "./eligibility";
import { validateVisitFeedbackAnswers } from "./questions";
import { firestoreVisitFeedbackStore } from "./firestoreStore";
import type { VisitFeedbackStore } from "./store";
import { isWellFormedVisitFeedbackToken, visitFeedbackTokenHash } from "./tokens";

export type GetInvitationResult =
  | { ok: true; visitDate: string; hasEmail: boolean }
  | { ok: false; reason: "invalid" | "used" };

export type SubmitResult = { ok: true } | { ok: false; reason: "invalid" | "used" | "invalid_answers"; error?: string };

export async function getVisitFeedbackInvitation(
  token: unknown,
  store: VisitFeedbackStore = firestoreVisitFeedbackStore(),
): Promise<GetInvitationResult> {
  if (!isWellFormedVisitFeedbackToken(token)) return { ok: false, reason: "invalid" };
  const record = await store.getByTokenHash(visitFeedbackTokenHash(token));
  if (!record) return { ok: false, reason: "invalid" };
  if (record.status === "submitted" || record.submittedAt) return { ok: false, reason: "used" };
  return {
    ok: true,
    visitDate: formatVisitDate(record.visitStart || record.visitEnd),
    hasEmail: Boolean(record.hasBookingEmail || record.email),
  };
}

export async function submitVisitFeedback(
  input: { token: unknown; answers: unknown },
  store: VisitFeedbackStore = firestoreVisitFeedbackStore(),
  now = Date.now(),
): Promise<SubmitResult> {
  if (!isWellFormedVisitFeedbackToken(input.token)) return { ok: false, reason: "invalid" };
  const tokenHash = visitFeedbackTokenHash(input.token);
  const record = await store.getByTokenHash(tokenHash);
  if (!record) return { ok: false, reason: "invalid" };
  if (record.status === "submitted" || record.submittedAt) return { ok: false, reason: "used" };
  const validated = validateVisitFeedbackAnswers(input.answers, Boolean(record.hasBookingEmail || record.email));
  if (!validated.ok) return { ok: false, reason: "invalid_answers", error: validated.error };
  const followupEmail = validated.answers.followupConsent
    ? (validated.answers.followupEmail || record.email || null)
    : null;
  const result = await store.submitAnswers({
    id: record.id,
    tokenHash,
    answers: validated.answers,
    followupEmail,
    now,
  });
  if (result === "used") return { ok: false, reason: "used" };
  if (result === "not_found") return { ok: false, reason: "invalid" };
  return { ok: true };
}

export const visitFeedback_getInvitation = onCall(
  { memory: "256MiB", timeoutSeconds: 30 },
  async (request) => {
    try {
      const token = request.data && typeof request.data === "object" ? (request.data as { token?: unknown }).token : undefined;
      return await getVisitFeedbackInvitation(token);
    } catch (error) {
      logger.error("visitFeedback_getInvitation failed", { error: error instanceof Error ? error.name : "error" });
      throw new HttpsError("internal", "Please try again in a minute.");
    }
  },
);

export const visitFeedback_submit = onCall(
  { memory: "256MiB", timeoutSeconds: 30 },
  async (request) => {
    try {
      const data = request.data && typeof request.data === "object" ? request.data as { token?: unknown; answers?: unknown } : {};
      const result = await submitVisitFeedback({ token: data.token, answers: data.answers });
      if (!result.ok && result.reason === "invalid_answers") {
        throw new HttpsError("invalid-argument", result.error || "Please check your answers and try again.");
      }
      return result;
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      logger.error("visitFeedback_submit failed", { error: error instanceof Error ? error.name : "error" });
      throw new HttpsError("internal", "Please try again in a minute.");
    }
  },
);
