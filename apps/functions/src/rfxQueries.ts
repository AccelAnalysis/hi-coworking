import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  getAuthorizedActor,
  getDb,
  isOrgManagementRole,
} from "./exchange/security";

type RecordData = Record<string, unknown>;

const listManagedRfxInputSchema = z
  .object({
    maxResults: z.number().int().min(1).max(200).default(100),
  })
  .strict();

const MAX_ORG_MEMBERSHIPS = 100;
const FIRESTORE_IN_LIMIT = 30;

function asRecord(value: unknown): RecordData {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordData
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === "function") {
      const milliseconds = toMillis.call(value);
      return typeof milliseconds === "number" && Number.isFinite(milliseconds)
        ? milliseconds
        : undefined;
    }
  }
  return undefined;
}

function stringArray(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value
    .filter((item): item is string => typeof item === "string")
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
  return result.length > 0 ? result : [];
}

function setString(
  target: RecordData,
  source: RecordData,
  field: string,
  maxLength = 10_000,
): void {
  const value = stringValue(source[field]);
  if (value !== undefined) target[field] = value.slice(0, maxLength);
}

function setNumber(target: RecordData, source: RecordData, field: string): void {
  const value = numberValue(source[field]);
  if (value !== undefined) target[field] = value;
}

function sanitizeEvaluationCriteria(value: unknown): RecordData[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item) => {
    const source = asRecord(item);
    const criterion: RecordData = {};
    setString(criterion, source, "id", 128);
    setString(criterion, source, "label", 160);
    setNumber(criterion, source, "weight");
    setString(criterion, source, "direction", 32);
    setString(criterion, source, "description", 500);
    return criterion;
  });
}

function sanitizeRequestedDocuments(value: unknown): RecordData[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((item) => {
    const source = asRecord(item);
    const requestedDocument: RecordData = {};
    setString(requestedDocument, source, "id", 128);
    setString(requestedDocument, source, "label", 160);
    if (typeof source.required === "boolean") requestedDocument.required = source.required;
    setString(requestedDocument, source, "description", 500);
    return requestedDocument;
  });
}

/**
 * Return the participant representation of an RFx through an explicit
 * allowlist. This prevents unrelated legacy or administrative fields from
 * leaking merely because the callable uses the Admin SDK.
 */
export function sanitizeManagedRfx(
  documentId: string,
  source: RecordData,
): RecordData {
  const result: RecordData = {
    id: documentId,
    memberOnly: source.memberOnly === true,
    evaluationCriteria: sanitizeEvaluationCriteria(source.evaluationCriteria),
    requestedDocuments: sanitizeRequestedDocuments(source.requestedDocuments),
    responseCount: numberValue(source.responseCount) ?? 0,
    createdAt: numberValue(source.createdAt) ?? 0,
  };

  const stringFields: Array<[string, number]> = [
    ["title", 160],
    ["description", 10_000],
    ["location", 240],
    ["territoryFips", 16],
    ["budget", 120],
    ["status", 40],
    ["createdBy", 128],
    ["ownerUid", 128],
    ["orgId", 128],
    ["createdByName", 200],
    ["visibility", 40],
    ["template", 80],
    ["adminApprovalStatus", 40],
    ["adminReviewNote", 1_000],
    ["approvedBy", 128],
    ["rejectedBy", 128],
    ["cancelledBy", 128],
    ["cancellationReason", 1_000],
    ["awardedResponseId", 128],
  ];
  stringFields.forEach(([field, maxLength]) => setString(result, source, field, maxLength));

  const numberFields = [
    "schemaVersion",
    "dueDate",
    "approvedAt",
    "rejectedAt",
    "cancelledAt",
    "version",
    "updatedAt",
  ];
  numberFields.forEach((field) => setNumber(result, source, field));

  const naicsCodes = stringArray(source.naicsCodes, 25, 16);
  if (naicsCodes !== undefined) result.naicsCodes = naicsCodes;

  const geoSource = asRecord(source.geo);
  const latitude = numberValue(geoSource.lat);
  const longitude = numberValue(geoSource.lng);
  const geohash = stringValue(geoSource.geohash);
  if (latitude !== undefined && longitude !== undefined && geohash) {
    result.geo = { lat: latitude, lng: longitude, geohash: geohash.slice(0, 20) };
  }

  return result;
}

function hasOrganizationScope(rfx: RecordData): boolean {
  return Object.prototype.hasOwnProperty.call(rfx, "orgId");
}

