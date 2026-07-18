import { FieldValue } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";
import { getDb } from "./exchange/security";
import { buildOpportunityDiscoveryProjection } from "./opportunityDiscovery";

type RecordData = Record<string, unknown>;
const MAX_FALLBACK_SCAN = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

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
      const result = toMillis.call(value);
      if (typeof result === "number" && Number.isFinite(result)) return result;
    }
  }
  return undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
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

function tokens(value: string): string[] {
  return normalize(value).split(" ").filter((item) => item.length > 1);
}

function intersects(source: unknown, requested: unknown): boolean {
  const filters = strings(requested).map(normalize);
  if (!filters.length) return true;
  const values = strings(source).map(normalize);
  return filters.some((filter) => values.some((value) => value === filter || value.includes(filter) || filter.includes(value)));
}

function prefixIntersects(source: unknown, requested: unknown): boolean {
  const filters = strings(requested);
  if (!filters.length) return true;
  const values = strings(source);
  return filters.some((filter) => values.some((value) => value.startsWith(filter) || filter.startsWith(value)));
}

function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = rad(bLat - aLat);
  const deltaLng = rad(bLng - aLng);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(deltaLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function relevance(record: RecordData, rawQuery: string): number {
  const query = normalize(rawQuery);
  if (!query) return 0;
  const title = normalize(stringValue(record.title) ?? "");
  const issuer = normalize(stringValue(record.issuerDisplayName) ?? "");
  const description = normalize(stringValue(record.searchableDescription) ?? "");
  const identifier = normalize(stringValue(record.rfxNumber) ?? stringValue(record.id) ?? "");
  if (title === query) return 1000;
  if (identifier === query) return 900;
  return tokens(query).reduce((score, token) => (
    score
      + (title.includes(token) ? 100 : 0)
      + (issuer.includes(token) ? 35 : 0)
      + (description.includes(token) ? 10 : 0)
      + (strings(record.naicsCodes).includes(token) ? 150 : 0)
      + (strings(record.capabilityKeywords).some((value) => normalize(value).includes(token)) ? 130 : 0)
  ), 0);
}

function withinLocation(record: RecordData, location: RecordData): boolean {
  const arrangement = stringValue(record.workArrangement);
  if (arrangement === "remote" && location.includeRemote !== false) return true;
  const geo = asRecord(record.geo);
  const latitude = numberValue(geo.latitude);
  const longitude = numberValue(geo.longitude);
  const bounds = asRecord(location.bounds);
  if (Object.keys(bounds).length) {
    const west = numberValue(bounds.west);
    const south = numberValue(bounds.south);
    const east = numberValue(bounds.east);
    const north = numberValue(bounds.north);
    if (
      latitude === undefined
      || longitude === undefined
      || west === undefined
      || south === undefined
      || east === undefined
      || north === undefined
      || longitude < west
      || longitude > east
      || latitude < south
      || latitude > north
    ) return false;
  }
  const originLatitude = numberValue(location.latitude);
  const originLongitude = numberValue(location.longitude);
  const radius = numberValue(location.radiusMiles);
  if (originLatitude !== undefined && originLongitude !== undefined && radius !== undefined) {
    if (latitude === undefined || longitude === undefined) return false;
    if (haversineMiles(originLatitude, originLongitude, latitude, longitude) > radius) return false;
  }
  return true;
}

function matches(record: RecordData, input: RecordData): boolean {
  const filter = asRecord(input.filters);
  if (!prefixIntersects(record.naicsCodes, filter.naics)) return false;
  if (!intersects(record.industryLabels, filter.industries)) return false;
  if (!intersects(record.capabilityKeywords, filter.capabilities)) return false;
  const exactFilters: Array<[string, string]> = [
    ["opportunityType", "opportunityTypes"],
    ["rfxType", "rfxTypes"],
    ["issuerType", "buyerTypes"],
    ["workArrangement", "workArrangements"],
    ["visibility", "visibility"],
    ["territoryFips", "territoryFips"],
    ["primeClassification", "primeClassifications"],
    ["awardClassification", "awardClassifications"],
  ];
  for (const [recordField, filterField] of exactFilters) {
    const requested = strings(filter[filterField]);
    if (requested.length && !requested.includes(stringValue(record[recordField]) ?? "")) return false;
  }
  if (!intersects(record.requiredCertifications, filter.requiredCertifications)) return false;
  if (!intersects(record.setAsideDesignations, filter.setAsideDesignations)) return false;
  if (typeof filter.teamingSuitable === "boolean" && (record.teamingSuitable === true) !== filter.teamingSuitable) return false;
  const now = Date.now();
  const deadline = numberValue(record.responseDeadline);
  if (filter.closingSoon === true && (deadline === undefined || deadline < now || deadline > now + 7 * DAY_MS)) return false;
  const budgetMin = numberValue(record.budgetMin);
  const budgetMax = numberValue(record.budgetMax);
  const requestedMin = numberValue(filter.budgetMin);
  const requestedMax = numberValue(filter.budgetMax);
  if (requestedMin !== undefined && (budgetMax === undefined || budgetMax < requestedMin)) return false;
  if (requestedMax !== undefined && (budgetMin === undefined || budgetMin > requestedMax)) return false;
  const rawQuery = stringValue(input.query) ?? "";
  if (rawQuery && relevance(record, rawQuery) <= 0) return false;
  const location = asRecord(input.location);
  if (Object.keys(location).length && !withinLocation(record, location)) return false;
  return true;
}

function sortRecords(records: RecordData[], input: RecordData): RecordData[] {
  const sort = stringValue(input.sort) ?? "recommended";
  const direction = (field: string, ascending = false) => (left: RecordData, right: RecordData) => {
    const l = numberValue(left[field]) ?? (ascending ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    const r = numberValue(right[field]) ?? (ascending ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
    return (ascending ? l - r : r - l) || String(left.id).localeCompare(String(right.id));
  };
  switch (sort) {
    case "relevance": return records.sort((left, right) => relevance(right, stringValue(input.query) ?? "") - relevance(left, stringValue(input.query) ?? "") || direction("updatedAt")(left, right));
    case "nearest": return records.sort(direction("distanceMiles", true));
    case "newest": return records.sort(direction("postedAt"));
    case "updated": return records.sort(direction("updatedAt"));
    case "deadline_soonest": return records.sort(direction("responseDeadline", true));
    case "deadline_latest": return records.sort(direction("responseDeadline"));
    case "budget_high": return records.sort(direction("budgetMax"));
    case "budget_low": return records.sort(direction("budgetMin", true));
    default: return records.sort(direction("recommendedRank"));
  }
}

function encodeOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ version: 1, offset }), "utf8").toString("base64url");
}

