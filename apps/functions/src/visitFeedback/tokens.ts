import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 192-bit token, same shape as marketing unsubscribe tokens. */
export function newVisitFeedbackToken(): string {
  return randomBytes(24).toString("hex");
}

export function isWellFormedVisitFeedbackToken(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{48}$/.test(token);
}

export function visitFeedbackTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenHashEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}
