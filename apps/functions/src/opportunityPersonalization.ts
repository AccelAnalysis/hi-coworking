import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import { getDb } from "./exchange/security";

type RecordData = Record<string, unknown>;

const FIRESTORE_IN_LIMIT = 30;
const MAX_MEMBERSHIPS = 100;

function asRecord(value: unknown): RecordData {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordData
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "toMillis" in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    if (typeof toMillis === "function") {
      const converted = toMillis.call(value);
      if (typeof converted === "number" && Number.isFinite(converted)) return converted;
    }
  }
  return undefined;
}

function stringArray(value: unknown, max = 100): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))]
    .slice(0, max);
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function hasPrefixMatch(left: readonly string[], right: readonly string[]): boolean {
  if (!left.length || !right.length) return false;
  return left.some((candidate) => right.some((target) => (
    candidate.startsWith(target) || target.startsWith(candidate)
  )));
}

function hasTextMatch(left: readonly string[], right: readonly string[]): boolean {
  if (!left.length || !right.length) return false;
  const normalizedLeft = left.map(normalize);
  const normalizedRight = right.map(normalize);
  return normalizedLeft.some((candidate) => normalizedRight.some((target) => (
    candidate === target || candidate.includes(target) || target.includes(candidate)
  )));
}

interface PersonalizationContext {
  uid: string;
  orgIds: string[];
  naicsCodes: string[];
  capabilities: string[];
  territoryFips: string[];
  verificationStatus?: string;
}

async function loadPersonalizationContext(uid: string): Promise<PersonalizationContext> {
  const db = getDb();
  const [profileSnapshot, membershipSnapshot] = await Promise.all([
    db.collection("profiles").doc(uid).get(),
    db.collection("orgMembers").where("uid", "==", uid).limit(MAX_MEMBERSHIPS + 1).get(),
  ]);
  if (membershipSnapshot.size > MAX_MEMBERSHIPS) {
    throw new HttpsError(
      "resource-exhausted",
      "Organization membership count exceeds the discovery personalization limit",
    );
  }

  const profile = asRecord(profileSnapshot.data());
  const memberships = membershipSnapshot.docs.flatMap((document) => {
    const member = asRecord(document.data());
    const orgId = stringValue(member.orgId);
    const status = stringValue(member.status);
    if (
      !orgId
      || document.id !== `${orgId}_${uid}`
      || member.uid !== uid
      || (status && status !== "active")
    ) return [];
    return [orgId];
  });
  const organizationSnapshots = memberships.length
    ? await db.getAll(...memberships.map((orgId) => db.collection("orgs").doc(orgId)))
    : [];
  const organizations = organizationSnapshots
    .filter((snapshot) => snapshot.exists && snapshot.data()?.status === "active")
    .map((snapshot) => asRecord(snapshot.data()));

  return {
    uid,
    orgIds: memberships,
    naicsCodes: [...new Set([
      ...stringArray(profile.naicsCodes),
      ...organizations.flatMap((organization) => stringArray(organization.naicsCodes)),
    ])],
    capabilities: [...new Set([
      ...stringArray(profile.capabilityKeywords),
      ...stringArray(profile.capabilities),
      ...organizations.flatMap((organization) => [
        ...stringArray(organization.capabilityKeywords),
        ...stringArray(organization.capabilities),
      ]),
    ])],
    territoryFips: [...new Set([
      ...stringArray(profile.serviceTerritoryFips),
      ...stringArray(profile.territoryFips),
      ...organizations.flatMap((organization) => [
        ...stringArray(organization.serviceTerritoryFips),
        ...stringArray(organization.territoryFips),
      ]),
    ])],
    verificationStatus: stringValue(profile.verificationStatus),
  };
}

async function loadRespondedOpportunityIds(
  context: PersonalizationContext,
  opportunityIds: string[],
): Promise<Set<string>> {
  if (!opportunityIds.length) return new Set();
  const db = getDb();
  const responseSnapshots = await Promise.all(
    chunks(opportunityIds, FIRESTORE_IN_LIMIT).map((ids) => (
      db.collection("rfxResponses").where("rfxId", "in", ids).get()
    )),
  );
  const orgIdSet = new Set(context.orgIds);
  const responded = new Set<string>();
  responseSnapshots.forEach((snapshot) => {
    snapshot.docs.forEach((document) => {
      const response = asRecord(document.data());
      const rfxId = stringValue(response.rfxId);
      const respondentUid = stringValue(response.respondentUid)
        ?? stringValue(response.createdBy);
      const respondentOrgId = stringValue(response.respondentOrgId)
        ?? stringValue(response.orgId);
      if (
        rfxId
        && (
          respondentUid === context.uid
          || Boolean(respondentOrgId && orgIdSet.has(respondentOrgId))
        )
      ) responded.add(rfxId);
    });
  });
  return responded;
}

function capabilityMatchCount(record: RecordData, capabilities: string[]): number {
  const recordCapabilities = stringArray(record.capabilityKeywords);
  return recordCapabilities.filter((capability) => hasTextMatch([capability], capabilities)).length;
}

