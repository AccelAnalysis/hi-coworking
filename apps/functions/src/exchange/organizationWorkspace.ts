import { createHash } from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import type {
  ExchangeMode,
  ExchangeOrganizationMembershipRole,
  ExchangeSecondaryContext,
} from "@hi/shared";
import {
  fingerprintRequest,
  getAuthorizedActor,
  getDb,
  idempotencyRef,
  loadOrgAuthority,
  setCompletedIdempotency,
  writeExchangeAudit,
} from "./security";
import { normalizeOrganizationName } from "./organizationModel";
import {
  actorCapabilitiesForRole,
  projectApprovedPublicOrganization,
  projectPrivateOrganization,
  resolveOrganizationPerspectiveModel,
} from "./organizationPerspective";

const CONTRACT_VERSION = 1 as const;
const MAX_ACTOR_ORGANIZATIONS = 100;
const safeId = z.string().trim().min(1).max(200).refine((value) => !value.includes("/"), "Invalid identifier");
const idempotencyKey = z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9_.:@-]+$/);
const modeSchema = z.enum(["intelligence", "referrals", "opportunities", "resources"]);
const secondarySchema = z.object({
  type: z.enum(["opportunity", "referral", "resource", "territory", "team", "organization"]),
  id: safeId,
}).strict();

type RecordData = Record<string, unknown>;

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "Invalid organization workspace request", {
      issues: parsed.error.issues.slice(0, 12).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

function asRecord(value: unknown): RecordData {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordData
    : {};
}

function cleanText(value: unknown, max = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, max) : undefined;
}

function role(value: unknown): ExchangeOrganizationMembershipRole | null {
  return value === "owner" || value === "admin" || value === "member" ? value : null;
}

interface ActiveActorOrganization {
  organizationId: string;
  name: string;
  membershipRole: ExchangeOrganizationMembershipRole;
  capabilities: ReturnType<typeof actorCapabilitiesForRole>;
  organization: RecordData;
}

async function loadActiveActorOrganizations(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<ActiveActorOrganization[]> {
  const membershipSnapshot = await db.collection("orgMembers")
    .where("uid", "==", uid)
    .limit(MAX_ACTOR_ORGANIZATIONS + 1)
    .get();
  if (membershipSnapshot.size > MAX_ACTOR_ORGANIZATIONS) {
    throw new HttpsError("resource-exhausted", "Organization membership count exceeds the workspace limit.");
  }
  const candidates = membershipSnapshot.docs.flatMap((document) => {
    const membership = asRecord(document.data());
    const organizationId = cleanText(membership.orgId, 200);
    const membershipRole = role(membership.role);
    if (
      !organizationId
      || document.id !== `${organizationId}_${uid}`
      || membership.uid !== uid
      || membership.status !== "active"
      || !membershipRole
    ) return [];
    return [{
      organizationId,
      membershipRole,
      capabilities: actorCapabilitiesForRole(membershipRole, membership.permissions),
    }];
  });
  if (!candidates.length) return [];
  const organizations = await db.getAll(
    ...candidates.map(({ organizationId }) => db.collection("orgs").doc(organizationId)),
  );
  return organizations.flatMap((snapshot, index) => {
    const candidate = candidates[index];
    const organization = asRecord(snapshot.data());
    if (!snapshot.exists || snapshot.id !== candidate.organizationId || organization.status !== "active") return [];
    return [{
      ...candidate,
      name: cleanText(organization.name, 200) ?? "Organization",
      organization,
    }];
  }).sort((left, right) => left.name.localeCompare(right.name)
    || left.organizationId.localeCompare(right.organizationId));
}

interface ActorSelection {
  actors: ActiveActorOrganization[];
  selected: ActiveActorOrganization | null;
  fallbackApplied: boolean;
}

async function resolveActorSelection(
  db: FirebaseFirestore.Firestore,
  uid: string,
  requestedActorOrganizationId?: string,
): Promise<ActorSelection> {
  const [actors, preferenceSnapshot] = await Promise.all([
    loadActiveActorOrganizations(db, uid),
    db.collection("exchangeWorkspacePreferences").doc(uid).get(),
  ]);
  const byId = new Map(actors.map((actor) => [actor.organizationId, actor]));
  const preferredId = cleanText(preferenceSnapshot.data()?.actorOrganizationId, 200);
  const selected = (requestedActorOrganizationId ? byId.get(requestedActorOrganizationId) : undefined)
    ?? (preferredId ? byId.get(preferredId) : undefined)
    ?? actors[0]
    ?? null;
  return {
    actors,
    selected,
    fallbackApplied: Boolean(
      requestedActorOrganizationId
      && requestedActorOrganizationId !== selected?.organizationId
    ),
  };
}

function publicActor(actor: ActiveActorOrganization): Omit<ActiveActorOrganization, "organization"> {
  return {
    organizationId: actor.organizationId,
    name: actor.name,
    membershipRole: actor.membershipRole,
    capabilities: actor.capabilities,
  };
}

const listActorsInputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION).optional().default(CONTRACT_VERSION),
  requestedActorOrganizationId: safeId.optional(),
  persistSelection: z.boolean().optional().default(false),
}).strict();

