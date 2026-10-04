import * as logger from "firebase-functions/logger";
import { defineString } from "firebase-functions/params";
import { PUBLIC_SITE_URL } from "./types";

/**
 * Optional listener for a successful Attend, Apply to pitch, or Offer a prize.
 * An empty value skips the POST. The submission is already saved by then.
 */
export const EVENT_SUBMISSION_WEBHOOK_URL = defineString("EVENT_SUBMISSION_WEBHOOK_URL", {
  default: "",
  description: "Optional URL that receives a JSON POST after a successful event submission. Leave empty to skip.",
});

export const EVENT_SUBMISSION_WEBHOOK_AUTHORIZATION = defineString("EVENT_SUBMISSION_WEBHOOK_AUTHORIZATION", {
  default: "",
  description: "Optional Authorization header for the submission webhook. Leave empty to POST without that header.",
});

export const ADMIN_EVENT_SUBMISSIONS_PATH = "/admin/events/submissions";

export type EventSubmissionAction = "attend" | "apply_to_pitch" | "offer_prize";

export function eventSubmissionAdminReviewUrl() {
  return `${PUBLIC_SITE_URL.replace(/\/$/, "")}${ADMIN_EVENT_SUBMISSIONS_PATH}`;
}

export async function notifyEventSubmission(input: {
  eventName: string;
  action: EventSubmissionAction;
  name: string;
  email: string;
}) {
  let url = "";
  try {
    url = EVENT_SUBMISSION_WEBHOOK_URL.value().trim();
  } catch (error) {
    logger.error("Event submission webhook param could not be read", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (!url) return;
  let authorization = "";
  try {
    authorization = EVENT_SUBMISSION_WEBHOOK_AUTHORIZATION.value().trim();
  } catch (error) {
    logger.error("Event submission webhook authorization param could not be read", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization) headers.Authorization = authorization;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        eventName: input.eventName,
        action: input.action,
        name: input.name,
        email: input.email,
        adminReviewUrl: eventSubmissionAdminReviewUrl(),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      logger.error("Event submission webhook returned a non-success status", {
        status: response.status,
        action: input.action,
      });
    }
  } catch (error) {
    logger.error("Event submission webhook failed", {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
