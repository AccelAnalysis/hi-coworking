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
  const failures = [];
  const duplicateKeys = (indexes) => {
    const seen = new Set();
    const duplicates = new Set();
    for (const index of indexes) {
      const key = canonical(index);
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }
    return [...duplicates];
  };
  for (const [label, indexes] of [["manifest", manifest.indexes], ["target", target.indexes]]) {
    for (const duplicate of duplicateKeys(indexes)) {
      failures.push(`${label} contains a duplicate index: ${duplicate}`);
    }
  }
  for (const index of manifest.indexes) {
    if (index.queryScope !== "COLLECTION") {
      failures.push(`${index.collectionGroup} must use COLLECTION query scope`);
    }
    if (!Array.isArray(index.fields) || index.fields.length < 2) {
      failures.push(`${index.collectionGroup} must declare at least two ordered fields`);
      continue;
    }
    if (index.fields.filter((field) => field.arrayConfig).length > 1) {
      failures.push(`${index.collectionGroup} declares more than one array field`);
    }
    const nameField = index.fields.findIndex((field) => field.fieldPath === "__name__");
    if (nameField >= 0 && nameField !== index.fields.length - 1) {
      failures.push(`${index.collectionGroup} must place __name__ last`);
    }
    if (index.collectionGroup === "opportunityDiscovery") {
      const last = index.fields.at(-1);
      const sort = index.fields.at(-2);
      if (last?.fieldPath !== "__name__" || last.order !== sort?.order) {
        failures.push("opportunityDiscovery cursor direction must match its primary sort direction");
      }
    }
  }
  for (const index of missing) {
    failures.push(`missing ${index.collectionGroup} index: ${canonical(index)}`);
  }
  const ownedGroups = new Set([
    "opportunityDiscovery",
    "opportunitySavedSearches",
    "opportunityRecentSearches",
    "rfxAddenda",
    "rfxQuestions",
  ]);
  const manifestKeys = new Set(manifest.indexes.map(canonical));
  for (const index of target.indexes) {
    if (ownedGroups.has(index.collectionGroup) && !manifestKeys.has(canonical(index))) {
      failures.push(`obsolete ${index.collectionGroup} index: ${canonical(index)}`);
    }
  }
  if (failures.length) {
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(`Validated ${manifest.indexes.length} opportunity-discovery indexes: present, unique, ordered, and current.`);
  process.exit(0);
}

const merged = {
  ...target,
  indexes: [...target.indexes, ...missing],
  fieldOverrides: Array.isArray(target.fieldOverrides) ? target.fieldOverrides : [],
};
await writeFile(targetPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
console.log(`Added ${missing.length} opportunity-discovery indexes to firestore.indexes.json.`);