export const exchange_listActorOrganizations = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseInput(listActorsInputSchema, request.data);
  const db = getDb();
  const selection = await resolveActorSelection(db, actor.uid, input.requestedActorOrganizationId);

  // Persist only an explicitly requested, currently valid actor. Invalid URL or
  // browser state may receive a safe fallback but can never change authority.
  if (
    input.persistSelection
    && input.requestedActorOrganizationId
    && selection.selected?.organizationId === input.requestedActorOrganizationId
  ) {
    await db.runTransaction(async (transaction) => {
      await loadOrgAuthority(transaction, db, input.requestedActorOrganizationId as string, actor.uid);
      const preferenceRef = db.collection("exchangeWorkspacePreferences").doc(actor.uid);
      const preferenceSnapshot = await transaction.get(preferenceRef);
      if (preferenceSnapshot.data()?.actorOrganizationId === input.requestedActorOrganizationId) return;
      const now = Date.now();
      transaction.set(preferenceRef, {
        uid: actor.uid,
        actorOrganizationId: input.requestedActorOrganizationId,
        updatedAt: now,
      }, { merge: true });
      writeExchangeAudit(transaction, db, {
        actorUid: actor.uid,
        actorRole: actor.role,
        action: "exchange.actor_selected",
        entityType: "organization",
        entityId: input.requestedActorOrganizationId as string,
        orgId: input.requestedActorOrganizationId,
        actorOrganizationId: input.requestedActorOrganizationId,
        createdAt: now,
      });
    });
  }

  return {
    contractVersion: CONTRACT_VERSION,
    actors: selection.actors.map(publicActor),
    selectedActorOrganizationId: selection.selected?.organizationId ?? null,
    fallbackApplied: selection.fallbackApplied,
  };
});

function relationshipDocumentId(leftOrganizationId: string, rightOrganizationId: string): string {
  return [leftOrganizationId, rightOrganizationId].sort().join("__");
}

interface SafeRelationshipState {
  exists: boolean;
  disclosurePermitted: boolean;
  trusted: boolean;
}

function safeRelationshipState(
  snapshot: FirebaseFirestore.DocumentSnapshot | null,
  actorOrganizationId: string | null,
  subjectOrganizationId: string,
): SafeRelationshipState {
  if (!snapshot?.exists || !actorOrganizationId) {
    return { exists: false, disclosurePermitted: false, trusted: false };
  }
  const relationship = asRecord(snapshot.data());
  const participants = Array.isArray(relationship.participantSubjectKeys)
    ? relationship.participantSubjectKeys.filter((value): value is string => typeof value === "string")
    : [];
  if (
    !participants.includes(`org:${actorOrganizationId}`)
    || !participants.includes(`org:${subjectOrganizationId}`)
  ) return { exists: false, disclosurePermitted: false, trusted: false };
  const disclosurePermitted = relationship.externalDisclosureAllowed === true
    || relationship.disclosurePermitted === true
    || relationship.disclosureLevel === "relationship_safe";
  return {
    exists: true,
    disclosurePermitted,
    trusted: disclosurePermitted && relationship.state === "trusted",
  };
}

function savedOrganizationDocumentId(actorOrganizationId: string, subjectOrganizationId: string): string {
  return createHash("sha256")
    .update(`${actorOrganizationId}\u001f${subjectOrganizationId}`)
    .digest("hex");
}

const perspectiveInputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION).optional().default(CONTRACT_VERSION),
  actorOrganizationId: safeId.optional(),
  subjectOrganizationId: safeId,
  mode: modeSchema,
  secondary: secondarySchema.optional(),
}).strict();

type PerspectiveInput = z.infer<typeof perspectiveInputSchema>;

