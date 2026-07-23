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
const sharedDist = resolve(root, "packages/shared/dist");
const stagingRoot = resolve(root, ".firebase-deploy/exchange-workstream-functions");
const markerPath = resolve(stagingRoot, ".exchange-workstream-functions-package.json");
const expectedEndpoints = [
  "businessReferral_confirmConsent",
  "businessReferral_create",
  "businessReferral_createDispute",
  "businessReferral_getDetail",
  "businessReferral_listMine",
  "businessReferral_listTimeline",
  "businessReferral_prepareEvidenceAccess",
  "businessReferral_progress",
  "businessReferral_reportTransaction",
  "businessReferral_resolveDispute",
  "businessReferral_respond",
  "businessReferral_reviewTransaction",
  "businessReferral_send",
  "businessReferral_suggestRecipients",
  "businessReferral_updateConsent",
  "businessReferral_withdrawConsent",
  "referralIntelligence_getEconomicImpact",
  "referralIntelligence_getGapAnalysis",
  "referralIntelligence_getOverview",
  "referralIntelligence_getReciprocalPatterns",
  "referralIntelligence_listRelationships",
  "referralServiceOffer_create",
  "referralServiceOffer_createVersion",
  "referralServiceOffer_deactivate",
  "referralServiceOffer_listDiscoverable",
  "referralServiceOffer_listMine",
  "referralServiceOffer_publish",
  "rfx_listManaged",
  "territory_list_released",
].sort();

const manifest = {
  endpoints: Object.fromEntries(expectedEndpoints.map((endpoint) => [endpoint, {
    platform: "gcfv2",
    callableTrigger: {},
    entryPoint: endpoint,
  }])),
  specVersion: "v1alpha1",
  requiredAPIs: [],
  extensions: {},
  params: [],
};

const allowedRuntimePackages = new Set([
  "@hi/shared",
  "firebase-admin",
  "firebase-functions",
  "zod",
]);
const forbiddenFunctionModules = new Set([
  "adminMarketingEmail.js",
  "bookstore.js",
  "digitalFulfillment.js",
  "eventMarketing.js",
  "eventMedia.js",
  "eventSeries.js",
  "events.js",
  "exchangeStripe.js",
  "referralFinance.js",
]);

