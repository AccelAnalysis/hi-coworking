#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const root = process.cwd();
const targetPath = resolve(root, "firestore.indexes.json");
const manifestPath = resolve(root, "docs/exchange/opportunity-discovery-firestore-indexes.json");
const checkOnly = process.argv.includes("--check");

const target = JSON.parse(await readFile(targetPath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (!Array.isArray(target.indexes) || !Array.isArray(manifest.indexes)) {
  throw new Error("Both index files must contain an indexes array");
}

function canonical(index) {
  return JSON.stringify({
    collectionGroup: index.collectionGroup,
    queryScope: index.queryScope ?? "COLLECTION",
    fields: (index.fields ?? []).map((field) => ({
      fieldPath: field.fieldPath,
      ...(field.order ? { order: field.order } : {}),
      ...(field.arrayConfig ? { arrayConfig: field.arrayConfig } : {}),
    })),
  });
}

const existing = new Set(target.indexes.map(canonical));
const missing = manifest.indexes.filter((index) => !existing.has(canonical(index)));
if (checkOnly) {
  if (missing.length) {
    console.error(`${missing.length} opportunity-discovery indexes are missing from firestore.indexes.json.`);
    for (const index of missing) console.error(`- ${index.collectionGroup}: ${canonical(index)}`);
    process.exit(1);
  }
  console.log("All opportunity-discovery indexes are present in firestore.indexes.json.");
  process.exit(0);
}

const merged = {
  ...target,
  indexes: [...target.indexes, ...missing],
  fieldOverrides: Array.isArray(target.fieldOverrides) ? target.fieldOverrides : [],
};
await writeFile(targetPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
console.log(`Added ${missing.length} opportunity-discovery indexes to firestore.indexes.json.`);