async function resolvePerspective(
  request: CallableRequest<unknown>,
  input: PerspectiveInput,
): Promise<RecordData> {
  const authorizedViewer = getAuthorizedActor(request);
  const db = getDb();
  const selection = await resolveActorSelection(db, authorizedViewer.uid, input.actorOrganizationId);
  const selectedActor = selection.selected;
  const subjectPublicRef = db.collection("publicOrganizations").doc(input.subjectOrganizationId);
  const subjectOrgRef = db.collection("orgs").doc(input.subjectOrganizationId);
  const subjectMembershipRef = db.collection("orgMembers")
    .doc(`${input.subjectOrganizationId}_${authorizedViewer.uid}`);
  const relationshipRef = selectedActor && selectedActor.organizationId !== input.subjectOrganizationId
    ? db.collection("referralRelationshipInsights").doc(
      relationshipDocumentId(selectedActor.organizationId, input.subjectOrganizationId),
    )
    : null;
  const savedRef = selectedActor
    ? db.collection("exchangeSavedOrganizations").doc(
      savedOrganizationDocumentId(selectedActor.organizationId, input.subjectOrganizationId),
    )
    : null;
  const [publicSnapshot, subjectOrgSnapshot, subjectMembershipSnapshot, relationshipSnapshot, savedSnapshot] = await Promise.all([
    subjectPublicRef.get(),
    subjectOrgRef.get(),
    subjectMembershipRef.get(),
    relationshipRef ? relationshipRef.get() : Promise.resolve(null),
    savedRef ? savedRef.get() : Promise.resolve(null),
  ]);

  const publicProjection = publicSnapshot.exists
    ? projectApprovedPublicOrganization(input.subjectOrganizationId, asRecord(publicSnapshot.data()))
    : null;
  const subjectOrganization = asRecord(subjectOrgSnapshot.data());
  const subjectMembership = asRecord(subjectMembershipSnapshot.data());
  const subjectMembershipRole = (
    subjectOrgSnapshot.exists
    && subjectOrganization.status === "active"
    && subjectMembershipSnapshot.exists
    && subjectMembershipSnapshot.id === `${input.subjectOrganizationId}_${authorizedViewer.uid}`
    && subjectMembership.orgId === input.subjectOrganizationId
    && subjectMembership.uid === authorizedViewer.uid
    && subjectMembership.status === "active"
  ) ? role(subjectMembership.role) : null;
  const self = selectedActor?.organizationId === input.subjectOrganizationId;
  const managed = subjectMembershipRole === "owner" || subjectMembershipRole === "admin";
  const privateAllowed = Boolean(self || managed);
  const subjectAvailable = Boolean(
    (privateAllowed && subjectOrgSnapshot.exists && subjectOrganization.status === "active")
    || publicProjection
  );
  const source = privateAllowed ? subjectOrganization : asRecord(publicProjection);
  const safeRelationship = safeRelationshipState(
    relationshipSnapshot,
    selectedActor?.organizationId ?? null,
    input.subjectOrganizationId,
  );
  const isSaved = Boolean(
    savedSnapshot?.exists
    && savedSnapshot.data()?.actorOrganizationId === selectedActor?.organizationId
    && savedSnapshot.data()?.organizationId === input.subjectOrganizationId
  );
  const subjectClaimStatus = source.claimStatus === "claimed" || source.claimStatus === "claim_pending"
    ? source.claimStatus
    : "unclaimed";
  const model = resolveOrganizationPerspectiveModel({
    actorValid: Boolean(selectedActor),
    actorOrganizationId: selectedActor?.organizationId ?? null,
    actorName: selectedActor?.name ?? null,
    actorMembershipRole: selectedActor?.membershipRole ?? null,
    subjectOrganizationId: input.subjectOrganizationId,
    subjectName: subjectAvailable ? cleanText(source.name, 200) ?? "Organization" : "Organization",
    subjectAvailable,
    subjectMembershipRole,
    subjectClaimStatus,
    subjectResourceProviderApproved: source.resourceProviderStatus === "approved",
    subjectIssuerApproved: source.issuerStatus === "approved",
    relationshipExists: safeRelationship.exists,
    relationshipDisclosurePermitted: safeRelationship.disclosurePermitted,
    relationshipTrusted: safeRelationship.trusted,
    saved: isSaved,
    mode: input.mode as ExchangeMode,
  });

  let organization: RecordData | null = null;
  if (model.projectionLevel.startsWith("private_") && subjectMembershipRole) {
    organization = projectPrivateOrganization(
      input.subjectOrganizationId,
      subjectOrganization,
      subjectMembershipRole,
    );
  } else if (publicProjection) {
    organization = { ...publicProjection, projectionLevel: model.projectionLevel };
  }

  const publicResourceStatus = !subjectAvailable
    ? "unavailable"
    : source.resourceProviderStatus === "approved"
      ? "approved"
      : "not_provider";
  const relationshipType = !safeRelationship.exists
    ? "none"
    : !safeRelationship.disclosurePermitted
      ? "undisclosed"
      : safeRelationship.trusted
        ? "trusted"
        : "established";
  const disclosureLevel = !safeRelationship.exists
    ? "none"
    : safeRelationship.disclosurePermitted
      ? "relationship_safe"
      : "indicator";

  return {
    contractVersion: CONTRACT_VERSION,
    viewer: {
      authenticated: true,
      uid: authorizedViewer.uid,
      platformRole: authorizedViewer.role,
    },
    actor: {
      organizationId: selectedActor?.organizationId ?? null,
      name: selectedActor?.name ?? null,
      membershipRole: selectedActor?.membershipRole ?? null,
      capabilities: selectedActor?.capabilities ?? [],
      valid: Boolean(selectedActor),
      fallbackApplied: selection.fallbackApplied,
    },
    subject: {
      organizationId: input.subjectOrganizationId,
      contextType: model.contextType,
      claimedStatus: subjectAvailable ? subjectClaimStatus : "unavailable",
      resourceProviderStatus: publicResourceStatus,
    },
    relationship: {
      exists: safeRelationship.exists,
      type: relationshipType,
      disclosureLevel,
      trustedIntroductionMayBeAvailable: safeRelationship.exists,
    },
    perspective: {
      mode: input.mode,
      projectionLevel: model.projectionLevel,
      allowedActions: model.allowedActions,
      isModeResultEligible: model.isModeResultEligible,
      contextMarkerOnly: model.contextMarkerOnly,
      heading: model.heading,
    },
    ...(input.secondary ? { secondary: input.secondary as ExchangeSecondaryContext } : {}),
    organization,
    saved: isSaved,
  };
}

