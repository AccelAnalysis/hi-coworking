import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Option A (Jonathan, Oct 31, 2026): the Seam door-code functions deploy from
// their own source, which needs only the two Seam secrets.

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

const ACCESS_IDS = ["access_adminResendPin", "access_getMyGrants", "access_seamWebhook"];

describe("isolated access (Seam) functions deploy", () => {
  const config = JSON.parse(readFileSync("firebase.access.json", "utf8"));
  const pkg = JSON.parse(readFileSync("firebase/access-functions/package.json", "utf8"));

  it("deploys into the default codebase, where the functions already run, from its own source", () => {
    expect(config.functions.source).toBe("firebase/access-functions");
    expect(config.functions.codebase).toBeUndefined();
    expect(config.functions.region).toBe("us-central1");
    expect(config.functions.predeploy).toEqual([
      "rm -rf firebase/access-functions/lib",
      "npm run build --workspace functions -- --project ../../firebase/access-functions/tsconfig.json",
    ]);
    expect(pkg.main).toBe("lib/firebase/access-functions/src/index.js");
    expect(readFileSync(".gitignore", "utf8")).toContain("firebase/access-functions/lib/");
  });

  it("never loads the Twilio, LinkedIn, X or Stripe modules", () => {
    const files = loadGraph("firebase/access-functions/src/index.ts");
    expect(files.some((file) => file.endsWith(`apps${path.sep}functions${path.sep}src${path.sep}access.ts`))).toBe(true);
    for (const banned of ["eventMarketing.ts", "smsProvider.ts", "main.ts", `src${path.sep}index.ts`, "stripeWebhook.ts", "bookingManagement.ts"]) {
      expect(files.some((file) => file.endsWith(`apps${path.sep}functions${path.sep}src${path.sep}${banned}`))).toBe(false);
    }
    const literal = files.flatMap((file) => [...readFileSync(file, "utf8").matchAll(LITERAL_SECRET_RE)].map((m) => m[1]));
    expect(literal.sort()).toEqual(["SEAM_API_KEY", "SEAM_WEBHOOK_SECRET"]);
  });

  it("emits a Firebase manifest whose only secrets are the two Seam secrets", () => {
    expect(existsSync("firebase/access-functions/lib/firebase/access-functions/src/index.js")).toBe(true);
    const output = execFileSync(
      process.execPath,
      [
        "-e",
        `
        const { loadStack } = require("./node_modules/firebase-functions/lib/runtime/loader.js");
        loadStack(${JSON.stringify(path.resolve("firebase/access-functions"))}).then((stack) => {
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
    expect(parsed.ids).toEqual(ACCESS_IDS);
    expect(parsed.params.sort()).toEqual(["SEAM_API_KEY:secret", "SEAM_WEBHOOK_SECRET:secret"]);
    expect(parsed.bound.access_getMyGrants).toEqual(["SEAM_API_KEY"]);
    expect(parsed.bound.access_adminResendPin).toEqual(["SEAM_API_KEY"]);
    expect(parsed.bound.access_seamWebhook.sort()).toEqual(["SEAM_API_KEY", "SEAM_WEBHOOK_SECRET"]);
    expect(output).not.toMatch(/TWILIO|LINKEDIN|X_CLIENT|STRIPE|RESEND/);
  });

  it("adds no root package.json script and no deploy workflow", () => {
    const root = JSON.parse(readFileSync("package.json", "utf8"));
    expect(JSON.stringify(root.scripts)).not.toContain("access-functions");
    expect(existsSync(".github/workflows/firebase-live-access-functions.yml")).toBe(false);
  });
});
