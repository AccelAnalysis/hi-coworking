export type CallableErrorCategory =
  | "deployment"
  | "configuration"
  | "authentication"
  | "authorization"
  | "validation"
  | "version_conflict"
  | "app_check"
  | "network"
  | "timeout"
  | "transaction"
  | "provider"
  | "unknown";

export interface CallableDiagnosticContext {
  functionName: string;
  projectId?: string;
  region?: string;
  endpoint?: string;
}

export interface SafeCallableError {
  diagnosticCode?: string;
  firebaseCode: string;
  requestId?: string;
  category: CallableErrorCategory;
  retryable: boolean;
  functionName: string;
  projectId?: string;
  region?: string;
  endpoint?: string;
  httpStatus?: number;
  errorName?: string;
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === "object" ? error as Record<string, unknown> : {};
}

function normalizedCode(record: Record<string, unknown>): string {
  return String(record.code ?? "").toLowerCase().replace(/^firebase:/, "");
}

function finiteStatus(value: unknown): number | undefined {
  const status = typeof value === "number" ? value : Number(value);
  return Number.isFinite(status) ? status : undefined;
}

/**
 * Converts an SDK/callable failure to a safe, structured diagnostic. Raw error
 * messages, request payloads, tokens, email addresses, and provider responses
 * are intentionally never returned or logged by this helper.
 */
export function serializeCallableError(
  error: unknown,
  context: CallableDiagnosticContext,
): SafeCallableError {
  const record = errorRecord(error);
  const details = record.details && typeof record.details === "object"
    ? record.details as Record<string, unknown>
    : {};
  const firebaseCode = normalizedCode(record);
  const message = String(record.message ?? "").toLowerCase();
  const diagnosticCode = typeof details.diagnosticCode === "string"
    ? details.diagnosticCode.toUpperCase()
    : undefined;
  const requestId = typeof details.requestId === "string" ? details.requestId : undefined;
  const httpStatus = finiteStatus(record.status ?? details.httpStatus);
  let category: CallableErrorCategory = "unknown";
  let retryable = false;

  if (
    ["functions/not-found", "not-found", "functions/unimplemented", "unimplemented"].includes(firebaseCode)
    || httpStatus === 404
    || message.includes("404")
  ) {
    category = "deployment";
  } else if (diagnosticCode === "PROFILE_VERSION_CONFLICT") {
    category = "version_conflict";
    retryable = true;
  } else if (diagnosticCode?.includes("PROVIDER")) {
    category = "provider";
    retryable = true;
  } else if (message.includes("app check") || diagnosticCode?.includes("APP_CHECK")) {
    category = "app_check";
  } else if (["functions/unauthenticated", "unauthenticated"].includes(firebaseCode)) {
    category = "authentication";
    retryable = true;
  } else if (["functions/permission-denied", "permission-denied"].includes(firebaseCode)) {
    category = "authorization";
  } else if (["functions/invalid-argument", "invalid-argument"].includes(firebaseCode)) {
    category = "validation";
  } else if (["functions/aborted", "aborted"].includes(firebaseCode)) {
    category = "transaction";
    retryable = true;
  } else if (["functions/deadline-exceeded", "deadline-exceeded"].includes(firebaseCode)) {
    category = "timeout";
    retryable = true;
  } else if (
    ["functions/unavailable", "unavailable", "auth/network-request-failed"].includes(firebaseCode)
    || message.includes("network")
    || message.includes("cors")
    || message.includes("failed to fetch")
  ) {
    category = "network";
    retryable = true;
  } else if (diagnosticCode?.startsWith("INVALID_")) {
    category = "validation";
  }

  return {
    ...(diagnosticCode ? { diagnosticCode } : {}),
    firebaseCode,
    ...(requestId ? { requestId } : {}),
    category,
    retryable,
    functionName: context.functionName,
    ...(context.projectId ? { projectId: context.projectId } : {}),
    ...(context.region ? { region: context.region } : {}),
    ...(context.endpoint ? { endpoint: context.endpoint } : {}),
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    ...(typeof record.name === "string" ? { errorName: record.name } : {}),
  };
}
