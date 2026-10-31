import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Nurture, Series, Bookstore and Published setups each deploy from an isolated
// bundle that never loads eventMarketing.ts (TWILIO_*, LINKEDIN_*, X_* secrets).

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
    for (const match of readFileSync(file, "utf8").matchAll(SPEC_RE)) {
      const next = resolveImport(file, match[1]);
      if (next) queue.push(next);
    }
  }
  return files;
}

type Bundle = {
  codebase: string;
  ids: string[];
  params: string[];
  bound: Record<string, string[]>;
  secretFiles: string[];
  auto: boolean;
  confirm?: string;
  probe: string;
};

const BUNDLES: Bundle[] = [
  {
    codebase: "nurture-lifecycle",
    ids: [
      "nurture_adminOverview",
      "nurture_adminSetCampaignStatus",
      "nurture_onBookingCreated",
      "nurture_onLeadCreated",
      "nurture_onMemberUpdated",
      "nurture_scanLifecycle",
      "nurture_unsubscribe",
      "nurture_updateMyPreferences",
    ],
    params: ["HI_COWORKING_RESEND_API_KEY:secret"],
    bound: {},
    secretFiles: ["emailSecret.ts"],
    auto: false,
    confirm: "deploy nurture lifecycle",
    probe: "nurture_adminOverview",
  },
  {
    codebase: "event-series",
    ids: ["events_extendHorizon", "events_setSeriesOccurrenceOverride", "events_upsertSeries"],
    params: [],
    bound: {},
    secretFiles: [],
    auto: true,
    probe: "events_upsertSeries",
  },
  {
    codebase: "bookstore",
    ids: [
      "bookstore_adjustInventory",
      "bookstore_cancelOrder",
      "bookstore_createCheckoutSession",
      "bookstore_getDownloadLink",
      "bookstore_getMyOrders",
      "bookstore_getOrder",
      "bookstore_getPublicStock",
      "bookstore_listInventory",
      "bookstore_listOrders",
      "bookstore_onPaymentUpdated",
      "bookstore_refundOrder",
      "bookstore_releaseExpiredReservations",
      "bookstore_setPickupStatus",
    ],
    params: ["STRIPE_SECRET_KEY:secret", "STRIPE_WEBHOOK_SECRET:secret"],
    bound: {
      bookstore_createCheckoutSession: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
      bookstore_refundOrder: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
      bookstore_releaseExpiredReservations: ["STRIPE_SECRET_KEY"],
    },
    secretFiles: ["bookstoreCommerce.ts", "bookstoreRefund.ts"],
    auto: false,
    confirm: "deploy bookstore",
    probe: "bookstore_getPublicStock",
  },
  {
    codebase: "space-catalog",
    ids: [
      "space_adminGetCatalog",
      "space_adminSetSetupPublished",
      "space_adminUpsertAddOn",
      "space_adminUpsertSetup",
      "space_getPublishedCatalog",
    ],
    params: [],
    bound: {},
    secretFiles: [],
    auto: true,
    probe: "space_getPublishedCatalog",
  },
  {
    codebase: "member-record",
    ids: ["admin_consentList", "admin_memberRecordGet"],
    params: [],
    bound: {},
    secretFiles: [],
    auto: false,
    confirm: "deploy member record",
    probe: "admin_consentList",
  },
  {
    codebase: "front-desk-kiosk",
    ids: [
      "admin_followUpSetStatus",
      "admin_kioskCloseVisit",
      "admin_kioskDeviceSet",
      "admin_kioskOverview",
      "admin_kioskResolveAlert",
      "admin_kioskSetSettings",
      "kioskFrontDeskTask",
      "kiosk_checkIn",
      "kiosk_checkOut",
      "kiosk_lookupMember",
      "kiosk_onBookingWritten",
      "kiosk_session",
      "members_kioskSummary",
    ],
    params: [],
    bound: {},
    secretFiles: [],
    auto: false,
    confirm: "deploy front desk kiosk",
    probe: "kiosk_session",
  },
];

function manifest(source: string) {
  const output = execFileSync(
    process.execPath,
    [
      "-e",
      `
      const { loadStack } = require("./node_modules/firebase-functions/lib/runtime/loader.js");
      loadStack(${JSON.stringify(path.resolve(source))}).then((stack) => {
        const params = (stack.params || []).map((param) => param.name + ":" + param.type).sort();
        const bound = {};
        for (const [id, endpoint] of Object.entries(stack.endpoints || {})) {
          const keys = (endpoint.secretEnvironmentVariables || []).map((secret) => secret.key).sort();
          if (keys.length) bound[id] = keys;
        }
        process.stdout.write(JSON.stringify({ params, bound, ids: Object.keys(stack.endpoints || {}).sort() }));
      }).catch((error) => { console.error(error); process.exit(1); });
      `,
    ],
    { encoding: "utf8" },
  );
  return { raw: output, ...(JSON.parse(output) as { params: string[]; bound: Record<string, string[]>; ids: string[] }) };
}

