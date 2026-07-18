import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { getAuthorizedActor, getDb } from "./exchange/security";

const PROJECTION_VERSION = 1 as const;
const MAX_PAGE_SIZE = 100;
const MAX_CANDIDATES = 400;
const CURSOR_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

type RecordData = Record<string, unknown>;
type SortDirection = "asc" | "desc";

type OpportunitySort =
  | "recommended"
  | "relevance"
  | "nearest"
  | "newest"
  | "updated"
  | "deadline_soonest"
  | "deadline_latest"
  | "local_first"
  | "capability_match"
  | "budget_high"
  | "budget_low";

interface DiscoveryCursor {
  version: number;
  sort: OpportunitySort;
  value: number;
  id: string;
}

interface DiscoveryLocation {
  label?: string;
  latitude?: number;
  longitude?: number;
  radiusMiles?: number;
  bounds?: { west: number; south: number; east: number; north: number };
  includeRemote: boolean;
}

interface DiscoveryFilters {
  naics: string[];
  industries: string[];
  capabilities: string[];
  opportunityTypes: string[];
  rfxTypes: string[];
  buyerTypes: string[];
  workArrangements: string[];
  visibility: string[];
  requiredCertifications: string[];
  setAsideDesignations: string[];
  territoryFips: string[];
  primeClassifications: string[];
  awardClassifications: string[];
  teamingSuitable?: boolean;
  closingSoon?: boolean;
  postedAfter?: number;
  postedBefore?: number;
  deadlineAfter?: number;
  deadlineBefore?: number;
  budgetMin?: number;
  budgetMax?: number;
  currency?: string;
  personalized: string[];
}

interface DiscoveryInput {
  contractVersion: 1;
  query: string;
  exactPhrase?: string;
  filters: DiscoveryFilters;
  location?: DiscoveryLocation;
  sort: OpportunitySort;
  pageSize: number;
  cursor?: string;
}

const stringList = (maxItems: number, maxLength: number) => z
  .array(z.string().trim().min(1).max(maxLength))
  .max(maxItems)
  .default([]);

const discoveryInputSchema = z.object({
  contractVersion: z.literal(PROJECTION_VERSION).default(PROJECTION_VERSION),
  query: z.string().max(240).default(""),
  exactPhrase: z.string().max(240).optional(),
  filters: z.object({
    naics: z.array(z.string().regex(/^\d{2,6}$/)).max(40).default([]),
    industries: stringList(40, 160),
    capabilities: stringList(60, 120),
    opportunityTypes: stringList(10, 40),
    rfxTypes: stringList(20, 80),
    buyerTypes: stringList(10, 40),
    workArrangements: stringList(10, 40),
    visibility: stringList(3, 40),
    requiredCertifications: stringList(40, 160),
    setAsideDesignations: stringList(40, 160),
    territoryFips: stringList(40, 16),
    primeClassifications: stringList(3, 24),
    awardClassifications: stringList(2, 24),
    teamingSuitable: z.boolean().optional(),
    closingSoon: z.boolean().optional(),
    postedAfter: z.number().int().nonnegative().optional(),
    postedBefore: z.number().int().nonnegative().optional(),
    deadlineAfter: z.number().int().nonnegative().optional(),
    deadlineBefore: z.number().int().nonnegative().optional(),
    budgetMin: z.number().nonnegative().optional(),
    budgetMax: z.number().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    personalized: stringList(20, 64),
  }).strict().default({}),
  location: z.object({
    label: z.string().max(240).optional(),
    latitude: z.number().min(-85.051129).max(85.051129).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    radiusMiles: z.number().min(1).max(500).optional(),
    bounds: z.object({
      west: z.number().min(-180).max(180),
      south: z.number().min(-85.051129).max(85.051129),
      east: z.number().min(-180).max(180),
      north: z.number().min(-85.051129).max(85.051129),
    }).optional(),
    includeRemote: z.boolean().default(true),
  }).strict().optional(),
  sort: z.enum([
    "recommended",
    "relevance",
    "nearest",
    "newest",
    "updated",
    "deadline_soonest",
    "deadline_latest",
    "local_first",
    "capability_match",
    "budget_high",
    "budget_low",
  ]).default("recommended"),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE).default(40),
  cursor: z.string().max(2048).optional(),
}).strict();

