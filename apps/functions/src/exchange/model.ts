export const FOUNDING_MEMBER_LIMIT = 250;
export const FOUNDING_MONTHLY_CREDITS = 25;
export const FOUNDING_PRICE_CENTS = 4900;
export const CHECKOUT_RESERVATION_MS = 30 * 60 * 1000;

export function calculateCreditExpiration(effectiveAt: number): number {
  const source = new Date(effectiveAt);
  if (!Number.isFinite(source.getTime())) throw new Error("Invalid credit effective timestamp");
  const targetYear = source.getUTCFullYear() + 1;
  const targetMonth = source.getUTCMonth();
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return Date.UTC(
    targetYear,
    targetMonth,
    Math.min(source.getUTCDate(), lastDayOfTargetMonth),
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds(),
  );
}

export type ExchangePlan = "free" | "founding";
export type ExchangeMembershipStatus =
  | "free"
  | "checkout_pending"
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "suspended";

export const FREE_CAPABILITIES = [
  "exchange.profile.manage",
  "exchange.directory.browse",
  "exchange.map.browse",
  "exchange.opportunity.respond",
  "exchange.rfx.respond",
  "exchange.referral.receive",
  "exchange.teaming.respond",
  "exchange.resources.browse",
  "exchange.analytics.basic",
] as const;

export const FOUNDING_CAPABILITIES = [
  ...FREE_CAPABILITIES,
  "exchange.opportunity.create",
  "exchange.rfx.create",
  "exchange.referral.initiate",
  "exchange.teaming.initiate",
  "exchange.analytics.founder",
  "exchange.founder.badge",
  "exchange.credits.use",
] as const;

export function normalizeOrganizationName(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(incorporated|corporation|company|limited|inc|corp|co|llc|ltd|pllc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeWebsiteDomain(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export function createSearchTokens(name: string): string[] {
  const normalized = normalizeOrganizationName(name);
  return [...new Set(normalized.split(" ").filter((token) => token.length >= 2))].slice(0, 20);
}

export function scoreOrganizationMatch(
  input: { name: string; city?: string; state?: string; website?: string; sourceIds?: Record<string, string> },
  candidate: { name: string; city?: string; state?: string; website?: string; websiteDomain?: string; sourceIds?: Record<string, string> }
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const inputName = normalizeOrganizationName(input.name);
  const candidateName = normalizeOrganizationName(candidate.name);

  if (inputName && inputName === candidateName) {
    score += 65;
    reasons.push("same normalized name");
  } else if (inputName && candidateName && (inputName.includes(candidateName) || candidateName.includes(inputName))) {
    score += 35;
    reasons.push("similar name");
  }

  if (input.city && candidate.city && input.city.trim().toLowerCase() === candidate.city.trim().toLowerCase()) {
    score += 12;
    reasons.push("same city");
  }
  if (input.state && candidate.state && input.state.trim().toLowerCase() === candidate.state.trim().toLowerCase()) {
    score += 8;
    reasons.push("same state");
  }

  const inputDomain = normalizeWebsiteDomain(input.website);
  const candidateDomain = candidate.websiteDomain || normalizeWebsiteDomain(candidate.website);
  if (inputDomain && candidateDomain && inputDomain === candidateDomain) {
    score += 30;
    reasons.push("same website domain");
  }

  for (const [system, identifier] of Object.entries(input.sourceIds || {})) {
    if (identifier && candidate.sourceIds?.[system] === identifier) {
      score += 100;
      reasons.push(`same ${system} identifier`);
      break;
    }
  }

  return { score: Math.min(score, 100), reasons };
}

export function resolveCapabilities(plan: ExchangePlan, status: ExchangeMembershipStatus): string[] {
  if (plan === "founding" && (status === "active" || status === "trialing")) {
    return [...FOUNDING_CAPABILITIES];
  }
  return [...FREE_CAPABILITIES];
}

export function mapStripeSubscriptionStatus(status: string): ExchangeMembershipStatus {
  switch (status) {
    case "active": return "active";
    case "trialing": return "trialing";
    case "past_due":
    case "unpaid": return "past_due";
    case "canceled":
    case "incomplete_expired": return "canceled";
    case "incomplete": return "incomplete";
    case "paused": return "suspended";
    default: return "incomplete";
  }
}

export function calculateUsableCreditBalance(
  lots: Array<{ amount: number; remainingAmount?: number; expiresAt?: number; reversed?: boolean }>,
  now = Date.now()
): number {
  return lots.reduce((total, lot) => {
    if (lot.reversed || (lot.expiresAt !== undefined && lot.expiresAt <= now)) return total;
    return total + Math.max(0, lot.remainingAmount ?? lot.amount);
  }, 0);
}

export function allocateFounderNumber(state: {
  activeCount: number;
  nextFounderNumber: number;
}, existingFounderNumber?: number): {
  founderNumber: number;
  activeCount: number;
  nextFounderNumber: number;
} {
  if (existingFounderNumber) return { founderNumber: existingFounderNumber, ...state };
  if (state.activeCount >= FOUNDING_MEMBER_LIMIT || state.nextFounderNumber > FOUNDING_MEMBER_LIMIT) {
    throw new Error("Founding Member cap reached");
  }
  return {
    founderNumber: state.nextFounderNumber,
    activeCount: state.activeCount + 1,
    nextFounderNumber: state.nextFounderNumber + 1,
  };
}

export function planFifoCreditSpend(
  lots: Array<{ id: string; remainingAmount: number; expiresAt: number }>,
  amount: number
): Array<{ id: string; spend: number }> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Spend amount must be a positive integer");
  const ordered = [...lots]
    .filter((lot) => lot.remainingAmount > 0)
    .sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id));
  if (ordered.reduce((sum, lot) => sum + lot.remainingAmount, 0) < amount) {
    throw new Error("Insufficient credits");
  }
  let remaining = amount;
  const plan: Array<{ id: string; spend: number }> = [];
  for (const lot of ordered) {
    if (!remaining) break;
    const spend = Math.min(remaining, lot.remainingAmount);
    plan.push({ id: lot.id, spend });
    remaining -= spend;
  }
  return plan;
}