function decodeOffset(cursor: unknown): number {
  if (typeof cursor !== "string") return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as RecordData;
    return value.version === 1 && typeof value.offset === "number" && Number.isInteger(value.offset) && value.offset >= 0
      ? value.offset
      : 0;
  } catch {
    return 0;
  }
}

async function addRelationships(uid: string | undefined, records: RecordData[]): Promise<RecordData[]> {
  if (!uid || !records.length) return records.map((record) => ({
    ...record,
    relationship: { saved: false, viewed: false, responded: false, managed: false, newSinceLastVisit: false, updatedSinceViewed: false },
  }));
  const db = getDb();
  const saved = await db.getAll(...records.map((record) => db.collection("opportunitySavedItems").doc(`${uid}_${record.id}`)));
  const viewed = await db.getAll(...records.map((record) => db.collection("opportunityRecentViews").doc(`${uid}_${record.id}`)));
  return records.map((record, index) => {
    const viewedAt = numberValue(viewed[index]?.data()?.viewedAt);
    const postedAt = numberValue(record.postedAt) ?? 0;
    const updatedAt = numberValue(record.updatedAt) ?? 0;
    return {
      ...record,
      relationship: {
        saved: Boolean(saved[index]?.exists),
        viewed: Boolean(viewed[index]?.exists),
        responded: false,
        managed: stringValue(record.ownerUid) === uid || stringValue(record.createdBy) === uid,
        newSinceLastVisit: !viewedAt && postedAt >= Date.now() - 14 * DAY_MS,
        updatedSinceViewed: Boolean(viewedAt && updatedAt > viewedAt),
      },
    };
  });
}