const savedSearchInputSchema = z.object({
  id: z.string().min(1).max(160).optional(),
  name: z.string().trim().min(1).max(120),
  query: discoveryInputSchema.omit({ cursor: true }),
  alertFrequency: z.enum(["immediate", "daily", "weekly", "disabled"]).default("disabled"),
}).strict();

function asRecord(value: unknown): RecordData {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordData
    : {};
}

function stringValue(value: unknown, maxLength = 10_000): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : undefined;
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

function stringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean))]
    .slice(0, maxItems);
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SYNONYMS: Record<string, string[]> = {
  construction: ["contractor", "building", "renovation", "facilities"],
  technology: ["software", "it", "information technology", "digital"],
  consulting: ["advisory", "professional services", "strategy"],
  hvac: ["heating", "ventilation", "air conditioning", "238220"],
  electrical: ["electrician", "238210"],
  roofing: ["roof", "238160"],
  rfp: ["request for proposal"],
  rfq: ["request for quotation", "request for qualifications"],
};

function tokenize(value: string): string[] {
  const normalized = normalizeSearchText(value);
  if (!normalized) return [];
  const tokens = normalized.split(" ").filter((token) => token.length > 1);
  const expanded = tokens.flatMap((token) => [token, ...(SYNONYMS[token] ?? [])]);
  return [...new Set(expanded.map(normalizeSearchText).filter(Boolean))].slice(0, 500);
}

function parseBudget(value: unknown): { min?: number; max?: number; display?: string } {
  const display = stringValue(value, 160);
  if (!display) return {};
  const numbers = [...display.matchAll(/[\d,.]+/g)]
    .map((match) => Number(match[0].replace(/,/g, "")))
    .filter(Number.isFinite);
  const multiplier = /\b(?:m|million)\b/i.test(display)
    ? 1_000_000
    : /\b(?:k|thousand)\b/i.test(display)
      ? 1_000
      : 1;
  if (numbers.length === 0) return { display };
  const scaled = numbers.map((number) => number * multiplier);
  return {
    min: Math.min(...scaled),
    max: Math.max(...scaled),
    display,
  };
}

function naicsLabel(code: string): string | undefined {
  const labels: Record<string, string> = {
    "23": "Construction",
    "236220": "Commercial and institutional building construction",
    "238160": "Roofing contractors",
    "238210": "Electrical contractors",
    "238220": "Plumbing, heating, and air-conditioning contractors",
    "54": "Professional, scientific, and technical services",
    "541330": "Engineering services",
    "541511": "Custom computer programming services",
    "541512": "Computer systems design services",
    "541611": "Administrative management consulting services",
  };
  return labels[code] ?? labels[code.slice(0, 2)];
}

function safeGeo(source: RecordData): RecordData | undefined {
  const geo = asRecord(source.geo);
  const latitude = numberValue(geo.lat) ?? numberValue(source.latitude);
  const longitude = numberValue(geo.lng) ?? numberValue(source.longitude);
  const geohash = stringValue(geo.geohash ?? source.geohash, 24);
  if (
    latitude === undefined
    || longitude === undefined
    || latitude < -85.051129
    || latitude > 85.051129
    || longitude < -180
    || longitude > 180
    || !geohash
  ) {
    return undefined;
  }
  const confidence = stringValue(source.geographicConfidence, 40);
  const allowed = new Set([
    "exact",
    "approximate",
    "place_of_performance",
    "issuer_address",
    "eligible_territory",
    "territory_centroid",
    "withheld",
    "remote",
    "not_geocoded",
  ]);
  return {
    latitude,
    longitude,
    geohash,
    // Legacy coordinates are deliberately not promoted to exact without an
    // authoritative confidence field.
    confidence: confidence && allowed.has(confidence) ? confidence : "approximate",
  };
}

