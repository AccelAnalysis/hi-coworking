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
exports.backfillTeamMemberships = backfillTeamMemberships;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const security_1 = require("../exchange/security");
const TEAM_MEMBERSHIP_COLLECTION = "rfxTeamMemberships";
const TEAM_MEMBERSHIP_REVIEW_COLLECTION = "rfxTeamMembershipReviews";
const TEAM_ROLES = new Set(["prime", "sub", "estimator", "compliance", "proposal_writer"]);
const MAX_TEAM_MEMBERS = 100;
const MAX_TRANSACTION_WRITES = 450;
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isSafeId(value) {
    return typeof value === "string"
        && value.length > 0
        && value.length <= 128
        && /^[A-Za-z0-9_.:@-]+$/.test(value);
}
function uniqueReasons(reasons) {
    return [...new Set(reasons)].sort();
}
function assessTeam(teamId, data) {
    const reasons = [];
    if (data.id !== undefined && data.id !== teamId)
        reasons.push("team_identity_mismatch");
    const rfxId = isSafeId(data.rfxId) ? data.rfxId : null;
    if (!rfxId)
        reasons.push("invalid_rfx_id");
    const primeUid = isSafeId(data.primeUid) ? data.primeUid : null;
    if (!primeUid)
        reasons.push("invalid_prime_uid");
    const members = [];
    const seen = new Set();
    if (!Array.isArray(data.members)) {
        reasons.push("members_not_array");
    }
    else {
        if (data.members.length === 0)
            reasons.push("members_empty");
        if (data.members.length > MAX_TEAM_MEMBERS)
            reasons.push("member_limit_exceeded");
        for (const rawMember of data.members) {
            if (!isRecord(rawMember)
                || !isSafeId(rawMember.uid)
                || typeof rawMember.role !== "string"
                || !TEAM_ROLES.has(rawMember.role)) {
                reasons.push("invalid_member");
                continue;
            }
            if (seen.has(rawMember.uid)) {
                reasons.push("duplicate_member_uid");
                continue;
            }
            seen.add(rawMember.uid);
            members.push({ uid: rawMember.uid, role: rawMember.role });
        }
    }
    if (!Array.isArray(data.memberUids)) {
        reasons.push("member_uids_not_array");
    }
    else if (data.memberUids.length !== members.length
        || data.memberUids.some((uid, index) => uid !== members[index]?.uid)) {
        reasons.push("member_uid_parity_mismatch");
    }
    const primeMembers = members.filter((member) => member.role === "prime");
    if (primeMembers.length !== 1 || !primeUid || primeMembers[0]?.uid !== primeUid) {
        reasons.push("invalid_prime_membership");
    }
    const normalizedReasons = uniqueReasons(reasons);
    return {
        valid: normalizedReasons.length === 0,
        reasons: normalizedReasons,
        rfxId,
        primeUid,
        members,
    };
}
function guardMatches(data, teamId, rfxId, member) {
    return Boolean(data)
        && data?.id === member.uid
        && data.uid === member.uid
        && data.teamId === teamId
        && data.rfxId === rfxId
        && data.role === member.role;
}
function calculateGuardDelta(teamId, assessment, guards) {
    if (!assessment.valid || !assessment.rfxId) {
        return {
            writes: 0,
            deletes: guards.size,
            missingOrInvalid: 0,
            stale: guards.size,
        };
    }
    const desired = new Map(assessment.members.map((member) => [member.uid, member]));
    const existing = new Map(guards.docs.map((guard) => [guard.id, guard]));
    let missingOrInvalid = 0;
    for (const member of assessment.members) {
        const guard = existing.get(member.uid);
        if (!guard || !guardMatches(guard.data(), teamId, assessment.rfxId, member)) {
            missingOrInvalid += 1;
        }
    }
    const stale = guards.docs.filter((guard) => !desired.has(guard.id)).length;
    return {
        writes: missingOrInvalid,
        deletes: stale,
        missingOrInvalid,
        stale,
    };
}
function sameReasons(left, right) {
    return Array.isArray(left)
        && JSON.stringify([...left].sort()) === JSON.stringify(right);
}
async function applyTeamMemberships(teamId) {
    const db = (0, security_1.getDb)();
    const teamRef = db.collection("rfxTeams").doc(teamId);
    const memberships = db.collection(TEAM_MEMBERSHIP_COLLECTION).doc(teamId).collection("members");
    const reviewRef = db.collection(TEAM_MEMBERSHIP_REVIEW_COLLECTION).doc(teamId);
    return db.runTransaction(async (transaction) => {
        const [teamSnap, guardSnaps, reviewSnap] = await Promise.all([
            transaction.get(teamRef),
            transaction.get(memberships),
            transaction.get(reviewRef),
        ]);
        if (!teamSnap.exists)
            throw new Error("Team no longer exists");
        const assessment = assessTeam(teamId, teamSnap.data() ?? {});
        const delta = calculateGuardDelta(teamId, assessment, guardSnaps);
        const existingReview = reviewSnap.data();
        const reviewAlreadyPresent = !assessment.valid
            && reviewSnap.exists
            && existingReview?.status === "needs_admin_review"
            && sameReasons(existingReview.reasons, assessment.reasons);
        const reviewApplied = !assessment.valid && !reviewAlreadyPresent ? 1 : 0;
        const reviewResolved = assessment.valid
            && reviewSnap.exists
            && existingReview?.status === "needs_admin_review"
            ? 1
            : 0;
        const auditWrite = delta.writes > 0
            || delta.deletes > 0
            || reviewApplied > 0
            || reviewResolved > 0
            ? 1
            : 0;
        const totalWrites = delta.writes + delta.deletes + reviewApplied + reviewResolved + auditWrite;
        if (totalWrites > MAX_TRANSACTION_WRITES) {
            throw new Error(`Team requires ${totalWrites} atomic writes; manual review is required before rules deployment`);
        }
        const now = Date.now();
        if (assessment.valid && assessment.rfxId) {
            const desired = new Map(assessment.members.map((member) => [member.uid, member]));
            const existing = new Map(guardSnaps.docs.map((guard) => [guard.id, guard]));
            for (const member of assessment.members) {
                const existingGuard = existing.get(member.uid);
                if (!existingGuard || !guardMatches(existingGuard.data(), teamId, assessment.rfxId, member)) {
                    const createdAt = existingGuard?.data().createdAt;
                    transaction.set(memberships.doc(member.uid), {
                        id: member.uid,
                        teamId,
                        rfxId: assessment.rfxId,
                        uid: member.uid,
                        role: member.role,
                        createdAt: typeof createdAt === "number" ? createdAt : now,
                        updatedAt: now,
                    });
                }
            }
            for (const guard of guardSnaps.docs) {
                if (!desired.has(guard.id))
                    transaction.delete(guard.ref);
            }
            if (reviewResolved) {
                transaction.set(reviewRef, {
                    status: "resolved",
                    resolvedAt: now,
                    lastSeenAt: now,
                    resolvedByUid: "system:team-membership-backfill",
                }, { merge: true });
            }
        }
        else {
            for (const guard of guardSnaps.docs)
                transaction.delete(guard.ref);
            if (reviewApplied) {
                transaction.set(reviewRef, {
                    id: teamId,
                    teamId,
                    status: "needs_admin_review",
                    reasons: assessment.reasons,
                    memberCount: assessment.members.length,
                    primeUid: assessment.primeUid,
                    rfxId: assessment.rfxId,
                    reportedByUid: "system:team-membership-backfill",
                    reportedByRole: "system",
                    firstSeenAt: typeof existingReview?.firstSeenAt === "number"
                        ? existingReview.firstSeenAt
                        : now,
                    lastSeenAt: now,
                }, { merge: true });
            }
        }
        if (auditWrite) {
            (0, security_1.writeExchangeAudit)(transaction, db, {
                actorUid: "system:team-membership-backfill",
                actorRole: "system",
                action: assessment.valid
                    ? "team_membership_guards_reconciled"
                    : "team_membership_flagged_for_review",
                entityType: "rfxTeam",
                entityId: teamId,
                metadata: {
                    valid: assessment.valid,
                    reasons: assessment.reasons.join("|"),
                    guardWrites: delta.writes,
                    guardDeletes: delta.deletes,
                },
                createdAt: now,
            });
        }
        return {
            valid: assessment.valid,
            memberCount: assessment.members.length,
            guardWrites: delta.writes,
            guardDeletes: delta.deletes,
            reviewApplied,
            reviewAlreadyPresent: reviewAlreadyPresent ? 1 : 0,
            reviewResolved,
            reasons: assessment.reasons,
        };
    });
}
function ensureAdmin(projectId) {
    if (admin.apps.length > 0)
        return;
    admin.initializeApp(projectId ? { projectId } : undefined);
}
async function backfillTeamMemberships(options = {}) {
    ensureAdmin(options.projectId);
    const apply = options.apply === true;
    const pageSize = Math.min(Math.max(options.pageSize ?? 200, 1), 500);
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
        validTeams: 0,
        reviewTeams: 0,
        canonicalMembers: 0,
        missingOrInvalidGuards: 0,
        staleGuards: 0,
        wouldWriteGuards: 0,
        wouldDeleteGuards: 0,
        guardWritesApplied: 0,
        guardDeletesApplied: 0,
        reviewRecordsApplied: 0,
        reviewRecordsAlreadyPresent: 0,
        reviewRecordsResolved: 0,
        failedTeams: 0,
        reviewRequiredTeamIds: [],
    };
    const db = (0, security_1.getDb)();
    let lastTeam;
    while (report.totalScanned < limit) {
        const remaining = limit - report.totalScanned;
        let query = db.collection("rfxTeams")
            .orderBy(firestore_1.FieldPath.documentId())
            .limit(Math.min(pageSize, remaining));
        if (lastTeam)
            query = query.startAfter(lastTeam);
        const snapshot = await query.get();
        if (snapshot.empty)
            break;
        for (const teamDoc of snapshot.docs) {
            report.totalScanned += 1;
            const assessment = assessTeam(teamDoc.id, teamDoc.data());
            const guards = await db.collection(TEAM_MEMBERSHIP_COLLECTION)
                .doc(teamDoc.id)
                .collection("members")
                .get();
            const delta = calculateGuardDelta(teamDoc.id, assessment, guards);
            if (assessment.valid)
                report.validTeams += 1;
            else {
                report.reviewTeams += 1;
                if (report.reviewRequiredTeamIds.length < 100) {
                    report.reviewRequiredTeamIds.push(teamDoc.id);
                }
            }
            report.canonicalMembers += assessment.valid ? assessment.members.length : 0;
            report.missingOrInvalidGuards += delta.missingOrInvalid;
            report.staleGuards += delta.stale;
            report.wouldWriteGuards += delta.writes;
            report.wouldDeleteGuards += delta.deletes;
            if (apply) {
                try {
                    const outcome = await applyTeamMemberships(teamDoc.id);
                    report.guardWritesApplied += outcome.guardWrites;
                    report.guardDeletesApplied += outcome.guardDeletes;
                    report.reviewRecordsApplied += outcome.reviewApplied;
                    report.reviewRecordsAlreadyPresent += outcome.reviewAlreadyPresent;
                    report.reviewRecordsResolved += outcome.reviewResolved;
                }
                catch (error) {
                    report.failedTeams += 1;
                    console.error("[backfillTeamMemberships] team reconciliation failed", {
                        teamId: teamDoc.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }
        lastTeam = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.size < Math.min(pageSize, remaining))
            break;
    }
    return report;
}
function parsePositiveIntegerFlag(value, flag) {
    if (value === undefined)
        return undefined;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}
if (require.main === module) {
    const args = process.argv.slice(2);
    const valueFor = (name) => args
        .find((arg) => arg.startsWith(`${name}=`))
        ?.slice(name.length + 1);
    const options = {
        apply: args.includes("--apply"),
        projectId: valueFor("--project"),
        confirmProject: valueFor("--confirm-project"),
        limit: parsePositiveIntegerFlag(valueFor("--limit"), "--limit"),
        pageSize: parsePositiveIntegerFlag(valueFor("--page-size"), "--page-size"),
    };
    backfillTeamMemberships(options)
        .then((report) => {
        console.log(JSON.stringify(report, null, 2));
        process.exit(report.failedTeams > 0 ? 1 : 0);
    })
        .catch((error) => {
        console.error("[backfillTeamMemberships] failed", error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
