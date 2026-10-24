import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SPEC_RE = /(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']/g;

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

type Stack = {
  params?: { name: string; type: string }[];
  endpoints?: Record<string, { secretEnvironmentVariables?: { key: string }[] }>;
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
        process.exit(0);
      }).catch((error) => { console.error(error); process.exit(1); });
      `,
    ],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        GCLOUD_PROJECT: "demo-hi-coworking",
        FIREBASE_CONFIG: JSON.stringify({ projectId: "demo-hi-coworking", storageBucket: "demo-hi-coworking.appspot.com" }),
      },
    },
  );
  return JSON.parse(output) as Stack;
}

// The 44 default-codebase functions that main exports and that are deployed today.
const ONLY = "functions:admin_backfillQBO,functions:admin_syncPaymentToQBO,functions:authProvisionOnCreate,functions:businessReferral_confirmConsent,functions:businessReferral_create,functions:businessReferral_createDispute,functions:businessReferral_prepareEvidenceAccess,functions:businessReferral_progress,functions:businessReferral_resolveDispute,functions:businessReferral_respond,functions:businessReferral_send,functions:businessReferral_updateConsent,functions:businessReferral_withdrawConsent,functions:createBooking,functions:createBookingQuote,functions:enrichment_link,functions:enrichment_search,functions:health,functions:intuit_checkConnection,functions:intuit_getAuthUrl,functions:intuit_oauthCallback,functions:leads_onNewLead,functions:leads_submitContact,functions:leads_submitLead,functions:notify_eventRegistration,functions:notify_paymentCreated,functions:notify_referralUpdate,functions:notify_rfxCreated,functions:notify_rfxResponse,functions:org_create,functions:org_purchaseSeats,functions:payments_createQuickBooksInvoice,functions:payments_pollQBInvoices,functions:profile_update,functions:qb_chargeCard,functions:qb_createCheckout,functions:qb_paymentsWebhook,functions:qb_refundCharge,functions:referral_onStatusChange,functions:rfx_listManaged,functions:setUserRole,functions:stripe_createCheckoutSession,functions:stripe_webhook,functions:territory_list_released";
const CORE_IDS = ONLY.split(",").map((entry) => entry.replace("functions:", "")).sort();
const DEPLOY = `npx firebase deploy --config firebase.core.json --project hi-coworking-plat --only ${ONLY} --non-interactive`;
const CORE_SECRETS = [
  "INTUIT_CLIENT_ID",
  "INTUIT_CLIENT_SECRET",
  "RECAPTCHA_SECRET_KEY",
  "SAM_GOV_API_KEY",
  "SEAM_API_KEY",
  "SEAM_WEBHOOK_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];
const BANNED = /^(TWILIO_|LINKEDIN_|X_)/;

describe("isolated core functions deploy", () => {
  const config = JSON.parse(readFileSync("firebase.core.json", "utf8"));
  const pkg = JSON.parse(readFileSync("firebase/core-functions/package.json", "utf8"));
  const index = readFileSync("firebase/core-functions/src/index.ts", "utf8");
  const yaml = readFileSync(".github/workflows/firebase-live-core-functions.yml", "utf8");
  const trigger = yaml.split(/^jobs:/m)[0] ?? "";

  it("deploys into the default codebase from its own source on Node 22", () => {
    expect(CORE_IDS).toHaveLength(44);
    expect(config.functions.source).toBe("firebase/core-functions");
    expect(config.functions.codebase).toBeUndefined();
    expect(config.functions.region).toBe("us-central1");
    expect(config.functions.predeploy).toEqual([
      "rm -rf firebase/core-functions/lib",
      "npm run build --workspace functions -- --project ../../firebase/core-functions/tsconfig.json",
    ]);
    expect(pkg.main).toBe("lib/firebase/core-functions/src/index.js");
    expect(pkg.engines.node).toBe("22");
    expect(readFileSync(".gitignore", "utf8")).toContain("firebase/core-functions/lib/");
  });

  it("never loads main.ts or the Twilio, LinkedIn, or X modules", () => {
    expect(index).not.toMatch(/from ["'][^"']*(eventMarketing|src\/main)["']/);
    expect(readFileSync("apps/functions/src/index.ts", "utf8")).not.toMatch(/from "\.\/eventMarketing"/);
    const files = loadGraph("firebase/core-functions/src/index.ts");
    for (const banned of ["eventMarketing.ts", "smsProvider.ts", "main.ts"]) {
      expect(files.some((file) => file.endsWith(`apps${path.sep}functions${path.sep}src${path.sep}${banned}`))).toBe(false);
    }
  });

  it("keeps the main source exporting the event marketing functions", () => {
    const main = readFileSync("apps/functions/src/main.ts", "utf8");
    expect(main).toContain('import * as eventMarketing from "./eventMarketing";');
    for (const id of ["events_enqueueCampaignJobs", "events_processCampaignJobs", "events_generateShareKits", "events_processSocialPosts"]) {
      expect(main).toContain(`export const ${id} = eventMarketing.${id};`);
    }
    expect(main).toContain('export { createBookingQuote, createBooking } from "./retiredBookingEndpoints";');
  });

  it("emits exactly the 44 functions, identical to main's, with no Twilio, LinkedIn, or X secrets", () => {
    expect(existsSync("firebase/core-functions/lib/firebase/core-functions/src/index.js")).toBe(true);
    expect(existsSync("apps/functions/lib/main.js")).toBe(true);
    const core = loadManifest("firebase/core-functions");
    const main = loadManifest("apps/functions");

    expect(Object.keys(core.endpoints ?? {}).sort()).toEqual(CORE_IDS);
    for (const id of CORE_IDS) expect(core.endpoints?.[id]).toEqual(main.endpoints?.[id]);

    const declared = (core.params ?? []).map((param) => `${param.name}:${param.type}`).sort();
    expect(declared).toEqual(CORE_SECRETS.map((name) => `${name}:secret`));
    const bound = Object.values(core.endpoints ?? {}).flatMap((endpoint) => (endpoint.secretEnvironmentVariables ?? []).map((secret) => secret.key));
    for (const name of [...declared.map((entry) => entry.split(":")[0]), ...bound]) expect(name).not.toMatch(BANNED);
    expect(JSON.stringify(core)).not.toMatch(/TWILIO_|LINKEDIN_|X_CLIENT/);

    // The main source still declares them, which is why this bundle exists.
    expect((main.params ?? []).map((param) => param.name)).toContain("TWILIO_ACCOUNT_SID");
  });

  it("has a manual-only workflow gated by a typed confirmation that deploys just the 44 with --only", () => {
    expect(trigger).toContain("workflow_dispatch:");
    expect(trigger).not.toContain("push:");
    expect(trigger).not.toContain("pull_request");
    expect(trigger).not.toContain("workflow_run");
    expect(yaml).toContain('DEPLOY_CONFIRMATION}" != "deploy core functions"');
    expect(yaml).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(yaml).toContain(DEPLOY);
    expect(yaml).not.toContain("--force");
    expect(yaml).not.toMatch(/TWILIO_|LINKEDIN_|X_CLIENT/);
    expect(yaml).not.toContain("secrets versions access");
    for (const name of CORE_SECRETS) expect(yaml).toContain(name);
  });

  it("does not add scripts to the root package.json, which would trigger the auto-deploy workflows", () => {
    const root = JSON.parse(readFileSync("package.json", "utf8"));
    expect(JSON.stringify(root.scripts)).not.toContain("core-functions");
  });
});
