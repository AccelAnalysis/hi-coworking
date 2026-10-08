import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("expo_submitNasaLead manual deploy workflow", () => {
  const yaml = readFileSync(".github/workflows/firebase-live-expo-lead-function.yml", "utf8");
  const doc = readFileSync("docs/EXPO-NASA-2026-LEAD-CAPTURE.md", "utf8");
  const trigger = yaml.split(/^jobs:/m)[0] ?? "";

  it("is a manual confirmation on main and deploys only that function", () => {
    expect(yaml.startsWith("name: Hi Coworking Firebase expo lead function\n")).toBe(true);
    expect(trigger).toContain("workflow_dispatch:");
    expect(trigger).not.toContain("push:");
    expect(yaml).toContain('DEPLOY_CONFIRMATION}" != "deploy expo_submitNasaLead"');
    expect(yaml).toContain('GITHUB_REF}" != "refs/heads/main"');
    expect(yaml).toContain("npx firebase deploy --project hi-coworking-plat --only functions:expo_submitNasaLead --non-interactive");
    expect(yaml).not.toMatch(/--only\s+(hosting|firestore|storage|functions\s*$)/m);
    expect(yaml).not.toContain("firebase deploy --only functions\n");
    expect(yaml).toContain("hi-coworking-plat");
    expect(yaml).toContain("FIREBASE_SERVICE_ACCOUNT_HI_COWORKING_PLAT");
    expect(yaml).toContain('node-version: "20"');
    expect(yaml).toContain("npm run build:shared && npm run build:functions");
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
  });
});