export const exchange_resolveOrganizationPerspective = onCall(async (request) => {
  const input = parseInput(perspectiveInputSchema, request.data);
  return resolvePerspective(request, input);
});

const boundsSchema = z.object({
  west: z.number().min(-180).max(180),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  north: z.number().min(-90).max(90),
}).strict().refine((bounds) => bounds.south < bounds.north, "south must be below north");

const directoryInputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION).optional().default(CONTRACT_VERSION),
  organizationId: safeId.optional(),
  actorOrganizationId: safeId.optional(),
  mode: modeSchema.optional().default("intelligence"),
  query: z.string().trim().max(300).optional().default(""),
  filters: z.object({
    industries: z.array(z.string().trim().min(1).max(160)).max(25).optional().default([]),
    capabilities: z.array(z.string().trim().min(1).max(160)).max(25).optional().default([]),
    naicsCodes: z.array(z.string().trim().regex(/^\d{2,6}$/)).max(25).optional().default([]),
    certifications: z.array(z.string().trim().min(1).max(160)).max(25).optional().default([]),
    locality: z.string().trim().max(160).optional(),
    claimStatus: z.enum(["claimed", "claim_pending", "unclaimed"]).optional(),
    verificationStatus: z.string().trim().min(1).max(40).optional(),
    resourceProviderStatus: z.enum(["approved", "not_provider"]).optional(),
  }).strict().optional().default({
    industries: [],
    capabilities: [],
    naicsCodes: [],
    certifications: [],
  }),
  bounds: boundsSchema.optional(),
  pageSize: z.number().int().min(1).max(50).optional().default(25),
  cursor: z.object({ name: z.string().max(200), organizationId: safeId }).strict().optional(),
}).strict();

type DirectoryInput = z.infer<typeof directoryInputSchema>;

function includesAny(source: unknown, desired: string[]): boolean {
  if (!desired.length) return true;
  const available = new Set(
    (Array.isArray(source) ? source : [])
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase()),
  );
  return desired.some((value) => available.has(value.trim().toLowerCase()));
}

function inBounds(organization: RecordData, bounds: z.infer<typeof boundsSchema>): boolean {
  const latitude = organization.latitude;
  const longitude = organization.longitude;
  if (typeof latitude !== "number" || typeof longitude !== "number") return false;
  const longitudeMatches = bounds.west <= bounds.east
    ? longitude >= bounds.west && longitude <= bounds.east
    : longitude >= bounds.west || longitude <= bounds.east;
  return latitude >= bounds.south && latitude <= bounds.north && longitudeMatches;
}

