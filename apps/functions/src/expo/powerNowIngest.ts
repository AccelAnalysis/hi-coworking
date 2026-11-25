/**
 * Power NOW ingest. Submissions are stored in Firestore collection
 * intakeLeads. Confirmation email is sent after a successful save when
 * the confirmation flag is on.
 */

import {
  confirmationEmailEnabled,
  createFirestoreConfirmationStore,
  runPowerNowConfirmation,
  type PowerNowConfirmationOptions,
} from "./powerNowConfirmation";
import { readPowerNowSecret } from "./powerNowConfirmationSecrets";
import {
  buildPowerNowIntakeLead,
  defaultIntakeLeadStore,
  saveIntakeLead,
  type IntakeLeadStore,
} from "./intakeLeadStore";
import {
  POWER_NOW_RATE_LIMIT_ERROR,
  validatePowerNowPayload,
  type NormalizedPowerNow,
} from "./powerNowModel";

const POWER_NOW_RATE_LIMIT = 8;
const POWER_NOW_RATE_WINDOW_MS = 10 * 60 * 1000;

export type PowerNowRateLimiter = {
  allow(key: string): boolean;
};

export function createPowerNowRateLimiter(options?: {
  limit?: number;
  windowMs?: number;
  now?: () => number;
}): PowerNowRateLimiter {
  const limit = options?.limit ?? POWER_NOW_RATE_LIMIT;
  const windowMs = options?.windowMs ?? POWER_NOW_RATE_WINDOW_MS;
  const now = options?.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return {
    allow(key: string) {
      const time = now();
      const recent = (hits.get(key) ?? []).filter((stamp) => time - stamp < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(time);
      hits.set(key, recent);
      return true;
    },
  };
}

const sharedRateLimiter = createPowerNowRateLimiter();

export async function handlePowerNowHttp(request: {
  body: unknown;
  now?: Date;
  ip?: string | null;
  rateLimiter?: PowerNowRateLimiter;
  confirmation?: PowerNowConfirmationOptions;
  leadStore?: IntakeLeadStore;
}): Promise<{ status: number; body: Record<string, unknown>; extraHeaders?: Record<string, string> }> {
  const limiter = request.rateLimiter ?? sharedRateLimiter;
  const ip = request.ip?.trim() || "unknown";
  if (!limiter.allow(`power-now:${ip}`)) {
    return {
      status: 429,
      extraHeaders: { "Retry-After": "600" },
      body: { ok: false, error: POWER_NOW_RATE_LIMIT_ERROR },
    };
  }

  const validated = validatePowerNowPayload(request.body, request.now ?? new Date());
  if (!validated.ok) {
    return { status: 400, body: { ok: false, error: validated.error, fields: validated.fields } };
  }

  const storedAt = (request.now ?? new Date()).toISOString();
  const saved = await saveIntakeLead(
    request.leadStore ?? defaultIntakeLeadStore(),
    buildPowerNowIntakeLead(validated.lead, storedAt),
  );
  if (!saved.ok) {
    return { status: 502, body: { ok: false, error: "Could not save this lead." } };
  }
  if (!saved.created) {
    return {
      status: 200,
      body: { ok: true, accepted: true, stored: true, duplicate: true, action: "duplicate", path: validated.lead.path },
    };
  }

  await confirmStoredPowerNowLead(validated.lead, confirmationFromRequest(request));
  return {
    status: 200,
    body: {
      ok: true,
      accepted: true,
      stored: true,
      duplicate: false,
      action: "stored",
      path: validated.lead.path,
    },
  };
}

function confirmationFromRequest(request: {
  body: unknown;
  now?: Date;
  ip?: string | null;
  confirmation?: PowerNowConfirmationOptions;
}): PowerNowConfirmationOptions {
  const raw = request.body && typeof request.body === "object"
    ? request.body as Record<string, unknown>
    : null;
  return {
    ...request.confirmation,
    now: request.confirmation?.now ?? request.now,
    ip: request.confirmation?.ip ?? request.ip ?? undefined,
    startedAt: request.confirmation?.startedAt ?? (typeof raw?.pnStartedAt === "string" ? raw.pnStartedAt : null),
    captchaToken: request.confirmation?.captchaToken ?? (typeof raw?.recaptchaToken === "string" ? raw.recaptchaToken : null),
  };
}

async function confirmStoredPowerNowLead(
  lead: NormalizedPowerNow,
  confirmation: PowerNowConfirmationOptions,
): Promise<void> {
  const env = confirmation.env ?? process.env;
  if (!confirmationEmailEnabled(env)) return;
  try {
    await runPowerNowConfirmation({
      lead,
      personRecordId: lead.clientSubmissionId,
      env,
      now: confirmation.now ?? new Date(),
      ip: confirmation.ip ?? "unknown",
      startedAt: confirmation.startedAt ?? null,
      captchaToken: confirmation.captchaToken ?? null,
      mailFetch: confirmation.mailFetch,
      store: confirmation.store ?? createFirestoreConfirmationStore(),
      resolveMx: confirmation.resolveMx,
      verifyCaptcha: confirmation.verifyCaptcha,
      readSecret: confirmation.readSecret ?? ((name) => readPowerNowSecret(name, env)),
      onSuccess: async () => undefined,
      onSendFailure: async (errorClass) => {
        console.error("Power NOW confirmation email", { errorClass });
      },
    });
  } catch {
    console.error("Power NOW confirmation email", { errorClass: "SendFailed" });
  }
}
