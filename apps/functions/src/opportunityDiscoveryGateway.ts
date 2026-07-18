import type { CallableRequest } from "firebase-functions/v2/https";
import { HttpsError } from "firebase-functions/v2/https";
import {
  rfx_discover,
  rfx_markViewed,
  rfx_savedSearch_delete,
  rfx_savedSearch_list,
  rfx_savedSearch_upsert,
  rfx_setSaved,
} from "./opportunityDiscovery";
import {
  ensureOpportunityProjection,
  fallbackOpportunityDiscovery,
} from "./opportunityDiscoveryFallback";

type RecordData = Record<string, unknown>;
type RunnableCallable = {
  run: (request: CallableRequest<unknown>) => Promise<unknown>;
};

const OPERATIONS = new Set([
  "discover",
  "setSaved",
  "markViewed",
  "savedSearchUpsert",
  "savedSearchDelete",
  "savedSearchList",
]);

export function isOpportunityDiscoveryGatewayRequest(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const operation = (value as { operation?: unknown }).operation;
  return typeof operation === "string" && OPERATIONS.has(operation);
}

function runnable(value: unknown): RunnableCallable {
  const candidate = value as Partial<RunnableCallable>;
  if (typeof candidate.run !== "function") {
    throw new HttpsError(
      "internal",
      "The opportunity discovery callable is not available in this Functions runtime",
    );
  }
  return candidate as RunnableCallable;
}

function record(value: unknown): RecordData {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordData
    : {};
}

async function ensurePayloadProjection(payload: unknown): Promise<void> {
  const rfxId = record(payload).rfxId;
  if (typeof rfxId !== "string" || !rfxId) return;
  await ensureOpportunityProjection(rfxId);
}

/**
 * Compatibility gateway used by the already-exported rfx_listManaged callable.
 * This avoids adding a second public endpoint during the branch rollout while
 * keeping legacy management queries completely unchanged.
 */
export async function handleOpportunityDiscoveryGateway(
  request: CallableRequest<unknown>,
): Promise<unknown> {
  const data = record(request.data);
  const operation = data.operation;
  const payload = data.payload ?? {};
  const delegatedRequest = {
    ...request,
    data: payload,
  } as CallableRequest<unknown>;

  switch (operation) {
    case "discover": {
      const primary = record(await runnable(rfx_discover).run(delegatedRequest));
      const records = Array.isArray(primary.records) ? primary.records : [];
      if (records.length > 0 || primary.nextCursor) return primary;
      return fallbackOpportunityDiscovery(request, payload);
    }
    case "setSaved":
      await ensurePayloadProjection(payload);
      return runnable(rfx_setSaved).run(delegatedRequest);
    case "markViewed":
      await ensurePayloadProjection(payload);
      return runnable(rfx_markViewed).run(delegatedRequest);
    case "savedSearchUpsert":
      return runnable(rfx_savedSearch_upsert).run(delegatedRequest);
    case "savedSearchDelete":
      return runnable(rfx_savedSearch_delete).run(delegatedRequest);
    case "savedSearchList":
      return runnable(rfx_savedSearch_list).run(delegatedRequest);
    default:
      throw new HttpsError("invalid-argument", "Unsupported opportunity discovery operation");
  }
}