function matchesDirectory(organization: RecordData, input: DirectoryInput): boolean {
  if (input.mode === "resources" && organization.resourceProviderStatus !== "approved") return false;
  const normalizedQuery = normalizeOrganizationName(input.query);
  if (normalizedQuery) {
    const haystack = normalizeOrganizationName([
      organization.name,
      organization.description,
      ...(Array.isArray(organization.industries) ? organization.industries : []),
      ...(Array.isArray(organization.capabilityKeywords) ? organization.capabilityKeywords : []),
      ...(Array.isArray(organization.naicsCodes) ? organization.naicsCodes : []),
      ...(Array.isArray(organization.certifications) ? organization.certifications : []),
    ].filter((value): value is string => typeof value === "string").join(" "));
    if (!haystack.includes(normalizedQuery)) return false;
  }
  const filters = input.filters;
  if (!includesAny(organization.industries, filters.industries)) return false;
  if (!includesAny(organization.capabilityKeywords, filters.capabilities)) return false;
  if (!includesAny(organization.naicsCodes, filters.naicsCodes)) return false;
  if (!includesAny(organization.certifications, filters.certifications)) return false;
  if (filters.locality) {
    const locality = filters.locality.toLowerCase();
    const values = [organization.city, organization.county, organization.state]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.toLowerCase());
    if (!values.some((value) => value.includes(locality))) return false;
  }
  if (filters.claimStatus && organization.claimStatus !== filters.claimStatus) return false;
  if (filters.verificationStatus && organization.verificationStatus !== filters.verificationStatus) return false;
  if (
    filters.resourceProviderStatus
    && organization.resourceProviderStatus !== filters.resourceProviderStatus
  ) return false;
  if (input.bounds && !inBounds(organization, input.bounds)) return false;
  return true;
}

export const exchange_organizationDirectory = onCall(async (request) => {
  const input = parseInput(directoryInputSchema, request.data);
  const db = getDb();
  if (input.organizationId) {
    if (request.auth) {
      const perspective = await resolvePerspective(request, {
        contractVersion: CONTRACT_VERSION,
        actorOrganizationId: input.actorOrganizationId,
        subjectOrganizationId: input.organizationId,
        mode: input.mode,
      });
      if (!perspective.organization) throw new HttpsError("not-found", "Organization is unavailable.");
      return {
        contractVersion: CONTRACT_VERSION,
        organization: perspective.organization,
        perspective,
      };
    }
    const snapshot = await db.collection("publicOrganizations").doc(input.organizationId).get();
    const organization = snapshot.exists
      ? projectApprovedPublicOrganization(input.organizationId, asRecord(snapshot.data()))
      : null;
    if (!organization) throw new HttpsError("not-found", "Organization is unavailable.");
    return { contractVersion: CONTRACT_VERSION, organization };
  }

  const scanLimit = Math.min(250, Math.max(50, input.pageSize * 5));
  let query: FirebaseFirestore.Query = db.collection("publicOrganizations")
    .where("status", "==", "active")
    .where("publicationApproved", "==", true)
    .orderBy("name", "asc")
    .orderBy(FieldPath.documentId(), "asc");
  if (input.cursor) query = query.startAfter(input.cursor.name, input.cursor.organizationId);
  const snapshot = await query.limit(scanLimit).get();
  const organizations: RecordData[] = [];
  let processed = 0;
  let lastProcessed: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (const document of snapshot.docs) {
    processed += 1;
    lastProcessed = document;
    const projection = projectApprovedPublicOrganization(document.id, asRecord(document.data()));
    if (projection && matchesDirectory(projection, input)) organizations.push(projection);
    if (organizations.length >= input.pageSize) break;
  }
  const hasMore = processed < snapshot.size || snapshot.size === scanLimit;
  return {
    contractVersion: CONTRACT_VERSION,
    organizations,
    nextCursor: hasMore && lastProcessed
      ? { name: String(lastProcessed.get("name") || ""), organizationId: lastProcessed.id }
      : null,
    hasMore,
    scanned: processed,
  };
});

const saveInputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION).optional().default(CONTRACT_VERSION),
  actorOrganizationId: safeId,
  action: z.enum(["set", "list"]),
  organizationId: safeId.optional(),
  saved: z.boolean().optional(),
  pageSize: z.number().int().min(1).max(100).optional().default(50),
}).strict().superRefine((input, context) => {
  if (input.action === "set" && (!input.organizationId || input.saved === undefined)) {
    context.addIssue({ code: "custom", message: "organizationId and saved are required for set" });
  }
});