export function buildOpportunityDiscoveryProjection(
  id: string,
  sourceValue: unknown,
): RecordData | null {
  const source = asRecord(sourceValue);
  const status = stringValue(source.status, 40) ?? "draft";
  const approval = stringValue(source.adminApprovalStatus, 40) ?? "pending";
  if (["draft", "under_review", "rejected"].includes(status) || approval !== "approved") {
    return null;
  }

  const title = stringValue(source.title, 240);
  const description = stringValue(source.description, 10_000);
  if (!title || !description) return null;

  const naicsCodes = stringArray(source.naicsCodes, 40, 6)
    .filter((code) => /^\d{2,6}$/.test(code));
  const industryLabels = [
    ...stringArray(source.industryLabels, 40, 160),
    ...naicsCodes.map(naicsLabel).filter((label): label is string => Boolean(label)),
  ];
  const capabilityKeywords = stringArray(source.capabilityKeywords, 60, 120);
  const issuerDisplayName = stringValue(source.issuerDisplayName, 240)
    ?? stringValue(source.createdByName, 240)
    ?? "Exchange issuer";
  const location = stringValue(source.placeOfPerformance, 320)
    ?? stringValue(source.location, 320);
  const postedAt = numberValue(source.postedAt)
    ?? numberValue(source.createdAt)
    ?? Date.now();
  const updatedAt = numberValue(source.updatedAt) ?? postedAt;
  const responseDeadline = numberValue(source.responseDeadline)
    ?? numberValue(source.dueDate);
  const budget = parseBudget(source.budgetDisplay ?? source.budget);
  const visibilitySource = stringValue(source.visibility, 40)
    ?? (source.memberOnly === true ? "members" : "public");
  const visibility = ["public", "members", "restricted"].includes(visibilitySource)
    ? visibilitySource
    : "public";
  const workArrangementSource = stringValue(source.workArrangement, 40);
  const workArrangement = ["on_site", "remote", "hybrid", "flexible"].includes(workArrangementSource ?? "")
    ? workArrangementSource
    : /remote/i.test(location ?? "")
      ? "remote"
      : "unspecified";
  const opportunityTypeSource = stringValue(source.opportunityType, 40);
  const template = stringValue(source.template, 80) ?? "other";
  const opportunityType = [
    "goods",
    "services",
    "construction",
    "professional_services",
    "mixed",
    "other",
  ].includes(opportunityTypeSource ?? "")
    ? opportunityTypeSource
    : /construction/i.test(`${template} ${title}`)
      ? "construction"
      : /consult|professional/i.test(`${template} ${title}`)
        ? "professional_services"
        : "services";
  const issuerTypeSource = stringValue(source.issuerType, 40);
  const issuerType = ["government", "nonprofit", "private", "institutional"].includes(issuerTypeSource ?? "")
    ? issuerTypeSource
    : "unknown";
  const requiredCertifications = stringArray(source.requiredCertifications, 40, 160);
  const setAsideDesignations = stringArray(source.setAsideDesignations, 40, 160);
  const searchable = [
    id,
    title,
    description,
    issuerDisplayName,
    location,
    ...naicsCodes,
    ...industryLabels,
    ...capabilityKeywords,
    ...requiredCertifications,
    ...setAsideDesignations,
  ].filter((value): value is string => Boolean(value));
  const searchTokens = tokenize(searchable.join(" "));
  const geo = safeGeo(source);

  return {
    projectionVersion: PROJECTION_VERSION,
    id,
    title,
    searchableDescription: description,
    ...(stringValue(source.rfxNumber, 120) ? { rfxNumber: stringValue(source.rfxNumber, 120) } : {}),
    ...(stringValue(source.orgId, 160) ? { issuerOrganizationId: stringValue(source.orgId, 160) } : {}),
    issuerDisplayName,
    issuerType,
    issuerVerified: source.issuerVerified === true,
    rfxType: stringValue(source.rfxType, 80) ?? template,
    opportunityType,
    naicsCodes,
    industryLabels: [...new Set(industryLabels)].slice(0, 40),
    capabilityKeywords,
    searchTokens,
    normalizedTitle: normalizeSearchText(title),
    normalizedIssuer: normalizeSearchText(issuerDisplayName),
    postedAt,
    updatedAt,
    ...(responseDeadline !== undefined ? { responseDeadline } : {}),
    ...(stringValue(source.deadlineTimezone, 80) ? { deadlineTimezone: stringValue(source.deadlineTimezone, 80) } : {}),
    ...(budget.min !== undefined ? { budgetMin: budget.min } : {}),
    ...(budget.max !== undefined ? { budgetMax: budget.max } : {}),
    ...(budget.display ? { budgetDisplay: budget.display } : {}),
    currency: stringValue(source.currency, 3)?.toUpperCase() ?? "USD",
    ...(location ? { placeOfPerformance: location } : {}),
    workArrangement,
    ...(stringValue(source.territoryFips, 16) ? { territoryFips: stringValue(source.territoryFips, 16) } : {}),
    ...(stringValue(source.city, 120) ? { city: stringValue(source.city, 120) } : {}),
    ...(stringValue(source.county, 120) ? { county: stringValue(source.county, 120) } : {}),
    ...(stringValue(source.state, 80) ? { state: stringValue(source.state, 80) } : {}),
    ...(stringValue(source.postalCode, 20) ? { postalCode: stringValue(source.postalCode, 20) } : {}),
    ...(geo ? { geo } : {}),
    visibility,
    requiredCertifications,
    setAsideDesignations,
    primeClassification: ["prime", "subcontract", "either"].includes(stringValue(source.primeClassification, 24) ?? "")
      ? stringValue(source.primeClassification, 24)
      : "unspecified",
    awardClassification: ["single", "multiple"].includes(stringValue(source.awardClassification, 24) ?? "")
      ? stringValue(source.awardClassification, 24)
      : "unspecified",
    teamingSuitable: source.teamingSuitable === true,
    addendumCount: Math.max(0, Math.trunc(numberValue(source.addendumCount) ?? 0)),
    qAndAStatus: ["open", "closed"].includes(stringValue(source.qAndAStatus, 24) ?? "")
      ? stringValue(source.qAndAStatus, 24)
      : "not_available",
    ...(source.discloseResponseCount === true
      ? { responseCount: Math.max(0, Math.trunc(numberValue(source.responseCount) ?? 0)) }
      : {}),
    status,
    adminApprovalStatus: approval,
    ownerUid: stringValue(source.ownerUid, 160) ?? stringValue(source.createdBy, 160),
    createdBy: stringValue(source.createdBy, 160),
    discoverable: true,
    recommendedRank: Math.round(updatedAt / 1000),
    projectionUpdatedAt: Date.now(),
  };
}

