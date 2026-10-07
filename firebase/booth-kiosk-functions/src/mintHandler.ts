/**
 * Mints a short-lived xAI realtime client secret.
 * The long-lived XAI_API_KEY stays on the server. Visitor speech never
 * reaches this function, and the token value is not logged.
 */
import { CLIENT_SECRET_URL, buildClientSecretBody, parseClientSecret } from "../../../apps/web/src/booth/jessicaSession.js";

export const BOOTH_ALLOWED_ORIGINS = [
  "https://hi-coworking.com",
  "https://www.hi-coworking.com",
  "https://hi-coworking-plat.web.app",
  "https://hi-coworking-plat.firebaseapp.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const;

const ORIGIN_LIMIT = 30;
const ANON_LIMIT = 8;
const WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 1024;

export interface MintHttpRequest {
  method: string;
  origin?: string;
  ip: string;
  contentLength?: string;
}

export interface MintHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body?: unknown;
}

export interface RateLimiter {
  allow(key: string, limit: number): boolean;
}

export function createRateLimiter(now: () => number = Date.now): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    allow(key: string, limit: number) {
      const time = now();
      const recent = (hits.get(key) ?? []).filter((stamp) => time - stamp < WINDOW_MS);
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

export function allowedOriginSet(extra: string | undefined): Set<string> {
  const origins = new Set<string>(BOOTH_ALLOWED_ORIGINS);
  if (!extra) return origins;
  for (const item of extra.split(",")) {
    const trimmed = item.trim();
    if (trimmed) origins.add(trimmed);
  }
  return origins;
}

function corsHeaders(origin: string | undefined, allowed: Set<string>): Record<string, string> {
  if (!origin || !allowed.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  };
}

export async function handleBoothMint(
  request: MintHttpRequest,
  deps: {
    apiKey: string | undefined;
    fetchImpl: typeof fetch;
    allowedOrigins: Set<string>;
    rateLimiter: RateLimiter;
  },
): Promise<MintHttpResponse> {
  const headers = corsHeaders(request.origin, deps.allowedOrigins);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    if (request.origin && !deps.allowedOrigins.has(request.origin)) {
      return { statusCode: 403, headers, body: { error: "Origin is not allowed." } };
    }
    return { statusCode: 204, headers };
  }

  if (method !== "POST") {
    return { statusCode: 405, headers, body: { error: "Method not allowed." } };
  }

  if (request.origin && !deps.allowedOrigins.has(request.origin)) {
    return { statusCode: 403, headers: {}, body: { error: "Origin is not allowed." } };
  }

  const contentLength = Number(request.contentLength ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return { statusCode: 413, headers, body: { error: "Request is too large." } };
  }

  const rateKey = `${request.origin ?? "no-origin"}|${request.ip || "unknown"}`;
  const limit = request.origin ? ORIGIN_LIMIT : ANON_LIMIT;
  if (!deps.rateLimiter.allow(rateKey, limit)) {
    return {
      statusCode: 429,
      headers: { ...headers, "Retry-After": "60" },
      body: { error: "Too many token requests. Wait a minute and try again." },
    };
  }

  const apiKey = deps.apiKey?.trim();
  if (!apiKey) {
    return { statusCode: 500, headers, body: { error: "Voice token service is not configured." } };
  }

  let upstream: Response;
  try {
    upstream = await deps.fetchImpl(CLIENT_SECRET_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildClientSecretBody()),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { statusCode: 502, headers, body: { error: "Voice token service is unavailable." } };
  }

  if (!upstream.ok) {
    return { statusCode: 502, headers, body: { error: "Voice token service is unavailable." } };
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return { statusCode: 502, headers, body: { error: "Voice token service is unavailable." } };
  }

  const secret = parseClientSecret(payload);
  if (!secret) {
    return { statusCode: 502, headers, body: { error: "Voice token service is unavailable." } };
  }

  return {
    statusCode: 200,
    headers: {
      ...headers,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
    body: { value: secret.value, expires_at: secret.expires_at },
  };
}