export const exchange_saveOrganization = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseInput(saveInputSchema, request.data);
  const db = getDb();
  if (input.action === "list") {
    await db.runTransaction(async (transaction) => {
      await loadOrgAuthority(transaction, db, input.actorOrganizationId, actor.uid);
    });
    const savedSnapshot = await db.collection("exchangeSavedOrganizations")
      .where("actorOrganizationId", "==", input.actorOrganizationId)
      .orderBy("updatedAt", "desc")
      .limit(input.pageSize + 1)
      .get();
    const selected = savedSnapshot.docs.slice(0, input.pageSize);
    const publicSnapshots = selected.length
      ? await db.getAll(...selected.map((document) => (
        db.collection("publicOrganizations").doc(String(document.get("organizationId")))
      )))
      : [];
    const savedOrganizations = publicSnapshots.flatMap((snapshot) => {
      const projection = snapshot.exists
        ? projectApprovedPublicOrganization(snapshot.id, asRecord(snapshot.data()))
        : null;
      return projection ? [projection] : [];
    });
    return {
      contractVersion: CONTRACT_VERSION,
      savedOrganizations,
      truncated: savedSnapshot.size > input.pageSize,
    };
  }

  const organizationId = input.organizationId as string;
  if (organizationId === input.actorOrganizationId) {
    throw new HttpsError("invalid-argument", "The active actor organization cannot save itself.");
  }
  const savedRef = db.collection("exchangeSavedOrganizations")
    .doc(savedOrganizationDocumentId(input.actorOrganizationId, organizationId));
  const result = await db.runTransaction(async (transaction) => {
    await loadOrgAuthority(transaction, db, input.actorOrganizationId, actor.uid);
    const [organizationSnapshot, savedSnapshot] = await Promise.all([
      transaction.get(db.collection("publicOrganizations").doc(organizationId)),
      transaction.get(savedRef),
    ]);
    const organization = organizationSnapshot.exists
      ? projectApprovedPublicOrganization(organizationId, asRecord(organizationSnapshot.data()))
      : null;
    if (!organization) throw new HttpsError("not-found", "Organization is unavailable.");
    const currentlySaved = savedSnapshot.exists;
    if (currentlySaved === input.saved) {
      return { contractVersion: CONTRACT_VERSION, organizationId, saved: currentlySaved };
    }
    const now = Date.now();
    if (input.saved) {
      transaction.create(savedRef, {
        id: savedRef.id,
        actorOrganizationId: input.actorOrganizationId,
        organizationId,
        savedByUid: actor.uid,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      transaction.delete(savedRef);
    }
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action: input.saved ? "organization.saved" : "organization.unsaved",
      entityType: "organization",
      entityId: organizationId,
      orgId: input.actorOrganizationId,
      actorOrganizationId: input.actorOrganizationId,
      subjectOrganizationId: organizationId,
      metadata: { subjectOrganizationId: organizationId },
      createdAt: now,
    });
    return { contractVersion: CONTRACT_VERSION, organizationId, saved: input.saved };
  });
  return result;
});

function completedIdempotentResult(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  actorUid: string,
  action: string,
  requestFingerprint: string,
): RecordData | null {
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (data?.uid !== actorUid || data.action !== action || data.status !== "completed") {
    throw new HttpsError("already-exists", "The idempotency key is already in use.");
  }
  if (data.requestFingerprint !== requestFingerprint) {
    throw new HttpsError("already-exists", "The idempotency key belongs to a different request.");
  }
  return asRecord(data.result ?? { requestId: data.entityId });
}

const contactInputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION).optional().default(CONTRACT_VERSION),
  actorOrganizationId: safeId,
  subjectOrganizationId: safeId,
  message: z.string().trim().min(10).max(2_000),
  topic: z.string().trim().min(1).max(160).optional(),
  idempotencyKey,
}).strict();

