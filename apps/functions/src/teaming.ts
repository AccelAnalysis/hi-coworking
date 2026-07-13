import { createHash } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  nonPrimeTeamRoleSchema,
  parseCallableInput,
  teamCreateInputSchema,
  teamInviteInputSchema,
  teamManageMemberInputSchema,
  teamRespondInviteInputSchema,
  teamRevokeInviteInputSchema,
} from "./exchange/contracts";
import {
  evaluateTransactionEligibility,
  getAuthorizedActor,
  getDb,
  idempotencyRef,
  setCompletedIdempotency,
  throwEligibilityFailure,
  writeExchangeAudit,
  type AuthorizedActor,
} from "./exchange/security";

const ACTIVE_TEAM_STATUSES = new Set(["forming", "active"]);
const NON_PRIME_ROLES = new Set(["sub", "estimator", "compliance", "proposal_writer"]);
const INVITE_GUARD_COLLECTION = "rfxTeamInviteGuards";
const INVITE_REVIEW_COLLECTION = "rfxTeamInviteReviews";
const TEAM_MEMBERSHIP_COLLECTION = "rfxTeamMemberships";
const MAX_INVITES_PER_EXPIRY_RUN = 200;
const MAX_TEAM_MEMBERS = 100;
const DAY_MS = 24 * 60 * 60 * 1_000;

type TeamRole = "prime" | "sub" | "estimator" | "compliance" | "proposal_writer";
type NonPrimeTeamRole = Exclude<TeamRole, "prime">;
type InvitationStatus = "pending" | "accepted" | "declined" | "revoked" | "expired";

interface TeamMember {
  uid: string;
  role: TeamRole;
  displayName?: string;
  businessName?: string;
  joinedAt?: number;
  scopeDescription?: string;
  [key: string]: unknown;
}

interface TeamRecord extends FirebaseFirestore.DocumentData {
  id?: string;
  rfxId?: string;
  orgId?: string;
  name?: string;
  primeUid?: string;
  members?: unknown;
  memberUids?: unknown;
  status?: string;
  version?: number;
}

interface InviteRecord extends FirebaseFirestore.DocumentData {
  id?: string;
  teamId?: string;
  rfxId?: string;
  inviterUid?: string;
  inviteeUid?: string;
  inviteeName?: string;
  role?: string;
  status?: string;
  expiresAt?: unknown;
  version?: number;
}

type DeferredFailure = {
  ok: false;
  code: "failed-precondition" | "not-found";
  message: string;
  reason: string;
};

type RespondOutcome =
  | { ok: true; teamId: string; status: "accepted" | "declined"; replayed: boolean }
  | DeferredFailure;

type RevokeOutcome =
  | { ok: true; inviteId: string; status: "revoked"; replayed: boolean }
  | DeferredFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSafeId(value: unknown): value is string {
  return isNonEmptyString(value)
    && value.length <= 128
    && /^[A-Za-z0-9_.:@-]+$/.test(value);
}

function versionOf(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function toMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (isRecord(value) && typeof value.toMillis === "function") {
    const millis = (value.toMillis as (this: unknown) => unknown).call(value);
    return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
  }
  if (isRecord(value) && typeof value.seconds === "number") {
    return value.seconds * 1_000 + (typeof value.nanoseconds === "number" ? value.nanoseconds / 1_000_000 : 0);
  }
  return null;
}

function requiredString(
  data: FirebaseFirestore.DocumentData,
  field: string,
  message: string,
): string {
  const value = data[field];
  if (!isNonEmptyString(value)) {
    throw new HttpsError("failed-precondition", message);
  }
  return value;
}

function optionalString(data: FirebaseFirestore.DocumentData, field: string): string | undefined {
  const value = data[field];
  return isNonEmptyString(value) ? value : undefined;
}

function assertExactDocumentId(
  data: FirebaseFirestore.DocumentData,
  documentId: string,
  entityLabel: string,
): void {
  if (data.id !== undefined && data.id !== documentId) {
    throw new HttpsError("failed-precondition", `${entityLabel} identity is inconsistent`);
  }
}

function assertRfxRelationship(
  rfx: FirebaseFirestore.DocumentData,
  rfxId: string,
): { territoryFips: string } {
  assertExactDocumentId(rfx, rfxId, "RFx");
  const territoryFips = requiredString(rfx, "territoryFips", "RFx territory is invalid");
  if (!/^\d{5}$/.test(territoryFips)) {
    throw new HttpsError("failed-precondition", "RFx territory is invalid");
  }
  return { territoryFips };
}

function assertRfxOpenForTeaming(rfx: FirebaseFirestore.DocumentData, rfxId: string, now: number): string {
  const { territoryFips } = assertRfxRelationship(rfx, rfxId);
  if (rfx.status !== "open" || rfx.adminApprovalStatus !== "approved") {
    throw new HttpsError("failed-precondition", "RFx is not open and approved for teaming");
  }
  const dueDate = toMillis(rfx.dueDate);
  if (dueDate !== null && dueDate <= now) {
    throw new HttpsError("failed-precondition", "RFx response deadline has passed");
  }
  return territoryFips;
}

function assertTeamRelationship(
  team: TeamRecord,
  teamId: string,
  expectedRfxId?: string,
): string {
  assertExactDocumentId(team, teamId, "Team");
  const rfxId = requiredString(team, "rfxId", "Team RFx relationship is invalid");
  if (expectedRfxId !== undefined && rfxId !== expectedRfxId) {
    throw new HttpsError("failed-precondition", "Team does not belong to the specified RFx");
  }
  return rfxId;
}

function assertActiveTeam(team: TeamRecord): void {
  if (!isNonEmptyString(team.status) || !ACTIVE_TEAM_STATUSES.has(team.status)) {
    throw new HttpsError("failed-precondition", "Team is not open for membership changes");
  }
}

function parseMembers(team: TeamRecord): TeamMember[] {
  if (!Array.isArray(team.members)) {
    throw new HttpsError("failed-precondition", "Team membership data is invalid");
  }
  if (team.members.length === 0 || team.members.length > MAX_TEAM_MEMBERS) {
    throw new HttpsError("failed-precondition", "Team membership count is invalid");
  }

  const members: TeamMember[] = [];
  const seen = new Set<string>();
  for (const rawMember of team.members) {
    if (!isRecord(rawMember) || !isNonEmptyString(rawMember.uid) || !isNonEmptyString(rawMember.role)) {
      throw new HttpsError("failed-precondition", "Team membership data is invalid");
    }
    const role = rawMember.role;
    if (role !== "prime" && !NON_PRIME_ROLES.has(role)) {
      throw new HttpsError("failed-precondition", "Team contains an invalid member role");
    }
    if (seen.has(rawMember.uid)) {
      throw new HttpsError("failed-precondition", "Team contains duplicate members");
    }
    seen.add(rawMember.uid);
    members.push({ ...rawMember, uid: rawMember.uid, role: role as TeamRole });
  }

  const primeUid = requiredString(team, "primeUid", "Team prime is invalid");
  const primeMembers = members.filter((member) => member.role === "prime");
  if (primeMembers.length !== 1 || primeMembers[0].uid !== primeUid) {
    throw new HttpsError("failed-precondition", "Team must have exactly one designated prime");
  }

  if (
    !Array.isArray(team.memberUids)
    || team.memberUids.length !== members.length
    || team.memberUids.some((uid, index) => !isNonEmptyString(uid) || uid !== members[index].uid)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Team members and memberUids must have exact ordered parity",
    );
  }
  return members;
}

