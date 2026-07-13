import { isDeepStrictEqual } from "node:util";
import * as admin from "firebase-admin";
import { FieldPath } from "firebase-admin/firestore";
import { sanitizePublicProfile } from "../exchange/publicProfiles";
import { getDb, writeExchangeAudit } from "../exchange/security";

export { sanitizePublicProfile } from "../exchange/publicProfiles";

/**
 * Rebuilds the public profile directory from the private, authoritative profile
 * collection. The command is a dry run unless --apply is supplied.
 *
 * Apply example:
 *   node lib/scripts/backfillPublicProfiles.js --apply \
 *     --project=my-project --confirm-project=my-project
 */

export interface BackfillPublicProfilesOptions {
  apply?: boolean;
  projectId?: string;
  confirmProject?: string;
  limit?: number;
  pageSize?: number;
}

export interface BackfillPublicProfilesReport {
  projectId: string;
  dryRun: boolean;
  total: number;
  published: number;
  private: number;
  alreadyCurrent: number;
  wouldCreate: number;
  wouldUpdate: number;
  staleProjection: number;
  wouldDelete: number;
  updatesApplied: number;
  deletesApplied: number;
  failed: number;
}

const SYSTEM_ACTOR = "system:public-profile-backfill";

function ensureAdmin(projectId?: string): void {
  if (admin.apps.length > 0) return;
  admin.initializeApp(projectId ? { projectId } : undefined);
}

function configuredProjectId(): string {
  return String(
    admin.app().options.projectId
      ?? process.env.GCLOUD_PROJECT
      ?? process.env.GOOGLE_CLOUD_PROJECT
      ?? "unknown",
  );
}

type ProjectionSyncOutcome = "created" | "updated" | "already_current" | "deleted_stale" | "no_change";

async function syncPublishedProjection(profileId: string): Promise<ProjectionSyncOutcome> {
  const db = getDb();
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
      if (!publicSnapshot.exists) return "no_change";
      const now = Date.now();
      const reason = profileSnapshot.exists ? "source_private" : "source_missing";
      transaction.delete(publicRef);
      writeExchangeAudit(transaction, db, {
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

    const expected = sanitizePublicProfile(profileId, profile);
    const current = publicSnapshot.data();
    if (publicSnapshot.exists && current && isDeepStrictEqual(current, expected)) {
      return "already_current";
    }

    const now = Date.now();
    const outcome = publicSnapshot.exists ? "updated" : "created";
    transaction.set(publicRef, expected);
    writeExchangeAudit(transaction, db, {
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

type StaleDeleteOutcome = "deleted" | "not_stale" | "missing";

async function deleteStaleProjection(profileId: string): Promise<StaleDeleteOutcome> {
  const db = getDb();
  const profileRef = db.collection("profiles").doc(profileId);
  const publicRef = db.collection("publicProfiles").doc(profileId);

  return db.runTransaction(async (transaction) => {
    const [profileSnapshot, publicSnapshot] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(publicRef),
    ]);
    if (!publicSnapshot.exists) return "missing";
    const profile = profileSnapshot.data();
    if (profileSnapshot.exists && profile?.published === true) return "not_stale";

    const now = Date.now();
    const reason = profileSnapshot.exists ? "source_private" : "source_missing";
    transaction.delete(publicRef);
    writeExchangeAudit(transaction, db, {
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

export async function backfillPublicProfiles(
  options: BackfillPublicProfilesOptions = {},
): Promise<BackfillPublicProfilesReport> {
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

  const report: BackfillPublicProfilesReport = {
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

  const db = getDb();
  let lastProfile: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (report.total < limit) {
    const remaining = limit - report.total;
    const queryLimit = Math.min(pageSize, remaining);
    let query = db.collection("profiles")
      .orderBy(FieldPath.documentId())
      .limit(queryLimit);
    if (lastProfile) query = query.startAfter(lastProfile);
    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const profileSnapshot of snapshot.docs) {
      report.total += 1;
      const profile = profileSnapshot.data();
      if (profile.published !== true) {
        report.private += 1;
        continue;
      }

      report.published += 1;
      try {
        const expected = sanitizePublicProfile(profileSnapshot.id, profile);
        const publicSnapshot = await db.collection("publicProfiles").doc(profileSnapshot.id).get();
        if (!publicSnapshot.exists) report.wouldCreate += 1;
        else if (isDeepStrictEqual(publicSnapshot.data(), expected)) report.alreadyCurrent += 1;
        else report.wouldUpdate += 1;

        if (apply && (!publicSnapshot.exists || !isDeepStrictEqual(publicSnapshot.data(), expected))) {
          const outcome = await syncPublishedProjection(profileSnapshot.id);
          if (outcome === "created" || outcome === "updated") report.updatesApplied += 1;
          else if (outcome === "deleted_stale") {
            report.staleProjection += 1;
            report.wouldDelete += 1;
            report.deletesApplied += 1;
          }
        }
      } catch (error) {
        report.failed += 1;
        console.error("[backfillPublicProfiles] projection sync failed", {
          profileId: profileSnapshot.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    lastProfile = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < queryLimit) break;
  }

  // A second pass removes projections whose authoritative profile is private or
  // no longer exists. Sources are read directly, so cleanup remains safe even
  // when --limit intentionally processes only part of the profile collection.
  let projectionsScanned = 0;
  let lastProjection: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (projectionsScanned < limit) {
    const remaining = limit - projectionsScanned;
    const queryLimit = Math.min(pageSize, remaining);
    let query = db.collection("publicProfiles")
      .orderBy(FieldPath.documentId())
      .limit(queryLimit);
    if (lastProjection) query = query.startAfter(lastProjection);
    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const publicSnapshot of snapshot.docs) {
      projectionsScanned += 1;
      try {
        const profileSnapshot = await db.collection("profiles").doc(publicSnapshot.id).get();
        if (profileSnapshot.exists && profileSnapshot.data()?.published === true) continue;

        report.staleProjection += 1;
        report.wouldDelete += 1;
        if (apply) {
          const outcome = await deleteStaleProjection(publicSnapshot.id);
          if (outcome === "deleted") report.deletesApplied += 1;
        }
      } catch (error) {
        report.failed += 1;
        console.error("[backfillPublicProfiles] stale projection cleanup failed", {
          profileId: publicSnapshot.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    lastProjection = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < queryLimit) break;
  }

  return report;
}

function parsePositiveIntegerFlag(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== value) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const allowedFlags = ["--apply", "--project=", "--confirm-project=", "--limit=", "--page-size="];
  const unknownFlag = args.find((argument) => !allowedFlags.some((flag) => (
    flag === "--apply" ? argument === flag : argument.startsWith(flag)
  )));
  if (unknownFlag) {
    console.error(`[backfillPublicProfiles] unknown argument: ${unknownFlag}`);
    process.exit(1);
  }

  const valueFor = (name: string) => args.find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  const options: BackfillPublicProfilesOptions = {
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
      console.error(
        "[backfillPublicProfiles] failed",
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    });
}
