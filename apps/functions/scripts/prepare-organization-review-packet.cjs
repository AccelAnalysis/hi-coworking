#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  SeedLifecycleError,
  contentHash,
  createReviewPacket,
  loadJsonLines,
} = require("./organization-seed-lifecycle.cjs");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function writeProtectedJsonLines(file, rows) {
  fs.writeFileSync(
    file,
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

function main() {
  const organizationsFile = argument("--organizations");
  const targetingFile = argument("--targeting");
  const outputDirectory = path.resolve(argument("--output-dir") || "data/seed/prepared/review");
  if (!organizationsFile || !targetingFile) {
    throw new Error("--organizations and --targeting are required");
  }
  fs.mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const organizationOutput = path.join(outputDirectory, "organization-review-packet.jsonl");
  const targetingOutput = path.join(outputDirectory, "restricted-matching-review-packet.jsonl");
  const manifestOutput = path.join(outputDirectory, "review-packet-manifest.json");
  for (const file of [organizationOutput, targetingOutput, manifestOutput]) {
    if (fs.existsSync(file)) {
      throw new Error(`Refusing to overwrite generated review evidence: ${file}`);
    }
  }

  const organizations = createReviewPacket(loadJsonLines(path.resolve(organizationsFile)));
  const targeting = createReviewPacket(loadJsonLines(path.resolve(targetingFile)), { restricted: true });
  writeProtectedJsonLines(organizationOutput, organizations.rows);
  writeProtectedJsonLines(targetingOutput, targeting.rows);
  const manifest = {
    reviewPacketVersion: 1,
    seedPackageVersion: 2,
    generatedAt: Date.now(),
    humanApprovalInferred: false,
    protectedArtifact: true,
    organizations: {
      ...organizations.report,
      file: path.relative(process.cwd(), organizationOutput),
      candidateSetHash: contentHash(organizations.rows.map((row) => row.reviewCandidateHash)),
    },
    restrictedMatching: {
      ...targeting.report,
      file: path.relative(process.cwd(), targetingOutput),
      candidateSetHash: contentHash(targeting.rows.map((row) => row.reviewCandidateHash)),
    },
    nextStep: "A human reviewer must approve rows explicitly. Automated preparation never opens the import gate.",
  };
  fs.writeFileSync(manifestOutput, `${JSON.stringify(manifest, null, 2)}\n`, {
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

module.exports = { writeProtectedJsonLines };