function isMember(members: TeamMember[], uid: string): boolean {
  return members.some((member) => member.uid === uid);
}

function isListedMemberUid(team: TeamRecord, uid: string): boolean {
  return Array.isArray(team.memberUids) && team.memberUids.includes(uid);
}

function displayNameFrom(data: FirebaseFirestore.DocumentData | undefined, fallback: string): string {
  return data && isNonEmptyString(data.displayName) ? data.displayName : fallback;
}

function businessNameFrom(data: FirebaseFirestore.DocumentData | undefined): string {
  return data && isNonEmptyString(data.businessName) ? data.businessName : "Unknown Business";
}

function inviteGuardRef(
  db: FirebaseFirestore.Firestore,
  teamId: string,
  inviteeUid: string,
): FirebaseFirestore.DocumentReference {
  const guardId = createHash("sha256").update(`${teamId}\u0000${inviteeUid}`).digest("hex");
  return db.collection(INVITE_GUARD_COLLECTION).doc(guardId);
}

function teamMembershipRef(
  db: FirebaseFirestore.Firestore,
  teamId: string,
  uid: string,
): FirebaseFirestore.DocumentReference {
  return db.collection(TEAM_MEMBERSHIP_COLLECTION).doc(teamId).collection("members").doc(uid);
}

function teamMembershipData(params: {
  teamId: string;
  rfxId: string;
  member: TeamMember;
  now: number;
  createdAt?: number;
}): Record<string, unknown> {
  return {
    id: params.member.uid,
    teamId: params.teamId,
    rfxId: params.rfxId,
    uid: params.member.uid,
    role: params.member.role,
    createdAt: params.createdAt ?? params.now,
    updatedAt: params.now,
  };
}

function assertMembershipGuard(
  guardSnap: FirebaseFirestore.DocumentSnapshot,
  params: { teamId: string; rfxId: string; member: TeamMember },
): void {
  const guard = guardSnap.data();
  if (
    !guardSnap.exists
    || guard?.id !== params.member.uid
    || guard?.teamId !== params.teamId
    || guard?.rfxId !== params.rfxId
    || guard?.uid !== params.member.uid
    || guard?.role !== params.member.role
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Authoritative team membership is missing or inconsistent; administrator review is required",
    );
  }
}

function teamCreateFingerprint(input: {
  rfxId: string;
  name: string;
  internalNotes?: string;
  orgId?: string;
}): string {
  return createHash("sha256").update(JSON.stringify({
    rfxId: input.rfxId,
    name: input.name,
    internalNotes: input.internalNotes ?? null,
    orgId: input.orgId ?? null,
  })).digest("hex");
}

function clearMatchingInviteGuard(
  transaction: FirebaseFirestore.Transaction,
  guardSnap: FirebaseFirestore.DocumentSnapshot,
  inviteId: string,
): void {
  if (guardSnap.exists && guardSnap.data()?.activeInviteId === inviteId) {
    transaction.delete(guardSnap.ref);
  }
}

function reviewFailure(
  transaction: FirebaseFirestore.Transaction,
  db: FirebaseFirestore.Firestore,
  params: {
    actor: AuthorizedActor;
    inviteId: string;
    reason: string;
    message: string;
    rfxId?: string;
    inviterUid?: string;
    inviteeUid?: string;
    candidateTeamIds?: string[];
    now: number;
  },
): DeferredFailure {
  const reviewRef = db.collection(INVITE_REVIEW_COLLECTION).doc(params.inviteId);
  transaction.set(
    reviewRef,
    {
      id: reviewRef.id,
      inviteId: params.inviteId,
      status: "needs_admin_review",
      reason: params.reason,
      message: params.message,
      rfxId: params.rfxId ?? null,
      inviterUid: params.inviterUid ?? null,
      inviteeUid: params.inviteeUid ?? null,
      candidateTeamIds: params.candidateTeamIds ?? [],
      candidateCount: params.candidateTeamIds?.length ?? 0,
      reportedByUid: params.actor.uid,
      reportedByRole: params.actor.role,
      lastSeenAt: params.now,
    },
    { merge: true },
  );
  writeExchangeAudit(transaction, db, {
    actorUid: params.actor.uid,
    actorRole: params.actor.role,
    action: "team_invite_flagged_for_review",
    entityType: "rfxTeamInvite",
    entityId: params.inviteId,
    metadata: {
      reason: params.reason,
      candidateCount: params.candidateTeamIds?.length ?? 0,
    },
    createdAt: params.now,
  });
  return {
    ok: false,
    code: "failed-precondition",
    message: params.message,
    reason: params.reason,
  };
}

function throwDeferredFailure(outcome: DeferredFailure): never {
  throw new HttpsError(outcome.code, outcome.message, { reason: outcome.reason });
}

function listedTeamRecord(
  teamId: string,
  team: TeamRecord,
  members: TeamMember[],
): Record<string, unknown> | null {
  if (
    !isNonEmptyString(team.rfxId)
    || !isNonEmptyString(team.name)
    || !isNonEmptyString(team.primeUid)
    || !isNonEmptyString(team.status)
    || typeof team.createdAt !== "number"
  ) {
    return null;
  }
  const result: Record<string, unknown> = {
    id: teamId,
    rfxId: team.rfxId,
    name: team.name,
    primeUid: team.primeUid,
    members: members.map((member) => ({
      uid: member.uid,
      role: member.role,
      ...(isNonEmptyString(member.displayName) ? { displayName: member.displayName } : {}),
      ...(isNonEmptyString(member.businessName) ? { businessName: member.businessName } : {}),
      ...(typeof member.joinedAt === "number" ? { joinedAt: member.joinedAt } : { joinedAt: 0 }),
      ...(isNonEmptyString(member.scopeDescription)
        ? { scopeDescription: member.scopeDescription }
        : {}),
    })),
    memberUids: members.map((member) => member.uid),
    status: team.status,
    createdAt: team.createdAt,
  };
  if (isNonEmptyString(team.orgId)) result.orgId = team.orgId;
  if (isNonEmptyString(team.internalNotes)) result.internalNotes = team.internalNotes;
  if (typeof team.version === "number") result.version = team.version;
  if (typeof team.updatedAt === "number") result.updatedAt = team.updatedAt;
  if (typeof team.schemaVersion === "number") result.schemaVersion = team.schemaVersion;
  return result;
}

