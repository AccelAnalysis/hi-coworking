"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPin = hashPin;
exports.createTimeBoundCode = createTimeBoundCode;
exports.deleteCode = deleteCode;
exports.remoteUnlock = remoteUnlock;
exports.getDeviceStatus = getDeviceStatus;
exports.validateSeamSignature = validateSeamSignature;
const logger = __importStar(require("firebase-functions/logger"));
const crypto = __importStar(require("crypto"));
const SEAM_API_BASE = "https://connect.getseam.com";
/** Hash a PIN using SHA-256 — plain PIN must never be stored in Firestore */
function hashPin(pin) {
    return crypto.createHash("sha256").update(pin).digest("hex");
}
async function seamRequest(seamApiKey, method, path, body) {
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
    }
    catch {
        return text;
    }
}
/**
 * Create a time-bounded access code on a Seam-connected device.
 * Returns the plain PIN once — hash it and store only the hash.
 */
async function createTimeBoundCode(seamApiKey, deviceId, startsAt, endsAt, codeName) {
    const data = await seamRequest(seamApiKey, "POST", "/access_codes/create", {
        device_id: deviceId,
        name: codeName,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        type: "time_bound",
    });
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
async function deleteCode(seamApiKey, deviceId, seamCodeId) {
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
async function remoteUnlock(seamApiKey, deviceId) {
    await seamRequest(seamApiKey, "POST", "/locks/unlock_door", {
        device_id: deviceId,
    });
    logger.info("Seam remote unlock triggered", { deviceId });
}
/**
 * Get the current status of a Seam-connected device.
 */
async function getDeviceStatus(seamApiKey, deviceId) {
    const data = await seamRequest(seamApiKey, "GET", `/devices/get?device_id=${encodeURIComponent(deviceId)}`);
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
function validateSeamSignature(payload, signature, webhookSecret) {
    const expected = crypto
        .createHmac("sha256", webhookSecret)
        .update(payload)
        .digest("hex");
    try {
        return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
    }
    catch {
        return false;
    }
}
