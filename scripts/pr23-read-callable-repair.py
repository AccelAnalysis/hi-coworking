from pathlib import Path

root = Path(__file__).resolve().parents[1]
helper = root / "apps/web/src/lib/callableReadPayloads.ts"

helper.write_text(r'''type UnknownRecord = Record<string, unknown>;

const REFERRAL_ID = /^[A-Za-z0-9_.:@-]+$/;
const NAICS_CODE = /^\d{2,6}$/;
const TERRITORY_FIPS = /^\d{5}$/;
const REFERRAL_STATUSES = new Set([
  "draft", "sent", "accepted", "declined", "in_progress", "converted",
  "closed", "withdrawn", "expired",
]);

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown, maximum: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, maximum);
  return normalized || undefined;
}

function workspaceId(value: unknown): string | undefined {
  const normalized = text(value, 200);
  return normalized && !normalized.includes("/") ? normalized : undefined;
}

function referralId(value: unknown): string | undefined {
  const normalized = text(value, 128);
  return normalized && REFERRAL_ID.test(normalized) ? normalized : undefined;
}

function boundedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(numeric)));
}

function stringList(
  value: unknown,
  maximumItems = 25,
  maximumLength = 160,
  validator?: (item: string) => boolean,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = [...new Set(value.flatMap((item) => {
    const result = text(item, maximumLength);
    return result && (!validator || validator(result)) ? [result] : [];
  }))].slice(0, maximumItems);
  return normalized.length ? normalized : undefined;
}

export interface NormalizedActorOrganizationRequest {
  contractVersion: 1;
  requestedActorOrganizationId?: string;
  persistSelection: boolean;
}

export function normalizeActorOrganizationRequest(value: unknown): NormalizedActorOrganizationRequest {
  const input = record(value);
  const requestedActorOrganizationId = workspaceId(input.requestedActorOrganizationId);
  return {
    contractVersion: 1,
    ...(requestedActorOrganizationId ? { requestedActorOrganizationId } : {}),
    persistSelection: Boolean(requestedActorOrganizationId && input.persistSelection === true),
  };
}

export interface NormalizedOrganizationDirectoryFilters {
  industries?: string[];
  capabilities?: string[];
  naicsCodes?: string[];
  certifications?: string[];
  locality?: string;
  claimStatus?: "claimed" | "claim_pending" | "unclaimed";
  verificationStatus?: string;
  resourceProviderStatus?: "approved" | "not_provider";
}

export interface NormalizedOrganizationDirectoryRequest {
  contractVersion: 1;
  query?: string;
  filters?: NormalizedOrganizationDirectoryFilters;
  bounds?: { west: number; south: number; east: number; north: number };
  pageSize: number;
  cursor?: { name: string; organizationId: string };
}

export function normalizeOrganizationDirectoryRequest(value: unknown): NormalizedOrganizationDirectoryRequest {
  const input = record(value);
  const rawFilters = record(input.filters);
  const filters: NormalizedOrganizationDirectoryFilters = {};
  const industries = stringList(rawFilters.industries);
  const capabilities = stringList(rawFilters.capabilities);
  const naicsCodes = stringList(rawFilters.naicsCodes, 25, 6, (item) => NAICS_CODE.test(item));
  const certifications = stringList(rawFilters.certifications);
  if (industries) filters.industries = industries;
  if (capabilities) filters.capabilities = capabilities;
  if (naicsCodes) filters.naicsCodes = naicsCodes;
  if (certifications) filters.certifications = certifications;
  const locality = text(rawFilters.locality, 160);
  if (locality) filters.locality = locality;
  if (["claimed", "claim_pending", "unclaimed"].includes(String(rawFilters.claimStatus))) {
    filters.claimStatus = rawFilters.claimStatus as NormalizedOrganizationDirectoryFilters["claimStatus"];
  }
  const verificationStatus = text(rawFilters.verificationStatus, 40);
  if (verificationStatus) filters.verificationStatus = verificationStatus;
  if (["approved", "not_provider"].includes(String(rawFilters.resourceProviderStatus))) {
    filters.resourceProviderStatus = rawFilters.resourceProviderStatus as NormalizedOrganizationDirectoryFilters["resourceProviderStatus"];
  }

  const rawBounds = record(input.bounds);
  const west = rawBounds.west;
  const south = rawBounds.south;
  const east = rawBounds.east;
  const north = rawBounds.north;
  const bounds = [west, south, east, north].every((item) => typeof item === "number" && Number.isFinite(item))
    && (west as number) >= -180 && (west as number) <= 180
    && (east as number) >= -180 && (east as number) <= 180
    && (south as number) >= -90 && (south as number) <= 90
    && (north as number) >= -90 && (north as number) <= 90
    && (south as number) < (north as number)
    ? { west: west as number, south: south as number, east: east as number, north: north as number }
    : undefined;

  const rawCursor = record(input.cursor);
  const cursorName = typeof rawCursor.name === "string" ? rawCursor.name.slice(0, 200) : undefined;
  const cursorOrganizationId = workspaceId(rawCursor.organizationId);
  const cursor = cursorName !== undefined && cursorOrganizationId
    ? { name: cursorName, organizationId: cursorOrganizationId }
    : undefined;
  const query = text(input.query, 300);

  return {
    contractVersion: 1,
    ...(query ? { query } : {}),
    ...(Object.keys(filters).length ? { filters } : {}),
    ...(bounds ? { bounds } : {}),
    pageSize: boundedInteger(input.pageSize, 1, 50, 25),
    ...(cursor ? { cursor } : {}),
  };
}

export interface NormalizedBusinessReferralListMineInput {
  direction: "all" | "sent" | "received";
  scope: "all" | "individual" | "organization";
  actorOrganizationId?: string;
  statuses: string[];
  industry?: string;
  territoryFips?: string;
  compensationPresent?: boolean;
  search?: string;
  limit: number;
  cursor?: { createdAt: number; id: string };
}

export function normalizeBusinessReferralListMineInput(value: unknown): NormalizedBusinessReferralListMineInput {
  const input = record(value);
  const direction = ["all", "sent", "received"].includes(String(input.direction))
    ? input.direction as NormalizedBusinessReferralListMineInput["direction"]
    : "all";
  const requestedScope = ["all", "individual", "organization"].includes(String(input.scope))
    ? input.scope as NormalizedBusinessReferralListMineInput["scope"]
    : "all";
  const actorOrganizationId = referralId(input.actorOrganizationId);
  const scope = requestedScope === "organization" && !actorOrganizationId
    ? "individual"
    : requestedScope;
  const statuses = Array.isArray(input.statuses)
    ? [...new Set(input.statuses.filter((item): item is string => (
      typeof item === "string" && REFERRAL_STATUSES.has(item)
    )))].slice(0, 9)
    : [];
  const industry = text(input.industry, 160);
  const territoryFips = text(input.territoryFips, 5);
  const search = text(input.search, 160);
  const rawCursor = record(input.cursor);
  const cursorId = referralId(rawCursor.id);
  const cursorCreatedAt = rawCursor.createdAt;
  const cursor = typeof cursorCreatedAt === "number"
    && Number.isInteger(cursorCreatedAt)
    && cursorCreatedAt >= 0
    && cursorId
    ? { createdAt: cursorCreatedAt, id: cursorId }
    : undefined;

  return {
    direction,
    scope,
    ...(scope === "organization" && actorOrganizationId ? { actorOrganizationId } : {}),
    statuses,
    ...(industry ? { industry } : {}),
    ...(territoryFips && TERRITORY_FIPS.test(territoryFips) ? { territoryFips } : {}),
    ...(typeof input.compensationPresent === "boolean"
      ? { compensationPresent: input.compensationPresent }
      : {}),
    ...(search ? { search } : {}),
    limit: boundedInteger(input.limit, 1, 100, 50),
    ...(cursor ? { cursor } : {}),
  };
}
''', encoding="utf-8")

