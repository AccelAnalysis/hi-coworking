import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_EVENT_SAVE_ALLOWED_ORIGINS,
  isAdminEventSaveOriginAllowed,
} from "../../apps/functions/src/eventsV2/adminEventCors";
import {
  events_v2AdminPublishEvent,
  events_v2AdminSaveEvent,
} from "../../apps/functions/src/eventsV2/adminEventSave";
import {
  events_v2GetPublicEvent,
  events_v2ListPublicEvents,
} from "../../apps/functions/src/eventsV2/publicEventRead";

const saveSource = readFileSync(
  "apps/functions/src/eventsV2/adminEventSave.ts",
  "utf8",
);
const notificationsSource = readFileSync(
  "apps/functions/src/eventsV2/notifications.ts",
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
const listHandler = events_v2ListPublicEvents as unknown as CallableHandler;
const detailHandler = events_v2GetPublicEvent as unknown as CallableHandler;

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
    for (const handler of [saveHandler, publishHandler, listHandler, detailHandler]) {
      for (const origin of ["https://hi-coworking.com", "https://hi-coworking-plat.web.app"]) {
        const result = await invoke(handler, "OPTIONS", origin);
        expect(result.statusCode).toBe(204);
        expect(result.allowOrigin).toBe(origin);
      }
    }
  });

  it("does not reflect a foreign origin", async () => {
    for (const handler of [saveHandler, publishHandler, listHandler, detailHandler]) {
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
    const saveBlock = saveSource.slice(
      saveSource.indexOf("export const events_v2AdminSaveEvent"),
      saveSource.indexOf("export const events_v2AdminPublishEvent"),
    );
    const publishBlock = saveSource.slice(saveSource.indexOf("export const events_v2AdminPublishEvent"));
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
    expect(deployIndex).toContain("events_v2ListPublicEvents");
    expect(deployIndex).toContain("events_v2GetPublicEvent");
    expect(deployIndex).toContain('from "../../../apps/functions/src/eventsV2/adminEventSave"');
    expect(deployIndex).toContain('from "../../../apps/functions/src/eventsV2/publicEventRead"');
    expect(deployIndex).not.toContain("eventsV2/management");
    expect(deployIndex).not.toContain("events_v2AdminCancelEvent");
    expect(packageJson.scripts["build:admin-event-deploy"]).toContain("firebase/admin-event-functions/tsconfig.json");
    expect(packageJson.scripts["deploy:admin-event"]).toContain("firebase.admin-events.json");
    expect(packageJson.scripts["deploy:admin-event"]).toContain("functions:admin-event-save");
    expect(deployWorkflow).toContain("events_v2AdminSaveEvent");
    expect(deployWorkflow).toContain("events_v2AdminPublishEvent");
    expect(deployWorkflow).toContain("events_v2ListPublicEvents");
    expect(deployWorkflow).toContain("events_v2GetPublicEvent");
    expect(deployWorkflow).toContain("https://hi-coworking.com");
    expect(deployWorkflow).toContain("https://hi-coworking-plat.web.app");
    expect(deployWorkflow).toContain("https://evil.example");
    expect(deployWorkflow).not.toContain("functions:booking");
  });

  it("loads save and publish without the SendGrid secret, and leaves mail delivery on the notification worker", () => {
    const loaded = sourceFilesReachableFrom("firebase/admin-event-functions/src/index.ts");
    expect(loaded.length).toBeGreaterThan(1);
    for (const file of loaded) {
      expect(readFileSync(file, "utf8")).not.toContain("SENDGRID_API_KEY");
    }
    expect(notificationsSource).toContain('defineSecret("SENDGRID_API_KEY")');
    expect(notificationsSource).toContain("new SendGridProvider(apiKey)");
    expect(notificationsSource).toContain("events_v2ProcessNotificationJobs");

    const entry = resolve("firebase/admin-event-functions/lib/firebase/admin-event-functions/src/index.js");
    expect(existsSync(entry), "Build the admin-event deploy bundle before asserting secret registration.").toBe(true);
    const probe = spawnSync(process.execPath, ["-e", `
      const { declaredParams } = require("firebase-functions/params");
      require(${JSON.stringify(entry)});
      const names = declaredParams.map((param) => param.name);
      if (names.includes("SENDGRID_API_KEY")) {
        console.error(names.join(","));
        process.exit(2);
      }
      if (!names.includes("STRIPE_SECRET_KEY")) {
        console.error(names.join(",") || "<no params>");
        process.exit(3);
      }
    `], { encoding: "utf8" });
    expect(probe.status, probe.stderr || probe.stdout).toBe(0);

    const publicRead = readFileSync("apps/functions/src/eventsV2/publicEventRead.ts", "utf8");
    expect(publicRead).toContain('where("slug", "==", identifier)');
    expect(publicRead).toContain('event.status === "published"');
    expect(publicRead).not.toContain("requireAdmin");
    expect(publicRead).not.toContain("SENDGRID_API_KEY");
    expect(publicRead).toContain("adminEventCallableOptions");
  });
});

function sourceFilesReachableFrom(entry: string) {
  const seen = new Set<string>();
  const pending = [resolve(entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const base = resolve(dirname(file), match[1]);
      const candidate = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")]
        .find((path) => existsSync(path) && !path.endsWith(".ts.ts"));
      if (candidate?.endsWith(".ts") || candidate?.endsWith(".tsx")) pending.push(candidate);
    }
  }
  return [...seen];
}
