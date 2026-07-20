#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);
const { opportunityDiscoveryRecordSchema } = require(
  "../packages/shared/dist/opportunityDiscovery.js",
);
const paths = process.argv.slice(2);

if (!paths.length) {
  console.error("Pass one or more generated fixture paths.");
  process.exit(1);
}

for (const path of paths) {
  const absolute = resolve(path);
  const payload = JSON.parse(await readFile(absolute, "utf8"));
  if (payload.synthetic !== true || !Array.isArray(payload.records)) {
    throw new Error(`${path}: fixture must be explicitly synthetic and contain records`);
  }
  if (payload.count !== payload.records.length) {
    throw new Error(`${path}: declared count does not match record count`);
  }
  const ids = new Set();
  payload.records.forEach((record, index) => {
    const parsed = opportunityDiscoveryRecordSchema.safeParse(record);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(
        `${path}: record ${index} is invalid at ${issue?.path.join(".")}: ${issue?.message}`,
      );
    }
    if (ids.has(parsed.data.id)) throw new Error(`${path}: duplicate id ${parsed.data.id}`);
    ids.add(parsed.data.id);
    if (record.synthetic !== true || !parsed.data.id.startsWith("synthetic-rfx-")) {
      throw new Error(`${path}: record ${index} is not safely namespaced synthetic data`);
    }
    if (!parsed.data.geo && !["withheld", "remote", "not_geocoded"].includes(
      parsed.data.locationConfidence,
    )) {
      throw new Error(`${path}: record ${parsed.data.id} lacks coordinates without an explicit no-marker state`);
    }
  });
  console.log(`Validated ${payload.records.length.toLocaleString("en-US")} synthetic records in ${path}.`);
}