function encodeCursor(cursor: DiscoveryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined, expectedSort: OpportunitySort): DiscoveryCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<DiscoveryCursor>;
    if (
      parsed.version !== CURSOR_VERSION
      || parsed.sort !== expectedSort
      || typeof parsed.value !== "number"
      || !Number.isFinite(parsed.value)
      || typeof parsed.id !== "string"
      || !parsed.id
    ) return undefined;
    return parsed as DiscoveryCursor;
  } catch {
    return undefined;
  }
}

function sortField(sort: OpportunitySort): { field: string; direction: SortDirection } {
  switch (sort) {
    case "newest": return { field: "postedAt", direction: "desc" };
    case "updated": return { field: "updatedAt", direction: "desc" };
    case "deadline_soonest": return { field: "responseDeadline", direction: "asc" };
    case "deadline_latest": return { field: "responseDeadline", direction: "desc" };
    case "budget_high": return { field: "budgetMax", direction: "desc" };
    case "budget_low": return { field: "budgetMin", direction: "asc" };
    default: return { field: "recommendedRank", direction: "desc" };
  }
}

function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function intersects(values: unknown, filters: readonly string[]): boolean {
  if (filters.length === 0) return true;
  const source = new Set(stringArray(values, 100, 200).map(normalizeSearchText));
  return filters.some((filter) => source.has(normalizeSearchText(filter)));
}

function matchesPrefix(values: unknown, filters: readonly string[]): boolean {
  if (filters.length === 0) return true;
  const source = stringArray(values, 100, 20);
  return filters.some((filter) => source.some((value) => value.startsWith(filter) || filter.startsWith(value)));
}

function inBounds(geo: RecordData, bounds: NonNullable<DiscoveryLocation["bounds"]>): boolean {
  const latitude = numberValue(geo.latitude);
  const longitude = numberValue(geo.longitude);
  return latitude !== undefined
    && longitude !== undefined
    && latitude >= bounds.south
    && latitude <= bounds.north
    && longitude >= bounds.west
    && longitude <= bounds.east;
}

