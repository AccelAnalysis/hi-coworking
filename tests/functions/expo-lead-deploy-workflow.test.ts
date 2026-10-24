import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SPEC_RE = /(?:from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']/g;
const SECRET_RE = /defineSecret\(\s*["']([A-Z0-9_]+)["']/g;

function resolveImport(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  const stripped = base.replace(/\.(?:js|mjs|cjs)$/, "");
  const candidates = [
    base,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    `${stripped}.js`,
    path.join(stripped, "index.ts"),
    path.join(stripped, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function loadGraph(entry: string): { files: string[]; secrets: string[] } {
  const files: string[] = [];
  const secrets = new Set<string>();
  const seen = new Set<string>();
  const queue = [path.resolve(entry)];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(SECRET_RE)) secrets.add(match[1]);
    SPEC_RE.lastIndex = 0;
    for (const match of source.matchAll(SPEC_RE)) {
      const next = resolveImport(file, match[1]);
      if (next) queue.push(next);
    }
  }

  return { files, secrets: [...secrets].sort() };
}

describe("expo_submitNasaLead manual deploy workflow", () => {
  const yaml = readFileSync(".github/workflows/firebase-live-expo-lead-function.yml", "utf8");
  const doc = readFileSync("docs/EXPO-NASA-2026-LEAD-CAPTURE.md", "utf8");
  const trigger = yaml.split(/^jobs:/m)[0] ?? "";
  const isolatedIndex = readFileSync("firebase/expo-lead-functions/src/index.ts", "utf8");
  const isolatedConfig = JSON.parse(readFileSync("firebase.expo-lead.json", "utf8"));
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const main = readFileSync("apps/functions/src/main.ts", "utf8");

  it("is a manual confirmation on main and deploys only that function", () => {
    expect(yaml.startsWith("name: Hi Coworking Firebase expo lead function\n")).toBe(true);
    expect(trigger).toContain("workflow_dispatch:");
    expect(trigger).not.toContain("push:");
    expect(yaml).toContain('DEPLOY_CONFIRMATION}" != "deploy expo_submitNasaLead"');
    expect(yaml).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(yaml).toContain(
      "npx firebase deploy --config firebase.expo-lead.json --project hi-coworking-plat --only functions:expo_submitNasaLead --non-interactive",
    );
    expect(yaml).toContain("npm run build:expo-lead-deploy");
    expect(yaml).not.toContain("npm run build:functions");
    expect(yaml).not.toMatch(/--only\s+(hosting|firestore|storage|functions\s*$)/m);
    expect(yaml).not.toContain("firebase deploy --only functions\n");
    expect(yaml).not.toContain("TWILIO_");
    expect(yaml).toContain("hi-coworking-plat");
    expect(yaml).toContain("FIREBASE_SERVICE_ACCOUNT_HI_COWORKING_PLAT");
    expect(yaml).toContain('node-version: "22"');
  });

  it("checks the Attio secret without reading or printing it, then smoke-tests with OPTIONS", () => {
    expect(yaml).toContain("gcloud secrets describe ATTIO_API_KEY");
    expect(yaml).toContain("secrets versions list ATTIO_API_KEY");
    expect(yaml).not.toContain("secrets versions access");
    expect(yaml).toContain("The secret value was not printed.");
    expect(yaml).toContain("--request OPTIONS");
    expect(yaml).toContain("does not write to Attio");
    expect(doc).toContain("Hi Coworking Firebase expo lead function");
    expect(doc).toContain("deploy expo_submitNasaLead");
    expect(doc).toContain("workflow_dispatch");
    expect(doc).toContain("OPTIONS");
    expect(doc).toContain("firebase.expo-lead.json");
    expect(doc).toContain("https://accelanalysis.com/power-now");
    expect(doc).toContain("https://forms.accelanalysis.com/power-now");
    expect(doc).toContain("/pitch");
    expect(doc).toContain("/watch");
    expect(doc).toContain("/contribute");
    expect(doc).toContain("301");
  });

  it("loads only ATTIO_API_KEY for the scoped deploy, while the monolith still registers Twilio", () => {
    expect(isolatedConfig.functions.source).toBe("firebase/expo-lead-functions");
    expect(isolatedConfig.functions.codebase).toBeUndefined();
    expect(isolatedConfig.functions.region).toBe("us-central1");
    expect(isolatedConfig.functions.predeploy).toEqual(["npm run build:expo-lead-deploy"]);
    expect(isolatedIndex).toContain('from "../../../apps/functions/src/expo/submitNasaLead"');
    expect(isolatedIndex).not.toContain("eventMarketing");
    expect(isolatedIndex).not.toContain("TWILIO");
    expect(main).toContain('export { expo_submitNasaLead } from "./expo/submitNasaLead"');
    expect(packageJson.scripts["build:expo-lead-deploy"]).toContain("firebase/expo-lead-functions/tsconfig.json");
    expect(packageJson.scripts["deploy:expo-lead"]).toBe(
      "firebase deploy --config firebase.expo-lead.json --project hi-coworking-plat --only functions:expo_submitNasaLead",
    );

    const isolated = loadGraph("firebase/expo-lead-functions/src/index.ts");
    expect(isolated.secrets).toEqual(["ATTIO_API_KEY"]);
    expect(isolated.files.some((file) => file.endsWith("powerNowConfirmationSecrets.ts"))).toBe(true);
    expect(isolated.files.some((file) => file.endsWith("powerNowIngest.ts"))).toBe(true);
    expect(isolated.files.some((file) => file.endsWith("intakeLeadStore.ts"))).toBe(true);
    expect(isolated.files.some((file) => file.endsWith(`${path.sep}apps${path.sep}functions${path.sep}src${path.sep}index.ts`))).toBe(false);
    expect(isolated.files.some((file) => file.endsWith("eventMarketing.ts"))).toBe(false);
    expect(isolated.files.some((file) => file.endsWith("smsProvider.ts"))).toBe(false);

    const monolith = loadGraph("apps/functions/src/main.ts");
    expect(monolith.secrets).toContain("TWILIO_ACCOUNT_SID");
    expect(monolith.secrets).toContain("TWILIO_AUTH_TOKEN");
    expect(monolith.secrets).toContain("TWILIO_FROM_NUMBER");
    expect(monolith.secrets).toContain("ATTIO_API_KEY");
    expect(monolith.files.some((file) => file.endsWith("eventMarketing.ts"))).toBe(true);
  });

  it("emits a Firebase manifest whose only secret is ATTIO_API_KEY", () => {
    expect(existsSync("firebase/expo-lead-functions/lib/firebase/expo-lead-functions/src/index.js")).toBe(true);
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        `
        const { loadStack } = require("./node_modules/firebase-functions/lib/runtime/loader.js");
        loadStack(${JSON.stringify(path.resolve("firebase/expo-lead-functions"))}).then((stack) => {
          const params = (stack.params || []).map((param) => param.name + ":" + param.type);
          const endpoint = stack.endpoints && stack.endpoints.expo_submitNasaLead;
          const bound = ((endpoint && endpoint.secretEnvironmentVariables) || []).map((secret) => secret.key);
          const ids = Object.keys(stack.endpoints || {});
          process.stdout.write(JSON.stringify({ params, bound, ids }));
        }).catch((error) => {
          console.error(error);
          process.exit(1);
        });
        `,
      ],
      { encoding: "utf8" },
    );
    const parsed = JSON.parse(output) as { params: string[]; bound: string[]; ids: string[] };
    expect(parsed.ids).toEqual(["expo_submitNasaLead"]);
    expect(parsed.bound).toEqual(["ATTIO_API_KEY"]);
    expect(parsed.params.filter((param) => param.endsWith(":secret"))).toEqual(["ATTIO_API_KEY:secret"]);
    expect(parsed.params).toEqual(expect.arrayContaining([
      "ATTIO_API_KEY:secret",
      "ATTIO_INTAKE_ENABLED:string",
      "POWER_NOW_CONFIRMATION_EMAIL_ENABLED:string",
      "POWER_NOW_CONFIRMATION_TEST_RECIPIENTS:string",
      "RECAPTCHA_ENTERPRISE_SITE_KEY:string",
    ]));
    expect(parsed.params.some((param) => param.startsWith("RESEND_API_KEY"))).toBe(false);
    expect(parsed.params.some((param) => param.startsWith("RECAPTCHA_ENTERPRISE_API_KEY"))).toBe(false);
  });
});
