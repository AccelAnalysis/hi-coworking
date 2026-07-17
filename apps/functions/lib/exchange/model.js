"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FOUNDING_CAPABILITIES = exports.FREE_CAPABILITIES = exports.CHECKOUT_RESERVATION_MS = exports.CREDIT_EXPIRY_MS = exports.FOUNDING_PRICE_CENTS = exports.FOUNDING_MONTHLY_CREDITS = exports.FOUNDING_MEMBER_LIMIT = void 0;
exports.normalizeOrganizationName = normalizeOrganizationName;
exports.normalizeWebsiteDomain = normalizeWebsiteDomain;
exports.createSearchTokens = createSearchTokens;
exports.scoreOrganizationMatch = scoreOrganizationMatch;
exports.resolveCapabilities = resolveCapabilities;
exports.mapStripeSubscriptionStatus = mapStripeSubscriptionStatus;
exports.calculateUsableCreditBalance = calculateUsableCreditBalance;
exports.allocateFounderNumber = allocateFounderNumber;
exports.planFifoCreditSpend = planFifoCreditSpend;
exports.FOUNDING_MEMBER_LIMIT = 250;
exports.FOUNDING_MONTHLY_CREDITS = 25;
exports.FOUNDING_PRICE_CENTS = 4900;
exports.CREDIT_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;
exports.CHECKOUT_RESERVATION_MS = 30 * 60 * 1000;
exports.FREE_CAPABILITIES = [
    "exchange.profile.manage",
    "exchange.directory.browse",
    "exchange.map.browse",
    "exchange.opportunity.respond",
    "exchange.rfx.respond",
    "exchange.referral.receive",
    "exchange.teaming.respond",
    "exchange.resources.browse",
    "exchange.analytics.basic",
];
exports.FOUNDING_CAPABILITIES = [
    ...exports.FREE_CAPABILITIES,
    "exchange.opportunity.create",
    "exchange.rfx.create",
    "exchange.referral.initiate",
    "exchange.teaming.initiate",
    "exchange.analytics.founder",
    "exchange.founder.badge",
    "exchange.credits.use",
];
function normalizeOrganizationName(value) {
    return value
        .normalize("NFKD")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/\b(incorporated|corporation|company|limited|inc|corp|co|llc|ltd|pllc)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .replace(/\s+/g, " ");
}
function normalizeWebsiteDomain(value) {
    if (!value?.trim())
        return undefined;
    try {
        const url = new URL(value.includes("://") ? value : `https://${value}`);
        return url.hostname.toLowerCase().replace(/^www\./, "");
    }
    catch {
        return undefined;
    }
}
function createSearchTokens(name) {
    const normalized = normalizeOrganizationName(name);
    return [...new Set(normalized.split(" ").filter((token) => token.length >= 2))].slice(0, 20);
}
function scoreOrganizationMatch(input, candidate) {
    let score = 0;
    const reasons = [];
    const inputName = normalizeOrganizationName(input.name);
    const candidateName = normalizeOrganizationName(candidate.name);
    if (inputName && inputName === candidateName) {
        score += 65;
        reasons.push("same normalized name");
    }
    else if (inputName && candidateName && (inputName.includes(candidateName) || candidateName.includes(inputName))) {
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
function resolveCapabilities(plan, status) {
    if (plan === "founding" && (status === "active" || status === "trialing")) {
        return [...exports.FOUNDING_CAPABILITIES];
    }
    return [...exports.FREE_CAPABILITIES];
}
function mapStripeSubscriptionStatus(status) {
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
function calculateUsableCreditBalance(lots, now = Date.now()) {
    return lots.reduce((total, lot) => {
        if (lot.reversed || (lot.expiresAt !== undefined && lot.expiresAt <= now))
            return total;
        return total + Math.max(0, lot.remainingAmount ?? lot.amount);
    }, 0);
}
function allocateFounderNumber(state, existingFounderNumber) {
    if (existingFounderNumber)
        return { founderNumber: existingFounderNumber, ...state };
    if (state.activeCount >= exports.FOUNDING_MEMBER_LIMIT || state.nextFounderNumber > exports.FOUNDING_MEMBER_LIMIT) {
        throw new Error("Founding Member cap reached");
    }
    return {
        founderNumber: state.nextFounderNumber,
        activeCount: state.activeCount + 1,
        nextFounderNumber: state.nextFounderNumber + 1,
    };
}
function planFifoCreditSpend(lots, amount) {
    if (!Number.isInteger(amount) || amount <= 0)
        throw new Error("Spend amount must be a positive integer");
    const ordered = [...lots]
        .filter((lot) => lot.remainingAmount > 0)
        .sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id));
    if (ordered.reduce((sum, lot) => sum + lot.remainingAmount, 0) < amount) {
        throw new Error("Insufficient credits");
    }
    let remaining = amount;
    const plan = [];
    for (const lot of ordered) {
        if (!remaining)
            break;
        const spend = Math.min(remaining, lot.remainingAmount);
        plan.push({ id: lot.id, spend });
        remaining -= spend;
    }
    return plan;
}
