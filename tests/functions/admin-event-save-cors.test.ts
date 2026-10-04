import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADMIN_EVENT_SAVE_ALLOWED_ORIGINS,
  isAdminEventSaveOriginAllowed,
} from "../../apps/functions/src/eventsV2/adminEventCors";
import {
  events_v2AdminPublishEvent,
  events_v2AdminSaveEvent,
} from "../../apps/functions/src/eventsV2/management";

const managementSource = readFileSync(
  "apps/functions/src/eventsV2/management.ts",
  "utf8",
);
const deployIndex = readFileSync(
  "firebase/admin-event-functions/src/index.ts",
  "utf8",
);
const deployConfig = JSON.parse(readFileSync("firebase.admin-events.json", "utf8"));
const deployWorkflow = readFileSync(
  ".github/workflows/firebase-live-admin-event-functions.yml",
  "utf8",
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};

type HeaderValue = string | number | readonly string[];

class MockResponse extends EventEmitter {
  statusCode = 200;
  headers: Record<string, HeaderValue> = {};
  body: unknown;

  setHeader(name: string, value: HeaderValue) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }

  getHeader(name: string) {
    return this.headers[name.toLowerCase()];
  }

  header(name: string, value?: HeaderValue) {
    if (value === undefined) return this.getHeader(name);
    this.setHeader(name, value);
    return this;
  }

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  send(body?: unknown) {
    this.body = body;
    this.end();
    return this;
  }

  end() {
    this.emit("finish");
    return this;
  }

  write() {
    return true;
  }
}

function mockRequest(method: string, origin: string, body?: unknown) {
  const headers: Record<string, string> = {
    origin,
    "content-type": "application/json",
  };
  if (method === "OPTIONS") {
    headers["access-control-request-method"] = "POST";
    headers["access-control-request-headers"] = "authorization,content-type";
  }
  return {
    method,
    url: "/",
    headers,
    body,
    header(name: string) {
      return headers[name.toLowerCase()];
    },
  };
}

type CallableHandler = (req: ReturnType<typeof mockRequest>, res: MockResponse) => Promise<void>;

async function invoke(handler: CallableHandler, method: string, origin: string, body?: unknown) {
  const response = new MockResponse();
  await handler(mockRequest(method, origin, body), response);
  const allowOrigin = response.getHeader("access-control-allow-origin");
  return {
    statusCode: response.statusCode,
    allowOrigin: typeof allowOrigin === "string" ? allowOrigin : undefined,
    body: response.body,
  };
}

const saveHandler = events_v2AdminSaveEvent as unknown as CallableHandler;
const publishHandler = events_v2AdminPublishEvent as unknown as CallableHandler;

describe("admin event save CORS", () => {
  it("allows only the live site, Firebase Hosting hosts, and local Next.js origins", () => {
    expect([...ADMIN_EVENT_SAVE_ALLOWED_ORIGINS]).toEqual([
      "https://hi-coworking.com",
      "https://www.hi-coworking.com",
      "https://hi-coworking-plat.web.app",
      "https://hi-coworking-plat.firebaseapp.com",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]);
    expect(ADMIN_EVENT_SAVE_ALLOWED_ORIGINS.length).toBeGreaterThan(1);
    expect(ADMIN_EVENT_SAVE_ALLOWED_ORIGINS).not.toContain("*");
    expect(isAdminEventSaveOriginAllowed("https://hi-coworking.com")).toBe(true);
    expect(isAdminEventSaveOriginAllowed("https://hi-coworking-plat.web.app")).toBe(true);
    expect(isAdminEventSaveOriginAllowed("https://evil.example")).toBe(false);
    expect(isAdminEventSaveOriginAllowed("https://hi-coworking.com.evil.example")).toBe(false);
    expect(isAdminEventSaveOriginAllowed("http://hi-coworking.com")).toBe(false);
    expect(isAdminEventSaveOriginAllowed(undefined)).toBe(false);
  });

  it("reflects the production and web.app origins on save and publish preflight", async () => {
    for (const handler of [saveHandler, publishHandler]) {
      for (const origin of ["https://hi-coworking.com", "https://hi-coworking-plat.web.app"]) {
        const result = await invoke(handler, "OPTIONS", origin);
        expect(result.statusCode).toBe(204);
        expect(result.allowOrigin).toBe(origin);
      }
    }
  });

  it("does not reflect a foreign origin", async () => {
    for (const handler of [saveHandler, publishHandler]) {
      const result = await invoke(handler, "OPTIONS", "https://evil.example");
      expect(result.allowOrigin).not.toBe("https://evil.example");
      expect(result.allowOrigin).not.toBe("*");
    }
  });

  it("keeps the admin auth check and still returns CORS headers for an allowed origin", async () => {
    const result = await invoke(saveHandler, "POST", "https://hi-coworking.com", { data: {} });
    expect(result.allowOrigin).toBe("https://hi-coworking.com");
    expect(result.statusCode).toBe(401);
    expect(result.body).toMatchObject({
      error: { status: "UNAUTHENTICATED" },
    });
    const saveBlock = managementSource.slice(
      managementSource.indexOf("export const events_v2AdminSaveEvent"),
      managementSource.indexOf("export const events_v2AdminPublishEvent"),
    );
    const publishBlock = managementSource.slice(
      managementSource.indexOf("export const events_v2AdminPublishEvent"),
      managementSource.indexOf("export const events_v2AdminCancelEvent"),
    );
    for (const block of [saveBlock, publishBlock]) {
      expect(block).toContain("if (!request.auth) throw new HttpsError(\"unauthenticated\", \"Sign in required.\");");
      expect(block).toContain("requireAdmin(request.auth);");
      expect(block).toContain("adminEventCallableOptions");
    }
  });

  it("deploys save and publish from an isolated us-central1 codebase", () => {
    expect(deployConfig.functions).toHaveLength(1);
    expect(deployConfig.functions[0].codebase).toBe("admin-event-save");
    expect(deployConfig.functions[0].source).toBe("firebase/admin-event-functions");
    expect(deployConfig.functions[0].region).toBe("us-central1");
    expect(deployIndex).toContain("events_v2AdminSaveEvent");
    expect(deployIndex).toContain("events_v2AdminPublishEvent");
    expect(deployIndex).not.toContain("events_v2AdminCancelEvent");
    expect(packageJson.scripts["build:admin-event-deploy"]).toContain("firebase/admin-event-functions/tsconfig.json");
    expect(packageJson.scripts["deploy:admin-event"]).toContain("firebase.admin-events.json");
    expect(packageJson.scripts["deploy:admin-event"]).toContain("functions:admin-event-save");
    expect(deployWorkflow).toContain("events_v2AdminSaveEvent");
    expect(deployWorkflow).toContain("events_v2AdminPublishEvent");
    expect(deployWorkflow).toContain("https://hi-coworking.com");
    expect(deployWorkflow).toContain("https://hi-coworking-plat.web.app");
    expect(deployWorkflow).toContain("https://evil.example");
    expect(deployWorkflow).not.toContain("functions:booking");
  });
});
