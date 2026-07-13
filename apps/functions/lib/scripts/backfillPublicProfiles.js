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
exports.sanitizePublicProfile = void 0;
exports.backfillPublicProfiles = backfillPublicProfiles;
const node_util_1 = require("node:util");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const publicProfiles_1 = require("../exchange/publicProfiles");
const security_1 = require("../exchange/security");
var publicProfiles_2 = require("../exchange/publicProfiles");
Object.defineProperty(exports, "sanitizePublicProfile", { enumerable: true, get: function () { return publicProfiles_2.sanitizePublicProfile; } });
const SYSTEM_ACTOR = "system:public-profile-backfill";
function ensureAdmin(projectId) {
    if (admin.apps.length > 0)
        return;
    admin.initializeApp(projectId ? { projectId } : undefined);
}
function configuredProjectId() {
    return String(admin.app().options.projectId
        ?? process.env.GCLOUD_PROJECT
        ?? process.env.GOOGLE_CLOUD_PROJECT
        ?? "unknown");
}
async function syncPublishedProjection(profileId) {
    const db = (0, security_1.getDb)();
    const profileRef = db.collection("profiles").doc(profileId);
    const publicRef = db.collection("publicProfiles").doc(profileId);
    return db.runTransaction(async (transaction) => {
        const [profileSnapshot, publicSnapshot] = await Promise.all([
            transaction.get(profileRef),
            transaction.get(publicRef),
        ]);
        const profile = profileSnapshot.data();
        // Fail closed if the source changed after the assessment read.
        if (!profileSnapshot.exists || !profile || profile.published !== true) {
            if (!publicSnapshot.exists)
                return "no_change";
            const now = Date.now();
            const reason = profileSnapshot.exists ? "source_private" : "source_missing";
            transaction.delete(publicRef);
            (0, security_1.writeExchangeAudit)(transaction, db, {
                actorUid: SYSTEM_ACTOR,
                actorRole: "system",
                action: "profile.public_projection_deleted",
                entityType: "publicProfile",
                entityId: profileId,
                previousStatus: "published",
                newStatus: "private",
                metadata: { reason },
                createdAt: now,
            });
            return "deleted_stale";
        }
        const expected = (0, publicProfiles_1.sanitizePublicProfile)(profileId, profile);
        const current = publicSnapshot.data();
        if (publicSnapshot.exists && current && (0, node_util_1.isDeepStrictEqual)(current, expected)) {
            return "already_current";
        }
        const now = Date.now();
        const outcome = publicSnapshot.exists ? "updated" : "created";
        transaction.set(publicRef, expected);
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: SYSTEM_ACTOR,
            actorRole: "system",
            action: `profile.public_projection_${outcome}`,
            entityType: "publicProfile",
            entityId: profileId,
            newStatus: "published",
            metadata: { sourceCollection: "profiles" },
            createdAt: now,
        });
        return outcome;
    });
}
async function deleteStaleProjection(profileId) {
    const db = (0, security_1.getDb)();
    const profileRef = db.collection("profiles").doc(profileId);
    const publicRef = db.collection("publicProfiles").doc(profileId);
    return db.runTransaction(async (transaction) => {
        const [profileSnapshot, publicSnapshot] = await Promise.all([
            transaction.get(profileRef),
            transaction.get(publicRef),
        ]);
        if (!publicSnapshot.exists)
            return "missing";
        const profile = profileSnapshot.data();
        if (profileSnapshot.exists && profile?.published === true)
            return "not_stale";
        const now = Date.now();
        const reason = profileSnapshot.exists ? "source_private" : "source_missing";
        transaction.delete(publicRef);
        (0, security_1.writeExchangeAudit)(transaction, db, {
            actorUid: SYSTEM_ACTOR,
            actorRole: "system",
            action: "profile.public_projection_deleted",
            entityType: "publicProfile",
            entityId: profileId,
            previousStatus: "published",
            newStatus: "private",
            metadata: { reason },
            createdAt: now,
        });
        return "deleted";
    });
}
async function backfillPublicProfiles(options = {}) {
    ensureAdmin(options.projectId);
    const apply = options.apply === true;
    const pageSize = Math.min(Math.max(options.pageSize ?? 250, 1), 500);
    const limit = Math.max(options.limit ?? Number.MAX_SAFE_INTEGER, 0);
    const projectId = configuredProjectId();
    if (options.projectId && options.projectId !== projectId) {
        throw new Error(`Configured Firebase project ${projectId} does not match --project=${options.projectId}`);
    }
    if (apply && !options.projectId) {
        throw new Error("--apply requires an explicit --project=<project-id>");
    }
    if (apply && projectId === "unknown") {
        throw new Error("--apply requires a resolvable Firebase project ID");
    }
    if (apply && options.confirmProject !== projectId) {
        throw new Error(`--apply requires --confirm-project=${projectId}`);
    }
    const report = {
        projectId,
        dryRun: !apply,
        total: 0,
        published: 0,
        private: 0,
        alreadyCurrent: 0,
        wouldCreate: 0,
        wouldUpdate: 0,
        staleProjection: 0,
        wouldDelete: 0,
        updatesApplied: 0,
        deletesApplied: 0,
        failed: 0,
    };
    const db = (0, security_1.getDb)();
    let lastProfile;
    while (report.total < limit) {
        const remaining = limit - report.total;
        const queryLimit = Math.min(pageSize, remaining);
        let query = db.collection("profiles")
            .orderBy(firestore_1.FieldPath.documentId())
            .limit(queryLimit);
        if (lastProfile)
            query = query.startAfter(lastProfile);
        const snapshot = await query.get();
        if (snapshot.empty)
            break;
        for (const profileSnapshot of snapshot.docs) {
            report.total += 1;
            const profile = profileSnapshot.data();
            if (profile.published !== true) {
                report.private += 1;
                continue;
            }
            report.published += 1;
            try {
                const expected = (0, publicProfiles_1.sanitizePublicProfile)(profileSnapshot.id, profile);
                const publicSnapshot = await db.collection("publicProfiles").doc(profileSnapshot.id).get();
                if (!publicSnapshot.exists)
                    report.wouldCreate += 1;
                else if ((0, node_util_1.isDeepStrictEqual)(publicSnapshot.data(), expected))
                    report.alreadyCurrent += 1;
                else
                    report.wouldUpdate += 1;
                if (apply && (!publicSnapshot.exists || !(0, node_util_1.isDeepStrictEqual)(publicSnapshot.data(), expected))) {
                    const outcome = await syncPublishedProjection(profileSnapshot.id);
                    if (outcome === "created" || outcome === "updated")
                        report.updatesApplied += 1;
                    else if (outcome === "deleted_stale") {
                        report.staleProjection += 1;
                        report.wouldDelete += 1;
                        report.deletesApplied += 1;
                    }
                }
            }
            catch (error) {
                report.failed += 1;
                console.error("[backfillPublicProfiles] projection sync failed", {
                    profileId: profileSnapshot.id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        lastProfile = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.size < queryLimit)
            break;
    }
    // A second pass removes projections whose authoritative profile is private or
    // no longer exists. Sources are read directly, so cleanup remains safe even
    // when --limit intentionally processes only part of the profile collection.
    let projectionsScanned = 0;
    let lastProjection;
    while (projectionsScanned < limit) {
        const remaining = limit - projectionsScanned;
        const queryLimit = Math.min(pageSize, remaining);
        let query = db.collection("publicProfiles")
            .orderBy(firestore_1.FieldPath.documentId())
            .limit(queryLimit);
        if (lastProjection)
            query = query.startAfter(lastProjection);
        const snapshot = await query.get();
        if (snapshot.empty)
            break;
        for (const publicSnapshot of snapshot.docs) {
            projectionsScanned += 1;
            try {
                const profileSnapshot = await db.collection("profiles").doc(publicSnapshot.id).get();
                if (profileSnapshot.exists && profileSnapshot.data()?.published === true)
                    continue;
                report.staleProjection += 1;
                report.wouldDelete += 1;
                if (apply) {
                    const outcome = await deleteStaleProjection(publicSnapshot.id);
                    if (outcome === "deleted")
                        report.deletesApplied += 1;
                }
            }
            catch (error) {
                report.failed += 1;
                console.error("[backfillPublicProfiles] stale projection cleanup failed", {
                    profileId: publicSnapshot.id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        lastProjection = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.size < queryLimit)
            break;
    }
    return report;
}
function parsePositiveIntegerFlag(value, flag) {
    if (value === undefined)
        return undefined;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}
if (require.main === module) {
    const args = process.argv.slice(2);
    const allowedFlags = ["--apply", "--project=", "--confirm-project=", "--limit=", "--page-size="];
    const unknownFlag = args.find((argument) => !allowedFlags.some((flag) => (flag === "--apply" ? argument === flag : argument.startsWith(flag))));
    if (unknownFlag) {
        console.error(`[backfillPublicProfiles] unknown argument: ${unknownFlag}`);
        process.exit(1);
    }
    const valueFor = (name) => args.find((argument) => argument.startsWith(`${name}=`))
        ?.slice(name.length + 1);
    const options = {
        apply: args.includes("--apply"),
        projectId: valueFor("--project"),
        confirmProject: valueFor("--confirm-project"),
        limit: parsePositiveIntegerFlag(valueFor("--limit"), "--limit"),
        pageSize: parsePositiveIntegerFlag(valueFor("--page-size"), "--page-size"),
    };
    backfillPublicProfiles(options)
        .then((report) => {
        console.log(JSON.stringify(report, null, 2));
        process.exit(report.failed > 0 ? 1 : 0);
    })
        .catch((error) => {
        console.error("[backfillPublicProfiles] failed", error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
