#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return { __error: error instanceof Error ? error.message : String(error) };
  }
}

function redactPresence(value) {
  return Boolean(value && String(value).trim());
}

const cwd = process.cwd();
const envFile = path.resolve(arg("--env-file") || "apps/web/.env.local");
const firebasercPath = path.resolve(arg("--firebaserc") || ".firebaserc");
const requestedProject = arg("--project") || process.env.EXCHANGE_DEV_PROJECT_ID || "hi-coworking-plat";
const strict = hasFlag("--strict");
const jsonOnly = hasFlag("--json");

const envFileValues = parseEnvFile(envFile);
const env = { ...envFileValues, ...process.env };
const firebaserc = fs.existsSync(firebasercPath) ? readJson(firebasercPath) : {};
const aliases = firebaserc.projects || {};
const configuredProject = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";
const expectedProject = env.NEXT_PUBLIC_EXPECTED_FIREBASE_PROJECT_ID || requestedProject;
const emulatorEnabled = String(env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR || "").toLowerCase() === "true";
const mapboxToken = env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";

const checks = [];
function addCheck(id, level, ok, message, remediation) {
  checks.push({ id, level, ok, message, remediation: ok ? undefined : remediation });
}

addCheck(
  "env_file",
  "blocker",
  fs.existsSync(envFile),
  fs.existsSync(envFile) ? `Environment file found at ${path.relative(cwd, envFile)}` : `Environment file is missing at ${path.relative(cwd, envFile)}`,
  "Copy apps/web/.env.example to apps/web/.env.local and populate the configured-development Firebase public values.",
);

addCheck(
  "firebase_public_config",
  "blocker",
  [
    "NEXT_PUBLIC_FIREBASE_API_KEY",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
    "NEXT_PUBLIC_FIREBASE_APP_ID",
  ].every((key) => redactPresence(env[key])),
  "Required Firebase browser configuration is present.",
  "Populate all NEXT_PUBLIC_FIREBASE_* values in the selected environment file. Public Firebase browser configuration is not a secret, but it must match the intended project.",
);

addCheck(
  "project_match",
  "blocker",
  Boolean(configuredProject) && configuredProject === expectedProject && expectedProject === requestedProject,
  configuredProject
    ? `Configured project ${configuredProject} matches the expected development project.`
    : "No Firebase project is configured in the browser environment.",
  `Set NEXT_PUBLIC_FIREBASE_PROJECT_ID and NEXT_PUBLIC_EXPECTED_FIREBASE_PROJECT_ID to ${requestedProject}.`,
);

addCheck(
  "emulator_disabled_for_configured_development",
  "warning",
  !emulatorEnabled,
  emulatorEnabled
    ? "Firebase emulator mode is enabled; this will not exercise the configured development project."
    : "Firebase emulator mode is disabled for configured-development acceptance.",
  "Set NEXT_PUBLIC_USE_FIREBASE_EMULATOR=false for configured-development smoke testing. Keep emulator mode enabled for local isolated testing.",
);

addCheck(
  "mapbox_public_token",
  "warning",
  mapboxToken.startsWith("pk."),
  mapboxToken.startsWith("pk.")
    ? "A Mapbox public browser token is configured."
    : "A valid Mapbox public browser token was not detected.",
  "Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN to a public token beginning with pk. Never place an sk. token in browser configuration.",
);

addCheck(
  "firebase_alias",
  "warning",
  aliases.default === requestedProject,
  aliases.default
    ? `.firebaserc default alias points to ${aliases.default}.`
    : ".firebaserc does not define a default project alias.",
  `Ensure the intended development command explicitly targets --project ${requestedProject}; do not rely only on the default alias.`,
);

const sharedProject = Boolean(aliases.default && aliases.prod && aliases.default === aliases.prod);
addCheck(
  "shared_project_warning",
  "warning",
  !sharedProject,
  sharedProject
    ? `The default and prod Firebase aliases both point to ${aliases.default}. Development writes therefore require explicit confirmation and a reviewed rollback plan.`
    : "Development and production aliases are separated.",
  "Continue using dry-run-first tooling and explicit --confirm-development flags. Do not run development seed or bootstrap commands through an implicit Firebase alias.",
);

const blockers = checks.filter((check) => check.level === "blocker" && !check.ok);
const warnings = checks.filter((check) => check.level === "warning" && !check.ok);
const report = {
  generatedAt: new Date().toISOString(),
  workingDirectory: cwd,
  envFile: path.relative(cwd, envFile),
  requestedProject,
  configuredProject: configuredProject || null,
  expectedProject: expectedProject || null,
  emulatorEnabled,
  sharedProject,
  publicConfigPresence: {
    apiKey: redactPresence(env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: redactPresence(env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: redactPresence(env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    storageBucket: redactPresence(env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: redactPresence(env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
    appId: redactPresence(env.NEXT_PUBLIC_FIREBASE_APP_ID),
    mapboxPublicToken: mapboxToken.startsWith("pk."),
  },
  checks,
  summary: {
    readyForConfiguredDevelopmentSmoke: blockers.length === 0,
    blockers: blockers.length,
    warnings: warnings.length,
    strict,
  },
};

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("Exchange configured-development readiness\n");
  for (const check of checks) {
    const marker = check.ok ? "PASS" : check.level === "blocker" ? "BLOCK" : "WARN";
    console.log(`[${marker}] ${check.message}`);
    if (!check.ok && check.remediation) console.log(`       ${check.remediation}`);
  }
  console.log(`\nBlockers: ${blockers.length}; warnings: ${warnings.length}`);
  console.log(blockers.length === 0
    ? "Configured-development smoke testing can proceed. Advisory warnings do not block local development."
    : "Resolve blockers before treating a configured-development smoke result as valid. Local emulator development remains available.");
}

if (strict && blockers.length > 0) process.exitCode = 1;
