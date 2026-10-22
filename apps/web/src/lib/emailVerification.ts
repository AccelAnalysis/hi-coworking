export type VerificationResult = { ok: boolean; message: string; retryAt: number };

/** Explicit-action controller: constructing/rendering it never sends email. */
export function createVerificationController(options: {
  isVerified: () => boolean;
  send: () => Promise<void>;
  now?: () => number;
  retryAt?: number;
  onCooldown?: (until: number) => void;
}) {
  const now = options.now || Date.now;
  let retryAt = options.retryAt || 0;
  let inFlight = false;
  return {
    getRetryAt: () => retryAt,
    async request(): Promise<VerificationResult> {
      if (options.isVerified()) return { ok: true, message: "Your email is already verified.", retryAt };
      if (inFlight || now() < retryAt) return { ok: false, message: "Please wait before requesting another verification email.", retryAt };
      inFlight = true;
      retryAt = now() + 60_000;
      options.onCooldown?.(retryAt);
      try {
        await options.send();
        return { ok: true, message: "Verification email requested. Check your inbox and spam folder, then refresh your status here.", retryAt };
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code === "auth/too-many-requests") {
          retryAt = now() + 5 * 60_000;
          options.onCooldown?.(retryAt);
        }
        return { ok: false, message: code === "auth/too-many-requests"
          ? "Too many requests. Please wait a few minutes before trying again."
          : code === "auth/requires-recent-login"
            ? "Please sign in again before requesting verification. Your bookings remain saved."
            : "We could not request the verification email. Please try again after the cooldown or contact support.", retryAt };
      } finally { inFlight = false; }
    },
  };
}
