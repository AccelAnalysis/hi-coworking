export type ProfileUpdateDiagnosticCode =
  | "FUNCTION_NOT_DEPLOYED"
  | "WRONG_FIREBASE_PROJECT"
  | "UNAUTHENTICATED"
  | "STALE_AUTH_TOKEN"
  | "PERMISSION_DENIED"
  | "INVALID_PROFILE_DATA"
  | "LEGACY_PROFILE_REQUIRES_MIGRATION"
  | "STORAGE_REFERENCE_INVALID"
  | "NETWORK_UNAVAILABLE"
  | "UNKNOWN";

export interface ProfileUpdateDiagnostic {
  code: ProfileUpdateDiagnosticCode;
  userMessage: string;
  developerMessage: string;
  retryable: boolean;
}

interface DiagnosticOptions {
  configuredProjectId?: string;
  expectedProjectId?: string;
  hasAuthenticatedUser?: boolean;
}

function errorRecord(error: unknown): Record<string, unknown> {
  return error && typeof error === "object" ? error as Record<string, unknown> : {};
}

function normalizeCode(error: Record<string, unknown>): string {
  return String(error.code ?? "").toLowerCase().replace(/^firebase:/, "");
}

function detailsCode(error: Record<string, unknown>): string {
  const details = error.details && typeof error.details === "object"
    ? error.details as Record<string, unknown>
    : {};
  return String(details.diagnosticCode ?? "").toUpperCase();
}

const messages: Record<ProfileUpdateDiagnosticCode, Omit<ProfileUpdateDiagnostic, "code">> = {
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
  if (
    options.expectedProjectId
    && options.configuredProjectId
    && options.expectedProjectId !== options.configuredProjectId
  ) {
    return { code: "WRONG_FIREBASE_PROJECT", ...messages.WRONG_FIREBASE_PROJECT };
  }

  const record = errorRecord(error);
  const explicit = detailsCode(record);
  if (explicit && explicit in messages) {
    const code = explicit as ProfileUpdateDiagnosticCode;
    return { code, ...messages[code] };
  }

  const code = normalizeCode(record);
  let diagnosticCode: ProfileUpdateDiagnosticCode = "UNKNOWN";
  if (["functions/not-found", "not-found", "functions/unimplemented", "unimplemented"].includes(code)) {
    diagnosticCode = "FUNCTION_NOT_DEPLOYED";
  } else if (["functions/unauthenticated", "unauthenticated", "auth/user-token-expired", "auth/id-token-expired"].includes(code)) {
    diagnosticCode = options.hasAuthenticatedUser ? "STALE_AUTH_TOKEN" : "UNAUTHENTICATED";
  } else if (["functions/permission-denied", "permission-denied"].includes(code)) {
    diagnosticCode = "PERMISSION_DENIED";
  } else if (["functions/invalid-argument", "invalid-argument"].includes(code)) {
    diagnosticCode = "INVALID_PROFILE_DATA";
  } else if (["functions/unavailable", "unavailable", "functions/deadline-exceeded", "deadline-exceeded", "auth/network-request-failed"].includes(code)) {
    diagnosticCode = "NETWORK_UNAVAILABLE";
  } else if (String(record.message ?? "").toLowerCase().includes("profile asset path")) {
    diagnosticCode = "STORAGE_REFERENCE_INVALID";
  }

  return { code: diagnosticCode, ...messages[diagnosticCode] };
}
