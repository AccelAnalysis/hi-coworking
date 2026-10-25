/**
 * Message to show when a Firebase callable fails.
 *
 * Callables throw HttpsError with plain, accurate copy for expected refusals
 * (failed-precondition, invalid-argument, not-found, already-exists,
 * permission-denied). Show that copy instead of a generic guess so the admin
 * knows what actually happened.
 *
 * Transport-level failures get a short explanation appended to the caller's
 * fallback, so "internal" never reaches the screen on its own:
 * - The SDK reports a failed fetch (CORS refusal, a function that was never
 *   deployed, a dropped connection) as code "internal" with the lowercase
 *   message "internal".
 * - A missing endpoint that answers 404 without a JSON body is "not-found"
 *   with no server copy.
 * Real server errors (uppercase "INTERNAL") fall back to the caller's copy,
 * so server internals are never echoed.
 */
const USER_FACING_CODES = new Set([
  "functions/failed-precondition",
  "functions/invalid-argument",
  "functions/not-found",
  "functions/already-exists",
  "functions/permission-denied",
]);

export const NOT_SWITCHED_ON =
  "This tool may not be switched on yet, or the connection dropped. Check your connection and try again; if it keeps happening, tell the site owner.";

const CODE_HINTS: Record<string, string> = {
  "functions/unauthenticated": "Your sign-in has expired. Sign in again, then retry.",
  "functions/resource-exhausted": "Too many attempts in a short time. Wait a minute, then try again.",
  "functions/unavailable": "The service didn't respond. Check your connection and try again.",
  "functions/deadline-exceeded": "The service took too long to respond. Check whether the change went through before retrying.",
};

function withHint(fallback: string, hint: string): string {
  const base = fallback.trim();
  if (!base) return hint;
  return /[.!?]$/.test(base) ? `${base} ${hint}` : `${base}. ${hint}`;
}

export function callableErrorMessage(caught: unknown, fallback: string): string {
  if (!caught || typeof caught !== "object") return fallback;
  const { code, message } = caught as { code?: unknown; message?: unknown };
  if (typeof code !== "string") return fallback;
  const trimmed = typeof message === "string" ? message.trim() : "";

  // Transport failures: no server copy to show.
  if (code === "functions/internal" && trimmed === "internal") return withHint(fallback, NOT_SWITCHED_ON);
  if (code === "functions/not-found" && (trimmed === "not-found" || trimmed === "NOT_FOUND" || !trimmed)) {
    return withHint(fallback, NOT_SWITCHED_ON);
  }
  if (CODE_HINTS[code]) return withHint(fallback, CODE_HINTS[code]);

  if (!USER_FACING_CODES.has(code)) return fallback;
  if (!trimmed || trimmed.length > 400) return fallback;
  return trimmed;
}
