/**
 * What the SayHi page shows for one booking's door code. The full code only
 * ever comes from access_getMyGrants for the signed-in owner, while the
 * booking is still current. Customer copy never mentions email or how the
 * code is delivered (approved Oct 30, 2026, 6:41 PM).
 */
export type AccessGrantSummary = {
  grantId: string;
  bookingId: string;
  doorName: string;
  startsAt: number;
  endsAt: number;
  grantStatus: string;
  codeStatus: string | null;
  codeLast2: string | null;
  codeId: string | null;
  /** Full per-booking code. Null until it is ready, or after the booking ends. */
  code?: string | null;
};

export type AccessCodeView =
  | { kind: "loading"; text: string }
  | { kind: "code"; code: string; spoken: string; text: string }
  | { kind: "pending"; text: string }
  | { kind: "attention"; text: string }
  | { kind: "ended"; text: string };

export const ACCESS_CODE_HINT =
  "Use this code on the door keypad. It works only during this booking and checks you in.";

export function accessCodeView(
  access: AccessGrantSummary | undefined,
  options: { loading?: boolean; now?: number } = {},
): AccessCodeView {
  if (options.loading) return { kind: "loading", text: "Loading your access code…" };
  if (!access) return { kind: "pending", text: "Your access code will appear here before your booking starts." };
  if (access.codeStatus === "failed" || access.grantStatus === "failed") {
    return {
      kind: "attention",
      text: "Your booking is confirmed. We're finishing your access code. Contact us if it isn't here before you arrive.",
    };
  }
  const now = options.now ?? Date.now();
  if (now > 0 && access.endsAt <= now) return { kind: "ended", text: "This booking has ended." };
  const code = typeof access.code === "string" ? access.code.trim() : "";
  if (code && /^[0-9]{4,12}$/.test(code)) {
    return {
      kind: "code",
      code,
      spoken: code.split("").join(" "),
      text: ACCESS_CODE_HINT,
    };
  }
  return { kind: "pending", text: "Your access code will appear here before your booking starts." };
}
