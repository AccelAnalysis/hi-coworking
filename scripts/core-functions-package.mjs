import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceLib = resolve(root, "apps/functions/lib");
const stagingRoot = resolve(root, ".firebase-deploy/account-profile-functions");
const markerPath = resolve(stagingRoot, ".core-functions-package.json");
const expectedEndpoints = [
  "account_initialize",
  "enrichment_link",
  "enrichment_search",
  "exchange_adminGetOrganizationClaim",
  "exchange_adminListOrganizationClaims",
  "exchange_adminReviewOrganizationClaim",
  "exchange_getOrganizationResourceStatus",
  "exchange_listActorOrganizations",
  "exchange_organizationCreate",
  "exchange_organizationDirectory",
  "exchange_organizationListMyClaims",
  "exchange_organizationRequestClaim",
  "exchange_organizationSearch",
  "exchange_requestOrganizationContact",
  "exchange_requestOrganizationIntroduction",
  "exchange_resolveOrganizationPerspective",
  "exchange_saveOrganization",
  "profile_update",
].sort();
const compiledFiles = [
  "coreFirebaseEntry.js",
  "accounts.js",
  "profiles.js",
  "enrichment.js",
  "enrichmentLegacy.js",
  "enrichmentSearch.js",
  "providers/samGovClient.js",
  "profileModel.js",
  "exchange/contracts.js",
  "exchange/security.js",
  "exchange/publicProfiles.js",
  "exchange/organizationModel.js",
  "exchange/organizationPerspective.js",
  "exchange/organizationWorkspace.js",
  "exchange/organizations.js",
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
    exchange_organizationSearch: { platform: "gcfv2", callableTrigger: {}, entryPoint: "exchange_organizationSearch" },
    exchange_organizationCreate: { platform: "gcfv2", callableTrigger: {}, entryPoint: "exchange_organizationCreate" },
    exchange_organizationRequestClaim: { platform: "gcfv2", callableTrigger: {}, entryPoint: "exchange_organizationRequestClaim" },
    exchange_organizationListMyClaims: { platform: "gcfv2", callableTrigger: {}, entryPoint: "exchange_organizationListMyClaims" },
    exchange_adminListOrganizationClaims: { platform: "gcfv2", callableTrigger: {}, entryPoint: "exchange_adminListOrganizationClaims" },
    exchange_adminGetOrganizationClaim: { platform: "gcfv2", callableTrigger: {}, entryPoint: "exchange_adminGetOrganizationClaim" },
    exchange_adminReviewOrganizationClaim: { platform: "gcfv2", callableTrigger: {}, entryPoint: "exchange_adminReviewOrganizationClaim" },
    exchange_listActorOrganizations: { platform: "gcfv2", callableTrigger: {}, entryPoint: "exchange_listActorOrganizations" },
    exchange_resolveOrganizationPerspective: { platform: "gcfv2", callableTrigger: {}, entryPoint: "exchange_resolveOrganizationPerspective" },
    exchange_organizationDirectory: { platform: "gcfv2", callableTrigger: {}, entryPoint: "exchange_organizationDirectory" },
    exchange_saveOrganization: { platform: "gcfv2", callableTrigger: {}, entryPoint: "exchange_saveOrganization" },
    exchange_requestOrganizationContact: { platform: "gcfv2", callableTrigger: {}, entryPoint: "exchange_requestOrganizationContact" },
    exchange_requestOrganizationIntroduction: { platform: "gcfv2", callableTrigger: {}, entryPoint: "exchange_requestOrganizationIntroduction" },
    exchange_getOrganizationResourceStatus: { platform: "gcfv2", callableTrigger: {}, entryPoint: "exchange_getOrganizationResourceStatus" },
  },
  specVersion: "v1alpha1",
  requiredAPIs: [],
  extensions: {},
  params: [{ type: "secret", name: "SAM_GOV_API_KEY" }],
};

function listRelativeFiles(rootDirectory, current = rootDirectory) {
  if (!existsSync(current)) return [];
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const target = resolve(current, entry.name);
    return entry.isDirectory()
      ? listRelativeFiles(rootDirectory, target)
      : [relative(rootDirectory, target)];
  }).sort();
}

function artifactHashes() {
  return Object.fromEntries(
    listRelativeFiles(stagingRoot)
      .filter((file) => file !== ".core-functions-package.json")
      .map((file) => [
        file,
        createHash("sha256").update(readFileSync(resolve(stagingRoot, file))).digest("hex"),
      ]),
  );
}

function validatePackage() {
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  if (
    marker.contractVersion !== 3
    || JSON.stringify(marker.endpoints) !== JSON.stringify(expectedEndpoints)
    || JSON.stringify(marker.compiledFiles) !== JSON.stringify(listRelativeFiles(resolve(stagingRoot, "lib")))
  ) {
    throw new Error("Refusing an unrecognized core deployment package");
  }
  const actualManifest = JSON.parse(readFileSync(resolve(stagingRoot, "functions.yaml"), "utf8"));
  if (JSON.stringify(actualManifest) !== JSON.stringify(manifest)) {
    throw new Error("Refusing core package whose exact Function manifest changed");
  }
  const packageJson = JSON.parse(readFileSync(resolve(stagingRoot, "package.json"), "utf8"));
  const dependencyNames = Object.keys(packageJson.dependencies || {}).sort();
  if (
    packageJson.main !== "lib/coreFirebaseEntry.js"
    || JSON.stringify(dependencyNames) !== JSON.stringify([
      "firebase-admin", "firebase-functions", "zod",
    ])
  ) {
    throw new Error("Refusing core package with an unsafe runtime dependency contract");
  }
  if (JSON.stringify(marker.artifactHashes) !== JSON.stringify(artifactHashes())) {
    throw new Error("Refusing core package whose staged artifact content changed");
  }
}

const operation = process.argv[2];
if (operation === "generate") {
  if (existsSync(stagingRoot)) throw new Error(`Refusing to overwrite existing package: ${stagingRoot}`);
  const compiledSources = compiledFiles.map((relativePath) => ({
    relativePath,
    source: resolve(sourceLib, relativePath),
  }));
  for (const { source } of compiledSources) {
    if (!existsSync(source)) throw new Error(`Build the Functions package first; missing ${source}`);
  }
  for (const { relativePath, source } of compiledSources) {
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
  writeFileSync(markerPath, `${JSON.stringify({
    contractVersion: 3,
    endpoints: expectedEndpoints,
    compiledFiles: listRelativeFiles(resolve(stagingRoot, "lib")),
    artifactHashes: artifactHashes(),
  }, null, 2)}\n`);
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
