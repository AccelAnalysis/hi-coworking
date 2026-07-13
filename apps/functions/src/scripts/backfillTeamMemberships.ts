import * as admin from "firebase-admin";
import { FieldPath } from "firebase-admin/firestore";
import { getDb, writeExchangeAudit } from "../exchange/security";

const TEAM_MEMBERSHIP_COLLECTION = "rfxTeamMemberships";
const TEAM_MEMBERSHIP_REVIEW_COLLECTION = "rfxTeamMembershipReviews";
const TEAM_ROLES = new Set(["prime", "sub", "estimator", "compliance", "proposal_writer"]);
const MAX_TEAM_MEMBERS = 100;
const MAX_TRANSACTION_WRITES = 450;

export interface BackfillTeamMembershipOptions {
  apply?: boolean;
  projectId?: string;
  confirmProject?: string;
  limit?: number;
  pageSize?: number;
}

export interface TeamMembershipBackfillReport {
  projectId: string;
  dryRun: boolean;
  totalScanned: number;
  validTeams: number;
  reviewTeams: number;
  canonicalMembers: number;
  missingOrInvalidGuards: number;
  staleGuards: number;
  wouldWriteGuards: number;
  wouldDeleteGuards: number;
  guardWritesApplied: number;
  guardDeletesApplied: number;
  reviewRecordsApplied: number;
  reviewRecordsAlreadyPresent: number;
  reviewRecordsResolved: number;
  failedTeams: number;
  reviewRequiredTeamIds: string[];
}

interface TeamMember {
  uid: string;
  role: string;
}

interface TeamAssessment {
  valid: boolean;
  reasons: string[];
  rfxId: string | null;
  primeUid: string | null;
  members: TeamMember[];
}

interface GuardDelta {
  writes: number;
  deletes: number;
  missingOrInvalid: number;
  stale: number;
}

interface ApplyOutcome {
  valid: boolean;
  memberCount: number;
  guardWrites: number;
  guardDeletes: number;
  reviewApplied: number;
  reviewAlreadyPresent: number;
  reviewResolved: number;
  reasons: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && /^[A-Za-z0-9_.:@-]+$/.test(value);
}

function uniqueReasons(reasons: string[]): string[] {
  return [...new Set(reasons)].sort();
}

