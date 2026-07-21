import { serializeCallableError, type SafeCallableError } from "./callableDiagnostics";

export type ProfileUpdateDiagnosticCode =
  | "FUNCTION_NOT_DEPLOYED"
  | "WRONG_FIREBASE_PROJECT"
  | "WRONG_FUNCTION_REGION"
  | "EMULATOR_REMOTE_MISMATCH"
  | "DEPLOYMENT_REVISION_MISMATCH"
  | "UNAUTHENTICATED"
  | "STALE_AUTH_TOKEN"
  | "PERMISSION_DENIED"
  | "INVALID_PROFILE_DATA"
  | "LEGACY_PROFILE_REQUIRES_MIGRATION"
  | "STORAGE_REFERENCE_INVALID"
  | "PROFILE_VERSION_CONFLICT"
  | "APP_CHECK_REJECTED"
  | "REQUEST_TIMEOUT"
  | "TRANSACTION_ABORTED"
  | "NETWORK_UNAVAILABLE"
  | "UNKNOWN";

export interface ProfileUpdateDiagnostic {
  code: ProfileUpdateDiagnosticCode;
  userMessage: string;
  developerMessage: string;
  retryable: boolean;
  safeError: SafeCallableError;
}

interface DiagnosticOptions {
  configuredProjectId?: string;
  expectedProjectId?: string;
  hasAuthenticatedUser?: boolean;
  configuredRegion?: string;
  expectedRegion?: string;
  configuredEmulatorMode?: boolean;
  expectedEmulatorMode?: boolean;
  configuredRevision?: string;
  expectedRevision?: string;
}

const messages: Record<ProfileUpdateDiagnosticCode, Omit<ProfileUpdateDiagnostic, "code" | "safeError">> = {
  FUNCTION_NOT_DEPLOYED: {
    userMessage: "Profile saving is not available in this environment yet. The profile_update service must be deployed.",
    developerMessage: "Confirm the profile_update export, us-central1 deployment, emulator connection, and active Firebase project.",
    retryable: false,
  },
  WRONG_FIREBASE_PROJECT: {
    userMessage: "This preview is connected to the wrong Firebase project. Restart it with the intended development configuration.",
    developerMessage: "NEXT_PUBLIC_FIREBASE_PROJECT_ID does not match NEXT_PUBLIC_EXPECTED_FIREBASE_PROJECT_ID.",
    retryable: false,
  },
  WRONG_FUNCTION_REGION: {
    userMessage: "This preview is connected to the wrong Functions region. Restart it with the intended development configuration.",
    developerMessage: "The configured Functions region does not match the expected region.",
    retryable: false,
  },
  EMULATOR_REMOTE_MISMATCH: {
    userMessage: "This preview is using the wrong local or remote service mode. Restart it with the intended development configuration.",
    developerMessage: "NEXT_PUBLIC_USE_FIREBASE_EMULATOR does not match the acceptance environment.",
    retryable: false,
  },
  DEPLOYMENT_REVISION_MISMATCH: {
    userMessage: "Profile saving is running an unexpected service revision. Refresh after the development deployment completes.",
    developerMessage: "The observed Functions revision does not match the acceptance revision.",
    retryable: true,
  },
  UNAUTHENTICATED: {
    userMessage: "Your session ended. Sign in again before saving your profile.",
    developerMessage: "The callable received no authenticated Firebase user.",
    retryable: true,
  },
  STALE_AUTH_TOKEN: {
    userMessage: "Your sign-in permissions changed. Refresh your session, then try saving again.",
    developerMessage: "An authenticated client received unauthenticated; force-refresh the ID token or sign in again.",
    retryable: true,
  },
  PERMISSION_DENIED: {
    userMessage: "Your account is not authorized to update this profile.",
    developerMessage: "Inspect current custom claims and server-side profile ownership checks; legacy role fields must not grant authority.",
    retryable: false,
  },
  INVALID_PROFILE_DATA: {
    userMessage: "One or more profile fields are invalid. Check web addresses, NAICS codes, and field lengths.",
    developerMessage: "Inspect the callable validation issues returned in error.details without logging private field values.",
    retryable: false,
  },
  LEGACY_PROFILE_REQUIRES_MIGRATION: {
    userMessage: "This older profile needs a compatibility update before it can be saved.",
    developerMessage: "Run the documented legacy-profile migration against the configured development project.",
    retryable: false,
  },
  STORAGE_REFERENCE_INVALID: {
    userMessage: "A profile file reference is invalid. Remove or upload that file again, then save.",
    developerMessage: "A canonical profile asset path does not belong to the authenticated UID or uses an unsupported storage location.",
    retryable: false,
  },
  PROFILE_VERSION_CONFLICT: {
    userMessage: "This profile changed in another session. Reload it before saving again.",
    developerMessage: "The expectedVersion did not match the authoritative profileVersion.",
    retryable: true,
  },
  APP_CHECK_REJECTED: {
    userMessage: "This browser could not be verified for profile saving. Refresh the page and try again.",
    developerMessage: "The callable request was rejected by App Check configuration.",
    retryable: true,
  },
  REQUEST_TIMEOUT: {
    userMessage: "Profile saving timed out. Check your connection and try again.",
    developerMessage: "The callable exceeded its deadline without a confirmed response.",
    retryable: true,
  },
  TRANSACTION_ABORTED: {
    userMessage: "The profile was busy being updated. Reload it and try again.",
    developerMessage: "Firestore or the callable aborted the transaction without a version-conflict diagnostic.",
    retryable: true,
  },
  NETWORK_UNAVAILABLE: {
    userMessage: "The profile service could not be reached. Check your connection and try again.",
    developerMessage: "Functions returned unavailable, deadline-exceeded, or a network request failure.",
    retryable: true,
  },
  UNKNOWN: {
    userMessage: "Profile saving failed unexpectedly. Try again, or report the diagnostic reference shown below.",
    developerMessage: "Inspect the sanitized callable code and server logs; do not expose raw error details to the user.",
    retryable: true,
  },
};

