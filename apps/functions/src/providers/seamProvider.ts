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
    logger.error("Seam API error", { status: res.status, path, body: text });
    throw new Error(`Seam API ${res.status}: ${text}`);
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

/**
 * Validate a Seam webhook signature.
 * Seam signs with HMAC-SHA256 using the webhook secret.
 */
export function validateSeamSignature(
  payload: string,
  signature: string,
  webhookSecret: string
): boolean {
  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(payload)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}
