import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { handleExpoLeadHttp } from "./nasaLeadIngest";
import { POWER_NOW_CONFIRMATION_SECRETS } from "./powerNowConfirmationSecrets";

/**
 * Public booth ingest. The browser posts the form here; Attio is called only
 * with ATTIO_API_KEY from the function environment. This path does not read a
 * microphone, kiosk transcript, or any voice capture.
 */
const attioApiKey = defineSecret("ATTIO_API_KEY");

function readAttioApiKey(): string | undefined {
  const fromEnv = process.env.ATTIO_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromSecret = attioApiKey.value()?.trim();
    return fromSecret || undefined;
  } catch {
    return undefined;
  }
}

export const expo_submitNasaLead = onRequest(
  {
    secrets: [attioApiKey, ...POWER_NOW_CONFIRMATION_SECRETS],
    cors: false,
    timeoutSeconds: 60,
    memory: "256MiB",
    invoker: "public",
  },
  async (req, res) => {
    const origin = req.get("origin");
    const contentLengthHeader = req.get("content-length");
    const forwarded = req.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || req.ip || "unknown";
    const result = await handleExpoLeadHttp({
      method: req.method,
      origin,
      contentLength: contentLengthHeader ? Number(contentLengthHeader) : null,
      body: req.body,
      apiKey: readAttioApiKey(),
      ip,
    });

    for (const [key, value] of Object.entries(result.headers)) {
      res.set(key, value);
    }

    if (result.status >= 500) {
      logger.error("expo_submitNasaLead failed", { status: result.status });
    } else if (result.body && "action" in result.body) {
      logger.info("expo_submitNasaLead stored", {
        action: result.body.action,
        listStatus: result.body.listStatus,
        noteStatus: result.body.noteStatus,
        companyStatus: result.body.companyStatus,
        path: typeof result.body.path === "string" ? result.body.path : undefined,
      });
    }

    if (result.body === null) {
      res.status(result.status).send("");
      return;
    }
    res.status(result.status).json(result.body);
  },
);
