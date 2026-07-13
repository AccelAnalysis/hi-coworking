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
exports.backfillTeamInvitationTeamIds = backfillTeamInvitationTeamIds;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const security_1 = require("../exchange/security");
const NON_PRIME_ROLES = new Set(["sub", "estimator", "compliance", "proposal_writer"]);
function nonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function toMillis(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (value instanceof Date)
        return value.getTime();
    if (value && typeof value === "object" && "toMillis" in value) {
        const toMillisValue = value.toMillis;
        if (typeof toMillisValue === "function") {
            const millis = toMillisValue.call(value);
            return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
        }
    }
    if (value && typeof value === "object" && "seconds" in value) {
        const timestamp = value;
        if (typeof timestamp.seconds === "number") {
            return timestamp.seconds * 1000
                + (typeof timestamp.nanoseconds === "number" ? timestamp.nanoseconds / 1000000 : 0);
        }
    }
    return null;
}
function isFirestoreTimestamp(value) {
    return value instanceof firestore_1.Timestamp;
}
function teamMatchKey(rfxId, primeUid) {
    return `${rfxId}\u0000${primeUid}`;
}
function exactRfxIsValid(rfxId, rfxById) {
    if (!nonEmptyString(rfxId))
        return false;
    const rfx = rfxById.get(rfxId);
    return Boolean(rfx) && (rfx?.id === undefined || rfx.id === rfxId);
}
function exactTeamIsConsistent(team, invite) {
    return ((team.data.id === undefined || team.data.id === team.id)
        && nonEmptyString(invite.rfxId)
        && team.data.rfxId === invite.rfxId
        && nonEmptyString(invite.inviterUid)
        && team.data.primeUid === invite.inviterUid);
}
function membershipPresence(team, inviteeUid) {
    if (!nonEmptyString(inviteeUid))
        return { canonical: false, any: false };
    const inMembers = Array.isArray(team.data.members)
        && team.data.members.some((member) => (Boolean(member)
            && typeof member === "object"
            && member.uid === inviteeUid));
    const inMemberUids = Array.isArray(team.data.memberUids)
        && team.data.memberUids.includes(inviteeUid);
    return { canonical: Boolean(inMembers && inMemberUids), any: Boolean(inMembers || inMemberUids) };
}
function resolveLink(invite, teamById, teamsByRfxAndPrime, rfxById) {
    if (!exactRfxIsValid(invite.rfxId, rfxById) || !nonEmptyString(invite.inviterUid)) {
        return { kind: "invalid_rfx" };
    }
    if (nonEmptyString(invite.teamId)) {
        const existingTeam = teamById.get(invite.teamId);
        if (!existingTeam)
            return { kind: "missing_team" };
        return exactTeamIsConsistent(existingTeam, invite)
            ? { kind: "already_valid", team: existingTeam }
            : { kind: "invalid_rfx" };
    }
    const matches = teamsByRfxAndPrime.get(teamMatchKey(invite.rfxId, invite.inviterUid)) ?? [];
    if (matches.length === 0)
        return { kind: "missing_team" };
    if (matches.length > 1) {
        return { kind: "ambiguous", candidateTeamIds: matches.map((team) => team.id).sort() };
    }
    const [team] = matches;
    return exactTeamIsConsistent(team, invite)
        ? { kind: "resolved", team }
        : { kind: "invalid_rfx" };
}
async function loadCollection(collectionName, pageSize) {
    const db = (0, security_1.getDb)();
    const documents = [];
    let lastDocument;
    while (true) {
        let query = db.collection(collectionName)
            .orderBy(firestore_1.FieldPath.documentId())
            .limit(pageSize);
        if (lastDocument)
            query = query.startAfter(lastDocument);
        const snapshot = await query.get();
        if (snapshot.empty)
            break;
        documents.push(...snapshot.docs);
        lastDocument = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.size < pageSize)
            break;
    }
    return documents;
}
async function applyResolvedTeamId(inviteId, expectedTeamId) {
    const db = (0, security_1.getDb)();
    const inviteRef = db.collection("rfxTeamInvites").doc(inviteId);
    return db.runTransaction(async (transaction) => {
        const inviteSnap = await transaction.get(inviteRef);
        const invite = inviteSnap.data();
        if (!inviteSnap.exists || !invite)
            throw new Error("Invitation no longer exists");
        if (invite.id !== undefined && invite.id !== inviteId)
            throw new Error("Invitation identity is inconsistent");
        if (!nonEmptyString(invite.rfxId) || !nonEmptyString(invite.inviterUid)) {
            throw new Error("Invitation no longer has resolvable RFx and inviter fields");
        }
        if (nonEmptyString(invite.teamId)) {
            if (invite.teamId !== expectedTeamId)
                throw new Error("Invitation teamId changed during assessment");
            const existingTeamSnap = await transaction.get(db.collection("rfxTeams").doc(invite.teamId));
            const existingTeam = existingTeamSnap.data();
            if (!existingTeamSnap.exists
                || !existingTeam
                || existingTeam.rfxId !== invite.rfxId
                || existingTeam.primeUid !== invite.inviterUid) {
                throw new Error("Existing teamId is inconsistent");
            }
            return "already_valid";
        }
        // Deliberately fetch every exact match. Never use limit(1): ambiguity must fail closed.
        const exactMatches = await transaction.get(db.collection("rfxTeams")
            .where("rfxId", "==", invite.rfxId)
            .where("primeUid", "==", invite.inviterUid));
        if (exactMatches.size !== 1 || exactMatches.docs[0].id !== expectedTeamId) {
            throw new Error(`Invitation resolution changed; exact match count is ${exactMatches.size}`);
        }
        const exactTeam = exactMatches.docs[0].data();
        if ((exactTeam.id !== undefined && exactTeam.id !== expectedTeamId)
            || exactTeam.rfxId !== invite.rfxId
            || exactTeam.primeUid !== invite.inviterUid) {
            throw new Error("Resolved team relationship is inconsistent");
        }
        const rfxSnap = await transaction.get(db.collection("rfx").doc(invite.rfxId));
        const rfx = rfxSnap.data();
        if (!rfxSnap.exists || !rfx || (rfx.id !== undefined && rfx.id !== invite.rfxId)) {
            throw new Error("Resolved RFx is unavailable or inconsistent");
        }
        const now = Date.now();
        transaction.update(inviteRef, {
            teamId: expectedTeamId,
            version: firestore_1.FieldValue.increment(1),
            updatedAt: now,
            teamIdBackfill: {
                appliedAt: now,
                method: "exact_rfx_and_inviter_match",
                actorUid: "system:team-invitation-backfill",
            },
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: "system:team-invitation-backfill",
            actorRole: "system",
            action: "team_invite.team_id_backfilled",
            entityType: "rfxTeamInvite",
            entityId: inviteId,
            metadata: {
                teamId: expectedTeamId,
                rfxId: invite.rfxId,
                method: "exact_rfx_and_inviter_match",
            },
            createdAt: now,
        });
        return "updated";
    });
}
async function applyReviewRecord(inviteId, invite, resolution) {
    const db = (0, security_1.getDb)();
    const reviewRef = db.collection("rfxTeamInviteReviews").doc(inviteId);
    const candidateTeamIds = resolution.kind === "ambiguous" ? resolution.candidateTeamIds : [];
    const reason = resolution.kind === "ambiguous"
        ? "ambiguous_legacy_linkage"
        : resolution.kind === "missing_team"
            ? "missing_legacy_team"
            : "invalid_legacy_linkage";
    return db.runTransaction(async (transaction) => {
        const existing = await transaction.get(reviewRef);
        const existingData = existing.data();
        if (existing.exists
            && existingData?.status === "needs_admin_review"
            && existingData.reason === reason
            && JSON.stringify(existingData.candidateTeamIds ?? []) === JSON.stringify(candidateTeamIds)) {
            return "already_present";
        }
        const now = Date.now();
        transaction.set(reviewRef, {
            id: inviteId,
            inviteId,
            status: "needs_admin_review",
            reason,
            message: "Legacy invitation linkage could not be proven by an exact team relationship",
            rfxId: invite.rfxId ?? null,
            inviterUid: invite.inviterUid ?? null,
            inviteeUid: invite.inviteeUid ?? null,
            candidateTeamIds,
            candidateCount: candidateTeamIds.length,
            reportedByUid: "system:team-invitation-backfill",
            reportedByRole: "system",
            lastSeenAt: now,
        }, { merge: true });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: "system:team-invitation-backfill",
            actorRole: "system",
            action: "team_invite.flagged_for_review",
            entityType: "rfxTeamInvite",
            entityId: inviteId,
            metadata: { reason, candidateCount: candidateTeamIds.length },
            createdAt: now,
        });
        return "recorded";
    });
}
async function normalizeTimestampExpiry(inviteId, expectedMillis) {
    const db = (0, security_1.getDb)();
    const inviteRef = db.collection("rfxTeamInvites").doc(inviteId);
    return db.runTransaction(async (transaction) => {
        const inviteSnap = await transaction.get(inviteRef);
        const invite = inviteSnap.data();
        if (!inviteSnap.exists || !invite)
            throw new Error("Invitation no longer exists");
        if (typeof invite.expiresAt === "number") {
            if (invite.expiresAt !== expectedMillis) {
                throw new Error("Invitation expiry changed during normalization");
            }
            return "already_normalized";
        }
        if (!isFirestoreTimestamp(invite.expiresAt) || toMillis(invite.expiresAt) !== expectedMillis) {
            throw new Error("Invitation Timestamp expiry changed during normalization");
        }
        const now = Date.now();
        transaction.update(inviteRef, {
            expiresAt: expectedMillis,
            version: firestore_1.FieldValue.increment(1),
            updatedAt: now,
            expiryBackfill: {
                appliedAt: now,
                sourceType: "firestore_timestamp",
                actorUid: "system:team-invitation-backfill",
            },
        });
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: "system:team-invitation-backfill",
            actorRole: "system",
            action: "team_invite.expiry_normalized",
            entityType: "rfxTeamInvite",
            entityId: inviteId,
            metadata: { sourceType: "firestore_timestamp", expiresAt: expectedMillis },
            createdAt: now,
        });
        return "updated";
    });
}
function ensureAdmin(projectId) {
    if (admin.apps.length > 0)
        return;
    admin.initializeApp(projectId ? { projectId } : undefined);
}
function activeDuplicateKey(teamId, inviteeUid) {
    return `${teamId}\u0000${inviteeUid}`;
}
async function backfillTeamInvitationTeamIds(options = {}) {
    ensureAdmin(options.projectId);
    const apply = options.apply === true;
    const pageSize = Math.min(Math.max(options.pageSize ?? 500, 1), 500);
    const limit = Math.max(options.limit ?? Number.MAX_SAFE_INTEGER, 0);
    const configuredProjectId = String(admin.app().options.projectId
        ?? process.env.GCLOUD_PROJECT
        ?? process.env.GOOGLE_CLOUD_PROJECT
        ?? "unknown");
    if (options.projectId && configuredProjectId !== options.projectId) {
        throw new Error(`Configured Firebase project ${configuredProjectId} does not match --project=${options.projectId}`);
    }
    if (apply && !options.projectId) {
        throw new Error("--apply requires an explicit --project=<project-id>");
    }
    if (apply && configuredProjectId === "unknown") {
        throw new Error("--apply requires a resolvable Firebase project ID");
    }
    if (apply && options.confirmProject !== configuredProjectId) {
        throw new Error(`--apply requires --confirm-project=${configuredProjectId}`);
    }
    const report = {
        projectId: configuredProjectId,
        dryRun: !apply,
        totalScanned: 0,
        alreadyValid: 0,
        resolved: 0,
        ambiguous: 0,
        missingTeam: 0,
        invalidRfx: 0,
        failedUpdates: 0,
        acceptedWithoutMember: 0,
        pendingExistingMember: 0,
        duplicateActive: 0,
        invalidRole: 0,
        updatesApplied: 0,
        reviewRecordsApplied: 0,
        reviewRecordsAlreadyPresent: 0,
        failedReviewWrites: 0,
        timestampExpiryValues: 0,
        expiryNormalizationsApplied: 0,
        expiryNormalizationsAlreadyApplied: 0,
        failedExpiryNormalizations: 0,
        reviewRequiredInviteIds: [],
    };
    const [teamDocs, rfxDocs] = await Promise.all([
        loadCollection("rfxTeams", pageSize),
        loadCollection("rfx", pageSize),
    ]);
    const teamById = new Map();
    const teamsByRfxAndPrime = new Map();
    for (const teamDoc of teamDocs) {
        const team = { id: teamDoc.id, data: teamDoc.data() };
        teamById.set(team.id, team);
        if (nonEmptyString(team.data.rfxId) && nonEmptyString(team.data.primeUid)) {
            const key = teamMatchKey(team.data.rfxId, team.data.primeUid);
            teamsByRfxAndPrime.set(key, [...(teamsByRfxAndPrime.get(key) ?? []), team]);
        }
    }
    const rfxById = new Map(rfxDocs.map((rfxDoc) => [rfxDoc.id, rfxDoc.data()]));
    const activeInvitationsByTeamAndUser = new Map();
    const db = (0, security_1.getDb)();
    const now = Date.now();
    let lastInvite;
    while (report.totalScanned < limit) {
        const remaining = limit - report.totalScanned;
        let query = db.collection("rfxTeamInvites")
            .orderBy(firestore_1.FieldPath.documentId())
            .limit(Math.min(pageSize, remaining));
        if (lastInvite)
            query = query.startAfter(lastInvite);
        const snapshot = await query.get();
        if (snapshot.empty)
            break;
        for (const inviteDoc of snapshot.docs) {
            report.totalScanned += 1;
            const invite = inviteDoc.data();
            if (!NON_PRIME_ROLES.has(invite.role ?? ""))
                report.invalidRole += 1;
            if (isFirestoreTimestamp(invite.expiresAt)) {
                report.timestampExpiryValues += 1;
                const expiryMillis = toMillis(invite.expiresAt);
                if (apply && expiryMillis !== null) {
                    try {
                        const outcome = await normalizeTimestampExpiry(inviteDoc.id, expiryMillis);
                        if (outcome === "updated")
                            report.expiryNormalizationsApplied += 1;
                        else
                            report.expiryNormalizationsAlreadyApplied += 1;
                    }
                    catch (error) {
                        report.failedExpiryNormalizations += 1;
                        console.error("[backfillTeamInvitationTeamIds] expiry normalization failed", {
                            inviteId: inviteDoc.id,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
            }
            const resolution = resolveLink(invite, teamById, teamsByRfxAndPrime, rfxById);
            if (resolution.kind === "already_valid")
                report.alreadyValid += 1;
            else if (resolution.kind === "resolved")
                report.resolved += 1;
            else if (resolution.kind === "ambiguous")
                report.ambiguous += 1;
            else if (resolution.kind === "missing_team")
                report.missingTeam += 1;
            else
                report.invalidRfx += 1;
            if (resolution.kind === "ambiguous"
                || resolution.kind === "missing_team"
                || resolution.kind === "invalid_rfx") {
                if (report.reviewRequiredInviteIds.length < 100) {
                    report.reviewRequiredInviteIds.push(inviteDoc.id);
                }
                if (apply) {
                    try {
                        const outcome = await applyReviewRecord(inviteDoc.id, invite, resolution);
                        if (outcome === "recorded")
                            report.reviewRecordsApplied += 1;
                        else
                            report.reviewRecordsAlreadyPresent += 1;
                    }
                    catch (error) {
                        report.failedReviewWrites += 1;
                        console.error("[backfillTeamInvitationTeamIds] review write failed", {
                            inviteId: inviteDoc.id,
                            reason: resolution.kind,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
            }
            if (resolution.kind === "already_valid" || resolution.kind === "resolved") {
                const membership = membershipPresence(resolution.team, invite.inviteeUid);
                if (invite.status === "accepted" && !membership.canonical)
                    report.acceptedWithoutMember += 1;
                if (invite.status === "pending" && membership.any)
                    report.pendingExistingMember += 1;
                if (invite.status === "pending" && nonEmptyString(invite.inviteeUid)) {
                    const expiresAt = toMillis(invite.expiresAt);
                    if (expiresAt === null || expiresAt > now) {
                        const key = activeDuplicateKey(resolution.team.id, invite.inviteeUid);
                        activeInvitationsByTeamAndUser.set(key, [...(activeInvitationsByTeamAndUser.get(key) ?? []), inviteDoc.id]);
                    }
                }
                if (apply && resolution.kind === "resolved") {
                    try {
                        const outcome = await applyResolvedTeamId(inviteDoc.id, resolution.team.id);
                        if (outcome === "updated")
                            report.updatesApplied += 1;
                    }
                    catch (error) {
                        report.failedUpdates += 1;
                        console.error("[backfillTeamInvitationTeamIds] update failed", {
                            inviteId: inviteDoc.id,
                            expectedTeamId: resolution.team.id,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
            }
        }
        lastInvite = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.size < Math.min(pageSize, remaining))
            break;
    }
    for (const inviteIds of activeInvitationsByTeamAndUser.values()) {
        if (inviteIds.length > 1)
            report.duplicateActive += inviteIds.length - 1;
    }
    return report;
}
function parsePositiveIntegerFlag(value, flag) {
    if (value === undefined)
        return undefined;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0)
        throw new Error(`${flag} must be a positive integer`);
    return parsed;
}
if (require.main === module) {
    const args = process.argv.slice(2);
    const valueFor = (name) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
    const options = {
        apply: args.includes("--apply"),
        projectId: valueFor("--project"),
        confirmProject: valueFor("--confirm-project"),
        limit: parsePositiveIntegerFlag(valueFor("--limit"), "--limit"),
        pageSize: parsePositiveIntegerFlag(valueFor("--page-size"), "--page-size"),
    };
    backfillTeamInvitationTeamIds(options)
        .then((report) => {
        console.log(JSON.stringify(report, null, 2));
        process.exit(report.failedUpdates > 0
            || report.failedReviewWrites > 0
            || report.failedExpiryNormalizations > 0
            ? 1
            : 0);
    })
        .catch((error) => {
        console.error("[backfillTeamInvitationTeamIds] failed", error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
