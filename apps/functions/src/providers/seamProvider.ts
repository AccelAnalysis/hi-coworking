import * as logger from "firebase-functions/logger";
import * as crypto from "crypto";

const SEAM_API_BASE = "https://connect.getseam.com";

/** Door codes are 6 digits (Jonathan, Nov 24, 2026). Seam picks the digits. */
export const DOOR_CODE_LENGTH = 6;

export interface SeamCreateCodeResult {
  seamCodeId: string;
  /**
   * Plain PIN — returned once, do NOT persist. Null when Seam has not
   * assigned the digits yet (is_waiting_for_code_assignment); the owner's
   * page reads it from Seam later.
   */
  plainPin: string | null;
  /** SHA-256 hex hash of PIN, when known */
  codeHash: string | null;
  /** Last 2 digits, staff-only support hint, when known */
  codeLast2: string | null;
}

/**
 * The access_codes/create body for one booking. `type` is not a request
 * parameter in Seam's API (it is a read-only response field); a code with
 * starts_at and ends_at is time-bound. Seam generates the digits at the
 * preferred length and avoids clashes with codes already on the lock.
 */
export function timeBoundCodeRequest(deviceId: string, startsAt: Date, endsAt: Date, codeName: string) {
  return {
    device_id: deviceId,
    name: codeName,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    preferred_code_length: DOOR_CODE_LENGTH,
  };
}

export interface SeamDeviceStatus {
  online: boolean;
  batteryLevel?: number; // 0–1
  locked?: boolean;
}

/** Hash a PIN using SHA-256 — plain PIN must never be stored in Firestore */
export function hashPin(pin: string): string {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

/** Seam's machine-readable error type, e.g. "invalid_input"; never the message. */
export function seamErrorType(text: string): string | null {
  try {
    const type = (JSON.parse(text) as { error?: { type?: unknown } })?.error?.type;
    return typeof type === "string" && /^[a-z0-9_.:-]{1,80}$/i.test(type) ? type : null;
  } catch {
    return null;
  }
}

async function seamRequest(
  seamApiKey: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const url = `${SEAM_API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${seamApiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  if (!res.ok) {
    // Never log or rethrow Seam's response body (it can echo codes or names);
    // keep only the status and Seam's error type.
    const errorType = seamErrorType(text);
    logger.error("Seam API error", { status: res.status, path: path.split("?")[0], errorType });
    throw new Error(`Seam API ${res.status}${errorType ? ` (${errorType})` : ""}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Create a time-bounded access code on a Seam-connected device.
 * Returns the plain PIN once — hash it and store only the hash.
 */
export async function createTimeBoundCode(
  seamApiKey: string,
  deviceId: string,
  startsAt: Date,
  endsAt: Date,
  codeName: string
): Promise<SeamCreateCodeResult> {
  const data = await seamRequest(
    seamApiKey,
    "POST",
    "/access_codes/create",
    timeBoundCodeRequest(deviceId, startsAt, endsAt, codeName),
  ) as { access_code?: { access_code_id?: unknown; code?: unknown } };

  const seamCodeId = data.access_code?.access_code_id;
  if (typeof seamCodeId !== "string" || !seamCodeId) throw new Error("Seam API returned no access code id");
  const raw = data.access_code?.code;
  const plainPin = typeof raw === "string" && /^[0-9]{4,12}$/.test(raw) ? raw : null;

  return {
    seamCodeId,
    plainPin,
    codeHash: plainPin ? hashPin(plainPin) : null,
    codeLast2: plainPin ? plainPin.slice(-2) : null,
  };
}

/**
 * Read one access code's PIN from Seam. Used only to show a member their own
 * code on the signed-in SayHi page; the result is never stored or logged.
 */
export async function getCodePin(seamApiKey: string, seamCodeId: string): Promise<string | null> {
  const data = await seamRequest(seamApiKey, "POST", "/access_codes/get", {
    access_code_id: seamCodeId,
  }) as { access_code?: { code?: unknown } };
  const code = data.access_code?.code;
  return typeof code === "string" && code ? code : null;
}

/**
 * Delete an access code from a Seam-connected device.
 * Used for cancellations, no-shows, and expiry cleanup.
 */
export async function deleteCode(
  seamApiKey: string,
  deviceId: string,
  seamCodeId: string
): Promise<void> {
  await seamRequest(seamApiKey, "POST", "/access_codes/delete", {
    device_id: deviceId,
    access_code_id: seamCodeId,
  });
  logger.info("Seam code deleted", { deviceId, seamCodeId });
}

/**
 * Trigger a remote unlock on a Seam-connected device.
 * Admin-only override action.
 */
export async function remoteUnlock(
  seamApiKey: string,
  deviceId: string
): Promise<void> {
  await seamRequest(seamApiKey, "POST", "/locks/unlock_door", {
    device_id: deviceId,
  });
  logger.info("Seam remote unlock triggered", { deviceId });
}

/**
 * Get the current status of a Seam-connected device.
 */
export async function getDeviceStatus(
  seamApiKey: string,
  deviceId: string
): Promise<SeamDeviceStatus> {
  const data = await seamRequest(
    seamApiKey,
    "GET",
    `/devices/get?device_id=${encodeURIComponent(deviceId)}`
  ) as {
    device: {
      properties: {
        online: boolean;
        battery_level?: number;
        locked?: boolean;
      };
    };
  };

  const props = data.device.properties;
  return {
    online: props.online ?? false,
    batteryLevel: props.battery_level,
    locked: props.locked,
  };
}
