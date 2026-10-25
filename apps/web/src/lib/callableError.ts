/**
 * Message to show an admin when a Firebase callable fails.
 *
 * The admin membership callables throw HttpsError with plain, accurate copy
 * for expected refusals (failed-precondition, invalid-argument,
 * not-found, already-exists). Show that copy instead of a generic guess so
 * the admin knows what actually happened. Anything else (internal errors,
 * network failures) falls back to the caller's generic message, so server
 * internals are never echoed.
 */
const USER_FACING_CODES = new Set([
  "functions/failed-precondition",
  "functions/invalid-argument",
  "functions/not-found",
  "functions/already-exists",
  "functions/permission-denied",
]);

export function callableErrorMessage(caught: unknown, fallback: string): string {
  if (!caught || typeof caught !== "object") return fallback;
  const { code, message } = caught as { code?: unknown; message?: unknown };
  if (typeof code !== "string" || !USER_FACING_CODES.has(code)) return fallback;
  if (typeof message !== "string") return fallback;
  const trimmed = message.trim();
  if (!trimmed || trimmed.length > 400) return fallback;
  return trimmed;
}