/** List only teams backed by the caller's exact authoritative membership guard. */
export const team_listMine = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  if (
    request.data !== undefined
    && request.data !== null
    && (!isRecord(request.data) || Object.keys(request.data).length > 0)
  ) {
    throw new HttpsError("invalid-argument", "team_listMine does not accept input fields");
  }

  const db = getDb();
  const membershipSnaps = await db.collectionGroup("members")
    .where("uid", "==", actor.uid)
    .limit(500)
    .get();
  const exactGuards = membershipSnaps.docs.filter((guard) => {
    const teamParent = guard.ref.parent.parent;
    return guard.id === actor.uid
      && teamParent !== null
      && teamParent.parent.id === TEAM_MEMBERSHIP_COLLECTION;
  });
  const uniqueGuards = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const guard of exactGuards) {
    const teamId = guard.ref.parent.parent?.id;
    if (teamId && !uniqueGuards.has(teamId)) uniqueGuards.set(teamId, guard);
  }
  const selectedGuards = [...uniqueGuards.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 120);
  const teamSnaps = await Promise.all(selectedGuards.map(([teamId]) => (
    db.collection("rfxTeams").doc(teamId).get()
  )));

  const teams: Record<string, unknown>[] = [];
  for (let index = 0; index < selectedGuards.length; index += 1) {
    const [teamId, guardSnap] = selectedGuards[index];
    const teamSnap = teamSnaps[index];
    const team = teamSnap.data() as TeamRecord | undefined;
    if (!teamSnap.exists || !team) continue;
    try {
      const rfxId = assertTeamRelationship(team, teamId);
      const members = parseMembers(team);
      const actorMember = members.find((member) => member.uid === actor.uid);
      if (!actorMember) continue;
      assertMembershipGuard(guardSnap, { teamId, rfxId, member: actorMember });
      const listed = listedTeamRecord(teamId, team, members);
      if (listed) teams.push(listed);
    } catch (error) {
      logger.warn("Skipped inconsistent authoritative team membership", {
        teamId,
        uid: actor.uid,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  teams.sort((left, right) => {
    const leftUpdatedAt = typeof left.updatedAt === "number"
      ? left.updatedAt
      : left.createdAt as number;
    const rightUpdatedAt = typeof right.updatedAt === "number"
      ? right.updatedAt
      : right.createdAt as number;
    return rightUpdatedAt - leftUpdatedAt;
  });
  return {
    teams,
    truncated: uniqueGuards.size > selectedGuards.length,
  };
});

/** Create an RFx team. The authenticated creator is its only prime. */
export const team_create = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(teamCreateInputSchema, request.data);
  const db = getDb();
  const teamRef = db.collection("rfxTeams").doc();
  const operationRef = idempotencyRef(db, actor.uid, "team_create", input.idempotencyKey);
  const requestFingerprint = teamCreateFingerprint(input);

  return db.runTransaction(async (transaction) => {
    const operationSnap = await transaction.get(operationRef);
    if (operationSnap.exists) {
      const operation = operationSnap.data();
      const existingTeamId = operation?.result?.teamId;
      if (
        operation?.uid !== actor.uid
        || operation?.action !== "team_create"
        || operation?.status !== "completed"
        || !isNonEmptyString(existingTeamId)
        || operation?.result?.requestFingerprint !== requestFingerprint
      ) {
        throw new HttpsError("failed-precondition", "Idempotency record is inconsistent");
      }
      if (!isSafeId(existingTeamId)) {
        throw new HttpsError("failed-precondition", "Idempotent team identity is invalid");
      }
      const existingTeamSnap = await transaction.get(db.collection("rfxTeams").doc(existingTeamId));
      const existingTeam = existingTeamSnap.data() as TeamRecord | undefined;
      if (
        !existingTeamSnap.exists
        || !existingTeam
        || existingTeam.rfxId !== input.rfxId
        || existingTeam.primeUid !== actor.uid
      ) {
        throw new HttpsError("failed-precondition", "Idempotent team result is unavailable");
      }
      const existingMembers = parseMembers(existingTeam);
      const existingPrime = existingMembers.find((member) => member.uid === actor.uid);
      if (!existingPrime) {
        throw new HttpsError("failed-precondition", "Idempotent team prime is unavailable");
      }
      const membershipSnap = await transaction.get(
        teamMembershipRef(db, existingTeamId, actor.uid),
      );
      assertMembershipGuard(membershipSnap, {
        teamId: existingTeamId,
        rfxId: input.rfxId,
        member: existingPrime,
      });
      return { teamId: existingTeamId, replayed: true };
    }

    const rfxRef = db.collection("rfx").doc(input.rfxId);
    const rfxSnap = await transaction.get(rfxRef);
    const rfx = rfxSnap.data();
    if (!rfxSnap.exists || !rfx) {
      throw new HttpsError("not-found", "RFx not found");
    }

    const now = Date.now();
    const territoryFips = assertRfxOpenForTeaming(rfx, input.rfxId, now);
    const eligibility = await evaluateTransactionEligibility({
      transaction,
      db,
      actor,
      territoryFips,
      orgId: input.orgId,
      requireVerification: true,
      permittedRoles: ["member", "externalVendor", "econPartner"],
    });
    if (!eligibility.result.allowed) throwEligibilityFailure(eligibility.result);

    const primeMember: TeamMember = {
      uid: actor.uid,
      displayName: displayNameFrom(eligibility.user, "Unknown User"),
      businessName: businessNameFrom(eligibility.profile),
      role: "prime",
      joinedAt: now,
      scopeDescription: "Prime Contractor",
    };

    const team: Record<string, unknown> = {
      id: teamRef.id,
      rfxId: input.rfxId,
      name: input.name,
      primeUid: actor.uid,
      members: [primeMember],
      memberUids: [actor.uid],
      status: "forming",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    if (input.orgId) team.orgId = input.orgId;
    if (input.internalNotes !== undefined) team.internalNotes = input.internalNotes;

    transaction.create(teamRef, team);
    transaction.create(
      teamMembershipRef(db, teamRef.id, actor.uid),
      teamMembershipData({
        teamId: teamRef.id,
        rfxId: input.rfxId,
        member: primeMember,
        now,
      }),
    );
    setCompletedIdempotency(transaction, operationRef, {
      uid: actor.uid,
      action: "team_create",
      entityId: teamRef.id,
      result: { teamId: teamRef.id, requestFingerprint },
      createdAt: now,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "team_created",
      entityType: "rfxTeam",
      entityId: teamRef.id,
      orgId: input.orgId,
      newStatus: "forming",
      metadata: { rfxId: input.rfxId, version: 1 },
      createdAt: now,
    });

    return { teamId: teamRef.id, replayed: false };
  });
});

/** Invite one non-prime member. A deterministic guard serializes active invitations. */
export const team_invite = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(teamInviteInputSchema, request.data);
  const db = getDb();
  const teamRef = db.collection("rfxTeams").doc(input.teamId);
  const rfxRef = db.collection("rfx").doc(input.rfxId);
  const inviteRef = db.collection("rfxTeamInvites").doc();
  const guardRef = inviteGuardRef(db, input.teamId, input.inviteeUid);
  const primeMembershipRef = teamMembershipRef(db, input.teamId, actor.uid);
  const inviteeMembershipRef = teamMembershipRef(db, input.teamId, input.inviteeUid);

  return db.runTransaction(async (transaction) => {
    const activeInviteQuery = db.collection("rfxTeamInvites").where("teamId", "==", input.teamId);
    const [
      teamSnap,
      rfxSnap,
      inviteeUserSnap,
      guardSnap,
      teamInviteSnaps,
      primeMembershipSnap,
      inviteeMembershipSnap,
    ] = await Promise.all([
      transaction.get(teamRef),
      transaction.get(rfxRef),
      transaction.get(db.collection("users").doc(input.inviteeUid)),
      transaction.get(guardRef),
      transaction.get(activeInviteQuery),
      transaction.get(primeMembershipRef),
      transaction.get(inviteeMembershipRef),
    ]);
    const team = teamSnap.data() as TeamRecord | undefined;
    const rfx = rfxSnap.data();
    if (!teamSnap.exists || !team) throw new HttpsError("not-found", "Team not found");
    if (!rfxSnap.exists || !rfx) throw new HttpsError("not-found", "RFx not found");
    if (!inviteeUserSnap.exists) throw new HttpsError("not-found", "Invitee account not found");

    assertTeamRelationship(team, input.teamId, input.rfxId);
    assertActiveTeam(team);
    if (team.primeUid !== actor.uid) {
      throw new HttpsError("permission-denied", "Only the team prime can invite members");
    }
    const members = parseMembers(team);
    const primeMember = members.find((member) => member.uid === actor.uid);
    if (!primeMember) {
      throw new HttpsError("failed-precondition", "Team prime membership is inconsistent");
    }
    assertMembershipGuard(primeMembershipSnap, {
      teamId: input.teamId,
      rfxId: input.rfxId,
      member: primeMember,
    });
    if (isMember(members, input.inviteeUid) || isListedMemberUid(team, input.inviteeUid)) {
      throw new HttpsError("already-exists", "Invitee is already a team member");
    }
    if (inviteeMembershipSnap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "Invitee has a stale authoritative membership; administrator review is required",
      );
    }

    const now = Date.now();
    const territoryFips = assertRfxOpenForTeaming(rfx, input.rfxId, now);
    const eligibility = await evaluateTransactionEligibility({
      transaction,
      db,
      actor,
      territoryFips,
      orgId: optionalString(team, "orgId"),
      requireVerification: true,
      permittedRoles: ["member", "externalVendor", "econPartner"],
    });
    if (!eligibility.result.allowed) throwEligibilityFailure(eligibility.result);

    const activeInviteSnaps = teamInviteSnaps.docs.filter((candidate) => {
      const invite = candidate.data() as InviteRecord;
      return invite.inviteeUid === input.inviteeUid && invite.status === "pending";
    });

    let guardedInviteSnap: FirebaseFirestore.DocumentSnapshot | undefined;
    const guard = guardSnap.data();
    const guardedInviteId = guard?.activeInviteId;
    if (
      guardSnap.exists
      && (
        guard?.teamId !== input.teamId
        || guard?.inviteeUid !== input.inviteeUid
        || !isSafeId(guardedInviteId)
      )
    ) {
      throw new HttpsError("failed-precondition", "Active invitation guard is inconsistent");
    }
    if (
      isSafeId(guardedInviteId)
      && !activeInviteSnaps.some((candidate) => candidate.id === guardedInviteId)
    ) {
      guardedInviteSnap = await transaction.get(db.collection("rfxTeamInvites").doc(guardedInviteId));
    }

    const candidates: FirebaseFirestore.DocumentSnapshot[] = [...activeInviteSnaps];
    if (guardedInviteSnap?.exists) candidates.push(guardedInviteSnap);
    for (const candidate of candidates) {
      const existing = candidate.data() as InviteRecord | undefined;
      if (!existing) continue;
      if (existing.teamId !== input.teamId || existing.inviteeUid !== input.inviteeUid) {
        if (candidate.id === guardedInviteId) {
          throw new HttpsError("failed-precondition", "Active invitation guard is inconsistent");
        }
        continue;
      }
      if (existing.status !== "pending") continue;
      const existingExpiry = toMillis(existing.expiresAt);
      if (existingExpiry === null || existingExpiry > now) {
        throw new HttpsError("already-exists", "An active invitation already exists for this user");
      }
    }

    // Expire every stale pending invitation found before establishing the new guard.
    for (const staleSnap of activeInviteSnaps) {
      const stale = staleSnap.data() as InviteRecord;
      const staleExpiry = toMillis(stale.expiresAt);
      if (staleExpiry !== null && staleExpiry <= now) {
        transaction.update(staleSnap.ref, {
          status: "expired",
          expiredAt: now,
          updatedAt: now,
          version: versionOf(stale.version) + 1,
        });
        writeExchangeAudit(transaction, db, {
          actorUid: actor.uid,
          actorRole: actor.role,
          action: "team_invite_expired",
          entityType: "rfxTeamInvite",
          entityId: staleSnap.id,
          previousStatus: "pending",
          newStatus: "expired",
          metadata: { teamId: input.teamId, replacementInvite: true },
          createdAt: now,
        });
      }
    }

    const inviteeUser = inviteeUserSnap.data();
    const expiresAt = now + input.expiresInDays * DAY_MS;
    transaction.create(inviteRef, {
      id: inviteRef.id,
      teamId: input.teamId,
      rfxId: input.rfxId,
      inviterUid: actor.uid,
      inviteeUid: input.inviteeUid,
      inviteeName: displayNameFrom(inviteeUser, "Unknown User"),
      role: input.role,
      status: "pending",
      note: input.note ?? "",
      expiresAt,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    transaction.set(guardRef, {
      id: guardRef.id,
      teamId: input.teamId,
      rfxId: input.rfxId,
      inviteeUid: input.inviteeUid,
      activeInviteId: inviteRef.id,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "team_invite_created",
      entityType: "rfxTeamInvite",
      entityId: inviteRef.id,
      orgId: optionalString(team, "orgId"),
      newStatus: "pending",
      metadata: {
        teamId: input.teamId,
        rfxId: input.rfxId,
        inviteeUid: input.inviteeUid,
        role: input.role,
      },
      createdAt: now,
    });
    return { inviteId: inviteRef.id, expiresAt };
  });
});

