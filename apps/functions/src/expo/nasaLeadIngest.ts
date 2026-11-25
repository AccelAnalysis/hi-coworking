import {
  validateExpoLeadPayload,
} from "./nasaLeadModel";
import {
  buildExpoIntakeLead,
  defaultIntakeLeadStore,
  saveIntakeLead,
  type IntakeLeadStore,
} from "./intakeLeadStore";
import { canonicalizePowerNowPath, POWER_NOW_FORM } from "./powerNowModel";
import type { PowerNowConfirmationOptions } from "./powerNowConfirmation";
import { handlePowerNowHttp, type PowerNowRateLimiter } from "./powerNowIngest";

export type ExpoHttpResult = {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
};

const ALLOWED_ORIGINS = new Set([
  "https://hi-coworking.com",
  "https://www.hi-coworking.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5003",
  "http://127.0.0.1:5003",
]);

/** Public Power NOW host. Pitch, watch, and contribute only — not the booth intake form. */
const POWER_NOW_FORMS_ORIGIN = "https://forms.accelanalysis.com";

export async function handleExpoLeadHttp(request: {
  method: string;
  origin?: string | null;
  contentLength?: number | null;
  body: unknown;
  now?: Date;
  ip?: string | null;
  rateLimiter?: PowerNowRateLimiter;
  confirmation?: PowerNowConfirmationOptions;
  leadStore?: IntakeLeadStore;
}): Promise<ExpoHttpResult> {
  const headers = corsHeaders(request.origin, request.method, request.body);
  if (request.origin && !isAllowedOrigin(request.origin, request.method, request.body)) {
    return {
      status: 403,
      headers,
      body: { ok: false, error: "This booth form cannot be submitted from that site." },
    };
  }
  if (request.method === "OPTIONS") {
    return { status: 204, headers, body: null };
  }
  if (request.method !== "POST") {
    return { status: 405, headers, body: { ok: false, error: "Method not allowed" } };
  }
  if (request.contentLength && request.contentLength > 20_000) {
    return { status: 413, headers, body: { ok: false, error: "That lead is too large." } };
  }

  const record = request.body && typeof request.body === "object"
    ? (request.body as Record<string, unknown>)
    : null;
  const honeypot = [record?.expo_hp, record?.pn_hp].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  if (honeypot) {
    return { status: 200, headers, body: { ok: true, accepted: true } };
  }

  if (record?.form === POWER_NOW_FORM) {
    const powerNow = await handlePowerNowHttp({
      body: request.body,
      now: request.now,
      ip: request.ip,
      rateLimiter: request.rateLimiter,
      confirmation: request.confirmation,
      leadStore: request.leadStore,
    });
    return {
      status: powerNow.status,
      headers: { ...headers, ...powerNow.extraHeaders },
      body: powerNow.body,
    };
  }

  const validated = validateExpoLeadPayload(request.body, request.now ?? new Date());
  if (!validated.ok) {
    return { status: 400, headers, body: { ok: false, error: validated.error } };
  }

  const storedAt = (request.now ?? new Date()).toISOString();
  const saved = await saveIntakeLead(
    request.leadStore ?? defaultIntakeLeadStore(),
    buildExpoIntakeLead(validated.lead, storedAt),
  );
  if (!saved.ok) {
    return { status: 502, headers, body: { ok: false, error: "Could not save this lead." } };
  }
  if (!saved.created) {
    return {
      status: 200,
      headers,
      body: { ok: true, accepted: true, stored: true, duplicate: true, action: "duplicate" },
    };
  }

  return {
    status: 200,
    headers,
    body: {
      ok: true,
      accepted: true,
      stored: true,
      duplicate: false,
      action: "stored",
    },
  };
}

function corsHeaders(origin: string | null | undefined, method: string, body: unknown): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "3600",
  };
  if (origin && isAllowedOrigin(origin, method, body)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function isAllowedOrigin(origin: string, method: string, body: unknown): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (/^https:\/\/(?:[a-z0-9-]+--)?hi-coworking-plat\.(?:web\.app|firebaseapp\.com)$/.test(origin)) {
    return true;
  }
  if (origin !== POWER_NOW_FORMS_ORIGIN) return false;
  if (method === "OPTIONS") return true;
  return isPowerNowFormsSubmission(body);
}

function isPowerNowFormsSubmission(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const record = body as Record<string, unknown>;
  return record.form === POWER_NOW_FORM && canonicalizePowerNowPath(record.path) !== null;
}
