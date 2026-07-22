import {
  normalizeExchangeEntityId,
  normalizeExchangeModeStates,
  normalizeExchangeSelection,
  normalizeExchangeViewport,
  normalizeOpportunityLocation,
} from "./exchangeWorkspaceReducer";
import {
  canonicalExchangeMode,
  createInitialExchangeWorkspaceState,
  isExchangeSurfaceMode,
  isExchangeView,
  type ExchangeWorkspaceSessionHydration,
  type ExchangeWorkspaceState,
} from "./exchangeWorkspaceTypes";

export const EXCHANGE_WORKSPACE_SESSION_VERSION = 1;
export const DEFAULT_EXCHANGE_WORKSPACE_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const SESSION_KEY_PREFIX = "hi.exchange.workspace.v1";

export interface ExchangeWorkspaceSessionBinding {
  uid: string;
  /** Must already have been validated for this viewer by the server. */
  actorOrganizationId?: string;
}

export interface ExchangeWorkspaceSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ExchangeWorkspaceSessionWriteOptions {
  now?: number;
  ttlMs?: number;
}

export function getExchangeWorkspaceIdentityKey({
  demoMode,
  authLoading,
  uid,
}: {
  demoMode: boolean;
  authLoading: boolean;
  uid?: string;
}): string {
  if (demoMode) return "exchange-demo";
  if (authLoading) return "exchange-auth-loading";
  const normalizedUid = normalizeExchangeEntityId(uid);
  return normalizedUid
    ? `exchange-user:${encodeURIComponent(normalizedUid)}`
    : "exchange-signed-out";
}

interface ExchangeWorkspaceSessionEnvelope {
  version: typeof EXCHANGE_WORKSPACE_SESSION_VERSION;
  uid: string;
  actorOrganizationId: string | null;
  createdAt: number;
  expiresAt: number;
  state: ExchangeWorkspaceSessionHydration;
}

function normalizeBinding(
  binding: ExchangeWorkspaceSessionBinding,
): { uid: string; actorOrganizationId?: string } | undefined {
  const uid = normalizeExchangeEntityId(binding.uid);
  if (!uid) return undefined;
  if (binding.actorOrganizationId === undefined) return { uid };
  const actorOrganizationId = normalizeExchangeEntityId(
    binding.actorOrganizationId,
  );
  return actorOrganizationId ? { uid, actorOrganizationId } : undefined;
}

export function getExchangeWorkspaceSessionKey(
  binding: ExchangeWorkspaceSessionBinding,
): string | undefined {
  const normalized = normalizeBinding(binding);
  if (!normalized) return undefined;
  return `${SESSION_KEY_PREFIX}:${encodeURIComponent(normalized.uid)}:${encodeURIComponent(
    normalized.actorOrganizationId ?? "individual",
  )}`;
}

function boundedNow(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : Date.now();
}

function boundedTtl(value: unknown): number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value > 0
    && value <= MAX_SESSION_TTL_MS
    ? value
    : DEFAULT_EXCHANGE_WORKSPACE_SESSION_TTL_MS;
}

/**
 * Projects runtime state onto the only fields permitted in session storage.
 * Identity claims, memberships, fetched entities, and actor authority are not
 * part of this object.
 */
export function createExchangeWorkspaceSessionHydration(
  state: ExchangeWorkspaceState,
): ExchangeWorkspaceSessionHydration {
  const modeStates = normalizeExchangeModeStates(state.modeStates);
  const activeMode = canonicalExchangeMode(state.view);
  modeStates[activeMode] = {
    ...modeStates[activeMode],
    secondaryContext: normalizeExchangeSelection(state.secondaryContext) ?? null,
  };
  return {
    view: state.view,
    surfaceMode: state.surfaceMode,
    subjectOrganizationId: normalizeExchangeEntityId(state.subjectOrganizationId),
    secondaryContext: normalizeExchangeSelection(state.secondaryContext) ?? null,
    modeStates,
    organizationDrawerOpen: state.organizationDrawerOpen === true,
    searchQuery: state.searchQuery.slice(0, 240),
    opportunityLocation: normalizeOpportunityLocation(state.opportunityLocation),
    leftPanelCollapsed: state.leftPanelCollapsed === true,
    rightPanelOpen: state.rightPanelOpen === true,
    mobileFilterOpen: state.mobileFilterOpen === true,
    mobileDetailOpen: state.mobileDetailOpen === true,
    viewport: normalizeExchangeViewport(state.viewport),
  };
}