export async function ensureOpportunityProjection(rfxId: string): Promise<boolean> {
  const db = getDb();
  const target = db.collection("opportunityDiscovery").doc(rfxId);
  const existing = await target.get();
  if (existing.exists) return true;
  const source = await db.collection("rfx").doc(rfxId).get();
  if (!source.exists) return false;
  const projection = buildOpportunityDiscoveryProjection(rfxId, source.data());
  if (!projection) return false;
  await target.set(projection, { merge: false });
  return true;
}

/**
 * Transitional fallback for branches whose existing RFx records predate the
 * discovery projection trigger/backfill. It stays server-side, bounded, safe,
 * and explicitly reports degraded/qualified behavior.
 */
export async function fallbackOpportunityDiscovery(
  request: CallableRequest<unknown>,
  payload: unknown,
): Promise<RecordData> {
  const input = asRecord(payload);
  const db = getDb();
  const snapshot = await db.collection("rfx")
    .where("adminApprovalStatus", "==", "approved")
    .where("status", "==", "open")
    .orderBy("updatedAt", "desc")
    .limit(MAX_FALLBACK_SCAN + 1)
    .get();
  const projections: RecordData[] = [];
  for (const document of snapshot.docs.slice(0, MAX_FALLBACK_SCAN)) {
    const projection = buildOpportunityDiscoveryProjection(document.id, document.data());
    if (!projection) continue;
    if (!request.auth && projection.visibility !== "public") continue;
    if (matches(projection, input)) {
      const location = asRecord(input.location);
      const geo = asRecord(projection.geo);
      const originLatitude = numberValue(location.latitude);
      const originLongitude = numberValue(location.longitude);
      const latitude = numberValue(geo.latitude);
      const longitude = numberValue(geo.longitude);
      projections.push({
        ...projection,
        relevanceScore: relevance(projection, stringValue(input.query) ?? ""),
        ...(originLatitude !== undefined && originLongitude !== undefined && latitude !== undefined && longitude !== undefined
          ? { distanceMiles: haversineMiles(originLatitude, originLongitude, latitude, longitude) }
          : {}),
      });
    }
  }
  sortRecords(projections, input);
  const offset = decodeOffset(input.cursor);
  const pageSize = Math.max(1, Math.min(100, numberValue(input.pageSize) ?? 40));
  const page = projections.slice(offset, offset + pageSize);
  const records = await addRelationships(request.auth?.uid, page);
  const hasMore = offset + pageSize < projections.length || snapshot.size > MAX_FALLBACK_SCAN;
  return {
    contractVersion: 1,
    records,
    ...(hasMore ? { nextCursor: encodeOffset(offset + pageSize) } : {}),
    countAccuracy: snapshot.size > MAX_FALLBACK_SCAN ? "qualified" : "exact",
    ...(snapshot.size <= MAX_FALLBACK_SCAN ? { totalCount: projections.length } : {}),
    truncated: hasMore,
    degraded: true,
    warnings: [
      "Discovery projection backfill is incomplete; results use the bounded server-side compatibility path.",
      ...(snapshot.size > MAX_FALLBACK_SCAN ? ["Compatibility results are capped at 400 source opportunities until backfill completes."] : []),
    ],
    provider: "legacy-rfx-server-fallback-v1",
    queryDurationMs: 0,
  };
}

export async function backfillOpportunityProjectionBatch(limit = 200): Promise<{ scanned: number; written: number }> {
  const db = getDb();
  const snapshot = await db.collection("rfx")
    .where("adminApprovalStatus", "==", "approved")
    .orderBy("updatedAt", "desc")
    .limit(Math.max(1, Math.min(500, limit)))
    .get();
  let written = 0;
  const batch = db.batch();
  snapshot.docs.forEach((document) => {
    const projection = buildOpportunityDiscoveryProjection(document.id, document.data());
    if (!projection) return;
    batch.set(db.collection("opportunityDiscovery").doc(document.id), {
      ...projection,
      backfilledAt: FieldValue.serverTimestamp(),
    }, { merge: false });
    written += 1;
  });
  if (written) await batch.commit();
  return { scanned: snapshot.size, written };
}
