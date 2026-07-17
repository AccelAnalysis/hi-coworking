"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.exchange_organizationRequestClaim = exports.exchange_organizationCreate = exports.exchange_organizationSearch = void 0;
const node_crypto_1 = require("node:crypto");
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
const model_1 = require("./model");
function getDb() { return admin.firestore(); }
function cleanString(value, max = 200) {
    if (typeof value !== "string")
        return undefined;
    const cleaned = value.trim().replace(/\s+/g, " ");
    return cleaned ? cleaned.slice(0, max) : undefined;
}
function assertAuthenticated(request) {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "Sign in to search or manage organizations.");
}
async function enforceSearchRateLimit(uid) {
    const minute = Math.floor(Date.now() / 60000);
    const ref = getDb().collection("organizationSearchRateLimits").doc(`${uid}_${minute}`);
    await getDb().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const count = Number(snap.data()?.count || 0);
        if (count >= 30)
            throw new https_1.HttpsError("resource-exhausted", "Too many searches. Try again shortly.");
        tx.set(ref, { uid, minute, count: count + 1, updatedAt: Date.now() }, { merge: true });
    });
}
async function searchLocalOrganizations(input) {
    const tokens = (0, model_1.createSearchTokens)(input.name);
    if (!tokens.length)
        return [];
    const [orgSnap, restrictedSnap] = await Promise.all([
        getDb().collection("orgs").where("searchTokens", "array-contains", tokens[0]).limit(40).get(),
        getDb().collection("organizationSourceCandidates").where("searchTokens", "array-contains", tokens[0]).limit(20).get(),
    ]);
    const mapDocument = (doc, restricted = false) => {
        const data = doc.data();
        const match = (0, model_1.scoreOrganizationMatch)(input, data);
        return {
            id: restricted ? `source:${doc.id}` : doc.id,
            name: String(data.name || "Organization"),
            city: cleanString(data.city),
            state: cleanString(data.state),
            website: cleanString(data.website),
            claimStatus: data.claimStatus === "claimed" || data.claimStatus === "claim_pending" ? data.claimStatus : "unclaimed",
            verificationStatus: String(data.verificationStatus || "unverified"),
            sources: Array.isArray(data.sources) ? data.sources.map(String) : ["manual"],
            confidenceScore: match.score,
            matchReason: match.reasons.join(" + ") || "name similarity",
            canRequestClaim: data.claimStatus !== "claimed",
            external: restricted,
        };
    };
    return [
        ...orgSnap.docs.map((doc) => mapDocument(doc)),
        ...restrictedSnap.docs.map((doc) => mapDocument(doc, true)),
    ].filter((candidate) => candidate.confidenceScore >= 30);
}
async function searchUsaSpending(name) {
    try {
        const response = await fetch("https://api.usaspending.gov/api/v2/autocomplete/recipient/", {
            method: "POST",
            headers: { "content-type": "application/json", "user-agent": "Hi-Coworking-Exchange/1.0" },
            body: JSON.stringify({ search_text: name, limit: 10 }),
            signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
            logger.warn("USAspending recipient search failed", { status: response.status });
            return [];
        }
        const payload = await response.json();
        const groups = Array.isArray(payload.results) ? [payload.results] : Object.values(payload.results || {});
        return groups.flat().slice(0, 15).map((row, index) => {
            const recipientName = cleanString(row.recipient_name || row.name) || name;
            const uei = cleanString(row.uei || row.recipient_uei || row.recipient_unique_id);
            const match = (0, model_1.scoreOrganizationMatch)({ name }, { name: recipientName });
            const stable = (0, node_crypto_1.createHash)("sha256").update(`usaspending:${uei || recipientName}:${index}`).digest("hex").slice(0, 24);
            return {
                id: `usaspending:${stable}`,
                name: recipientName,
                claimStatus: "unclaimed",
                verificationStatus: "unverified",
                sources: ["usaspending"],
                confidenceScore: match.score,
                matchReason: match.reasons.join(" + ") || "USAspending recipient name",
                canRequestClaim: false,
                external: true,
            };
        });
    }
    catch (error) {
        logger.warn("USAspending recipient search unavailable", { error });
        return [];
    }
}
function dedupeCandidates(candidates) {
    const best = new Map();
    for (const candidate of candidates) {
        const key = `${(0, model_1.normalizeOrganizationName)(candidate.name)}|${candidate.city?.toLowerCase() || ""}|${candidate.state?.toLowerCase() || ""}`;
        const existing = best.get(key);
        if (!existing || (!candidate.external && existing.external) || candidate.confidenceScore > existing.confidenceScore) {
            best.set(key, existing ? {
                ...candidate,
                sources: [...new Set([...existing.sources, ...candidate.sources])],
                confidenceScore: Math.max(existing.confidenceScore, candidate.confidenceScore),
            } : candidate);
        }
        else {
            existing.sources = [...new Set([...existing.sources, ...candidate.sources])];
        }
    }
    return [...best.values()].sort((a, b) => b.confidenceScore - a.confidenceScore).slice(0, 20);
}
exports.exchange_organizationSearch = (0, https_1.onCall)(async (request) => {
    assertAuthenticated(request);
    const name = cleanString(request.data?.name, 160);
    const city = cleanString(request.data?.city, 100);
    const state = cleanString(request.data?.state, 40);
    if (!name || name.length < 2)
        throw new https_1.HttpsError("invalid-argument", "Enter at least two characters of the organization name.");
    await enforceSearchRateLimit(request.auth.uid);
    const [local, usaspending] = await Promise.all([
        searchLocalOrganizations({ name, city, state }),
        searchUsaSpending(name),
    ]);
    return { candidates: dedupeCandidates([...local, ...usaspending]) };
});
exports.exchange_organizationCreate = (0, https_1.onCall)(async (request) => {
    assertAuthenticated(request);
    const name = cleanString(request.data?.name, 160);
    const city = cleanString(request.data?.city, 100);
    const state = cleanString(request.data?.state, 40);
    const website = cleanString(request.data?.website, 300);
    const forceCreate = request.data?.forceCreate === true;
    if (!name)
        throw new https_1.HttpsError("invalid-argument", "Organization name is required.");
    const possibleMatches = await searchLocalOrganizations({ name, city, state });
    const strongMatches = possibleMatches.filter((candidate) => candidate.confidenceScore >= 65);
    if (strongMatches.length && !forceCreate) {
        return { created: false, possibleMatches: strongMatches.slice(0, 5) };
    }
    const now = Date.now();
    const orgRef = getDb().collection("orgs").doc();
    const memberRef = getDb().collection("orgMembers").doc(`${orgRef.id}_${request.auth.uid}`);
    const membershipRef = getDb().collection("organizationMemberships").doc(orgRef.id);
    const normalizedName = (0, model_1.normalizeOrganizationName)(name);
    const slugBase = normalizedName.replace(/\s+/g, "-").slice(0, 60) || "organization";
    const org = {
        id: orgRef.id,
        name,
        normalizedName,
        slug: `${slugBase}-${orgRef.id.slice(0, 6)}`,
        ownerUid: request.auth.uid,
        website: website || "",
        websiteDomain: (0, model_1.normalizeWebsiteDomain)(website) || "",
        address: "",
        city: city || "",
        state: state || "",
        seatsPurchased: 1,
        seatsUsed: 1,
        billingEmail: "",
        status: "active",
        claimStatus: "claimed",
        verificationStatus: "pending",
        sources: ["manual"],
        sourceIds: {},
        homeBased: false,
        naicsCodes: [],
        searchTokens: (0, model_1.createSearchTokens)(name),
        createdAt: now,
        updatedAt: now,
    };
    await getDb().runTransaction(async (tx) => {
        tx.create(orgRef, org);
        tx.create(memberRef, { id: memberRef.id, orgId: orgRef.id, uid: request.auth.uid, role: "owner", joinedAt: now });
        tx.create(membershipRef, {
            organizationId: orgRef.id,
            plan: "free",
            status: "free",
            cancelAtPeriodEnd: false,
            protectedRateEligible: false,
            createdAt: now,
            updatedAt: now,
        });
    });
    return { created: true, organizationId: orgRef.id };
});
exports.exchange_organizationRequestClaim = (0, https_1.onCall)(async (request) => {
    assertAuthenticated(request);
    const organizationId = cleanString(request.data?.organizationId, 200);
    const reason = cleanString(request.data?.reason, 1000);
    if (!organizationId || organizationId.startsWith("usaspending:")) {
        throw new https_1.HttpsError("failed-precondition", "Import this external match before requesting a claim.");
    }
    let resolvedOrganizationId = organizationId;
    if (organizationId.startsWith("source:")) {
        const sourceId = organizationId.slice("source:".length);
        const sourceSnap = await getDb().collection("organizationSourceCandidates").doc(sourceId).get();
        if (!sourceSnap.exists)
            throw new https_1.HttpsError("not-found", "Source organization not found.");
        const source = sourceSnap.data() || {};
        const orgRef = getDb().collection("orgs").doc(`target_${sourceId}`);
        const existing = await orgRef.get();
        if (!existing.exists) {
            const now = Date.now();
            await orgRef.create({
                ...source,
                id: orgRef.id,
                slug: `${String(source.normalizedName || "organization").replace(/\s+/g, "-").slice(0, 60)}-${sourceId.slice(-6)}`,
                ownerUid: "",
                seatsPurchased: 0,
                seatsUsed: 0,
                status: "active",
                claimStatus: "unclaimed",
                verificationStatus: "unverified",
                createdAt: now,
                updatedAt: now,
            });
        }
        resolvedOrganizationId = orgRef.id;
    }
    const orgRef = getDb().collection("orgs").doc(resolvedOrganizationId);
    const claimRef = getDb().collection("organizationClaims").doc(`${resolvedOrganizationId}_${request.auth.uid}`);
    await getDb().runTransaction(async (tx) => {
        const orgSnap = await tx.get(orgRef);
        if (!orgSnap.exists)
            throw new https_1.HttpsError("not-found", "Organization not found.");
        if (orgSnap.data()?.claimStatus === "claimed")
            throw new https_1.HttpsError("already-exists", "This organization is already claimed.");
        const now = Date.now();
        tx.set(claimRef, { id: claimRef.id, organizationId: resolvedOrganizationId, requestedBy: request.auth.uid, status: "pending", reason: reason || "", createdAt: now, updatedAt: now });
        tx.update(orgRef, { claimStatus: "claim_pending", updatedAt: now });
    });
    return { success: true, claimId: claimRef.id, organizationId: resolvedOrganizationId };
});