export const exchange_requestOrganizationContact = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseInput(contactInputSchema, request.data);
  if (input.actorOrganizationId === input.subjectOrganizationId) {
    throw new HttpsError("invalid-argument", "Contact requests require a different organization.");
  }
  const db = getDb();
  const action = "organization.contact_request";
  const fingerprint = fingerprintRequest(input);
  const dedupeRef = idempotencyRef(db, actor.uid, action, input.idempotencyKey);
  const contactRef = db.collection("organizationContactRequests").doc();
  return db.runTransaction(async (transaction) => {
    const dedupeSnapshot = await transaction.get(dedupeRef);
    await loadOrgAuthority(transaction, db, input.actorOrganizationId, actor.uid);
    const prior = completedIdempotentResult(dedupeSnapshot, actor.uid, action, fingerprint);
    if (prior) return { contractVersion: CONTRACT_VERSION, ...prior, idempotent: true };
    const [subjectSnapshot, subjectMemberships] = await Promise.all([
      transaction.get(db.collection("publicOrganizations").doc(input.subjectOrganizationId)),
      transaction.get(db.collection("orgMembers")
        .where("orgId", "==", input.subjectOrganizationId)
        .limit(50)),
    ]);
    const subject = subjectSnapshot.exists
      ? projectApprovedPublicOrganization(input.subjectOrganizationId, asRecord(subjectSnapshot.data()))
      : null;
    if (!subject || subject.claimStatus !== "claimed") {
      throw new HttpsError("failed-precondition", "The organization cannot receive contact requests.");
    }
    const recipientManagerUids = subjectMemberships.docs.flatMap((document) => {
      const membership = asRecord(document.data());
      const uid = cleanText(membership.uid, 200);
      return uid
        && document.id === `${input.subjectOrganizationId}_${uid}`
        && membership.orgId === input.subjectOrganizationId
        && membership.status === "active"
        && (membership.role === "owner" || membership.role === "admin")
        ? [uid]
        : [];
    }).slice(0, 20);
    const now = Date.now();
    transaction.create(contactRef, {
      id: contactRef.id,
      actorOrganizationId: input.actorOrganizationId,
      subjectOrganizationId: input.subjectOrganizationId,
      requestedByUid: actor.uid,
      message: input.message,
      ...(input.topic ? { topic: input.topic } : {}),
      recipientManagerUids,
      routingQueue: recipientManagerUids.length ? "subject_managers" : "platform_contact_review",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    for (const recipientUid of recipientManagerUids) {
      const notificationRef = db.collection("notifications")
        .doc(`organization_contact_${contactRef.id}_${recipientUid}`);
      transaction.create(notificationRef, {
        id: notificationRef.id,
        uid: recipientUid,
        type: "organization_contact_request",
        title: "Organization contact request",
        message: `${String(subject.name || "Your organization")} received a contact request in the Exchange.`,
        link: `/exchange?organization=${encodeURIComponent(input.subjectOrganizationId)}`,
        organizationId: input.subjectOrganizationId,
        requestId: contactRef.id,
        read: false,
        createdAt: now,
      });
    }
    const result = { requestId: contactRef.id, status: "pending" };
    setCompletedIdempotency(transaction, dedupeRef, {
      uid: actor.uid,
      action,
      entityId: contactRef.id,
      result,
      requestFingerprint: fingerprint,
      createdAt: now,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action,
      entityType: "organizationContactRequest",
      entityId: contactRef.id,
      orgId: input.actorOrganizationId,
      actorOrganizationId: input.actorOrganizationId,
      subjectOrganizationId: input.subjectOrganizationId,
      newStatus: "pending",
      metadata: { subjectOrganizationId: input.subjectOrganizationId },
      createdAt: now,
    });
    return { contractVersion: CONTRACT_VERSION, ...result, idempotent: false };
  });
});

const introductionInputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION).optional().default(CONTRACT_VERSION),
  actorOrganizationId: safeId,
  subjectOrganizationId: safeId,
  message: z.string().trim().min(10).max(2_000),
  idempotencyKey,
}).strict();