/** Respond to an invitation, including exact fail-closed resolution of legacy invitations. */
export const team_respond_invite = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(teamRespondInviteInputSchema, request.data);
  const db = getDb();
  const inviteRef = db.collection("rfxTeamInvites").doc(input.inviteId);

  const outcome = await db.runTransaction<RespondOutcome>(async (transaction) => {
    const inviteSnap = await transaction.get(inviteRef);
    const invite = inviteSnap.data() as InviteRecord | undefined;
    if (!inviteSnap.exists || !invite) throw new HttpsError("not-found", "Invitation not found");
    assertExactDocumentId(invite, input.inviteId, "Invitation");
    if (invite.inviteeUid !== actor.uid) {
      throw new HttpsError("permission-denied", "This invitation belongs to another user");
    }

    const now = Date.now();
    const rfxId = optionalString(invite, "rfxId");
    const inviterUid = optionalString(invite, "inviterUid");
    let teamId = optionalString(invite, "teamId");
    const wasMissingTeamId = !teamId;
    let candidateTeamIds: string[] = [];
    let preloadedRfxSnap: FirebaseFirestore.DocumentSnapshot | undefined;

    if (!isSafeId(rfxId) || !isSafeId(inviterUid)) {
      return reviewFailure(transaction, db, {
        actor,
        inviteId: input.inviteId,
        reason: teamId ? "invalid_invitation_linkage" : "invalid_legacy_linkage",
        message: "Invitation relationship is invalid; administrator review is required",
        rfxId,
        inviterUid,
        inviteeUid: actor.uid,
        now,
      });
    }

    if (!teamId) {
      const exactTeamQuery = db.collection("rfxTeams")
        .where("rfxId", "==", rfxId)
        .where("primeUid", "==", inviterUid);
      const [exactTeamSnaps, exactRfxSnap] = await Promise.all([
        transaction.get(exactTeamQuery),
        transaction.get(db.collection("rfx").doc(rfxId)),
      ]);
      preloadedRfxSnap = exactRfxSnap;
      candidateTeamIds = exactTeamSnaps.docs.map((candidate) => candidate.id);
      if (!exactRfxSnap.exists) {
        return reviewFailure(transaction, db, {
          actor,
          inviteId: input.inviteId,
          reason: "linked_rfx_missing",
          message: "Legacy invitation RFx is unavailable; administrator review is required",
          rfxId,
          inviterUid,
          inviteeUid: actor.uid,
          candidateTeamIds,
          now,
        });
      }
      if (candidateTeamIds.length !== 1) {
        return reviewFailure(transaction, db, {
          actor,
          inviteId: input.inviteId,
          reason: candidateTeamIds.length === 0 ? "legacy_team_missing" : "legacy_team_ambiguous",
          message: "Legacy invitation cannot be linked safely; administrator review is required",
          rfxId,
          inviterUid,
          inviteeUid: actor.uid,
          candidateTeamIds,
          now,
        });
      }
      [teamId] = candidateTeamIds;
    }

    if (!isSafeId(teamId)) {
      return reviewFailure(transaction, db, {
        actor,
        inviteId: input.inviteId,
        reason: "invalid_invitation_linkage",
        message: "Invitation relationship is invalid; administrator review is required",
        rfxId,
        inviterUid,
        inviteeUid: actor.uid,
        candidateTeamIds,
        now,
      });
    }

    const teamRef = db.collection("rfxTeams").doc(teamId);
    const rfxRef = db.collection("rfx").doc(rfxId);
    const teamSnapPromise = transaction.get(teamRef);
    const rfxSnapPromise = preloadedRfxSnap
      ? Promise.resolve(preloadedRfxSnap)
      : transaction.get(rfxRef);
    const [teamSnap, rfxSnap] = await Promise.all([teamSnapPromise, rfxSnapPromise]);
    const team = teamSnap.data() as TeamRecord | undefined;
    const rfx = rfxSnap.data();
    if (!teamSnap.exists || !team || !rfxSnap.exists || !rfx) {
      return reviewFailure(transaction, db, {
        actor,
        inviteId: input.inviteId,
        reason: !teamSnap.exists ? "linked_team_missing" : "linked_rfx_missing",
        message: "Invitation target is unavailable; administrator review is required",
        rfxId,
        inviterUid,
        inviteeUid: actor.uid,
        candidateTeamIds: [teamId],
        now,
      });
    }

    let members: TeamMember[];
    try {
      assertTeamRelationship(team, teamId, rfxId);
      assertRfxRelationship(rfx, rfxId);
      members = parseMembers(team);
    } catch (error) {
      if (!(error instanceof HttpsError)) throw error;
      return reviewFailure(transaction, db, {
        actor,
        inviteId: input.inviteId,
        reason: "invitation_relationship_inconsistent",
        message: "Invitation relationship is inconsistent; administrator review is required",
        rfxId,
        inviterUid,
        inviteeUid: actor.uid,
        candidateTeamIds: [teamId],
        now,
      });
    }

    if (team.primeUid !== inviterUid) {
      return reviewFailure(transaction, db, {
        actor,
        inviteId: input.inviteId,
        reason: "inviter_not_team_prime",
        message: "Invitation authority is inconsistent; administrator review is required",
        rfxId,
        inviterUid,
        inviteeUid: actor.uid,
        candidateTeamIds: [teamId],
        now,
      });
    }

    const primeMember = members.find((member) => member.uid === team.primeUid);
    if (!primeMember) {
      return reviewFailure(transaction, db, {
        actor,
        inviteId: input.inviteId,
        reason: "team_prime_membership_inconsistent",
        message: "Team prime membership is inconsistent; administrator review is required",
        rfxId,
        inviterUid,
        inviteeUid: actor.uid,
        candidateTeamIds: [teamId],
        now,
      });
    }
    const primeMembershipRef = teamMembershipRef(db, teamId, team.primeUid);
    const actorMembershipRef = teamMembershipRef(db, teamId, actor.uid);
    const [primeMembershipSnap, actorMembershipSnap] = await Promise.all([
      transaction.get(primeMembershipRef),
      transaction.get(actorMembershipRef),
    ]);
    try {
      assertMembershipGuard(primeMembershipSnap, { teamId, rfxId, member: primeMember });
    } catch (error) {
      if (!(error instanceof HttpsError)) throw error;
      return reviewFailure(transaction, db, {
        actor,
        inviteId: input.inviteId,
        reason: "team_prime_guard_inconsistent",
        message: "Authoritative team membership is incomplete; administrator review is required",
        rfxId,
        inviterUid,
        inviteeUid: actor.uid,
        candidateTeamIds: [teamId],
        now,
      });
    }

    const status = invite.status as InvitationStatus | undefined;
    if (status === "accepted" && input.response === "accepted") {
      const acceptedMember = members.find((member) => member.uid === actor.uid);
      if (!acceptedMember) {
        return reviewFailure(transaction, db, {
          actor,
          inviteId: input.inviteId,
          reason: "accepted_without_member",
          message: "Accepted invitation has no matching team member; administrator review is required",
          rfxId,
          inviterUid,
          inviteeUid: actor.uid,
          candidateTeamIds: [teamId],
          now,
        });
      }
      try {
        assertMembershipGuard(actorMembershipSnap, { teamId, rfxId, member: acceptedMember });
      } catch (error) {
        if (!(error instanceof HttpsError)) throw error;
        return reviewFailure(transaction, db, {
          actor,
          inviteId: input.inviteId,
          reason: "accepted_without_membership_guard",
          message: "Accepted invitation has no authoritative membership; administrator review is required",
          rfxId,
          inviterUid,
          inviteeUid: actor.uid,
          candidateTeamIds: [teamId],
          now,
        });
      }
      if (wasMissingTeamId) {
        transaction.update(inviteRef, {
          teamId,
          updatedAt: now,
          version: versionOf(invite.version) + 1,
        });
        writeExchangeAudit(transaction, db, {
          actorUid: actor.uid,
          actorRole: actor.role,
          action: "team_invite_legacy_link_resolved",
          entityType: "rfxTeamInvite",
          entityId: input.inviteId,
          metadata: { teamId, rfxId, terminalStatus: "accepted" },
          createdAt: now,
        });
      }
      return { ok: true, teamId, status: "accepted", replayed: true };
    }
    if (status === "declined" && input.response === "declined") {
      if (wasMissingTeamId) {
        transaction.update(inviteRef, {
          teamId,
          updatedAt: now,
          version: versionOf(invite.version) + 1,
        });
        writeExchangeAudit(transaction, db, {
          actorUid: actor.uid,
          actorRole: actor.role,
          action: "team_invite_legacy_link_resolved",
          entityType: "rfxTeamInvite",
          entityId: input.inviteId,
          metadata: { teamId, rfxId, terminalStatus: "declined" },
          createdAt: now,
        });
      }
      return { ok: true, teamId, status: "declined", replayed: true };
    }
    if (status !== "pending") {
      throw new HttpsError("failed-precondition", "Invitation is no longer pending");
    }

    if (
      input.response === "accepted"
      && !isMember(members, actor.uid)
      && actorMembershipSnap.exists
    ) {
      return reviewFailure(transaction, db, {
        actor,
        inviteId: input.inviteId,
        reason: "membership_guard_without_member",
        message: "Invitation conflicts with a stale membership guard; administrator review is required",
        rfxId,
        inviterUid,
        inviteeUid: actor.uid,
        candidateTeamIds: [teamId],
        now,
      });
    }

    const guardRef = inviteGuardRef(db, teamId, actor.uid);
    const guardSnap = await transaction.get(guardRef);
    const expiresAt = toMillis(invite.expiresAt);
    if (expiresAt === null) {
      return reviewFailure(transaction, db, {
        actor,
        inviteId: input.inviteId,
        reason: "invalid_expiry",
        message: "Invitation expiry is invalid; administrator review is required",
        rfxId,
        inviterUid,
        inviteeUid: actor.uid,
        candidateTeamIds: [teamId],
        now,
      });
    }
    if (expiresAt <= now) {
      transaction.update(inviteRef, {
        teamId,
        status: "expired",
        expiredAt: now,
        updatedAt: now,
        version: versionOf(invite.version) + 1,
      });
      clearMatchingInviteGuard(transaction, guardSnap, input.inviteId);
      writeExchangeAudit(transaction, db, {
        actorUid: actor.uid,
        actorRole: actor.role,
        action: "team_invite_expired",
        entityType: "rfxTeamInvite",
        entityId: input.inviteId,
        previousStatus: "pending",
        newStatus: "expired",
        metadata: { teamId, rfxId, detectedOnResponse: true },
        createdAt: now,
      });
      return {
        ok: false,
        code: "failed-precondition",
        message: "Invitation has expired",
        reason: "invitation_expired",
      };
    }

    if (input.response === "declined") {
      transaction.update(inviteRef, {
        teamId,
        status: "declined",
        respondedAt: now,
        updatedAt: now,
        version: versionOf(invite.version) + 1,
      });
      clearMatchingInviteGuard(transaction, guardSnap, input.inviteId);
      writeExchangeAudit(transaction, db, {
        actorUid: actor.uid,
        actorRole: actor.role,
        action: "team_invite_declined",
        entityType: "rfxTeamInvite",
        entityId: input.inviteId,
        previousStatus: "pending",
        newStatus: "declined",
        metadata: { teamId, rfxId },
        createdAt: now,
      });
      return { ok: true, teamId, status: "declined", replayed: false };
    }

    assertActiveTeam(team);
    const territoryFips = assertRfxOpenForTeaming(rfx, rfxId, now);
    const eligibility = await evaluateTransactionEligibility({
      transaction,
      db,
      actor,
      territoryFips,
      requireVerification: true,
      permittedRoles: ["member", "externalVendor", "econPartner"],
    });
    if (!eligibility.result.allowed) throwEligibilityFailure(eligibility.result);

    const parsedRole = nonPrimeTeamRoleSchema.safeParse(invite.role);
    if (!parsedRole.success) {
      return reviewFailure(transaction, db, {
        actor,
        inviteId: input.inviteId,
        reason: "invalid_role",
        message: "Invitation role is invalid; administrator review is required",
        rfxId,
        inviterUid,
        inviteeUid: actor.uid,
        candidateTeamIds: [teamId],
        now,
      });
    }
    if (isMember(members, actor.uid) || isListedMemberUid(team, actor.uid)) {
      return reviewFailure(transaction, db, {
        actor,
        inviteId: input.inviteId,
        reason: "pending_existing_member",
        message: "Pending invitation already has a team member; administrator review is required",
        rfxId,
        inviterUid,
        inviteeUid: actor.uid,
        candidateTeamIds: [teamId],
        now,
      });
    }

    const newMember: TeamMember = {
      uid: actor.uid,
      displayName: displayNameFrom(eligibility.user, "Unknown User"),
      businessName: businessNameFrom(eligibility.profile),
      role: parsedRole.data as NonPrimeTeamRole,
      joinedAt: now,
      scopeDescription: "",
    };
    const nextMembers = [...members, newMember];
    transaction.update(teamRef, {
      members: nextMembers,
      memberUids: nextMembers.map((member) => member.uid),
      updatedAt: now,
      version: versionOf(team.version) + 1,
    });
    transaction.create(
      actorMembershipRef,
      teamMembershipData({ teamId, rfxId, member: newMember, now }),
    );
    transaction.update(inviteRef, {
      teamId,
      status: "accepted",
      respondedAt: now,
      updatedAt: now,
      version: versionOf(invite.version) + 1,
    });
    clearMatchingInviteGuard(transaction, guardSnap, input.inviteId);
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "team_invite_accepted",
      entityType: "rfxTeamInvite",
      entityId: input.inviteId,
      orgId: optionalString(team, "orgId"),
      previousStatus: "pending",
      newStatus: "accepted",
      metadata: {
        teamId,
        rfxId,
        memberUid: actor.uid,
        role: parsedRole.data,
        teamVersion: versionOf(team.version) + 1,
      },
      createdAt: now,
    });
    return { ok: true, teamId, status: "accepted", replayed: false };
  });

  if (!outcome.ok) throwDeferredFailure(outcome);
  return outcome;
});

