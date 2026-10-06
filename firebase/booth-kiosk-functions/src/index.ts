import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { allowedOriginSet, createRateLimiter, handleBoothMint } from "./mintHandler.js";

const xaiApiKey = defineSecret("XAI_API_KEY");
const rateLimiter = createRateLimiter();

function clientIp(forwarded: string | undefined, direct: string | undefined): string {
  const first = forwarded?.split(",")[0]?.trim();
  return (first || direct || "unknown").slice(0, 64);
}

/**
 * Public mint endpoint for the NASA Expo Jessica kiosk.
 * Deploy only with firebase.booth-kiosk.json so booking and events stay put.
 */
export const booth_mintVoiceClientSecret = onRequest(
  {
    region: "us-central1",
    secrets: [xaiApiKey],
    cors: false,
    invoker: "public",
    timeoutSeconds: 15,
    memory: "256MiB",
    maxInstances: 2,
  },
  async (req, res) => {
    const result = await handleBoothMint(
      {
        method: req.method,
        origin: req.get("origin") || undefined,
        ip: clientIp(req.get("x-forwarded-for"), req.ip),
        contentLength: req.get("content-length") || undefined,
      },
      {
        apiKey: xaiApiKey.value() || process.env.XAI_API_KEY,
        fetchImpl: fetch,
        allowedOrigins: allowedOriginSet(process.env.BOOTH_ALLOWED_ORIGINS),
        rateLimiter,
      },
    );

    for (const [key, value] of Object.entries(result.headers)) res.set(key, value);
    if (result.statusCode === 200) logger.info("Booth voice token minted");
    else if (result.statusCode >= 400) logger.warn("Booth voice token request failed", { status: result.statusCode });

    res.status(result.statusCode);
    if (result.body === undefined) {
      res.send("");
      return;
    }
    res.json(result.body);
  },
);
