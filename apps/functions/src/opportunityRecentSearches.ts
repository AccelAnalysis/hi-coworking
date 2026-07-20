import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { fingerprintRequest, getAuthorizedActor, getDb } from "./exchange/security";

type RecordData = Record<string, unknown>;
const MAX_RECENT_SEARCHES = 20;

function asRecord(value: unknown): RecordData {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordData
    : {};
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

function compactQuery(value: unknown): RecordData | null {
  const source = asRecord(value);
  const filters = asRecord(source.filters);
  const query = typeof source.query === "string" ? source.query.trim().slice(0, 240) : "";
  const hasFilters = Object.values(filters).some((item) => (
    Array.isArray(item) ? item.length > 0 : item !== undefined && item !== false
  ));
  const location = source.location && typeof source.location === "object"
    ? source.location
    : undefined;
  if (!query && !hasFilters && !location) return null;
  return {
    contractVersion: 1,
    query,
    filters,
    ...(location ? { location } : {}),
    sort: typeof source.sort === "string" ? source.sort : "recommended",
    pageSize: 40,
  };
}

export async function recordRecentOpportunitySearch(
  request: CallableRequest<unknown>,
  payload: unknown,
): Promise<void> {
  if (!request.auth) return;
  const query = compactQuery(payload);
  if (!query) return;
  const db = getDb();
  const fingerprint = fingerprintRequest(query);
  const reference = db.collection("opportunityRecentSearches")
    .doc(`${request.auth.uid}_${fingerprint.slice(0, 32)}`);
  await reference.set({
    id: reference.id,
    ownerUid: request.auth.uid,
    query,
    label: typeof query.query === "string" && query.query
      ? query.query
      : "Filtered opportunity search",
    normalizedVersion: 1,
    lastUsedAt: Date.now(),
  }, { merge: true });

  const recent = await db.collection("opportunityRecentSearches")
    .where("ownerUid", "==", request.auth.uid)
    .orderBy("lastUsedAt", "desc")
    .limit(MAX_RECENT_SEARCHES + 10)
    .get();
  if (recent.size > MAX_RECENT_SEARCHES) {
    const batch = db.batch();
    recent.docs.slice(MAX_RECENT_SEARCHES).forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
}

export async function listRecentOpportunitySearches(
  request: CallableRequest<unknown>,
  payload: unknown,
): Promise<unknown> {
  const actor = getAuthorizedActor(request);
  const parsed = z.object({
    maxResults: z.number().int().min(1).max(MAX_RECENT_SEARCHES).default(10),
  }).strict().safeParse(payload ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid recent-search request");
  const snapshot = await getDb().collection("opportunityRecentSearches")
    .where("ownerUid", "==", actor.uid)
    .orderBy("lastUsedAt", "desc")
    .limit(parsed.data.maxResults)
    .get();
  return {
    searches: snapshot.docs.map((document) => {
      const data = asRecord(document.data());
      return {
        id: document.id,
        ownerUid: actor.uid,
        label: typeof data.label === "string"
          ? data.label.slice(0, 240)
          : "Filtered opportunity search",
        query: data.query,
        normalizedVersion: 1,
        lastUsedAt: Math.max(0, Math.trunc(numberValue(data.lastUsedAt) ?? 0)),
      };
    }),
  };
}