/** Revoke a still-pending invitation. */
export const team_revoke_invite = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(teamRevokeInviteInputSchema, request.data);
  const db = getDb();
  const inviteRef = db.collection("rfxTeamInvites").doc(input.inviteId);

  const outcome = await db.runTransaction<RevokeOutcome>(async (transaction) => {
    const inviteSnap = await transaction.get(inviteRef);
    const invite = inviteSnap.data() as InviteRecord | undefined;
    if (!inviteSnap.exists || !invite) throw new HttpsError("not-found", "Invitation not found");
    assertExactDocumentId(invite, input.inviteId, "Invitation");
    if (invite.inviterUid !== actor.uid) {
      throw new HttpsError("permission-denied", "Only the inviting team prime can revoke this invitation");
    }

    const now = Date.now();
    const teamId = optionalString(invite, "teamId");
    const rfxId = optionalString(invite, "rfxId");
    if (!isSafeId(teamId) || !isSafeId(rfxId)) {
      return reviewFailure(transaction, db, {
        actor,
        inviteId: input.inviteId,
        reason: "legacy_linkage_requires_backfill",
        message: "Legacy invitation must be backfilled before it can be revoked",
        rfxId,
        inviterUid: actor.uid,
        inviteeUid: optionalString(invite, "inviteeUid"),
        now,
      });
    }

    const teamRef = db.collection("rfxTeams").doc(teamId);
    const rfxRef = db.collection("rfx").doc(rfxId);
    const [teamSnap, rfxSnap] = await Promise.all([
      transaction.get(teamRef),
      transaction.get(rfxRef),
    ]);
    const team = teamSnap.data() as TeamRecord | undefined;
    const rfx = rfxSnap.data();
    if (!teamSnap.exists || !team || !rfxSnap.exists || !rfx) {
      return reviewFailure(transaction, db, {
        actor,
        inviteId: input.inviteId,
        reason: !teamSnap.exists ? "linked_team_missing" : "linked_rfx_missing",
        message: "Invitation target is unavailable; administrator review is required",
        rfxId,
        inviterUid: actor.uid,
        inviteeUid: optionalString(invite, "inviteeUid"),
        candidateTeamIds: [teamId],
        now,
      });
    }
    try {
      assertTeamRelationship(team, teamId, rfxId);
      assertRfxRelationship(rfx, rfxId);
      parseMembers(team);
    } catch (error) {
      if (!(error instanceof HttpsError)) throw error;
      return reviewFailure(transaction, db, {
        actor,
        inviteId: input.inviteId,
        reason: "invitation_relationship_inconsistent",
        message: "Invitation relationship is inconsistent; administrator review is required",
        rfxId,
        inviterUid: actor.uid,
        inviteeUid: optionalString(invite, "inviteeUid"),
        candidateTeamIds: [teamId],
        now,
      });
    }
    if (team.primeUid !== actor.uid) {
      throw new HttpsError("permission-denied", "Only the current team prime can revoke invitations");
    }

    const status = invite.status as InvitationStatus | undefined;
    if (status === "revoked") {
      return { ok: true, inviteId: input.inviteId, status: "revoked", replayed: true };
    }
    if (status !== "pending") {
      throw new HttpsError("failed-precondition", "Only a pending invitation can be revoked");
    }

    const inviteeUid = requiredString(invite, "inviteeUid", "Invitation recipient is invalid");
    const guardRef = inviteGuardRef(db, teamId, inviteeUid);
    const guardSnap = await transaction.get(guardRef);
    const expiresAt = toMillis(invite.expiresAt);
    if (expiresAt !== null && expiresAt <= now) {
      transaction.update(inviteRef, {
        status: "expired",
        expiredAt: now,
        updatedAt: now,
        version: versionOf(invite.version) + 1,
      });
      clearMatchingInviteGuard(transaction, guardSnap, input.inviteId);
      writeExchangeAudit(transaction, db, {
        actorUid: actor.uid,
        actorRole: actor.role,
        action: "team_invite_expired",
        entityType: "rfxTeamInvite",
        entityId: input.inviteId,
        previousStatus: "pending",
        newStatus: "expired",
        metadata: { teamId, rfxId, detectedOnRevoke: true },
        createdAt: now,
      });
      return {
        ok: false,
        code: "failed-precondition",
        message: "Invitation has already expired",
        reason: "invitation_expired",
      };
    }

    transaction.update(inviteRef, {
      status: "revoked",
      revokedAt: now,
      revokedByUid: actor.uid,
      revokeReason: input.reason,
      updatedAt: now,
      version: versionOf(invite.version) + 1,
    });
    clearMatchingInviteGuard(transaction, guardSnap, input.inviteId);
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: "team_invite_revoked",
      entityType: "rfxTeamInvite",
      entityId: input.inviteId,
      orgId: optionalString(team, "orgId"),
      previousStatus: "pending",
      newStatus: "revoked",
      metadata: { teamId, rfxId, inviteeUid },
      createdAt: now,
    });
    return { ok: true, inviteId: input.inviteId, status: "revoked", replayed: false };
  });

  if (!outcome.ok) throwDeferredFailure(outcome);
  return outcome;
});