function relevanceScore(record: RecordData, query: string, exactPhrase?: string): number {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery && !exactPhrase) return 0;
  const title = normalizeSearchText(stringValue(record.title, 240) ?? "");
  const issuer = normalizeSearchText(stringValue(record.issuerDisplayName, 240) ?? "");
  const description = normalizeSearchText(stringValue(record.searchableDescription, 10_000) ?? "");
  const id = normalizeSearchText(stringValue(record.rfxNumber, 120) ?? stringValue(record.id, 160) ?? "");
  const tokens = tokenize(query);
  let score = 0;
  if (normalizedQuery && title === normalizedQuery) score += 1000;
  if (normalizedQuery && id === normalizedQuery) score += 900;
  if (exactPhrase && `${title} ${description}`.includes(normalizeSearchText(exactPhrase))) score += 700;
  for (const token of tokens) {
    if (title.includes(token)) score += 100;
    if (issuer.includes(token)) score += 35;
    if (description.includes(token)) score += 10;
    if (stringArray(record.naicsCodes, 40, 10).some((code) => code === token)) score += 150;
    if (stringArray(record.capabilityKeywords, 60, 120).some((value) => normalizeSearchText(value).includes(token))) score += 130;
  }
  return score;
}

function matchesFilters(record: RecordData, input: DiscoveryInput, now: number): boolean {
  const filters = input.filters;
  if (!matchesPrefix(record.naicsCodes, filters.naics)) return false;
  if (!intersects(record.industryLabels, filters.industries)) return false;
  if (!intersects(record.capabilityKeywords, filters.capabilities)) return false;
  if (filters.opportunityTypes.length && !filters.opportunityTypes.includes(stringValue(record.opportunityType, 40) ?? "")) return false;
  if (filters.rfxTypes.length && !filters.rfxTypes.includes(stringValue(record.rfxType, 80) ?? "")) return false;
  if (filters.buyerTypes.length && !filters.buyerTypes.includes(stringValue(record.issuerType, 40) ?? "")) return false;
  if (filters.workArrangements.length && !filters.workArrangements.includes(stringValue(record.workArrangement, 40) ?? "")) return false;
  if (filters.visibility.length && !filters.visibility.includes(stringValue(record.visibility, 40) ?? "")) return false;
  if (!intersects(record.requiredCertifications, filters.requiredCertifications)) return false;
  if (!intersects(record.setAsideDesignations, filters.setAsideDesignations)) return false;
  if (filters.territoryFips.length && !filters.territoryFips.includes(stringValue(record.territoryFips, 16) ?? "")) return false;
  if (filters.primeClassifications.length && !filters.primeClassifications.includes(stringValue(record.primeClassification, 24) ?? "")) return false;
  if (filters.awardClassifications.length && !filters.awardClassifications.includes(stringValue(record.awardClassification, 24) ?? "")) return false;
  if (filters.teamingSuitable !== undefined && (record.teamingSuitable === true) !== filters.teamingSuitable) return false;
  const postedAt = numberValue(record.postedAt) ?? 0;
  const deadline = numberValue(record.responseDeadline);
  const budgetMin = numberValue(record.budgetMin);
  const budgetMax = numberValue(record.budgetMax);
  if (filters.postedAfter !== undefined && postedAt < filters.postedAfter) return false;
  if (filters.postedBefore !== undefined && postedAt > filters.postedBefore) return false;
  if (filters.deadlineAfter !== undefined && (deadline === undefined || deadline < filters.deadlineAfter)) return false;
  if (filters.deadlineBefore !== undefined && (deadline === undefined || deadline > filters.deadlineBefore)) return false;
  if (filters.closingSoon && (deadline === undefined || deadline < now || deadline > now + 7 * DAY_MS)) return false;
  if (filters.budgetMin !== undefined && (budgetMax === undefined || budgetMax < filters.budgetMin)) return false;
  if (filters.budgetMax !== undefined && (budgetMin === undefined || budgetMin > filters.budgetMax)) return false;
  if (filters.currency && stringValue(record.currency, 3) !== filters.currency.toUpperCase()) return false;

  const location = input.location;
  if (location) {
    const arrangement = stringValue(record.workArrangement, 40);
    if (arrangement === "remote" && location.includeRemote) return true;
    const geo = asRecord(record.geo);
    if (location.bounds && !inBounds(geo, location.bounds)) return false;
    if (
      location.latitude !== undefined
      && location.longitude !== undefined
      && location.radiusMiles !== undefined
    ) {
      const latitude = numberValue(geo.latitude);
      const longitude = numberValue(geo.longitude);
      if (latitude === undefined || longitude === undefined) return false;
      if (haversineMiles(location.latitude, location.longitude, latitude, longitude) > location.radiusMiles) return false;
    }
  }
  return true;
}

