import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceLib = resolve(root, "apps/functions/lib");
const stagingRoot = resolve(root, ".firebase-deploy/account-profile-functions");
const markerPath = resolve(stagingRoot, ".core-functions-package.json");
const expectedEndpoints = [
  "account_initialize",
  "enrichment_link",
  "enrichment_search",
  "profile_update",
];
const compiledFiles = [
  "coreFirebaseEntry.js",
  "accounts.js",
  "profiles.js",
  "enrichment.js",
  "profileModel.js",
  "exchange/contracts.js",
  "exchange/security.js",
  "exchange/publicProfiles.js",
];

const manifest = {
  endpoints: {
    account_initialize: { platform: "gcfv2", callableTrigger: {}, entryPoint: "account_initialize" },
    profile_update: { platform: "gcfv2", callableTrigger: {}, entryPoint: "profile_update" },
    enrichment_search: {
      platform: "gcfv2",
      callableTrigger: {},
      entryPoint: "enrichment_search",
      secretEnvironmentVariables: [{ key: "SAM_GOV_API_KEY" }],
    },
    enrichment_link: { platform: "gcfv2", callableTrigger: {}, entryPoint: "enrichment_link" },
  },
  specVersion: "v1alpha1",
  requiredAPIs: [],
  extensions: {},
  params: [{ type: "secret", name: "SAM_GOV_API_KEY" }],
};

function validatePackage() {
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  if (marker.contractVersion !== 1 || JSON.stringify(marker.endpoints) !== JSON.stringify(expectedEndpoints)) {
    throw new Error("Refusing an unrecognized core deployment package");
  }
  const actualManifest = JSON.parse(readFileSync(resolve(stagingRoot, "functions.yaml"), "utf8"));
  const endpoints = Object.keys(actualManifest.endpoints || {}).sort();
  if (JSON.stringify(endpoints) !== JSON.stringify(expectedEndpoints)) {
    throw new Error(`Refusing core package with endpoints: ${endpoints.join(", ")}`);
  }
  const packageJson = JSON.parse(readFileSync(resolve(stagingRoot, "package.json"), "utf8"));
  if (packageJson.main !== "lib/coreFirebaseEntry.js" || "@hi/shared" in (packageJson.dependencies || {})) {
    throw new Error("Refusing core package with an unsafe runtime dependency contract");
  }
}

const operation = process.argv[2];
if (operation === "generate") {
  if (existsSync(stagingRoot)) throw new Error(`Refusing to overwrite existing package: ${stagingRoot}`);
  for (const relativePath of compiledFiles) {
    const source = resolve(sourceLib, relativePath);
    if (!existsSync(source)) throw new Error(`Build the Functions package first; missing ${source}`);
    const destination = resolve(stagingRoot, "lib", relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  const sourcePackage = JSON.parse(readFileSync(resolve(root, "apps/functions/package.json"), "utf8"));
  const dependencies = Object.fromEntries(
    ["firebase-admin", "firebase-functions", "zod"].map((name) => [name, sourcePackage.dependencies[name]]),
  );
  writeFileSync(resolve(stagingRoot, "package.json"), `${JSON.stringify({
    name: "hi-coworking-core-functions-deployment",
    private: true,
    main: "lib/coreFirebaseEntry.js",
    engines: { node: "20" },
    dependencies,
  }, null, 2)}\n`);
  writeFileSync(resolve(stagingRoot, "functions.yaml"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(markerPath, `${JSON.stringify({ contractVersion: 1, endpoints: expectedEndpoints }, null, 2)}\n`);
  validatePackage();
  process.stdout.write(`Generated validated core deployment package: ${stagingRoot}\n`);
} else if (operation === "clean") {
  if (!existsSync(stagingRoot)) {
    process.stdout.write("Core deployment package is already absent.\n");
    process.exit(0);
  }
  validatePackage();
  rmSync(stagingRoot, { recursive: true });
  process.stdout.write(`Removed validated core deployment package: ${stagingRoot}\n`);
} else {
  throw new Error("Usage: node scripts/core-functions-package.mjs <generate|clean>");
}