/** Update or remove a member while preserving exactly one prime and canonical UID arrays. */
export const team_manage_member = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseCallableInput(teamManageMemberInputSchema, request.data);
  const db = getDb();
  const teamRef = db.collection("rfxTeams").doc(input.teamId);

  return db.runTransaction(async (transaction) => {
    const teamSnap = await transaction.get(teamRef);
    const team = teamSnap.data() as TeamRecord | undefined;
    if (!teamSnap.exists || !team) throw new HttpsError("not-found", "Team not found");
    const rfxId = assertTeamRelationship(team, input.teamId);
    assertActiveTeam(team);
    if (team.primeUid !== actor.uid) {
      throw new HttpsError("permission-denied", "Only the team prime can manage members");
    }

    const rfxSnap = await transaction.get(db.collection("rfx").doc(rfxId));
    const rfx = rfxSnap.data();
    if (!rfxSnap.exists || !rfx) throw new HttpsError("not-found", "RFx not found");
    assertRfxRelationship(rfx, rfxId);

    let members = parseMembers(team);
    const memberIndex = members.findIndex((member) => member.uid === input.memberUid);
    if (memberIndex < 0) throw new HttpsError("not-found", "Team member not found");
    const currentMember = members[memberIndex];
    const actorMember = members.find((member) => member.uid === actor.uid);
    if (!actorMember) {
      throw new HttpsError("failed-precondition", "Team prime membership is inconsistent");
    }
    const actorMembershipRef = teamMembershipRef(db, input.teamId, actor.uid);
    const targetMembershipRef = teamMembershipRef(db, input.teamId, input.memberUid);
    const [actorMembershipSnap, targetMembershipSnap] = await Promise.all([
      transaction.get(actorMembershipRef),
      transaction.get(targetMembershipRef),
    ]);
    assertMembershipGuard(actorMembershipSnap, {
      teamId: input.teamId,
      rfxId,
      member: actorMember,
    });
    assertMembershipGuard(targetMembershipSnap, {
      teamId: input.teamId,
      rfxId,
      member: currentMember,
    });

    if (input.action === "remove") {
      if (currentMember.role === "prime" || currentMember.uid === team.primeUid) {
        throw new HttpsError("failed-precondition", "The sole team prime cannot be removed");
      }
      members = members.filter((member) => member.uid !== input.memberUid);
    } else {
      if (currentMember.role === "prime" && input.newRole !== undefined) {
        throw new HttpsError("failed-precondition", "The sole team prime cannot be demoted");
      }
      members = members.map((member, index) => index === memberIndex
        ? {
          ...member,
          ...(input.newRole !== undefined ? { role: input.newRole as NonPrimeTeamRole } : {}),
          ...(input.scopeDescription !== undefined ? { scopeDescription: input.scopeDescription } : {}),
        }
        : member);
    }

    const primeMembers = members.filter((member) => member.role === "prime");
    if (primeMembers.length !== 1 || primeMembers[0].uid !== team.primeUid) {
      throw new HttpsError("failed-precondition", "Membership update would invalidate the team prime");
    }

    const now = Date.now();
    const nextVersion = versionOf(team.version) + 1;
    transaction.update(teamRef, {
      members,
      memberUids: members.map((member) => member.uid),
      updatedAt: now,
      version: nextVersion,
    });
    if (input.action === "remove") {
      transaction.delete(targetMembershipRef);
    } else {
      const nextMember = members.find((member) => member.uid === input.memberUid);
      if (!nextMember) {
        throw new HttpsError("failed-precondition", "Updated team member is unavailable");
      }
      transaction.update(targetMembershipRef, {
        role: nextMember.role,
        updatedAt: now,
      });
    }
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: input.action === "remove" ? "team_member_removed" : "team_member_updated",
      entityType: "rfxTeam",
      entityId: input.teamId,
      orgId: optionalString(team, "orgId"),
      metadata: {
        rfxId,
        memberUid: input.memberUid,
        version: nextVersion,
        ...(input.newRole ? { newRole: input.newRole } : {}),
      },
      createdAt: now,
    });
    return { success: true, teamId: input.teamId, memberUid: input.memberUid, version: nextVersion };
  });
});