async function applyRelationships(
  actorUid: string | undefined,
  records: RecordData[],
): Promise<RecordData[]> {
  if (!actorUid || records.length === 0) {
    return records.map((record) => ({
      ...record,
      relationship: {
        saved: false,
        viewed: false,
        responded: false,
        managed: false,
        newSinceLastVisit: false,
        updatedSinceViewed: false,
      },
    }));
  }
  const db = getDb();
  const savedRefs = records.map((record) => db.collection("opportunitySavedItems").doc(`${actorUid}_${record.id}`));
  const viewedRefs = records.map((record) => db.collection("opportunityRecentViews").doc(`${actorUid}_${record.id}`));
  const [savedSnapshots, viewedSnapshots] = await Promise.all([
    db.getAll(...savedRefs),
    db.getAll(...viewedRefs),
  ]);
  return records.map((record, index) => {
    const viewedAt = numberValue(viewedSnapshots[index]?.data()?.viewedAt);
    const updatedAt = numberValue(record.updatedAt) ?? 0;
    const postedAt = numberValue(record.postedAt) ?? 0;
    return {
      ...record,
      relationship: {
        saved: Boolean(savedSnapshots[index]?.exists),
        viewed: Boolean(viewedSnapshots[index]?.exists),
        responded: false,
        managed: stringValue(record.ownerUid, 160) === actorUid || stringValue(record.createdBy, 160) === actorUid,
        newSinceLastVisit: !viewedAt && postedAt >= Date.now() - 14 * DAY_MS,
        updatedSinceViewed: Boolean(viewedAt && updatedAt > viewedAt),
      },
    };
  });
}

interface OpportunitySearchProvider {
  readonly name: string;
  search(input: DiscoveryInput, actorUid?: string): Promise<{
    records: RecordData[];
    nextCursor?: string;
    totalCount?: number;
    countAccuracy: "exact" | "qualified" | "unavailable";
    truncated: boolean;
    degraded: boolean;
    warnings: string[];
  }>;
}

class FirestoreProjectionSearchProvider implements OpportunitySearchProvider {
  readonly name = "firestore-projection-v1";

