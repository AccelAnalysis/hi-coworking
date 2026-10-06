import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIENT_SECRET_TTL_SECONDS,
  DEFAULT_BOOTH_TOKEN_URL,
  GREETING_LINE,
  HANDOFF_LINE,
  IPAD_FORM_PATH,
  JESSICA_INSTRUCTIONS,
  REALTIME_WS_URL,
  STT_FAILURE_LIMIT,
  STT_RETRY_LINE,
  STT_STOP_LINE,
  applyTranscriptResult,
  boothTokenUrl,
  buildClientSecretBody,
  buildForceMessage,
  buildResponseCreate,
  buildSessionUpdate,
  classifyTranscript,
  handoffDetected,
  instructionsForAnsweredStep,
  isBrowserSafeClientSecret,
  nextDiscoveryStep,
  parseClientSecret,
  scrubAssistantCaption,
} from "../../apps/web/src/booth/jessicaSession";
import { base64Pcm16ToFloat32, floatToPcm16, pcm16ToBase64, resampleLinear, rms } from "../../apps/web/src/booth/pcm";
import {
  BOOTH_ALLOWED_ORIGINS,
  allowedOriginSet,
  createRateLimiter,
  handleBoothMint,
  type MintHttpResponse,
} from "../../firebase/booth-kiosk-functions/src/mintHandler";

const TOKEN = "xai-realtime-client-secret-testvalue";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function jsonFetch(status: number, body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;
}