function packageName(specifier) {
  if (specifier.startsWith("node:")) return specifier;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function runtimeRequires(source) {
  return [...source.matchAll(/require\(["']([^"']+)["']\)/g)].map((match) => match[1]);
}

function resolveLocalModule(importer, specifier) {
  const direct = resolve(dirname(importer), specifier);
  for (const candidate of [direct, `${direct}.js`, resolve(direct, "index.js")]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing local runtime dependency ${specifier} imported by ${importer}`);
}

function discoverCompiledClosure(entryFile) {
  const pending = [entryFile];
  const discovered = new Set();
  while (pending.length) {
    const current = pending.pop();
    const relativePath = relative(sourceLib, current);
    if (!relativePath || relativePath.startsWith("..") || relativePath.startsWith("/")) {
      throw new Error(`Refusing compiled dependency outside Functions lib: ${current}`);
    }
    if (discovered.has(relativePath)) continue;
    if (forbiddenFunctionModules.has(relativePath)) {
      throw new Error(`Refusing forbidden Function module in Exchange closure: ${relativePath}`);
    }
    const source = readFileSync(current, "utf8");
    for (const specifier of runtimeRequires(source)) {
      if (specifier.startsWith(".")) {
        pending.push(resolveLocalModule(current, specifier));
        continue;
      }
      const dependency = packageName(specifier);
      if (!dependency.startsWith("node:") && !allowedRuntimePackages.has(dependency)) {
        throw new Error(`Refusing unreviewed runtime package ${dependency} imported by ${relativePath}`);
      }
    }
    discovered.add(relativePath);
  }
  return [...discovered].sort();
}

function copyCompiledFiles(compiledFiles) {
  for (const relativePath of compiledFiles) {
    const destination = resolve(stagingRoot, "lib", relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(sourceLib, relativePath), destination);
  }
}

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
      .filter((file) => file !== ".exchange-workstream-functions-package.json")
      .map((file) => [
        file,
        createHash("sha256").update(readFileSync(resolve(stagingRoot, file))).digest("hex"),
      ]),
  );
}

function validatePackage() {
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  if (
    marker.contractVersion !== 1
    || JSON.stringify(marker.endpoints) !== JSON.stringify(expectedEndpoints)
    || JSON.stringify(marker.compiledFiles) !== JSON.stringify(listRelativeFiles(resolve(stagingRoot, "lib")))
  ) {
    throw new Error("Refusing an unrecognized Exchange workstream deployment package");
  }
  const actualManifest = JSON.parse(readFileSync(resolve(stagingRoot, "functions.yaml"), "utf8"));
  if (JSON.stringify(actualManifest) !== JSON.stringify(manifest)) {
    throw new Error("Refusing Exchange package whose exact Function manifest changed");
  }
  const packageJson = JSON.parse(readFileSync(resolve(stagingRoot, "package.json"), "utf8"));
  const dependencyNames = Object.keys(packageJson.dependencies || {}).sort();
  if (
    packageJson.main !== "lib/exchangeWorkstreamFirebaseEntry.js"
    || packageJson.dependencies?.["@hi/shared"] !== "file:./vendor/shared"
    || JSON.stringify(dependencyNames) !== JSON.stringify([
      "@hi/shared", "firebase-admin", "firebase-functions", "zod",
    ])
  ) {
    throw new Error("Refusing Exchange package with an unsafe runtime dependency contract");
  }
  const sharedPackage = JSON.parse(readFileSync(resolve(stagingRoot, "vendor/shared/package.json"), "utf8"));
  if (sharedPackage.name !== "@hi/shared" || sharedPackage.main !== "dist/index.js") {
    throw new Error("Refusing Exchange package without the reviewed compiled shared contract");
  }
  if (JSON.stringify(marker.artifactHashes) !== JSON.stringify(artifactHashes())) {
    throw new Error("Refusing Exchange package whose staged artifact content changed");
  }
}

const operation = process.argv[2];
if (operation === "generate") {
  if (existsSync(stagingRoot)) throw new Error(`Refusing to overwrite existing package: ${stagingRoot}`);
  for (const required of [
    resolve(sourceLib, "exchangeWorkstreamFirebaseEntry.js"),
    resolve(sharedDist, "index.js"),
    resolve(sharedDist, "opportunityDiscovery.js"),
    resolve(sharedDist, "exchangeOrganizationContext.js"),
    resolve(sharedDist, "organizationEstablishments.js"),
  ]) {
    if (!existsSync(required)) throw new Error(`Build the Functions/shared packages first; missing ${required}`);
  }
  const compiledFiles = discoverCompiledClosure(resolve(sourceLib, "exchangeWorkstreamFirebaseEntry.js"));
  mkdirSync(stagingRoot, { recursive: true });
  copyCompiledFiles(compiledFiles);
  mkdirSync(resolve(stagingRoot, "vendor/shared/dist"), { recursive: true });
  for (const file of readdirSync(sharedDist)) {
    if (!file.endsWith(".js") || file.endsWith(".test.js")) continue;
    copyFileSync(resolve(sharedDist, file), resolve(stagingRoot, "vendor/shared/dist", file));
  }
  const sourcePackage = JSON.parse(readFileSync(resolve(root, "apps/functions/package.json"), "utf8"));
  const dependencies = Object.fromEntries(
    ["firebase-admin", "firebase-functions", "zod"].map((name) => [name, sourcePackage.dependencies[name]]),
  );
  dependencies["@hi/shared"] = "file:./vendor/shared";
  writeFileSync(resolve(stagingRoot, "package.json"), `${JSON.stringify({
    name: "hi-coworking-exchange-workstream-functions-deployment",
    private: true,
    main: "lib/exchangeWorkstreamFirebaseEntry.js",
    engines: { node: "20" },
    dependencies,
  }, null, 2)}\n`);
  writeFileSync(resolve(stagingRoot, "vendor/shared/package.json"), `${JSON.stringify({
    name: "@hi/shared",
    private: true,
    version: "0.0.0",
    main: "dist/index.js",
    exports: {
      ".": "./dist/index.js",
      "./opportunity-discovery": "./dist/opportunityDiscovery.js",
      "./exchange-organization-context": "./dist/exchangeOrganizationContext.js",
      "./organization-establishments": "./dist/organizationEstablishments.js",
    },
    dependencies: { zod: sourcePackage.dependencies.zod },
  }, null, 2)}\n`);
  writeFileSync(resolve(stagingRoot, "functions.yaml"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(markerPath, `${JSON.stringify({
    contractVersion: 1,
    endpoints: expectedEndpoints,
    compiledFiles,
    artifactHashes: artifactHashes(),
  }, null, 2)}\n`);
  validatePackage();
  process.stdout.write(`Generated validated Exchange workstream package: ${stagingRoot}\n`);
} else if (operation === "clean") {
  if (!existsSync(stagingRoot)) {
    process.stdout.write("Exchange workstream package is already absent.\n");
    process.exit(0);
  }
  validatePackage();
  rmSync(stagingRoot, { recursive: true });
  process.stdout.write(`Removed validated Exchange workstream package: ${stagingRoot}\n`);
} else {
  throw new Error("Usage: node scripts/exchange-workstream-functions-package.mjs <generate|clean>");
}
