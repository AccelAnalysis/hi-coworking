import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { handleExpoLeadHttp } from "./nasaLeadIngest";

/**
 * Public booth and Power NOW ingest. The lead is stored in Firestore
 * collection intakeLeads. This path does not read a microphone, kiosk
 * transcript, or any voice capture.
 */
export const expo_submitNasaLead = onRequest(
  {
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
        stored: result.body.stored,
        duplicate: result.body.duplicate,
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