gateway = root / "apps/web/src/features/exchange/data/organizationContextGateway.ts"
source = gateway.read_text(encoding="utf-8")
if 'from "@/lib/callableReadPayloads"' not in source:
    source = source.replace(
        'import { functions } from "@/lib/firebase";\n',
        'import { functions } from "@/lib/firebase";\nimport {\n  normalizeActorOrganizationRequest,\n  normalizeOrganizationDirectoryRequest,\n} from "@/lib/callableReadPayloads";\n',
        1,
    )
source = source.replace(
    '  const result = await listActorOrganizationsCallable({\n    contractVersion: EXCHANGE_ORGANIZATION_CONTEXT_VERSION,\n    ...input,\n  });\n',
    '  const result = await listActorOrganizationsCallable(\n    normalizeActorOrganizationRequest(input),\n  );\n',
    1,
)
source = source.replace(
    '  const result = await organizationDirectoryCallable({\n    contractVersion: EXCHANGE_ORGANIZATION_CONTEXT_VERSION,\n    ...input,\n  });\n',
    '  const result = await organizationDirectoryCallable(\n    normalizeOrganizationDirectoryRequest(input),\n  );\n',
    1,
)
if 'normalizeActorOrganizationRequest(input)' not in source or 'normalizeOrganizationDirectoryRequest(input)' not in source:
    raise SystemExit("Organization callable anchors were not repaired")
