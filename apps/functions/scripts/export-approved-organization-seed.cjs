#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  CONFIGURED_DEVELOPMENT_PROJECT,
  DEFAULT_SAMPLE_LIMIT,
  SeedLifecycleError,
  assertConfiguredDevelopmentProject,
  assertDevelopmentExpansionGate,
  contentHash,
  exportApprovedRows,
  loadJsonLines,
} = require("./organization-seed-lifecycle.cjs");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const input = argument("--input");
  const output = argument("--output");
  const manifestOutput = argument("--manifest") || (output ? `${output}.manifest.json` : undefined);
  const projectId = argument("--project");
  const environment = argument("--environment") || "development";
  const restricted = process.argv.includes("--restricted");
  const allowFullDevelopment = process.argv.includes("--allow-full-development");
  const maximumLimit = allowFullDevelopment ? 10_000 : DEFAULT_SAMPLE_LIMIT;
  const limit = Number(argument("--limit") || DEFAULT_SAMPLE_LIMIT);
  if (!input || !output || !manifestOutput) {
    throw new Error("--input, --output, and --manifest are required");
  }
  assertConfiguredDevelopmentProject(projectId, environment);
  if (projectId !== CONFIGURED_DEVELOPMENT_PROJECT) {
    throw new Error(`Approved development export requires ${CONFIGURED_DEVELOPMENT_PROJECT}`);
  }
  let sampleGateManifestHash = null;
  if (allowFullDevelopment) {
    if (argument("--confirm-full-development") !== CONFIGURED_DEVELOPMENT_PROJECT) {
      throw new Error(`Full export requires --confirm-full-development ${CONFIGURED_DEVELOPMENT_PROJECT}`);
    }
    const gateFile = argument("--sample-gate-manifest");
    if (!gateFile) throw new Error("--sample-gate-manifest is required for a full development export");
    const gate = JSON.parse(fs.readFileSync(path.resolve(gateFile), "utf8"));
    assertDevelopmentExpansionGate(gate, projectId);
    sampleGateManifestHash = contentHash(gate);
  }
  for (const file of [output, manifestOutput]) {
    if (fs.existsSync(path.resolve(file))) throw new Error(`Refusing to overwrite approved export evidence: ${file}`);
  }

  const exported = exportApprovedRows(loadJsonLines(path.resolve(input)), {
    restricted,
    limit,
    maximumLimit,
  });
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(path.resolve(manifestOutput)), { recursive: true, mode: 0o700 });
  const body = `${exported.rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  fs.writeFileSync(path.resolve(output), body, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const manifest = {
    approvedExportVersion: 2,
    seedPackageVersion: 2,
    projectId,
    environment,
    generatedAt: Date.now(),
    restricted,
    approvedOnly: true,
    humanApprovalInferred: false,
    fullDevelopmentExpansion: allowFullDevelopment,
    sampleGateManifestHash,
    output: path.relative(process.cwd(), path.resolve(output)),
    approvedRowsHash: contentHash(exported.rows),
    ...exported.report,
    nextStep: "Generate the rollback snapshot and review a strict dry run before any configured-development write.",
  };
  fs.writeFileSync(path.resolve(manifestOutput), `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(manifest, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    if (error instanceof SeedLifecycleError && error.report) {
      console.error(JSON.stringify(error.report, null, 2));
    }
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { main };
