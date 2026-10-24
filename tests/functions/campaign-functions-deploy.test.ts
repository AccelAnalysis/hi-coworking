import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  heldSmsDisposition,
  isSmsEnabledValue,
  selectDueJobs,
  statusAfterDelivery,
} from "../../apps/functions/src/campaignJobs";

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
    for (const match of readFileSync(file, "utf8").matchAll(SPEC_RE)) {
      const next = resolveImport(file, match[1]);
      if (next) queue.push(next);
    }
  }
  return files;
}

const ID = "events_processCampaignJobs";
const SECRETS = ["HI_COWORKING_RESEND_API_KEY", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"];
const DEPLOY =
  "npx firebase deploy --config firebase.campaign.json --project hi-coworking-plat --only functions:events_processCampaignJobs --non-interactive";

type Stack = {
  params?: Array<{ name: string; type: string; default?: unknown }>;
  endpoints?: Record<string, { secretEnvironmentVariables?: Array<{ key: string }>; scheduleTrigger?: { schedule?: string; timeZone?: string } }>;
};

function loadManifest(source: string): Stack {
  const output = execFileSync(
    process.execPath,
    [
      "-e",
      `
      const { loadStack } = require("./node_modules/firebase-functions/lib/runtime/loader.js");
      loadStack(${JSON.stringify(path.resolve(source))}).then((stack) => {
        process.stdout.write(JSON.stringify(stack));
      }).catch((error) => { console.error(error); process.exit(1); });
      `,
    ],
    { encoding: "utf8" },
  );
  return JSON.parse(output) as Stack;
}

describe("isolated campaign functions deploy", () => {
  const config = JSON.parse(readFileSync("firebase.campaign.json", "utf8"));
  const pkg = JSON.parse(readFileSync("firebase/campaign-functions/package.json", "utf8"));
  const index = readFileSync("firebase/campaign-functions/src/index.ts", "utf8");
  const docs = readFileSync("docs/HI-COWORKING-CAMPAIGN-SMS.md", "utf8");

  it("deploys into the default codebase from its own source on Node 22", () => {
    expect(config.functions.source).toBe("firebase/campaign-functions");
    expect(config.functions.codebase).toBeUndefined();
    expect(config.functions.region).toBe("us-central1");
    expect(config.functions.predeploy).toEqual([
      "rm -rf firebase/campaign-functions/lib",
      "npm run build --workspace functions -- --project ../../firebase/campaign-functions/tsconfig.json",
    ]);
    expect(pkg.main).toBe("lib/firebase/campaign-functions/src/index.js");
    expect(pkg.engines.node).toBe("22");
    expect(readFileSync(".gitignore", "utf8")).toContain("firebase/campaign-functions/lib/");
  });

  it("never loads eventMarketing, main or index (the LinkedIn and X secrets)", () => {
    expect(index).not.toMatch(/^(?:import|export)[^\n]*(eventMarketing|src\/main|src\/index)/m);
    const files = loadGraph("firebase/campaign-functions/src/index.ts");
    expect(files.some((file) => file.endsWith(`apps${path.sep}functions${path.sep}src${path.sep}campaignJobs.ts`))).toBe(true);
    for (const banned of ["eventMarketing.ts", "main.ts", "index.ts", `providers${path.sep}socialProvider.ts`]) {
      expect(files.some((file) => file.endsWith(`apps${path.sep}functions${path.sep}src${path.sep}${banned}`))).toBe(false);
    }
    const literal = files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(LITERAL_SECRET_RE)].map((m) => m[1])).sort();
    expect(literal).toEqual(["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"]);
  });

  it("emits one scheduled function bound to the Twilio and Resend secrets only", () => {
    expect(existsSync("firebase/campaign-functions/lib/firebase/campaign-functions/src/index.js")).toBe(true);
    const stack = loadManifest("firebase/campaign-functions");
    expect(Object.keys(stack.endpoints ?? {})).toEqual([ID]);
    const endpoint = stack.endpoints![ID];
    expect(endpoint.scheduleTrigger?.schedule).toBe("*/5 * * * *");
    expect(endpoint.scheduleTrigger?.timeZone).toBe("America/New_York");
    expect((endpoint.secretEnvironmentVariables ?? []).map((s) => s.key).sort()).toEqual(SECRETS);
    const params = (stack.params ?? []).map((p) => `${p.name}:${p.type}`).sort();
    expect(params).toEqual([...SECRETS.map((s) => `${s}:secret`), "HI_COWORKING_SMS_ENABLED:string"].sort());
    expect(JSON.stringify(stack)).not.toMatch(/LINKEDIN|X_CLIENT|STRIPE/);
  });

  it("ships SMS off in every env file that loads the processor", () => {
    for (const file of [
      "firebase/campaign-functions/.env.hi-coworking-plat",
      "firebase/campaign-functions/.env.demo-hi-coworking",
      "apps/functions/.env.hi-coworking-plat",
      "apps/functions/.env.demo-hi-coworking",
    ]) {
      expect(readFileSync(file, "utf8")).toMatch(/^HI_COWORKING_SMS_ENABLED=false$/m);
    }
  });

  it("documents the --only deploy and never --force", () => {
    expect(docs).toContain(DEPLOY);
    expect(docs).not.toMatch(/firebase deploy[^\n]*--force/);
  });

  it("keeps the main source exporting the processor", () => {
    expect(readFileSync("apps/functions/src/eventMarketing.ts", "utf8")).toContain(
      'export { events_processCampaignJobs } from "./campaignJobs";',
    );
    const root = JSON.parse(readFileSync("package.json", "utf8"));
    expect(JSON.stringify(root.scripts)).not.toContain("campaign-functions");
  });
});