  async search(input: DiscoveryInput, actorUid?: string) {
    const db = getDb();
    const collection = db.collection("opportunityDiscovery");
    const tokens = tokenize(input.query);
    const { field, direction } = sortField(input.sort);
    const cursor = decodeCursor(input.cursor, input.sort);
    const candidateLimit = Math.min(MAX_CANDIDATES, Math.max(input.pageSize + 1, input.pageSize * 4));
    const warnings: string[] = [];
    let degraded = false;

    let query: FirebaseFirestore.Query = collection
      .where("projectionVersion", "==", PROJECTION_VERSION)
      .where("discoverable", "==", true);
    if (!actorUid) query = query.where("visibility", "==", "public");
    if (tokens.length > 0) query = query.where("searchTokens", "array-contains", tokens[0]);
    if (input.filters.territoryFips.length === 1) {
      query = query.where("territoryFips", "==", input.filters.territoryFips[0]);
    }
    query = query.orderBy(field, direction).orderBy(FieldPath.documentId(), direction);
    if (cursor) query = query.startAfter(cursor.value, cursor.id);
    query = query.limit(candidateLimit);

    let snapshot: FirebaseFirestore.QuerySnapshot;
    try {
      snapshot = await query.get();
    } catch (error) {
      const code = stringValue(asRecord(error).code, 80) ?? "";
      if (!code.includes("failed-precondition")) throw error;
      degraded = true;
      warnings.push("A required Firestore composite index is not active; results use the safe updated-date fallback.");
      let fallback: FirebaseFirestore.Query = collection
        .where("projectionVersion", "==", PROJECTION_VERSION)
        .where("discoverable", "==", true);
      if (!actorUid) fallback = fallback.where("visibility", "==", "public");
      fallback = fallback.orderBy("updatedAt", "desc").limit(candidateLimit);
      snapshot = await fallback.get();
    }

    const now = Date.now();
    let records = snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() }))
      .filter((record) => matchesFilters(record, input, now))
      .map((record) => {
        const score = relevanceScore(record, input.query, input.exactPhrase);
        const geo = asRecord(record.geo);
        const distanceMiles = input.location?.latitude !== undefined
          && input.location.longitude !== undefined
          && numberValue(geo.latitude) !== undefined
          && numberValue(geo.longitude) !== undefined
          ? haversineMiles(
              input.location.latitude,
              input.location.longitude,
              numberValue(geo.latitude) as number,
              numberValue(geo.longitude) as number,
            )
          : undefined;
        return {
          ...record,
          relevanceScore: score,
          ...(distanceMiles !== undefined ? { distanceMiles } : {}),
        };
      });

    if (tokens.length > 1) {
      records = records.filter((record) => {
        const recordTokens = new Set(stringArray(record.searchTokens, 500, 64));
        return tokens.every((token) => recordTokens.has(token) || [...recordTokens].some((value) => value.startsWith(token)));
      });
    }
    if (input.exactPhrase) {
      const phrase = normalizeSearchText(input.exactPhrase);
      records = records.filter((record) => normalizeSearchText(
        `${stringValue(record.title, 240) ?? ""} ${stringValue(record.searchableDescription, 10_000) ?? ""}`,
      ).includes(phrase));
    }

    if (input.sort === "relevance") {
      records.sort((left, right) => (numberValue(right.relevanceScore) ?? 0) - (numberValue(left.relevanceScore) ?? 0)
        || (numberValue(right.updatedAt) ?? 0) - (numberValue(left.updatedAt) ?? 0)
        || String(left.id).localeCompare(String(right.id)));
    } else if (input.sort === "nearest") {
      records.sort((left, right) => (numberValue(left.distanceMiles) ?? Number.POSITIVE_INFINITY) - (numberValue(right.distanceMiles) ?? Number.POSITIVE_INFINITY)
        || (numberValue(right.updatedAt) ?? 0) - (numberValue(left.updatedAt) ?? 0)
        || String(left.id).localeCompare(String(right.id)));
    } else if (input.sort === "capability_match") {
      const requested = input.filters.capabilities.map(normalizeSearchText);
      const matchCount = (record: RecordData) => stringArray(record.capabilityKeywords, 60, 120)
        .map(normalizeSearchText)
        .filter((value) => requested.some((filter) => value.includes(filter) || filter.includes(value))).length;
      records.sort((left, right) => matchCount(right) - matchCount(left)
        || (numberValue(right.updatedAt) ?? 0) - (numberValue(left.updatedAt) ?? 0)
        || String(left.id).localeCompare(String(right.id)));
    }

    const hasMore = snapshot.size === candidateLimit || records.length > input.pageSize;
    const pageRecords = records.slice(0, input.pageSize);
    const related = await applyRelationships(actorUid, pageRecords);
    const lastSnapshot = snapshot.docs[Math.min(snapshot.docs.length, candidateLimit) - 1];
    const lastValue = lastSnapshot ? numberValue(lastSnapshot.get(field)) : undefined;
    const nextCursor = hasMore && lastSnapshot && lastValue !== undefined
      ? encodeCursor({
          version: CURSOR_VERSION,
          sort: input.sort,
          value: lastValue,
          id: lastSnapshot.id,
        })
      : undefined;

    const hasPostFilters = tokens.length > 1
      || Boolean(input.exactPhrase)
      || Object.entries(input.filters).some(([key, value]) => key !== "territoryFips"
        && (Array.isArray(value) ? value.length > 0 : value !== undefined && value !== false))
      || Boolean(input.location);
    if (hasPostFilters) {
      warnings.push("Result count is qualified because some relevance, radius, and compound procurement filters are evaluated within bounded server candidates.");
    }

    return {
      records: related,
      nextCursor,
      totalCount: hasPostFilters ? undefined : related.length,
      countAccuracy: hasPostFilters ? "qualified" as const : "exact" as const,
      truncated: hasMore,
      degraded,
      warnings,
    };
  }
}

const searchProvider: OpportunitySearchProvider = new FirestoreProjectionSearchProvider();

