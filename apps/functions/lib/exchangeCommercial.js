"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exchange_adminGetLaunchDashboard = exports.exchange_adminUpdateCommercialPolicy = exports.exchange_expireCredits = exports.exchange_adminAdjustCredits = exports.exchange_spendCredits = exports.exchange_getOrganizationWallet = exports.exchange_getOrganizationEntitlements = exports.exchange_getPublicCommercialPolicy = void 0;
exports.resolveExchangeEntitlements = resolveExchangeEntitlements;
exports.addCalendarMonths = addCalendarMonths;
exports.grantOrganizationCreditsOnce = grantOrganizationCreditsOnce;
exports.reverseCreditGrantAfterPaymentReversal = reverseCreditGrantAfterPaymentReversal;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const security_1 = require("./exchange/security");
const exchangeCommercialPolicy_1 = require("./exchangeCommercialPolicy");
const safeId = zod_1.z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_.:@-]+$/);
const idempotencyKey = zod_1.z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9_.:@-]+$/);
const organizationPermissions = [
    "view_exchange",
    "edit_profile",
    "respond_to_opportunities",
    "manage_referrals",
    "spend_credits",
    "purchase_credits",
    "manage_billing",
    "manage_members",
];
const ALL_PERMISSIONS = new Set(organizationPermissions);
const LEGACY_MEMBER_PERMISSIONS = new Set([
    "view_exchange",
    "edit_profile",
    "respond_to_opportunities",
    "manage_referrals",
]);
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function deterministicId(...parts) {
    return (0, node_crypto_1.createHash)("sha256").update(parts.join("\u001f")).digest("hex");
}
function permissionsForMember(member) {
    if (member.role === "owner" || member.role === "admin")
        return ALL_PERMISSIONS;
    const explicit = Array.isArray(member.permissions)
        ? member.permissions.filter((value) => (typeof value === "string" && organizationPermissions.includes(value)))
        : [];
    return explicit.length ? new Set(explicit) : LEGACY_MEMBER_PERMISSIONS;
}
function verificationStatus(org) {
    // Organization claim authority is not independent business verification.
    const status = org.verificationStatus;
    return [
        "unverified", "claim_pending", "claimed", "verification_pending",
        "verified", "suspended", "disputed",
    ].includes(String(status)) ? String(status) : "unverified";
}
async function resolveExchangeEntitlements(input) {
    const db = (0, security_1.getDb)();
    const [orgSnapshot, memberSnapshot, membershipSnapshot, policy] = await Promise.all([
        db.collection("orgs").doc(input.organizationId).get(),
        db.collection("orgMembers").doc(`${input.organizationId}_${input.actor.uid}`).get(),
        db.collection("exchangeMemberships").doc(input.organizationId).get(),
        (0, exchangeCommercialPolicy_1.loadExchangeCommercialPolicy)(db),
    ]);
    const org = asRecord(orgSnapshot.data());
    const member = asRecord(memberSnapshot.data());
    if (!orgSnapshot.exists || org.status !== "active" || !memberSnapshot.exists
        || member.orgId !== input.organizationId || member.uid !== input.actor.uid
        || member.status !== "active") {
        throw new https_1.HttpsError("permission-denied", "Active organization membership is required");
    }
    const permissions = permissionsForMember(member);
    if (input.requiredPermission && !permissions.has(input.requiredPermission)) {
        throw new https_1.HttpsError("permission-denied", `Organization permission ${input.requiredPermission} is required`);
    }
    const verified = verificationStatus(org);
    if (input.requireVerified && verified !== "verified") {
        throw new https_1.HttpsError("failed-precondition", "A verified organization is required");
    }
    const membership = asRecord(membershipSnapshot.data());
    const rawTier = membership.tier === "founding" ? "founding" : "free";
    const rawStatus = ["active", "past_due", "cancelled", "incomplete", "paused"].includes(String(membership.status))
        ? membership.status
        : "active";
    const paidEntitlementsActive = rawTier === "founding" && rawStatus === "active";
    return {
        organizationId: input.organizationId,
        organizationName: typeof org.name === "string" ? org.name : "Organization",
        verificationStatus: verified,
        permissions: [...permissions],
        tier: rawTier,
        membershipStatus: rawStatus,
        isFoundingMember: membership.isFoundingMember === true,
        foundingRecognitionRetained: membership.foundingRecognitionRetained === true,
        paidEntitlementsActive,
        freeBrowsingAllowed: true,
        monthlyActionLimits: paidEntitlementsActive ? policy.quotas.founding : policy.quotas.free,
        pricingVersion: typeof membership.pricingVersion === "string"
            ? membership.pricingVersion
            : policy.foundingMembership.pricingVersion,
        entitlementVersion: typeof membership.entitlementVersion === "string"
            ? membership.entitlementVersion
            : policy.foundingMembership.entitlementVersion,
        ...(typeof membership.currentPeriodStart === "number" ? { currentPeriodStart: membership.currentPeriodStart } : {}),
        ...(typeof membership.currentPeriodEnd === "number" ? { currentPeriodEnd: membership.currentPeriodEnd } : {}),
    };
}
function addCalendarMonths(timestamp, months) {
    if (!Number.isInteger(timestamp) || timestamp < 0 || !Number.isInteger(months) || months < 0) {
        throw new Error("Calendar expiration inputs must be non-negative integers");
    }
    const source = new Date(timestamp);
    const sourceLast = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0)).getUTCDate();
    const monthIndex = source.getUTCMonth() + months;
    const year = source.getUTCFullYear() + Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 12) % 12;
    const targetLast = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const day = source.getUTCDate() === sourceLast ? targetLast : Math.min(source.getUTCDate(), targetLast);
    return Date.UTC(year, month, day, source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds());
}
async function grantOrganizationCreditsOnce(input) {
    if (!Number.isSafeInteger(input.credits) || input.credits <= 0)
        throw new Error("Credits must be a positive integer");
    const db = (0, security_1.getDb)();
    const grantId = deterministicId("exchange-credit-grant", input.organizationId, input.source, input.sourceReferenceId);
    const grantRef = db.collection("exchangeCreditGrants").doc(grantId);
    const accountRef = db.collection("exchangeCreditAccounts").doc(input.organizationId);
    const transactionRef = db.collection("exchangeCreditTransactions").doc(`grant_${grantId}`);
    return db.runTransaction(async (transaction) => {
        const [grantSnapshot, accountSnapshot] = await Promise.all([
            transaction.get(grantRef),
            transaction.get(accountRef),
        ]);
        if (grantSnapshot.exists) {
            const prior = asRecord(grantSnapshot.data());
            if (prior.organizationId !== input.organizationId || prior.source !== input.source
                || prior.originalCredits !== input.credits || prior.sourceReferenceId !== input.sourceReferenceId
                || prior.policyVersion !== input.policyVersion) {
                throw new https_1.HttpsError("already-exists", "Credit grant source reference conflicts with an existing grant");
            }
            return { grantId, idempotent: true };
        }
        const now = Date.now();
        const account = asRecord(accountSnapshot.data());
        const currentBalance = typeof account.usableCredits === "number" ? account.usableCredits : 0;
        transaction.create(grantRef, {
            id: grantId,
            organizationId: input.organizationId,
            source: input.source,
            originalCredits: input.credits,
            remainingCredits: input.credits,
            grantedAt: input.grantedAt,
            ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
            status: "active",
            sourceReferenceId: input.sourceReferenceId,
            idempotencyKey: input.idempotencyKey,
            policyVersion: input.policyVersion,
            ...(input.actorUid ? { purchasedOrAllocatedByUid: input.actorUid } : {}),
            createdAt: now,
            updatedAt: now,
        });
        transaction.set(accountRef, {
            organizationId: input.organizationId,
            usableCredits: currentBalance + input.credits,
            hasDeficit: account.hasDeficit === true,
            updatedAt: now,
            policyVersion: input.policyVersion,
        }, { merge: true });
        transaction.create(transactionRef, {
            id: transactionRef.id,
            organizationId: input.organizationId,
            actingUid: input.actorUid ?? "system",
            amount: input.credits,
            type: input.source,
            relatedGrantIds: [grantId],
            sourceReferenceId: input.sourceReferenceId,
            idempotencyKey: input.idempotencyKey,
            policyVersion: input.policyVersion,
            createdAt: now,
        });
        return { grantId, idempotent: false };
    });
}
async function consumeCredits(input) {
    if (!Number.isSafeInteger(input.credits) || input.credits <= 0)
        throw new Error("Credits must be a positive integer");
    const db = (0, security_1.getDb)();
    const transactionId = deterministicId("exchange-credit-spend", input.organizationId, input.actorUid, input.idempotencyKey);
    const ledgerRef = db.collection("exchangeCreditTransactions").doc(transactionId);
    const accountRef = db.collection("exchangeCreditAccounts").doc(input.organizationId);
    const usagePeriod = new Date().toISOString().slice(0, 7);
    const usageRef = db.collection("exchangeActionUsage").doc(`${input.organizationId}_${input.actionKey}_${usagePeriod}`);
    const grantsQuery = db.collection("exchangeCreditGrants").where("organizationId", "==", input.organizationId).limit(250);
    return db.runTransaction(async (transaction) => {
        const [existing, accountSnapshot, grantSnapshots, usageSnapshot] = await Promise.all([
            transaction.get(ledgerRef),
            transaction.get(accountRef),
            transaction.get(grantsQuery),
            transaction.get(usageRef),
        ]);
        if (existing.exists) {
            const prior = asRecord(existing.data());
            if (prior.idempotencyKey !== input.idempotencyKey || prior.actionKey !== input.actionKey) {
                throw new https_1.HttpsError("already-exists", "Idempotency key belongs to a different credit action");
            }
            return {
                transactionId,
                remainingCredits: typeof prior.balanceAfter === "number" ? prior.balanceAfter : 0,
                idempotent: true,
            };
        }
        const now = Date.now();
        const usage = asRecord(usageSnapshot.data());
        const currentUsage = Number(usage.count ?? 0);
        if (input.monthlyLimit !== undefined && (input.monthlyLimit <= 0 || currentUsage >= input.monthlyLimit)) {
            throw new https_1.HttpsError("resource-exhausted", "The organization has reached its configured monthly action quota");
        }
        const eligible = grantSnapshots.docs
            .map((snapshot) => ({ snapshot, data: asRecord(snapshot.data()) }))
            .filter(({ data }) => data.status === "active"
            && typeof data.remainingCredits === "number" && data.remainingCredits > 0
            && (typeof data.expiresAt !== "number" || data.expiresAt > now))
            .sort((left, right) => {
            const leftExpiry = typeof left.data.expiresAt === "number" ? left.data.expiresAt : Number.MAX_SAFE_INTEGER;
            const rightExpiry = typeof right.data.expiresAt === "number" ? right.data.expiresAt : Number.MAX_SAFE_INTEGER;
            return leftExpiry - rightExpiry || Number(left.data.grantedAt ?? 0) - Number(right.data.grantedAt ?? 0);
        });
        const available = eligible.reduce((sum, grant) => sum + Number(grant.data.remainingCredits), 0);
        if (available < input.credits)
            throw new https_1.HttpsError("failed-precondition", "Insufficient usable Exchange credits");
        let needed = input.credits;
        const allocations = [];
        for (const grant of eligible) {
            if (needed === 0)
                break;
            const remaining = Number(grant.data.remainingCredits);
            const consumed = Math.min(remaining, needed);
            const next = remaining - consumed;
            allocations.push({ grantId: grant.snapshot.id, credits: consumed });
            transaction.update(grant.snapshot.ref, {
                remainingCredits: next,
                status: next === 0 ? "consumed" : "active",
                updatedAt: now,
            });
            needed -= consumed;
        }
        const account = asRecord(accountSnapshot.data());
        const projected = typeof account.usableCredits === "number" ? account.usableCredits : available;
        const balanceAfter = projected - input.credits;
        if (balanceAfter < 0)
            throw new https_1.HttpsError("aborted", "Credit account projection requires reconciliation");
        transaction.set(accountRef, {
            organizationId: input.organizationId,
            usableCredits: balanceAfter,
            updatedAt: now,
            policyVersion: input.policyVersion,
        }, { merge: true });
        transaction.create(ledgerRef, {
            id: transactionId,
            organizationId: input.organizationId,
            actingUid: input.actorUid,
            amount: -input.credits,
            type: input.administrativeReason ? "admin_adjustment" : "usage",
            actionKey: input.actionKey,
            referenceId: input.referenceId,
            allocations,
            relatedGrantIds: allocations.map((allocation) => allocation.grantId),
            idempotencyKey: input.idempotencyKey,
            policyVersion: input.policyVersion,
            balanceAfter,
            ...(input.administrativeReason ? { administrativeReason: input.administrativeReason } : {}),
            createdAt: now,
        });
        if (input.monthlyLimit !== undefined) {
            transaction.set(usageRef, {
                organizationId: input.organizationId,
                actionKey: input.actionKey,
                period: usagePeriod,
                count: currentUsage + 1,
                monthlyLimit: input.monthlyLimit,
                policyVersion: input.policyVersion,
                updatedAt: now,
            }, { merge: true });
        }
        return { transactionId, remainingCredits: balanceAfter, idempotent: false };
    });
}
exports.exchange_getPublicCommercialPolicy = (0, https_1.onCall)(async () => ({
    configuration: (0, exchangeCommercialPolicy_1.publicCommercialPolicy)(await (0, exchangeCommercialPolicy_1.loadExchangeCommercialPolicy)()),
}));
exports.exchange_getOrganizationEntitlements = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = zod_1.z.object({ organizationId: safeId }).strict().parse(request.data);
    return { entitlements: await resolveExchangeEntitlements({ organizationId: input.organizationId, actor }) };
});
exports.exchange_getOrganizationWallet = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = zod_1.z.object({ organizationId: safeId, limit: zod_1.z.number().int().min(1).max(100).default(50) }).strict().parse(request.data);
    const entitlements = await resolveExchangeEntitlements({ organizationId: input.organizationId, actor });
    const db = (0, security_1.getDb)();
    const [accountSnapshot, grantsSnapshot, transactionsSnapshot, policy] = await Promise.all([
        db.collection("exchangeCreditAccounts").doc(input.organizationId).get(),
        db.collection("exchangeCreditGrants").where("organizationId", "==", input.organizationId).limit(input.limit).get(),
        db.collection("exchangeCreditTransactions").where("organizationId", "==", input.organizationId).limit(input.limit).get(),
        (0, exchangeCommercialPolicy_1.loadExchangeCommercialPolicy)(db),
    ]);
    const now = Date.now();
    const soon = addCalendarMonths(now, 1);
    const grants = grantsSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }))
        .sort((a, b) => Number(b.grantedAt ?? 0) - Number(a.grantedAt ?? 0));
    const transactions = transactionsSnapshot.docs.map((document) => ({ id: document.id, ...document.data() }))
        .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
    return {
        entitlements,
        account: accountSnapshot.exists ? accountSnapshot.data() : {
            organizationId: input.organizationId,
            usableCredits: 0,
            hasDeficit: false,
        },
        expiringSoonCredits: grants.reduce((sum, grant) => (grant.status === "active" && typeof grant.expiresAt === "number" && grant.expiresAt <= soon
            ? sum + Number(grant.remainingCredits ?? 0)
            : sum), 0),
        grants,
        transactions,
        packs: (0, exchangeCommercialPolicy_1.publicCommercialPolicy)(policy).creditPacks,
        creditTerms: (0, exchangeCommercialPolicy_1.publicCommercialPolicy)(policy).creditDefinition,
        truncated: grantsSnapshot.size === input.limit || transactionsSnapshot.size === input.limit,
    };
});
exports.exchange_spendCredits = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    const input = zod_1.z.object({
        organizationId: safeId,
        actionKey: zod_1.z.enum(exchangeCommercialPolicy_1.EXCHANGE_ACTION_KEYS),
        referenceId: safeId,
        idempotencyKey,
    }).strict().parse(request.data);
    const policy = await (0, exchangeCommercialPolicy_1.loadExchangeCommercialPolicy)();
    const action = policy.actionCosts[input.actionKey];
    if (!action.enabled || action.credits <= 0) {
        throw new https_1.HttpsError("failed-precondition", "This credit-governed action is not enabled");
    }
    const entitlements = await resolveExchangeEntitlements({
        organizationId: input.organizationId,
        actor,
        requiredPermission: "spend_credits",
        requireVerified: action.verifiedBusinessRequired,
    });
    return consumeCredits({
        ...input,
        actorUid: actor.uid,
        credits: action.credits,
        policyVersion: policy.policyVersion,
        monthlyLimit: entitlements.monthlyActionLimits[input.actionKey],
    });
});
exports.exchange_adminAdjustCredits = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    (0, security_1.requireAdmin)(actor);
    const input = zod_1.z.object({
        organizationId: safeId,
        credits: zod_1.z.number().int().min(-100000).max(100000).refine((value) => value !== 0),
        reason: zod_1.z.string().trim().min(8).max(500),
        idempotencyKey,
    }).strict().parse(request.data);
    const policy = await (0, exchangeCommercialPolicy_1.loadExchangeCommercialPolicy)();
    if (input.credits > 0) {
        return grantOrganizationCreditsOnce({
            organizationId: input.organizationId,
            source: "admin_adjustment",
            credits: input.credits,
            grantedAt: Date.now(),
            sourceReferenceId: input.idempotencyKey,
            idempotencyKey: input.idempotencyKey,
            policyVersion: policy.policyVersion,
            actorUid: actor.uid,
        });
    }
    return consumeCredits({
        organizationId: input.organizationId,
        actorUid: actor.uid,
        credits: Math.abs(input.credits),
        actionKey: "admin_adjustment",
        referenceId: input.idempotencyKey,
        idempotencyKey: input.idempotencyKey,
        policyVersion: policy.policyVersion,
        administrativeReason: input.reason,
    });
});
exports.exchange_expireCredits = (0, scheduler_1.onSchedule)({ schedule: "every day 03:15" }, async () => {
    const db = (0, security_1.getDb)();
    const now = Date.now();
    const snapshot = await db.collection("exchangeCreditGrants").where("status", "==", "active").limit(500).get();
    let expired = 0;
    for (const document of snapshot.docs) {
        const grant = asRecord(document.data());
        if (typeof grant.expiresAt !== "number" || grant.expiresAt > now || Number(grant.remainingCredits ?? 0) <= 0)
            continue;
        const amount = Number(grant.remainingCredits);
        const organizationId = String(grant.organizationId ?? "");
        const transactionRef = db.collection("exchangeCreditTransactions").doc(`expiration_${document.id}`);
        const accountRef = db.collection("exchangeCreditAccounts").doc(organizationId);
        await db.runTransaction(async (transaction) => {
            const [currentGrant, priorTransaction, accountSnapshot] = await Promise.all([
                transaction.get(document.ref),
                transaction.get(transactionRef),
                transaction.get(accountRef),
            ]);
            if (!currentGrant.exists || priorTransaction.exists || currentGrant.data()?.status !== "active")
                return;
            const account = asRecord(accountSnapshot.data());
            const balance = Math.max(0, Number(account.usableCredits ?? 0) - amount);
            transaction.update(document.ref, { remainingCredits: 0, status: "expired", updatedAt: now });
            transaction.set(accountRef, { organizationId, usableCredits: balance, updatedAt: now }, { merge: true });
            transaction.create(transactionRef, {
                id: transactionRef.id,
                organizationId,
                actingUid: "system:expiration",
                amount: -amount,
                type: "expired",
                relatedGrantIds: [document.id],
                idempotencyKey: `expiration_${document.id}`,
                policyVersion: String(grant.policyVersion ?? "unknown"),
                balanceAfter: balance,
                createdAt: now,
            });
            expired += 1;
        });
    }
    await db.collection("exchangeJobRuns").doc(`credit-expiration-${new Date(now).toISOString().slice(0, 10)}`).set({
        job: "exchange_credit_expiration",
        scanned: snapshot.size,
        expired,
        truncated: snapshot.size === 500,
        completedAt: Date.now(),
    }, { merge: true });
});
exports.exchange_adminUpdateCommercialPolicy = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    (0, security_1.requireAdmin)(actor);
    const input = zod_1.z.object({
        expectedPolicyVersion: zod_1.z.string().min(1).max(128),
        policy: exchangeCommercialPolicy_1.exchangeCommercialPolicySchema.omit({ updatedAt: true, updatedBy: true }),
    }).strict().parse(request.data);
    const db = (0, security_1.getDb)();
    const policyRef = db.collection("exchangeCommercialPolicies").doc("current");
    return db.runTransaction(async (transaction) => {
        const [snapshot, nextVersionSnapshot] = await Promise.all([
            transaction.get(policyRef),
            transaction.get(db.collection("exchangeCommercialPolicyVersions").doc(input.policy.policyVersion)),
        ]);
        const current = snapshot.exists
            ? exchangeCommercialPolicy_1.exchangeCommercialPolicySchema.parse(snapshot.data())
            : exchangeCommercialPolicy_1.DEFAULT_EXCHANGE_COMMERCIAL_POLICY;
        if (current.policyVersion !== input.expectedPolicyVersion) {
            throw new https_1.HttpsError("aborted", "Commercial policy changed; reload and retry");
        }
        if (input.policy.policyVersion === current.policyVersion) {
            throw new https_1.HttpsError("invalid-argument", "A new policyVersion is required");
        }
        if (nextVersionSnapshot.exists) {
            throw new https_1.HttpsError("already-exists", "The requested policy version already exists");
        }
        const currentVersionRef = db.collection("exchangeCommercialPolicyVersions").doc(current.policyVersion);
        const currentVersionSnapshot = await transaction.get(currentVersionRef);
        const now = Date.now();
        const next = exchangeCommercialPolicy_1.exchangeCommercialPolicySchema.parse({
            ...input.policy,
            featureFlags: { ...input.policy.featureFlags, referralAutomatedPayoutsEnabled: false },
            updatedAt: now,
            updatedBy: actor.uid,
        });
        if (!currentVersionSnapshot.exists)
            transaction.create(currentVersionRef, current);
        transaction.create(db.collection("exchangeCommercialPolicyVersions").doc(next.policyVersion), next);
        transaction.set(policyRef, next, { merge: false });
        transaction.set(db.collection("exchangePublicConfiguration").doc("current"), (0, exchangeCommercialPolicy_1.publicCommercialPolicy)(next), { merge: false });
        transaction.create(db.collection("exchangeAuditEvents").doc(), {
            actorUid: actor.uid,
            actorRole: actor.role,
            action: "exchange.commercial_policy_updated",
            entityType: "exchangeCommercialPolicy",
            entityId: next.policyVersion,
            metadata: { previousPolicyVersion: current.policyVersion, automatedPayoutsEnabled: false },
            createdAt: now,
        });
        return { configuration: (0, exchangeCommercialPolicy_1.publicCommercialPolicy)(next) };
    });
});
exports.exchange_adminGetLaunchDashboard = (0, https_1.onCall)(async (request) => {
    const actor = (0, security_1.getAuthorizedActor)(request);
    (0, security_1.requireAdmin)(actor);
    zod_1.z.object({}).strict().parse(request.data ?? {});
    const db = (0, security_1.getDb)();
    const [policy, memberships, accounts, grants, referrals, orgs] = await Promise.all([
        (0, exchangeCommercialPolicy_1.loadExchangeCommercialPolicy)(db),
        db.collection("exchangeMemberships").limit(1000).get(),
        db.collection("exchangeCreditAccounts").limit(1000).get(),
        db.collection("exchangeCreditGrants").limit(1000).get(),
        db.collection("referralFinancialAccounts").limit(1000).get(),
        db.collection("orgs").limit(1000).get(),
    ]);
    const membershipCounts = {};
    memberships.docs.forEach((document) => {
        const status = String(document.data().status ?? "unknown");
        membershipCounts[status] = (membershipCounts[status] ?? 0) + 1;
    });
    const grantData = grants.docs.map((document) => asRecord(document.data()));
    const accountData = accounts.docs.map((document) => asRecord(document.data()));
    const referralData = referrals.docs.map((document) => asRecord(document.data()));
    const foundingCount = memberships.docs.filter((document) => document.data().isFoundingMember === true).length;
    const capacity = policy.foundingMembership.foundingCapacity;
    return {
        configuration: (0, exchangeCommercialPolicy_1.publicCommercialPolicy)(policy),
        readiness: {
            foundingCheckoutReady: (0, exchangeCommercialPolicy_1.publicCommercialPolicy)(policy).foundingMembership.checkoutReady,
            creditCheckoutReady: (0, exchangeCommercialPolicy_1.publicCommercialPolicy)(policy).creditPacks.some((pack) => pack.checkoutReady),
            referralPaymentsEnabled: policy.featureFlags.exchangeReferralPaymentsEnabled && policy.referralFinancialPolicy.enabled,
            automatedPayoutsEnabled: false,
            missing: [
                ...(!policy.foundingMembership.amountCents ? ["approved_founding_price"] : []),
                ...(!policy.foundingMembership.stripePriceId ? ["founding_stripe_price"] : []),
                ...(!policy.featureFlags.exchangeFoundingCheckoutEnabled ? ["founding_checkout_flag"] : []),
            ],
        },
        membershipCounts,
        foundingCount,
        foundingCapacity: capacity,
        remainingFoundingCapacity: capacity === undefined ? undefined : Math.max(0, capacity - foundingCount),
        organizationVerificationCounts: orgs.docs.reduce((result, document) => {
            const status = verificationStatus(asRecord(document.data()));
            result[status] = (result[status] ?? 0) + 1;
            return result;
        }, {}),
        credits: {
            outstanding: accountData.reduce((sum, account) => sum + Number(account.usableCredits ?? 0), 0),
            allocated: grantData.reduce((sum, grant) => sum + Number(grant.originalCredits ?? 0), 0),
            expired: grantData.filter((grant) => grant.status === "expired").reduce((sum, grant) => sum + Number(grant.originalCredits ?? 0), 0),
            deficits: accountData.filter((account) => account.hasDeficit === true).length,
        },
        referralFinance: {
            grossFundedCents: referralData.reduce((sum, item) => sum + Number(item.grossFundedCents ?? 0), 0),
            holdCents: referralData.reduce((sum, item) => sum + Number(item.holdCents ?? 0), 0),
            reserveLiabilityCents: referralData.reduce((sum, item) => sum + Number(item.reserveLiabilityCents ?? 0), 0),
            accumulatedPayoutCents: referralData.reduce((sum, item) => sum + Number(item.accumulatedPayoutCents ?? 0), 0),
            payoutEligibleCents: referralData.reduce((sum, item) => sum + Number(item.payoutEligibleCents ?? 0), 0),
            manualReviewItems: referralData.filter((item) => item.status === "manual_review").length,
        },
        truncated: [memberships, accounts, grants, referrals, orgs].some((snapshot) => snapshot.size === 1000),
        generatedAt: Date.now(),
    };
});
async function reverseCreditGrantAfterPaymentReversal(input) {
    const db = (0, security_1.getDb)();
    const grantRef = db.collection("exchangeCreditGrants").doc(input.grantId);
    const accountRef = db.collection("exchangeCreditAccounts").doc(input.organizationId);
    const reversalRef = db.collection("exchangeCreditTransactions").doc(`reversal_${input.eventId}`);
    await db.runTransaction(async (transaction) => {
        const [grantSnapshot, accountSnapshot, reversalSnapshot] = await Promise.all([
            transaction.get(grantRef), transaction.get(accountRef), transaction.get(reversalRef),
        ]);
        if (reversalSnapshot.exists)
            return;
        if (!grantSnapshot.exists)
            throw new Error("Credit grant for reversal is missing");
        const grant = asRecord(grantSnapshot.data());
        const remaining = Number(grant.remainingCredits ?? 0);
        const spent = Math.max(0, Number(grant.originalCredits ?? 0) - remaining);
        const account = asRecord(accountSnapshot.data());
        const current = Number(account.usableCredits ?? 0);
        transaction.update(grantRef, { remainingCredits: 0, status: "revoked", updatedAt: Date.now() });
        transaction.set(accountRef, {
            organizationId: input.organizationId,
            usableCredits: Math.max(0, current - remaining),
            hasDeficit: spent > 0 || account.hasDeficit === true,
            creditDeficit: firestore_1.FieldValue.increment(spent),
            manualReviewRequired: spent > 0,
            updatedAt: Date.now(),
        }, { merge: true });
        transaction.create(reversalRef, {
            id: reversalRef.id,
            organizationId: input.organizationId,
            actingUid: input.actorUid ?? "system:stripe",
            amount: -remaining,
            type: "payment_reversal",
            relatedGrantIds: [input.grantId],
            idempotencyKey: input.eventId,
            policyVersion: String(grant.policyVersion ?? "unknown"),
            deficitCreated: spent,
            createdAt: Date.now(),
        });
    });
}