describe("campaign SMS switch", () => {
  it("is on only for the exact value true", () => {
    expect(isSmsEnabledValue("true")).toBe(true);
    expect(isSmsEnabledValue(" TRUE ")).toBe(true);
    for (const value of ["false", "", "1", "yes", undefined, null, true]) expect(isSmsEnabledValue(value)).toBe(false);
  });

  it("holds SMS campaigns instead of marking them sent or failed", () => {
    expect(statusAfterDelivery(["email", "sms"], false)).toBe("sms_held");
    expect(statusAfterDelivery(["sms"], false)).toBe("sms_held");
    expect(statusAfterDelivery(["email", "sms"], true)).toBe("sent");
    expect(statusAfterDelivery(["email", "push"], false)).toBe("sent");
  });
});

describe("due job selection", () => {
  it("returns only due jobs, oldest first, capped", () => {
    const jobs = [
      { id: "future", scheduledFor: 500 },
      { id: "b", scheduledFor: 200 },
      { id: "a", scheduledFor: 100 },
      { id: "bad", scheduledFor: "x" },
      { id: "c", scheduledFor: 300 },
    ];
    expect(selectDueJobs(jobs, 300).map((j) => j.id)).toEqual(["a", "b", "c"]);
    expect(selectDueJobs(jobs, 300, 2).map((j) => j.id)).toEqual(["a", "b"]);
  });
});

describe("held SMS once the switch is on", () => {
  const HOUR = 60 * 60 * 1000;
  const start = 100 * HOUR;

  it("sends announcements and reminders only before the event starts", () => {
    expect(heldSmsDisposition({ type: "reminder", scheduledFor: start - 24 * HOUR }, start, start - HOUR)).toBe("send");
    expect(heldSmsDisposition({ type: "reminder", scheduledFor: start - 24 * HOUR }, start, start)).toBe("expire");
    expect(heldSmsDisposition({ type: "announce", scheduledFor: 0 }, start, start + 1)).toBe("expire");
  });

  it("expires starting-soon texts after an hour", () => {
    expect(heldSmsDisposition({ type: "starting_soon", scheduledFor: start - HOUR }, start, start - HOUR / 2)).toBe("send");
    expect(heldSmsDisposition({ type: "starting_soon", scheduledFor: start - 3 * HOUR }, start, start - HOUR)).toBe("expire");
  });

  it("sends follow-ups within 72 hours only", () => {
    expect(heldSmsDisposition({ type: "follow_up", scheduledFor: start }, start - HOUR, start + 71 * HOUR)).toBe("send");
    expect(heldSmsDisposition({ type: "follow_up", scheduledFor: start }, start - HOUR, start + 73 * HOUR)).toBe("expire");
  });
});
