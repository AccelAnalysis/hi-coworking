import { httpsCallable } from "firebase/functions";
import type {
  ExchangeMode,
  ExchangeOrganizationMembershipRole,
  ExchangeOrganizationPerspective,
  ExchangePublicOrganizationProjection,
  ExchangeSecondaryContext,
} from "@hi/shared/exchange-organization-context";
import { functions } from "@/lib/firebase";
import {
  normalizeActorOrganizationRequest,
  normalizeOrganizationDirectoryRequest,
} from "@/lib/callableReadPayloads";

export const EXCHANGE_ORGANIZATION_CONTEXT_VERSION = 1 as const;

export interface ExchangeActorOrganizationOption {
  organizationId: string;
  name: string;
  membershipRole: ExchangeOrganizationMembershipRole;
  capabilities: string[];
}

export interface ExchangeActorOrganizationResult {
  contractVersion: 1;
  actors: ExchangeActorOrganizationOption[];
  selectedActorOrganizationId: string | null;
  fallbackApplied: boolean;
}

export interface ExchangeOrganizationDirectoryCursor {
  name: string;
  organizationId: string;
}

export interface ExchangeOrganizationDirectoryResult {
  contractVersion: 1;
  organizations: ExchangePublicOrganizationProjection[];
  nextCursor: ExchangeOrganizationDirectoryCursor | null;
  hasMore: boolean;
  scanned: number;
}

export interface ExchangeOrganizationDirectoryFilters {
  industries?: string[];
  capabilities?: string[];
  naicsCodes?: string[];
  certifications?: string[];
  locality?: string;
  claimStatus?: "claimed" | "claim_pending" | "unclaimed";
  verificationStatus?: string;
  resourceProviderStatus?: "approved" | "not_provider";
}

const listActorOrganizationsCallable = httpsCallable<
  {
    contractVersion: 1;
    requestedActorOrganizationId?: string;
    persistSelection?: boolean;
  },
  ExchangeActorOrganizationResult
>(functions, "exchange_listActorOrganizations");

const resolveOrganizationPerspectiveCallable = httpsCallable<
  {
    contractVersion: 1;
    actorOrganizationId?: string;
    subjectOrganizationId: string;
    mode: ExchangeMode;
    secondary?: ExchangeSecondaryContext;
  },
  ExchangeOrganizationPerspective
>(functions, "exchange_resolveOrganizationPerspective");

const organizationDirectoryCallable = httpsCallable<
  {
    contractVersion: 1;
    query?: string;
    filters?: ExchangeOrganizationDirectoryFilters;
    bounds?: { west: number; south: number; east: number; north: number };
    pageSize?: number;
    cursor?: ExchangeOrganizationDirectoryCursor;
  },
  ExchangeOrganizationDirectoryResult
>(functions, "exchange_organizationDirectory");

const saveOrganizationCallable = httpsCallable<
  {
    contractVersion: 1;
    actorOrganizationId: string;
    action: "set";
    organizationId: string;
    saved: boolean;
  },
  { contractVersion: 1; organizationId: string; saved: boolean }
>(functions, "exchange_saveOrganization");

const requestOrganizationContactCallable = httpsCallable<
  {
    contractVersion: 1;
    actorOrganizationId: string;
    subjectOrganizationId: string;
    message: string;
    topic?: string;
    idempotencyKey: string;
  },
  { contractVersion: 1; requestId: string; status: "pending"; idempotent: boolean }
>(functions, "exchange_requestOrganizationContact");

const requestOrganizationIntroductionCallable = httpsCallable<
  {
    contractVersion: 1;
    actorOrganizationId: string;
    subjectOrganizationId: string;
    message: string;
    idempotencyKey: string;
  },
  {
    contractVersion: 1;
    requestId: string;
    status: "pending";
    trustedIntroductionMayBeAvailable: boolean;
    idempotent: boolean;
  }
>(functions, "exchange_requestOrganizationIntroduction");

const getOrganizationResourceStatusCallable = httpsCallable<
  {
    contractVersion: 1;
    actorOrganizationId?: string;
    subjectOrganizationId: string;
  },
  {
    contractVersion: 1;
    organizationId: string;
    status: "approved" | "not_provider" | "pending" | "suspended" | "rejected" | "unavailable";
    public: boolean;
  }
>(functions, "exchange_getOrganizationResourceStatus");

export async function listActorOrganizations(input: {
  requestedActorOrganizationId?: string;
  persistSelection?: boolean;
} = {}): Promise<ExchangeActorOrganizationResult> {
  const result = await listActorOrganizationsCallable(
    normalizeActorOrganizationRequest(input),
  );
  return result.data;
}

export async function resolveOrganizationPerspective(input: {
  actorOrganizationId?: string;
  subjectOrganizationId: string;
  mode: ExchangeMode;
  secondary?: ExchangeSecondaryContext;
}): Promise<ExchangeOrganizationPerspective> {
  const result = await resolveOrganizationPerspectiveCallable({
    contractVersion: EXCHANGE_ORGANIZATION_CONTEXT_VERSION,
    subjectOrganizationId: input.subjectOrganizationId,
    mode: input.mode,
    ...(input.actorOrganizationId
      ? { actorOrganizationId: input.actorOrganizationId }
      : {}),
    ...(input.secondary ? { secondary: input.secondary } : {}),
  });
  return result.data;
}

export async function listOrganizationDirectory(input: {
  query?: string;
  filters?: ExchangeOrganizationDirectoryFilters;
  bounds?: { west: number; south: number; east: number; north: number };
  pageSize?: number;
  cursor?: ExchangeOrganizationDirectoryCursor;
} = {}): Promise<ExchangeOrganizationDirectoryResult> {
  const result = await organizationDirectoryCallable(
    normalizeOrganizationDirectoryRequest(input),
  );
  return result.data;
}

export async function setOrganizationSaved(input: {
  actorOrganizationId: string;
  organizationId: string;
  saved: boolean;
}): Promise<{ organizationId: string; saved: boolean }> {
  const result = await saveOrganizationCallable({
    contractVersion: EXCHANGE_ORGANIZATION_CONTEXT_VERSION,
    action: "set",
    ...input,
  });
  return result.data;
}

export async function requestOrganizationContact(input: {
  actorOrganizationId: string;
  subjectOrganizationId: string;
  message: string;
  topic?: string;
  idempotencyKey: string;
}) {
  const result = await requestOrganizationContactCallable({
    contractVersion: EXCHANGE_ORGANIZATION_CONTEXT_VERSION,
    ...input,
  });
  return result.data;
}

export async function requestOrganizationIntroduction(input: {
  actorOrganizationId: string;
  subjectOrganizationId: string;
  message: string;
  idempotencyKey: string;
}) {
  const result = await requestOrganizationIntroductionCallable({
    contractVersion: EXCHANGE_ORGANIZATION_CONTEXT_VERSION,
    ...input,
  });
  return result.data;
}

export async function getOrganizationResourceStatus(input: {
  actorOrganizationId?: string;
  subjectOrganizationId: string;
}) {
  const result = await getOrganizationResourceStatusCallable({
    contractVersion: EXCHANGE_ORGANIZATION_CONTEXT_VERSION,
    subjectOrganizationId: input.subjectOrganizationId,
    ...(input.actorOrganizationId
      ? { actorOrganizationId: input.actorOrganizationId }
      : {}),
  });
  return result.data;
}