for (const bundle of BUNDLES) {
  const dir = `firebase/${bundle.codebase}-functions`;
  const configFile = `firebase.${bundle.codebase}.json`;
  const workflowFile = `.github/workflows/firebase-live-${bundle.codebase}.yml`;
  const deploy = `npx firebase deploy --config ${configFile} --project hi-coworking-plat --only functions:${bundle.codebase} --non-interactive`;

  describe(`isolated ${bundle.codebase} deploy`, () => {
    it("deploys its own named codebase from its own source", () => {
      const config = JSON.parse(readFileSync(configFile, "utf8"));
      expect(config.functions).toHaveLength(1);
      const [fn] = config.functions;
      expect(fn.source).toBe(dir);
      expect(fn.codebase).toBe(bundle.codebase);
      expect(fn.region).toBe("us-central1");
      expect(fn.predeploy).toEqual([
        `rm -rf ${dir}/lib`,
        `npm run build --workspace functions -- --project ../../${dir}/tsconfig.json`,
      ]);
      expect(Object.keys(config)).toEqual(["functions"]);
      const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8"));
      expect(pkg.main).toBe(`lib/${dir}/src/index.js`);
      expect(pkg.engines.node).toBe("22");
      expect(readFileSync(".gitignore", "utf8")).toContain(`${dir}/lib/`);
    });

    it("never loads the Twilio, LinkedIn or X modules", () => {
      const files = loadGraph(`${dir}/src/index.ts`);
      for (const banned of ["eventMarketing.ts", "smsProvider.ts", "main.ts", "index.ts"]) {
        expect(files.some((file) => file.endsWith(`apps${path.sep}functions${path.sep}src${path.sep}${banned}`))).toBe(false);
      }
      const declaring = files
        .filter((file) => readFileSync(file, "utf8").includes("defineSecret("))
        .map((file) => path.basename(file))
        .sort();
      expect(declaring).toEqual([...bundle.secretFiles].sort());
    });

    it("emits a manifest with exactly the expected functions and secrets", () => {
      expect(existsSync(`${dir}/lib/${dir}/src/index.js`)).toBe(true);
      const result = manifest(dir);
      expect(result.ids).toEqual(bundle.ids);
      expect(result.params).toEqual(bundle.params);
      expect(result.bound).toEqual(bundle.bound);
      expect(result.raw).not.toMatch(/TWILIO|LINKEDIN|X_CLIENT/);
    });

    it(bundle.auto ? "auto-deploys on main by path" : "is manual with a typed confirmation", () => {
      const yaml = readFileSync(workflowFile, "utf8");
      const trigger = yaml.split(/^jobs:/m)[0] ?? "";
      expect(trigger).toContain("workflow_dispatch:");
      expect(trigger).not.toContain("pull_request");
      if (bundle.auto) {
        expect(trigger).toContain("push:");
        expect(trigger).toContain(`"${dir}/**"`);
      } else {
        expect(trigger).not.toContain("push:");
        expect(yaml).toContain(`DEPLOY_CONFIRMATION}" != "${bundle.confirm}"`);
        expect(yaml).toContain('GITHUB_REF}" != "refs/heads/main"');
        for (const secret of bundle.params.map((param) => param.split(":")[0])) {
          expect(yaml).toContain(`gcloud secrets versions list ${secret}`);
        }
      }
      expect(yaml).toContain(deploy);
      expect(yaml).toContain(`cloudfunctions.net/${bundle.probe}`);
      expect(yaml).not.toMatch(/--force|secrets versions access|TWILIO_/);
    });
  });
}

describe("admin tool bundles and the root package", () => {
  it("adds no root scripts, which would trigger the path-based auto-deploys", () => {
    const root = JSON.parse(readFileSync("package.json", "utf8"));
    const scripts = JSON.stringify(root.scripts);
    for (const bundle of BUNDLES) expect(scripts).not.toContain(`${bundle.codebase}-functions`);
  });

  it("keeps nurture_process in the mail bundle only", () => {
    expect(readFileSync("firebase/nurture-lifecycle-functions/src/index.ts", "utf8")).not.toMatch(/^\s*nurture_process,/m);
    expect(readFileSync("firebase/mail-functions/src/index.ts", "utf8")).toContain("nurture_process");
  });
});