export const exchange_requestOrganizationIntroduction = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseInput(introductionInputSchema, request.data);
  if (input.actorOrganizationId === input.subjectOrganizationId) {
    throw new HttpsError("invalid-argument", "Introduction requests require a different organization.");
  }
  const db = getDb();
  const action = "organization.introduction_request";
  const fingerprint = fingerprintRequest(input);
  const dedupeRef = idempotencyRef(db, actor.uid, action, input.idempotencyKey);
  const introductionRef = db.collection("organizationIntroductionRequests").doc();
  const relationshipRef = db.collection("referralRelationshipInsights").doc(
    relationshipDocumentId(input.actorOrganizationId, input.subjectOrganizationId),
  );
  return db.runTransaction(async (transaction) => {
    const dedupeSnapshot = await transaction.get(dedupeRef);
    await loadOrgAuthority(transaction, db, input.actorOrganizationId, actor.uid);
    const prior = completedIdempotentResult(dedupeSnapshot, actor.uid, action, fingerprint);
    if (prior) return { contractVersion: CONTRACT_VERSION, ...prior, idempotent: true };
    const [subjectSnapshot, relationshipSnapshot] = await Promise.all([
      transaction.get(db.collection("publicOrganizations").doc(input.subjectOrganizationId)),
      transaction.get(relationshipRef),
    ]);
    const subject = subjectSnapshot.exists
      ? projectApprovedPublicOrganization(input.subjectOrganizationId, asRecord(subjectSnapshot.data()))
      : null;
    if (!subject || subject.claimStatus !== "claimed") {
      throw new HttpsError("failed-precondition", "The organization cannot receive introduction requests.");
    }
    const relationship = safeRelationshipState(
      relationshipSnapshot,
      input.actorOrganizationId,
      input.subjectOrganizationId,
    );
    const now = Date.now();
    transaction.create(introductionRef, {
      id: introductionRef.id,
      actorOrganizationId: input.actorOrganizationId,
      subjectOrganizationId: input.subjectOrganizationId,
      requestedByUid: actor.uid,
      message: input.message,
      relationshipAvailable: relationship.exists,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    const result = {
      requestId: introductionRef.id,
      status: "pending",
      trustedIntroductionMayBeAvailable: relationship.exists,
    };
    setCompletedIdempotency(transaction, dedupeRef, {
      uid: actor.uid,
      action,
      entityId: introductionRef.id,
      result,
      requestFingerprint: fingerprint,
      createdAt: now,
    });
    writeExchangeAudit(transaction, db, {
      actorUid: actor.uid,
      actorRole: actor.role,
      action,
      entityType: "organizationIntroductionRequest",
      entityId: introductionRef.id,
      orgId: input.actorOrganizationId,
      actorOrganizationId: input.actorOrganizationId,
      subjectOrganizationId: input.subjectOrganizationId,
      newStatus: "pending",
      metadata: {
        subjectOrganizationId: input.subjectOrganizationId,
        relationshipAvailable: relationship.exists,
      },
      createdAt: now,
    });
    return { contractVersion: CONTRACT_VERSION, ...result, idempotent: false };
  });
});

const resourceStatusInputSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION).optional().default(CONTRACT_VERSION),
  actorOrganizationId: safeId.optional(),
  subjectOrganizationId: safeId,
}).strict();

function privateResourceStatus(value: unknown): "approved" | "not_provider" | "pending" | "suspended" | "rejected" {
  if (value === "approved" || value === "pending" || value === "suspended" || value === "rejected") {
    return value;
  }
  return "not_provider";
}

export const exchange_getOrganizationResourceStatus = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const input = parseInput(resourceStatusInputSchema, request.data);
  const db = getDb();
  const selection = await resolveActorSelection(db, actor.uid, input.actorOrganizationId);
  const [publicSnapshot, orgSnapshot, membershipSnapshot] = await Promise.all([
    db.collection("publicOrganizations").doc(input.subjectOrganizationId).get(),
    db.collection("orgs").doc(input.subjectOrganizationId).get(),
    db.collection("orgMembers").doc(`${input.subjectOrganizationId}_${actor.uid}`).get(),
  ]);
  const publicOrganization = publicSnapshot.exists
    ? projectApprovedPublicOrganization(input.subjectOrganizationId, asRecord(publicSnapshot.data()))
    : null;
  const organization = asRecord(orgSnapshot.data());
  const membership = asRecord(membershipSnapshot.data());
  const exactActiveMembership = orgSnapshot.exists
    && organization.status === "active"
    && membershipSnapshot.exists
    && membershipSnapshot.id === `${input.subjectOrganizationId}_${actor.uid}`
    && membership.orgId === input.subjectOrganizationId
    && membership.uid === actor.uid
    && membership.status === "active"
    && role(membership.role) !== null;
  const selectedSelf = selection.selected?.organizationId === input.subjectOrganizationId;
  const managesSubject = exactActiveMembership
    && (membership.role === "owner" || membership.role === "admin");
  if (selectedSelf || managesSubject) {
    return {
      contractVersion: CONTRACT_VERSION,
      organizationId: input.subjectOrganizationId,
      status: privateResourceStatus(organization.resourceProviderStatus),
      public: organization.resourceProviderStatus === "approved" && Boolean(publicOrganization),
    };
  }
  if (!publicOrganization) {
    return {
      contractVersion: CONTRACT_VERSION,
      organizationId: input.subjectOrganizationId,
      status: "unavailable",
      public: false,
    };
  }
  return {
    contractVersion: CONTRACT_VERSION,
    organizationId: input.subjectOrganizationId,
    status: publicOrganization.resourceProviderStatus === "approved" ? "approved" : "not_provider",
    public: publicOrganization.resourceProviderStatus === "approved",
  };
});
