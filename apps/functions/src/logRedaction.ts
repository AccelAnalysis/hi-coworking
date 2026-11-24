/**
 * Helpers that keep personal data (email addresses) out of Cloud Logging.
 *
 * Kept free of firebase-admin so tests can import them directly.
 */

const EMAIL_IN_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MAX_LOGGED_TEXT = 500;

/** Replaces every email address in free text with "[email]" and trims the text. */
export function redactEmails(text: unknown, maxLength = MAX_LOGGED_TEXT): string {
  const value = typeof text === "string" ? text : text == null ? "" : String(text);
  const redacted = value.replace(EMAIL_IN_TEXT, "[email]");
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}…` : redacted;
}

export type SafeLoggedError = {
  name?: string;
  type?: string;
  code?: string;
  statusCode?: number;
  requestId?: string;
  message: string;
};

/**
 * Reduces an error (for example a Stripe or fetch error, whose raw payload can
 * echo request parameters such as a customer email) to a small, email-free
 * summary that is safe to log.
 */
export function safeErrorForLog(error: unknown): SafeLoggedError {
  if (!error || typeof error !== "object") return { message: redactEmails(error) };
  const source = error as Record<string, unknown>;
  const summary: SafeLoggedError = { message: redactEmails(source.message) };
  if (typeof source.name === "string") summary.name = source.name;
  if (typeof source.type === "string") summary.type = source.type;
  if (typeof source.code === "string") summary.code = redactEmails(source.code, 100);
  if (typeof source.statusCode === "number") summary.statusCode = source.statusCode;
  if (typeof source.requestId === "string") summary.requestId = source.requestId;
  return summary;
}