function isIndividuallyManaged(rfx: RecordData, uid: string): boolean {
  if (hasOrganizationScope(rfx)) return false;
  return (stringValue(rfx.ownerUid) ?? stringValue(rfx.createdBy)) === uid;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

/**
 * Server-filtered discovery for RFx management. Organization scope always
 * wins over creator identity: a former creator receives no organization RFx
 * after their exact active owner/admin membership is removed.
 */
export const rfx_listManaged = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const parsed = listManagedRfxInputSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "Invalid request data", {
      issues: parsed.error.issues.slice(0, 8).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  const { maxResults } = parsed.data;
  const db = getDb();

  const membershipSnapshot = await db
    .collection("orgMembers")
    .where("uid", "==", actor.uid)
    .limit(MAX_ORG_MEMBERSHIPS + 1)
    .get();
  if (membershipSnapshot.size > MAX_ORG_MEMBERSHIPS) {
    throw new HttpsError(
      "resource-exhausted",
      "Organization membership count exceeds the managed RFx query limit",
    );
  }

  const managerMemberships = membershipSnapshot.docs.flatMap((document) => {
    const member = asRecord(document.data());
    const orgId = stringValue(member.orgId);
    if (
      !orgId
      || document.id !== `${orgId}_${actor.uid}`
      || member.uid !== actor.uid
      || !isOrgManagementRole(member.role)
    ) {
      return [];
    }
    return [{ orgId, role: member.role as "owner" | "admin" }];
  });

  const organizationSnapshots = managerMemberships.length > 0
    ? await db.getAll(...managerMemberships.map(({ orgId }) => db.collection("orgs").doc(orgId)))
    : [];
  const managerOrganizations = organizationSnapshots.flatMap((snapshot, index) => {
    const membership = managerMemberships[index];
    const organization = asRecord(snapshot.data());
    if (!snapshot.exists || organization.status !== "active" || snapshot.id !== membership.orgId) {
      return [];
    }
    const name = stringValue(organization.name);
    return [{
      orgId: membership.orgId,
      role: membership.role,
      ...(name ? { name: name.slice(0, 200) } : {}),
    }];
  });
  const managerOrgIds = managerOrganizations.map(({ orgId }) => orgId);
  const managerOrgIdSet = new Set(managerOrgIds);

  const rfxCollection = db.collection("rfx");
  const organizationQueries = chunks(managerOrgIds, FIRESTORE_IN_LIMIT).map((orgIds) => (
    rfxCollection
      .where("orgId", "in", orgIds)
      .orderBy("createdAt", "desc")
      .limit(maxResults)
      .get()
  ));
  const [ownerSnapshot, creatorSnapshot, ...organizationSnapshotsForRfx] = await Promise.all([
    rfxCollection
      .where("ownerUid", "==", actor.uid)
      .orderBy("createdAt", "desc")
      .limit(maxResults)
      .get(),
    rfxCollection
      .where("createdBy", "==", actor.uid)
      .orderBy("createdAt", "desc")
      .limit(maxResults)
      .get(),
    ...organizationQueries,
  ]);

  const snapshots = [ownerSnapshot, creatorSnapshot, ...organizationSnapshotsForRfx];
  const managedById = new Map<string, { source: RecordData; createdAt: number }>();
  for (const snapshot of snapshots) {
    for (const document of snapshot.docs) {
      const rfx = asRecord(document.data());
      const orgId = stringValue(rfx.orgId);
      const authorized = hasOrganizationScope(rfx)
        ? Boolean(orgId && managerOrgIdSet.has(orgId))
        : isIndividuallyManaged(rfx, actor.uid);
      if (!authorized) continue;
      managedById.set(document.id, {
        source: rfx,
        createdAt: numberValue(rfx.createdAt) ?? 0,
      });
    }
  }

  const managed = Array.from(managedById.entries())
    .sort((left, right) => (
      right[1].createdAt - left[1].createdAt || left[0].localeCompare(right[0])
    ));
  const returned = managed.slice(0, maxResults);
  const rfx = returned.map(([documentId, value]) => sanitizeManagedRfx(documentId, value.source));
  const activeStatuses = new Set(["open", "under_review"]);
  const publisherActiveCounts: {
    individual: number;
    organizations: Record<string, number>;
  } = { individual: 0, organizations: {} };
  managed.forEach(([, value]) => {
    if (!activeStatuses.has(stringValue(value.source.status) ?? "")) return;
    const orgId = stringValue(value.source.orgId);
    if (orgId) {
      publisherActiveCounts.organizations[orgId]
        = (publisherActiveCounts.organizations[orgId] ?? 0) + 1;
    } else {
      publisherActiveCounts.individual += 1;
    }
  });

  return {
    rfx,
    manageableRfxIds: rfx.map((document) => document.id as string),
    managerOrganizations,
    activeCount: managed.filter(([, value]) => activeStatuses.has(stringValue(value.source.status) ?? "")).length,
    publisherActiveCounts,
    totalCount: managed.length,
    truncated: managed.length > maxResults || snapshots.some((snapshot) => snapshot.size === maxResults),
  };
});