export function writeExchangeWorkspaceSession(
  storage: ExchangeWorkspaceSessionStorage,
  binding: ExchangeWorkspaceSessionBinding,
  state: ExchangeWorkspaceState,
  options: ExchangeWorkspaceSessionWriteOptions = {},
): boolean {
  const normalized = normalizeBinding(binding);
  const key = getExchangeWorkspaceSessionKey(binding);
  if (!normalized || !key) return false;
  const stateActorOrganizationId = normalizeExchangeEntityId(
    state.actorOrganizationId,
  );
  if (stateActorOrganizationId !== normalized.actorOrganizationId) return false;
  const createdAt = boundedNow(options.now);
  const ttlMs = boundedTtl(options.ttlMs);
  const envelope: ExchangeWorkspaceSessionEnvelope = {
    version: EXCHANGE_WORKSPACE_SESSION_VERSION,
    uid: normalized.uid,
    actorOrganizationId: normalized.actorOrganizationId ?? null,
    createdAt,
    expiresAt: createdAt + ttlMs,
    state: createExchangeWorkspaceSessionHydration(state),
  };
  try {
    storage.setItem(key, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

function sanitizeSessionHydration(value: unknown): ExchangeWorkspaceSessionHydration {
  const candidate = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const defaults = createInitialExchangeWorkspaceState();
  const subjectOrganizationId = normalizeExchangeEntityId(
    candidate.subjectOrganizationId,
  );
  const secondaryContext = normalizeExchangeSelection(candidate.secondaryContext);
  return {
    view: isExchangeView(candidate.view) ? candidate.view : defaults.view,
    surfaceMode: isExchangeSurfaceMode(candidate.surfaceMode)
      ? candidate.surfaceMode
      : defaults.surfaceMode,
    subjectOrganizationId,
    secondaryContext: secondaryContext ?? null,
    modeStates: normalizeExchangeModeStates(candidate.modeStates),
    organizationDrawerOpen: candidate.organizationDrawerOpen === true
      && Boolean(subjectOrganizationId),
    searchQuery: typeof candidate.searchQuery === "string"
      ? candidate.searchQuery.slice(0, 240)
      : "",
    opportunityLocation: normalizeOpportunityLocation(
      candidate.opportunityLocation,
    ),
    leftPanelCollapsed: candidate.leftPanelCollapsed === true,
    rightPanelOpen: candidate.rightPanelOpen === true
      && secondaryContext !== null
      && secondaryContext !== undefined,
    mobileFilterOpen: candidate.mobileFilterOpen === true,
    mobileDetailOpen: candidate.mobileDetailOpen === true,
    viewport: normalizeExchangeViewport(candidate.viewport),
  };
}

export function readExchangeWorkspaceSession(
  storage: ExchangeWorkspaceSessionStorage,
  binding: ExchangeWorkspaceSessionBinding,
  now = Date.now(),
): ExchangeWorkspaceSessionHydration | null {
  const normalized = normalizeBinding(binding);
  const key = getExchangeWorkspaceSessionKey(binding);
  if (!normalized || !key) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const envelope = JSON.parse(raw) as Partial<ExchangeWorkspaceSessionEnvelope>;
    const timestamp = boundedNow(now);
    const expectedActor = normalized.actorOrganizationId ?? null;
    const validEnvelope = envelope.version === EXCHANGE_WORKSPACE_SESSION_VERSION
      && envelope.uid === normalized.uid
      && envelope.actorOrganizationId === expectedActor
      && typeof envelope.createdAt === "number"
      && Number.isFinite(envelope.createdAt)
      && typeof envelope.expiresAt === "number"
      && Number.isFinite(envelope.expiresAt)
      && envelope.createdAt <= timestamp + 5 * 60 * 1_000
      && envelope.expiresAt > timestamp
      && envelope.expiresAt > envelope.createdAt
      && envelope.expiresAt - envelope.createdAt <= MAX_SESSION_TTL_MS;
    if (!validEnvelope) {
      storage.removeItem(key);
      return null;
    }
    return sanitizeSessionHydration(envelope.state);
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage cleanup is best effort.
    }
    return null;
  }
}

export function clearExchangeWorkspaceSession(
  storage: ExchangeWorkspaceSessionStorage,
  binding: ExchangeWorkspaceSessionBinding,
): boolean {
  const key = getExchangeWorkspaceSessionKey(binding);
  if (!key) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
