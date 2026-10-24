import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isStaleNotification } from "../../apps/functions/src/eventsV2/notifications";

const SPEC_RE = /(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']/g;
const LITERAL_SECRET_RE = /defineSecret\(\s*["']([A-Z0-9_]+)["']/g;

function resolveImport(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  const stripped = base.replace(/\.(?:js|mjs|cjs)$/, "");
  for (const candidate of [base, `${stripped}.ts`, `${stripped}.tsx`, `${stripped}.js`, path.join(stripped, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function loadGraph(entry: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const queue = [path.resolve(entry)];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(SPEC_RE)) {
      const next = resolveImport(file, match[1]);
      if (next) queue.push(next);
    }
  }
  return files;
}

const MAIL_IDS = ["events_v2ProcessNotificationJobs", "nurture_process"];
const DEPLOY =
  "npx firebase deploy --config firebase.mail.json --project hi-coworking-plat --only functions:nurture_process,functions:events_v2ProcessNotificationJobs --non-interactive";

describe("isolated mail functions deploy", () => {
  const config = JSON.parse(readFileSync("firebase.mail.json", "utf8"));
  const pkg = JSON.parse(readFileSync("firebase/mail-functions/package.json", "utf8"));
  const index = readFileSync("firebase/mail-functions/src/index.ts", "utf8");
  const yaml = readFileSync(".github/workflows/firebase-live-mail-functions.yml", "utf8");
  const trigger = yaml.split(/^jobs:/m)[0] ?? "";

  it("deploys into the default codebase from its own source", () => {
    expect(config.functions.source).toBe("firebase/mail-functions");
    expect(config.functions.codebase).toBeUndefined();
    expect(config.functions.region).toBe("us-central1");
    expect(config.functions.predeploy.join("\n")).toContain("firebase/mail-functions/tsconfig.json");
    expect(pkg.main).toBe("lib/firebase/mail-functions/src/index.js");
    expect(readFileSync(".gitignore", "utf8")).toContain("firebase/mail-functions/lib/");
  });

  it("never loads the Twilio, LinkedIn, or X modules", () => {
    expect(index).not.toMatch(/^import .*eventMarketing/m);
    const files = loadGraph("firebase/mail-functions/src/index.ts");
    expect(files.some((file) => file.endsWith("nurture.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith(`eventsV2${path.sep}notifications.ts`))).toBe(true);
    for (const banned of ["eventMarketing.ts", "smsProvider.ts", "main.ts", `src${path.sep}index.ts`]) {
      expect(files.some((file) => file.endsWith(`apps${path.sep}functions${path.sep}src${path.sep}${banned}`))).toBe(false);
    }
    // The only defineSecret in the graph is the Resend binding (by constant name).
    const literal = files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(LITERAL_SECRET_RE)].map((m) => m[1]));
    expect(literal).toEqual([]);
    expect(files.filter((file) => readFileSync(file, "utf8").includes("defineSecret(")).map((file) => path.basename(file))).toEqual([
      "emailSecret.ts",
    ]);
  });

  it("emits a Firebase manifest whose only secret is HI_COWORKING_RESEND_API_KEY", () => {
    expect(existsSync("firebase/mail-functions/lib/firebase/mail-functions/src/index.js")).toBe(true);
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        `
        const { loadStack } = require("./node_modules/firebase-functions/lib/runtime/loader.js");
        loadStack(${JSON.stringify(path.resolve("firebase/mail-functions"))}).then((stack) => {
          const params = (stack.params || []).map((param) => param.name + ":" + param.type);
          const bound = {};
          for (const [id, endpoint] of Object.entries(stack.endpoints || {})) {
            bound[id] = (endpoint.secretEnvironmentVariables || []).map((secret) => secret.key);
          }
          process.stdout.write(JSON.stringify({ params, bound, ids: Object.keys(stack.endpoints || {}).sort() }));
        }).catch((error) => { console.error(error); process.exit(1); });
        `,
      ],
      { encoding: "utf8" },
    );
    const parsed = JSON.parse(output) as { params: string[]; bound: Record<string, string[]>; ids: string[] };
    expect(parsed.ids).toEqual(MAIL_IDS);
    expect(parsed.params).toEqual(["HI_COWORKING_RESEND_API_KEY:secret"]);
    for (const id of MAIL_IDS) expect(parsed.bound[id]).toEqual(["HI_COWORKING_RESEND_API_KEY"]);
    expect(output).not.toMatch(/TWILIO|LINKEDIN|X_CLIENT|STRIPE/);
  });

  it("has a manual-only workflow that deploys just the two workers", () => {
    expect(trigger).toContain("workflow_dispatch:");
    expect(trigger).not.toContain("push:");
    expect(trigger).not.toContain("pull_request");
    expect(yaml).toContain('DEPLOY_CONFIRMATION}" != "deploy mail functions"');
    expect(yaml).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(yaml).toContain(DEPLOY);
    expect(yaml).not.toContain("TWILIO_");
    expect(yaml).not.toContain("secrets versions access");
  });

  it("does not add scripts to the root package.json, which would trigger the auto-deploy workflows", () => {
    const root = JSON.parse(readFileSync("package.json", "utf8"));
    expect(JSON.stringify(root.scripts)).not.toContain("mail-functions");
  });
});

describe("stale event notifications", () => {
  const event = { startTime: 1_000_000, endTime: 2_000_000 };

  it("expires reminders once the event has started", () => {
    expect(isStaleNotification("EVENT_REMINDER_24H", event, 999_999)).toBe(false);
    expect(isStaleNotification("EVENT_REMINDER_1H", event, 1_000_000)).toBe(true);
    expect(isStaleNotification("EVENT_REMINDER_24H", event, 5_000_000)).toBe(true);
  });

  it("expires confirmations and waitlist notices once the event has ended", () => {
    expect(isStaleNotification("REGISTRATION_CONFIRMED", event, 1_500_000)).toBe(false);
    expect(isStaleNotification("REGISTRATION_CONFIRMED", event, 2_000_000)).toBe(true);
    expect(isStaleNotification("WAITLIST_OFFER", event, 3_000_000)).toBe(true);
    expect(isStaleNotification("WAITLIST_JOINED", { startTime: 1_000_000, endTime: 0 }, 1_000_001)).toBe(true);
  });

  it("still sends after-the-fact notices", () => {
    for (const type of ["EVENT_FOLLOW_UP", "REGISTRATION_CANCELLED", "REFUND_CONFIRMED", "EVENT_CANCELLED"]) {
      expect(isStaleNotification(type, event, 9_000_000)).toBe(false);
    }
  });
});