async function expireInvitation(
  db: FirebaseFirestore.Firestore,
  inviteRef: FirebaseFirestore.DocumentReference,
  now: number,
): Promise<boolean> {
  return db.runTransaction(async (transaction) => {
    const inviteSnap = await transaction.get(inviteRef);
    const invite = inviteSnap.data() as InviteRecord | undefined;
    if (!inviteSnap.exists || !invite || invite.status !== "pending") return false;
    const expiresAt = toMillis(invite.expiresAt);
    if (expiresAt === null || expiresAt > now) return false;

    const teamId = optionalString(invite, "teamId");
    const inviteeUid = optionalString(invite, "inviteeUid");
    let guardSnap: FirebaseFirestore.DocumentSnapshot | undefined;
    if (teamId && inviteeUid) {
      guardSnap = await transaction.get(inviteGuardRef(db, teamId, inviteeUid));
    }

    transaction.update(inviteRef, {
      status: "expired",
      expiredAt: now,
      updatedAt: now,
      version: versionOf(invite.version) + 1,
    });
    if (guardSnap) clearMatchingInviteGuard(transaction, guardSnap, inviteRef.id);
    writeExchangeAudit(transaction, db, {
      actorUid: "system",
      actorRole: "system",
      action: "team_invite_expired",
      entityType: "rfxTeamInvite",
      entityId: inviteRef.id,
      previousStatus: "pending",
      newStatus: "expired",
      metadata: {
        ...(teamId ? { teamId } : {}),
        ...(optionalString(invite, "rfxId") ? { rfxId: invite.rfxId as string } : {}),
      },
      createdAt: now,
    });
    return true;
  });
}

