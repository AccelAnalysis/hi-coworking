import * as logger from "firebase-functions/logger";
import * as crypto from "crypto";

const SEAM_API_BASE = "https://connect.getseam.com";

export interface SeamCreateCodeResult {
  seamCodeId: string;
  /** Plain PIN — returned once for delivery, do NOT persist */
  plainPin: string;
  /** SHA-256 hex hash of PIN */
  codeHash: string;
  /** Last 2 digits */
  codeLast2: string;
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
  const data = await seamRequest(seamApiKey, "POST", "/access_codes/create", {
    device_id: deviceId,
    name: codeName,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    type: "time_bound",
  }) as { access_code: { access_code_id: string; code: string } };

  const plainPin = data.access_code.code;
  const seamCodeId = data.access_code.access_code_id;

  return {
    seamCodeId,
    plainPin,
    codeHash: hashPin(plainPin),
    codeLast2: plainPin.slice(-2),
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