function relationshipFor(
  record: RecordData,
  context: PersonalizationContext,
  responded: Set<string>,
): RecordData {
  const relationship = asRecord(record.relationship);
  const id = stringValue(record.id) ?? "";
  const deadline = numberValue(record.responseDeadline);
  const status = stringValue(record.status);
  const issuerOrgId = stringValue(record.issuerOrganizationId);
  const visibility = stringValue(record.visibility);
  const manages = relationship.managed === true
    || stringValue(record.ownerUid) === context.uid
    || stringValue(record.createdBy) === context.uid
    || Boolean(issuerOrgId && context.orgIds.includes(issuerOrgId));
  const hasResponded = relationship.responded === true || responded.has(id);
  let eligibleToRespond = true;
  let eligibilityReason = "Eligible to begin the secured response workflow";
  if (manages) {
    eligibleToRespond = false;
    eligibilityReason = "Members of the issuing organization cannot respond as an outside supplier";
  } else if (hasResponded) {
    eligibleToRespond = false;
    eligibilityReason = "A response has already been submitted by you or your organization";
  } else if (status !== "open") {
    eligibleToRespond = false;
    eligibilityReason = "This opportunity is not open for responses";
  } else if (deadline !== undefined && deadline < Date.now()) {
    eligibleToRespond = false;
    eligibilityReason = "The response deadline has passed";
  } else if (visibility !== "public" && !context.uid) {
    eligibleToRespond = false;
    eligibilityReason = "Membership is required for this opportunity";
  } else if (context.verificationStatus !== "verified") {
    eligibleToRespond = false;
    eligibilityReason = "Business verification may be required before submission";
  }
  return {
    ...relationship,
    saved: relationship.saved === true,
    viewed: relationship.viewed === true,
    responded: hasResponded,
    managed: manages,
    newSinceLastVisit: relationship.newSinceLastVisit === true,
    updatedSinceViewed: relationship.updatedSinceViewed === true,
    eligibleToRespond,
    eligibilityReason,
  };
}

function matchesPersonalizedFilters(
  record: RecordData,
  requested: readonly string[],
  context: PersonalizationContext,
): boolean {
  if (!requested.length) return true;
  const relationship = asRecord(record.relationship);
  const issuerOrgId = stringValue(record.issuerOrganizationId);
  const recordNaics = stringArray(record.naicsCodes);
  const recordCapabilities = stringArray(record.capabilityKeywords);
  const territory = stringValue(record.territoryFips);
  const matchesNaics = hasPrefixMatch(recordNaics, context.naicsCodes);
  const matchesCapabilities = hasTextMatch(recordCapabilities, context.capabilities);
  const matchesTerritory = Boolean(territory && context.territoryFips.includes(territory));
  const matchesOrganization = matchesNaics || matchesCapabilities || matchesTerritory;

  return requested.every((filter) => {
    switch (filter) {
      case "matches_organization": return matchesOrganization;
      case "matches_naics": return matchesNaics;
      case "matches_capabilities": return matchesCapabilities;
      case "matches_service_territory": return matchesTerritory;
      case "saved": return relationship.saved === true;
      case "viewed": return relationship.viewed === true;
      case "responded": return relationship.responded === true;
      case "managed": return relationship.managed === true;
      case "new_since_last_visit": return relationship.newSinceLastVisit === true;
      case "updated_since_viewed": return relationship.updatedSinceViewed === true;
      case "exclude_issued_by_my_org": return !issuerOrgId || !context.orgIds.includes(issuerOrgId);
      default: return true;
    }
  });
}

export async function applyOpportunityPersonalization(
  request: CallableRequest<unknown>,
  payload: unknown,
  pageValue: unknown,
): Promise<RecordData> {
  const page = asRecord(pageValue);
  const input = asRecord(payload);
  const filters = asRecord(input.filters);
  const personalized = stringArray(filters.personalized, 20);
  const records = Array.isArray(page.records)
    ? page.records.map(asRecord)
    : [];
  if (!request.auth) {
    if (personalized.length) {
      throw new HttpsError(
        "unauthenticated",
        "Sign in to use personalized opportunity filters",
      );
    }
    return page;
  }
  if (!records.length) return page;

  const context = await loadPersonalizationContext(request.auth.uid);
  const responded = await loadRespondedOpportunityIds(
    context,
    records.map((record) => stringValue(record.id)).filter((id): id is string => Boolean(id)),
  );
  let enriched = records.map((record) => ({
    ...record,
    relationship: relationshipFor(record, context, responded),
    capabilityMatchCount: capabilityMatchCount(record, context.capabilities),
  }));
  if (personalized.length) {
    enriched = enriched.filter((record) => (
      matchesPersonalizedFilters(record, personalized, context)
    ));
  }

  const sort = stringValue(input.sort);
  if (sort === "capability_match") {
    enriched.sort((left, right) => (
      (numberValue(right.capabilityMatchCount) ?? 0)
      - (numberValue(left.capabilityMatchCount) ?? 0)
      || (numberValue(right.updatedAt) ?? 0) - (numberValue(left.updatedAt) ?? 0)
      || String(left.id).localeCompare(String(right.id))
    ));
  } else if (sort === "recommended") {
    enriched.sort((left, right) => {
      const score = (record: RecordData) => (
        (numberValue(record.relevanceScore) ?? 0) * 100
        + (numberValue(record.capabilityMatchCount) ?? 0) * 25
        + (context.territoryFips.includes(stringValue(record.territoryFips) ?? "") ? 20 : 0)
        + (asRecord(record.relationship).updatedSinceViewed === true ? 8 : 0)
        + (asRecord(record.relationship).newSinceLastVisit === true ? 5 : 0)
      );
      return score(right) - score(left)
        || (numberValue(right.updatedAt) ?? 0) - (numberValue(left.updatedAt) ?? 0)
        || String(left.id).localeCompare(String(right.id));
    });
  }

  return {
    ...page,
    records: enriched,
    ...(personalized.length
      ? {
          totalCount: undefined,
          countAccuracy: "qualified",
          warnings: [
            ...stringArray(page.warnings, 10),
            "Personalized results are derived from the authenticated profile and active organization memberships.",
          ].slice(0, 10),
        }
      : {}),
  };
}