export const rfx_discover = onCall(async (request) => {
  const startedAt = Date.now();
  const parsed = discoveryInputSchema.safeParse(request.data ?? {});
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "Invalid opportunity discovery query", {
      issues: parsed.error.issues.slice(0, 12).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  const actorUid = request.auth?.uid;
  const result = await searchProvider.search(parsed.data as DiscoveryInput, actorUid);
  return {
    contractVersion: PROJECTION_VERSION,
    ...result,
    provider: searchProvider.name,
    queryDurationMs: Date.now() - startedAt,
  };
});

export const rfx_setSaved = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const parsed = z.object({
    rfxId: z.string().min(1).max(160),
    saved: z.boolean(),
  }).strict().safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid saved-opportunity request");
  const db = getDb();
  const projection = await db.collection("opportunityDiscovery").doc(parsed.data.rfxId).get();
  if (!projection.exists) throw new HttpsError("not-found", "Opportunity not found");
  const reference = db.collection("opportunitySavedItems").doc(`${actor.uid}_${parsed.data.rfxId}`);
  if (parsed.data.saved) {
    await reference.set({
      ownerUid: actor.uid,
      rfxId: parsed.data.rfxId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } else {
    await reference.delete();
  }
  return { rfxId: parsed.data.rfxId, saved: parsed.data.saved };
});

export const rfx_markViewed = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const parsed = z.object({ rfxId: z.string().min(1).max(160) }).strict().safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid recently-viewed request");
  const db = getDb();
  const projection = await db.collection("opportunityDiscovery").doc(parsed.data.rfxId).get();
  if (!projection.exists) throw new HttpsError("not-found", "Opportunity not found");
  await db.collection("opportunityRecentViews").doc(`${actor.uid}_${parsed.data.rfxId}`).set({
    ownerUid: actor.uid,
    rfxId: parsed.data.rfxId,
    viewedAt: Date.now(),
    opportunityUpdatedAt: numberValue(projection.data()?.updatedAt) ?? 0,
  }, { merge: true });
  return { success: true };
});

export const rfx_savedSearch_upsert = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const parsed = savedSearchInputSchema.safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid saved search");
  const db = getDb();
  const reference = parsed.data.id
    ? db.collection("opportunitySavedSearches").doc(parsed.data.id)
    : db.collection("opportunitySavedSearches").doc();
  if (parsed.data.id) {
    const current = await reference.get();
    if (current.exists && current.data()?.ownerUid !== actor.uid) {
      throw new HttpsError("permission-denied", "Saved search ownership is required");
    }
  }
  const now = Date.now();
  await reference.set({
    id: reference.id,
    ownerUid: actor.uid,
    name: parsed.data.name,
    query: parsed.data.query,
    alertFrequency: parsed.data.alertFrequency,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    normalizedVersion: PROJECTION_VERSION,
    alertsConfigured: false,
  }, { merge: true });
  return {
    id: reference.id,
    ownerUid: actor.uid,
    name: parsed.data.name,
    query: parsed.data.query,
    alertFrequency: parsed.data.alertFrequency,
    createdAt: now,
    updatedAt: now,
  };
});

export const rfx_savedSearch_delete = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const parsed = z.object({ id: z.string().min(1).max(160) }).strict().safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid saved search id");
  const reference = getDb().collection("opportunitySavedSearches").doc(parsed.data.id);
  const snapshot = await reference.get();
  if (!snapshot.exists) return { success: true };
  if (snapshot.data()?.ownerUid !== actor.uid) {
    throw new HttpsError("permission-denied", "Saved search ownership is required");
  }
  await reference.delete();
  return { success: true };
});

export const rfx_savedSearch_list = onCall(async (request) => {
  const actor = getAuthorizedActor(request);
  const parsed = z.object({ maxResults: z.number().int().min(1).max(100).default(50) }).strict().safeParse(request.data ?? {});
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid saved search request");
  const snapshot = await getDb()
    .collection("opportunitySavedSearches")
    .where("ownerUid", "==", actor.uid)
    .orderBy("updatedAt", "desc")
    .limit(parsed.data.maxResults)
    .get();
  return {
    searches: snapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
  };
});

export const rfx_syncDiscoveryProjection = onDocumentWritten("rfx/{rfxId}", async (event) => {
  const id = event.params.rfxId;
  const target = getDb().collection("opportunityDiscovery").doc(id);
  const after = event.data?.after;
  if (!after?.exists) {
    await target.delete();
    return;
  }
  const projection = buildOpportunityDiscoveryProjection(id, after.data());
  if (!projection) {
    await target.delete();
    return;
  }
  await target.set(projection, { merge: false });
});