export interface TeamInvitationExpiryResult {
  numericCandidates: number;
  timestampCandidates: number;
  selected: number;
  expired: number;
}

/**
 * Expire both canonical numeric-millis invitations and legacy Timestamp
 * invitations. The lower Timestamp bound prevents Firestore's cross-type sort
 * order from admitting numeric values into the legacy query.
 */
export async function expireTeamInvitationsAt(
  now: number,
  db: FirebaseFirestore.Firestore = getDb(),
): Promise<TeamInvitationExpiryResult> {
  const timestampFloor = Timestamp.fromMillis(0);
  const timestampNow = Timestamp.fromMillis(now);
  const [numericSnap, timestampSnap] = await Promise.all([
    db.collection("rfxTeamInvites")
      .where("status", "==", "pending")
      .where("expiresAt", "<=", now)
      .orderBy("expiresAt", "asc")
      .limit(MAX_INVITES_PER_EXPIRY_RUN)
      .get(),
    db.collection("rfxTeamInvites")
      .where("status", "==", "pending")
      .where("expiresAt", ">=", timestampFloor)
      .where("expiresAt", "<=", timestampNow)
      .orderBy("expiresAt", "asc")
      .limit(MAX_INVITES_PER_EXPIRY_RUN)
      .get(),
  ]);

  const candidates = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const invite of [...numericSnap.docs, ...timestampSnap.docs]) {
    const expiresAt = toMillis(invite.data().expiresAt);
    if (expiresAt !== null && expiresAt <= now) candidates.set(invite.id, invite);
  }
  const selected = [...candidates.values()]
    .sort((left, right) => {
      const expiryDelta = (toMillis(left.data().expiresAt) ?? 0)
        - (toMillis(right.data().expiresAt) ?? 0);
      return expiryDelta !== 0 ? expiryDelta : left.id.localeCompare(right.id);
    })
    .slice(0, MAX_INVITES_PER_EXPIRY_RUN);

  let expired = 0;
  for (let index = 0; index < selected.length; index += 20) {
    const chunk = selected.slice(index, index + 20);
    const results = await Promise.all(
      chunk.map((invite) => expireInvitation(db, invite.ref, now)),
    );
    expired += results.filter(Boolean).length;
  }
  return {
    numericCandidates: numericSnap.size,
    timestampCandidates: timestampSnap.size,
    selected: selected.length,
    expired,
  };
}

/** Scheduled cleanup for expired pending invitations. */
export const team_expire_invites = onSchedule(
  { schedule: "every 15 minutes", timeZone: "UTC", retryCount: 3 },
  async () => {
    const now = Date.now();
    const result = await expireTeamInvitationsAt(now);
    logger.info("Team invitation expiry cleanup completed", {
      ...result,
      maxPerRun: MAX_INVITES_PER_EXPIRY_RUN,
    });
  },
);