function assessTeam(
  teamId: string,
  data: FirebaseFirestore.DocumentData,
): TeamAssessment {
  const reasons: string[] = [];
  if (data.id !== undefined && data.id !== teamId) reasons.push("team_identity_mismatch");

  const rfxId = isSafeId(data.rfxId) ? data.rfxId : null;
  if (!rfxId) reasons.push("invalid_rfx_id");
  const primeUid = isSafeId(data.primeUid) ? data.primeUid : null;
  if (!primeUid) reasons.push("invalid_prime_uid");

  const members: TeamMember[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(data.members)) {
    reasons.push("members_not_array");
  } else {
    if (data.members.length === 0) reasons.push("members_empty");
    if (data.members.length > MAX_TEAM_MEMBERS) reasons.push("member_limit_exceeded");
    for (const rawMember of data.members) {
      if (
        !isRecord(rawMember)
        || !isSafeId(rawMember.uid)
        || typeof rawMember.role !== "string"
        || !TEAM_ROLES.has(rawMember.role)
      ) {
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
  } else if (
    data.memberUids.length !== members.length
    || data.memberUids.some((uid: unknown, index: number) => uid !== members[index]?.uid)
  ) {
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

function guardMatches(
  data: FirebaseFirestore.DocumentData | undefined,
  teamId: string,
  rfxId: string,
  member: TeamMember,
): boolean {
  return Boolean(data)
    && data?.id === member.uid
    && data.uid === member.uid
    && data.teamId === teamId
    && data.rfxId === rfxId
    && data.role === member.role;
}

function calculateGuardDelta(
  teamId: string,
  assessment: TeamAssessment,
  guards: FirebaseFirestore.QuerySnapshot,
): GuardDelta {
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

function sameReasons(left: unknown, right: string[]): boolean {
  return Array.isArray(left)
    && JSON.stringify([...left].sort()) === JSON.stringify(right);
}

async function applyTeamMemberships(teamId: string): Promise<ApplyOutcome> {
  const db = getDb();
  const teamRef = db.collection("rfxTeams").doc(teamId);
  const memberships = db.collection(TEAM_MEMBERSHIP_COLLECTION).doc(teamId).collection("members");
  const reviewRef = db.collection(TEAM_MEMBERSHIP_REVIEW_COLLECTION).doc(teamId);

  return db.runTransaction(async (transaction) => {
    const [teamSnap, guardSnaps, reviewSnap] = await Promise.all([
      transaction.get(teamRef),
      transaction.get(memberships),
      transaction.get(reviewRef),
    ]);
    if (!teamSnap.exists) throw new Error("Team no longer exists");

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
      throw new Error(
        `Team requires ${totalWrites} atomic writes; manual review is required before rules deployment`,
      );
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
        if (!desired.has(guard.id)) transaction.delete(guard.ref);
      }
      if (reviewResolved) {
        transaction.set(reviewRef, {
          status: "resolved",
          resolvedAt: now,
          lastSeenAt: now,
          resolvedByUid: "system:team-membership-backfill",
        }, { merge: true });
      }
    } else {
      for (const guard of guardSnaps.docs) transaction.delete(guard.ref);
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
      writeExchangeAudit(transaction, db, {
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

function ensureAdmin(projectId?: string): void {
  if (admin.apps.length > 0) return;
  admin.initializeApp(projectId ? { projectId } : undefined);
}

export async function backfillTeamMemberships(
  options: BackfillTeamMembershipOptions = {},
): Promise<TeamMembershipBackfillReport> {
  ensureAdmin(options.projectId);
  const apply = options.apply === true;
  const pageSize = Math.min(Math.max(options.pageSize ?? 200, 1), 500);
  const limit = Math.max(options.limit ?? Number.MAX_SAFE_INTEGER, 0);
  const configuredProjectId = String(
    admin.app().options.projectId
      ?? process.env.GCLOUD_PROJECT
      ?? process.env.GOOGLE_CLOUD_PROJECT
      ?? "unknown",
  );

  if (options.projectId && configuredProjectId !== options.projectId) {
    throw new Error(
      `Configured Firebase project ${configuredProjectId} does not match --project=${options.projectId}`,
    );
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

  const report: TeamMembershipBackfillReport = {
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

  const db = getDb();
  let lastTeam: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  while (report.totalScanned < limit) {
    const remaining = limit - report.totalScanned;
    let query = db.collection("rfxTeams")
      .orderBy(FieldPath.documentId())
      .limit(Math.min(pageSize, remaining));
    if (lastTeam) query = query.startAfter(lastTeam);
    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const teamDoc of snapshot.docs) {
      report.totalScanned += 1;
      const assessment = assessTeam(teamDoc.id, teamDoc.data());
      const guards = await db.collection(TEAM_MEMBERSHIP_COLLECTION)
        .doc(teamDoc.id)
        .collection("members")
        .get();
      const delta = calculateGuardDelta(teamDoc.id, assessment, guards);
      if (assessment.valid) report.validTeams += 1;
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
        } catch (error) {
          report.failedTeams += 1;
          console.error("[backfillTeamMemberships] team reconciliation failed", {
            teamId: teamDoc.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    lastTeam = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < Math.min(pageSize, remaining)) break;
  }
  return report;
}

function parsePositiveIntegerFlag(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const valueFor = (name: string) => args
    .find((arg) => arg.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  const options: BackfillTeamMembershipOptions = {
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
      console.error(
        "[backfillTeamMemberships] failed",
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    });
}