gateway.write_text(source, encoding="utf-8")

functions = root / "apps/web/src/lib/functions.ts"
source = functions.read_text(encoding="utf-8")
if 'from "./callableReadPayloads"' not in source:
    source = source.replace(
        'import { app, auth, functions } from "./firebase";\n',
        'import { app, auth, functions } from "./firebase";\nimport { normalizeBusinessReferralListMineInput } from "./callableReadPayloads";\n',
        1,
    )
old_callable = '''export const listBusinessReferralsFn = httpsCallable<
  BusinessReferralListMineInput,
  {
    referrals: unknown[];
    scope: { organizations: Array<{ id: string; role: string; name?: string }> };
    truncated: boolean;
    nextCursor?: { createdAt: number; id: string };
  }
>(functions, "businessReferral_listMine");
'''
new_callable = '''type BusinessReferralListMineResult = {
  referrals: unknown[];
  scope: { organizations: Array<{ id: string; role: string; name?: string }> };
  truncated: boolean;
  nextCursor?: { createdAt: number; id: string };
};

const listBusinessReferralsCallable = httpsCallable<
  BusinessReferralListMineInput,
  BusinessReferralListMineResult
>(functions, "businessReferral_listMine");

export function listBusinessReferralsFn(input: BusinessReferralListMineInput) {
  return listBusinessReferralsCallable(
    normalizeBusinessReferralListMineInput(input),
  );
}
'''
if old_callable in source:
    source = source.replace(old_callable, new_callable, 1)
if 'normalizeBusinessReferralListMineInput(input)' not in source:
    raise SystemExit("Business referral callable anchor was not repaired")
functions.write_text(source, encoding="utf-8")

test = root / "tests/exchange/callable-read-payload-normalization.test.ts"
test.write_text(r'''import { describe, expect, it } from "vitest";
import {
  normalizeActorOrganizationRequest,
  normalizeBusinessReferralListMineInput,
  normalizeOrganizationDirectoryRequest,
} from "../../apps/web/src/lib/callableReadPayloads";

describe("read callable payload normalization", () => {
  it("drops an invalid stale Actor selection and disables persistence", () => {
    expect(normalizeActorOrganizationRequest({
      requestedActorOrganizationId: " stale/actor ",
      persistSelection: true,
      unexpected: "ignored",
    })).toEqual({ contractVersion: 1, persistSelection: false });
  });

  it("sends only directory values accepted by the strict server schema", () => {
    expect(normalizeOrganizationDirectoryRequest({
      query: "  Accel   Analysis  ",
      pageSize: 500,
      filters: {
        industries: [" Consulting ", "Consulting", ""],
        naicsCodes: ["541611", "not-naics", "12"],
        claimStatus: "invalid",
        resourceProviderStatus: "approved",
      },
      cursor: { name: "A", organizationId: "bad/id" },
      unexpected: true,
    })).toEqual({
      contractVersion: 1,
      query: "Accel Analysis",
      filters: {
        industries: ["Consulting"],
        naicsCodes: ["541611", "12"],
        resourceProviderStatus: "approved",
      },
      pageSize: 50,
    });
  });

  it("removes stale organization context from all-scope referral reads", () => {
    expect(normalizeBusinessReferralListMineInput({
      direction: "all",
      scope: "all",
      actorOrganizationId: "stale-org",
      statuses: ["sent", "all", "sent", "bad"],
      territoryFips: "5109",
      limit: 0,
      cursor: { createdAt: -1, id: "bad/id" },
    })).toEqual({ direction: "all", scope: "all", statuses: ["sent"], limit: 1 });
  });

  it("fails closed to individual scope when an organization selection is invalid", () => {
    expect(normalizeBusinessReferralListMineInput({
      direction: "received",
      scope: "organization",
      actorOrganizationId: "invalid/org",
      statuses: [],
      limit: 25,
    })).toEqual({ direction: "received", scope: "individual", statuses: [], limit: 25 });
  });
});
''', encoding="utf-8")