export function diagnoseProfileUpdateError(
  error: unknown,
  options: DiagnosticOptions = {},
): ProfileUpdateDiagnostic {
  const configuredRegion = options.configuredRegion ?? "us-central1";
  const projectId = options.configuredProjectId;
  const safeError = serializeCallableError(error, {
    functionName: "profile_update",
    projectId,
    region: configuredRegion,
    endpoint: projectId
      ? `https://${configuredRegion}-${projectId}.cloudfunctions.net/profile_update`
      : undefined,
  });
  if (
    options.expectedProjectId
    && options.configuredProjectId
    && options.expectedProjectId !== options.configuredProjectId
  ) {
    return { code: "WRONG_FIREBASE_PROJECT", ...messages.WRONG_FIREBASE_PROJECT, safeError };
  }
  if (options.expectedRegion && options.expectedRegion !== configuredRegion) {
    return { code: "WRONG_FUNCTION_REGION", ...messages.WRONG_FUNCTION_REGION, safeError };
  }
  if (
    options.expectedEmulatorMode !== undefined
    && options.configuredEmulatorMode !== undefined
    && options.expectedEmulatorMode !== options.configuredEmulatorMode
  ) {
    return { code: "EMULATOR_REMOTE_MISMATCH", ...messages.EMULATOR_REMOTE_MISMATCH, safeError };
  }
  if (
    options.expectedRevision
    && options.configuredRevision
    && options.expectedRevision !== options.configuredRevision
  ) {
    return { code: "DEPLOYMENT_REVISION_MISMATCH", ...messages.DEPLOYMENT_REVISION_MISMATCH, safeError };
  }

  const explicit = safeError.diagnosticCode ?? "";
  if (explicit && explicit in messages) {
    const code = explicit as ProfileUpdateDiagnosticCode;
    return { code, ...messages[code], safeError };
  }

  let diagnosticCode: ProfileUpdateDiagnosticCode = "UNKNOWN";
  if (safeError.category === "deployment") {
    diagnosticCode = "FUNCTION_NOT_DEPLOYED";
  } else if (safeError.category === "authentication") {
    diagnosticCode = options.hasAuthenticatedUser ? "STALE_AUTH_TOKEN" : "UNAUTHENTICATED";
  } else if (safeError.category === "authorization") {
    diagnosticCode = "PERMISSION_DENIED";
  } else if (safeError.category === "validation") {
    diagnosticCode = "INVALID_PROFILE_DATA";
  } else if (safeError.category === "version_conflict") {
    diagnosticCode = "PROFILE_VERSION_CONFLICT";
  } else if (safeError.category === "app_check") {
    diagnosticCode = "APP_CHECK_REJECTED";
  } else if (safeError.category === "timeout") {
    diagnosticCode = "REQUEST_TIMEOUT";
  } else if (safeError.category === "transaction") {
    diagnosticCode = "TRANSACTION_ABORTED";
  } else if (safeError.category === "network") {
    diagnosticCode = "NETWORK_UNAVAILABLE";
  } else if (explicit === "STORAGE_REFERENCE_INVALID") {
    diagnosticCode = "STORAGE_REFERENCE_INVALID";
  }

  return { code: diagnosticCode, ...messages[diagnosticCode], safeError };
}
