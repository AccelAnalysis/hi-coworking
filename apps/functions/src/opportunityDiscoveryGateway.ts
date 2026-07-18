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

/**
 * Compatibility gateway used by the already-exported rfx_listManaged callable.
 * This avoids adding a second public endpoint during the branch rollout while
 * keeping legacy management queries completely unchanged.
 */
export async function handleOpportunityDiscoveryGateway(
  request: CallableRequest<unknown>,
): Promise<unknown> {
  const data = request.data && typeof request.data === "object" && !Array.isArray(request.data)
    ? request.data as Record<string, unknown>
    : {};
  const operation = data.operation;
  const payload = data.payload ?? {};
  const delegatedRequest = {
    ...request,
    data: payload,
  } as CallableRequest<unknown>;

  switch (operation) {
    case "discover":
      return runnable(rfx_discover).run(delegatedRequest);
    case "setSaved":
      return runnable(rfx_setSaved).run(delegatedRequest);
    case "markViewed":
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