async function mint(overrides: {
  origin?: string;
  method?: string;
  apiKey?: string;
  contentLength?: string;
  fetchImpl?: typeof fetch;
  allow?: boolean;
  extraOrigins?: string;
} = {}): Promise<{ response: MintHttpResponse; calls: Array<{ url: string; init?: RequestInit }> }> {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = overrides.fetchImpl ?? ((async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ value: TOKEN, expires_at: 1750000000 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch);

  const response = await handleBoothMint(
    {
      method: overrides.method ?? "POST",
      origin: overrides.origin,
      ip: "203.0.113.8",
      contentLength: overrides.contentLength,
    },
    {
      apiKey: overrides.apiKey === undefined ? "test-key" : overrides.apiKey,
      fetchImpl,
      allowedOrigins: allowedOriginSet(overrides.extraOrigins),
      rateLimiter: { allow: () => overrides.allow !== false },
    },
  );
  return { response, calls };
}

describe("Jessica booth script", () => {
  it("keeps the iPad handoff sentence exact", () => {
    expect(HANDOFF_LINE).toBe("Please enter your details on the iPad so our team can follow up the way you prefer.");
    expect(JESSICA_INSTRUCTIONS).toContain(HANDOFF_LINE);
    expect(instructionsForAnsweredStep("timeline")).toContain(HANDOFF_LINE);
    expect(buildResponseCreate("timeline").response.instructions).toContain(HANDOFF_LINE);
    expect(GREETING_LINE).not.toContain(HANDOFF_LINE);
    expect(handoffDetected(STT_STOP_LINE)).toBe(false);
    expect(handoffDetected(GREETING_LINE)).toBe(false);
    expect(handoffDetected(`  ${HANDOFF_LINE.toUpperCase()}  `)).toBe(true);
  });

  it("asks the three discovery questions and refuses contact details", () => {
    expect(GREETING_LINE).toContain("Accel Analysis booth assistant");
    expect(GREETING_LINE).toContain("biggest problem");
    expect(JESSICA_INSTRUCTIONS).toContain("who else is involved");
    expect(JESSICA_INSTRUCTIONS).toContain("timeline");
    expect(JESSICA_INSTRUCTIONS.toLowerCase()).toContain("email");
    expect(JESSICA_INSTRUCTIONS.toLowerCase()).toContain("phone");
    expect(JESSICA_INSTRUCTIONS.toLowerCase()).toContain("name");
    expect(JESSICA_INSTRUCTIONS).toContain("Never invent");
    expect(JESSICA_INSTRUCTIONS).toContain("Attio");
    expect(nextDiscoveryStep("problem")).toBe("stakeholders");
    expect(nextDiscoveryStep("stakeholders")).toBe("timeline");
    expect(nextDiscoveryStep("timeline")).toBe("confirm");
    expect(nextDiscoveryStep("confirm")).toBe("done");
    expect(instructionsForAnsweredStep("problem")).toContain("who else is involved");
    expect(instructionsForAnsweredStep("stakeholders")).toContain("timeline");
  });

  it("stops after two speech-recognition misses in a row", () => {
    expect(STT_FAILURE_LIMIT).toBe(2);
    expect(classifyTranscript("...")).toBe("empty");
    expect(classifyTranscript("  ")).toBe("empty");
    expect(classifyTranscript("ok")).toBe("usable");
    const first = applyTranscriptResult(0, "empty");
    expect(first).toEqual({ failures: 1, action: "retry" });
    expect(STT_RETRY_LINE).toContain("didn't catch that");
    const second = applyTranscriptResult(first.failures, "empty");
    expect(second).toEqual({ failures: 2, action: "stop" });
    expect(STT_STOP_LINE).toContain("I'm sorry");
    expect(STT_STOP_LINE).toContain("greeter");
    expect(STT_STOP_LINE).toContain("iPad");
    expect(applyTranscriptResult(1, "usable")).toEqual({ failures: 0, action: "respond" });
  });

  it("strips contact details from Jessica's on-screen line", () => {
    const scrubbed = scrubAssistantCaption(`Email me at visitor@example.com or call 757-236-0651. ${HANDOFF_LINE}`);
    expect(scrubbed).not.toContain("visitor@example.com");
    expect(scrubbed).not.toContain("757");
    expect(scrubbed).toContain(HANDOFF_LINE);
  });

  it("uses push-to-talk by default and the documented realtime socket", () => {
    expect(REALTIME_WS_URL).toBe("wss://api.x.ai/v1/realtime?model=grok-voice-latest");
    expect(IPAD_FORM_PATH).toBe("/expo/nasa-2026");
    expect(buildSessionUpdate("ptt").session.turn_detection).toBeNull();
    expect(buildSessionUpdate("vad").session.turn_detection).toEqual({ type: "server_vad" });
    expect("tools" in buildSessionUpdate("ptt").session).toBe(false);
    expect(buildSessionUpdate("ptt").session.instructions).toBe(JESSICA_INSTRUCTIONS);
    const forced = buildForceMessage(STT_STOP_LINE);
    expect(forced.item.type).toBe("force_message");
    expect(forced.item.content[0].text).toBe(STT_STOP_LINE);
    expect(JSON.stringify(forced)).not.toContain("response.create");
  });

  it("keeps the API key off the kiosk bundle", () => {
    const files = [
      ...walk("apps/web/src/booth"),
      ...walk("apps/web/src/app/expo"),
      "apps/web/public/booth/pcm-capture-worklet.js",
    ];
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toContain("XAI_API_KEY");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("console.");
    expect(source).not.toContain("attio.com");
    expect(source).toContain("xai-client-secret.");
    expect(boothTokenUrl(undefined)).toBe(DEFAULT_BOOTH_TOKEN_URL);
    expect(boothTokenUrl(" https://example.test/token ")).toBe("https://example.test/token");
    expect(isBrowserSafeClientSecret("xai-realtime-client-secret-abc123")).toBe(true);
    expect(isBrowserSafeClientSecret("has space")).toBe(false);
    expect(isBrowserSafeClientSecret("has=")).toBe(false);
  });
});

describe("ephemeral voice token", () => {
  it("asks xAI only for a 300 second client secret", () => {
    expect(buildClientSecretBody()).toEqual({ expires_after: { seconds: CLIENT_SECRET_TTL_SECONDS } });
    expect(CLIENT_SECRET_TTL_SECONDS).toBe(300);
    expect(JSON.stringify(buildClientSecretBody())).not.toContain("session");
  });

  it("returns the token to an allowed booth origin and hides the API key", async () => {
    const { response, calls } = await mint({ origin: "https://hi-coworking.com" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["Access-Control-Allow-Origin"]).toBe("https://hi-coworking.com");
    expect(response.headers["Cache-Control"]).toBe("no-store");
    expect(response.body).toEqual({ value: TOKEN, expires_at: 1750000000 });
    expect(JSON.stringify(response.body)).not.toContain("test-key");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.x.ai/v1/realtime/client_secrets");
    expect(new Headers(calls[0].init?.headers).get("Authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ expires_after: { seconds: 300 } });
  });

  it("refuses other origins before calling xAI", async () => {
    const denied = await mint({ origin: "https://evil.example" });
    expect(denied.response.statusCode).toBe(403);
    expect(denied.calls).toHaveLength(0);
    expect(denied.response.headers["Access-Control-Allow-Origin"]).toBeUndefined();

    const preflight = await mint({ origin: "https://hi-coworking.com", method: "OPTIONS" });
    expect(preflight.response.statusCode).toBe(204);
    expect(preflight.calls).toHaveLength(0);
  });

  it("does not mint when the key is missing or xAI fails", async () => {
    const missing = await mint({ origin: "http://localhost:3000", apiKey: "  " });
    expect(missing.response.statusCode).toBe(500);
    expect(missing.calls).toHaveLength(0);

    const failed = await mint({
      origin: "https://www.hi-coworking.com",
      fetchImpl: jsonFetch(401, { error: "bad key sk-secret" }),
    });
    expect(failed.response.statusCode).toBe(502);
    expect(JSON.stringify(failed.response.body)).not.toContain("sk-secret");

    const broken = await mint({
      origin: "https://hi-coworking-plat.web.app",
      fetchImpl: jsonFetch(200, { client_secret: { value: TOKEN } }),
    });
    expect(broken.response.statusCode).toBe(502);
    expect(parseClientSecret({ value: "short", expires_at: 1 })).toBeNull();
    expect(parseClientSecret({ value: TOKEN, expires_at: 1750000000 })).toEqual({
      value: TOKEN,
      expires_at: 1750000000,
    });
  });

  it("rate limits and ignores oversized bodies", async () => {
    const limited = await mint({ origin: "https://hi-coworking.com", allow: false });
    expect(limited.response.statusCode).toBe(429);
    expect(limited.calls).toHaveLength(0);

    const oversized = await mint({ origin: "https://hi-coworking.com", contentLength: "5000" });
    expect(oversized.response.statusCode).toBe(413);
    expect(oversized.calls).toHaveLength(0);

    let now = 1_000_000;
    const limiter = createRateLimiter(() => now);
    expect(limiter.allow("booth", 1)).toBe(true);
    expect(limiter.allow("booth", 1)).toBe(false);
    now += 60_001;
    expect(limiter.allow("booth", 1)).toBe(true);
  });

  it("allows an extra rehearsal origin and keeps the key in the function secret", () => {
    const origins = allowedOriginSet("https://preview.example");
    expect(origins.has("https://preview.example")).toBe(true);
    expect(BOOTH_ALLOWED_ORIGINS).toContain("https://hi-coworking.com");
    const index = readFileSync("firebase/booth-kiosk-functions/src/index.ts", "utf8");
    const handler = readFileSync("firebase/booth-kiosk-functions/src/mintHandler.ts", "utf8");
    expect(index).toContain('defineSecret("XAI_API_KEY")');
    expect(index).not.toContain("console.log");
    const logged = index.split("\n").filter((line) => line.includes("logger."));
    expect(logged.join("\n")).not.toContain("body");
    expect(logged.join("\n")).not.toContain("value");
    expect(index).toContain("res.json(result.body)");
    expect(handler).not.toContain("console.");
    expect(readFileSync("firebase.booth-kiosk.json", "utf8")).toContain("booth-kiosk");
    expect(readFileSync("firebase.json", "utf8")).not.toContain("booth-kiosk");
  });
});

describe("pcm audio", () => {
  it("round-trips 24 kHz PCM and downsamples mic audio", () => {
    const input = new Float32Array([0, 0.5, -1, 1]);
    const pcm = floatToPcm16(input);
    expect(pcm[2]).toBe(-32768);
    expect(pcm[3]).toBe(32767);
    const back = base64Pcm16ToFloat32(pcm16ToBase64(pcm));
    expect(back[1]).toBeCloseTo(0.5, 2);
    expect(resampleLinear(new Float32Array(48), 48000, 24000)).toHaveLength(24);
    expect(resampleLinear(new Float32Array(), 48000, 24000)).toHaveLength(0);
    expect(rms(new Float32Array([0, 0, 0]))).toBe(0);
  });
});
