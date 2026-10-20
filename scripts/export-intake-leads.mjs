/**
 * Export Firestore intakeLeads to CSV.
 *
 * Reads with Application Default Credentials. Does not print lead rows.
 *
 *   gcloud auth application-default login
 *   node scripts/export-intake-leads.mjs --out intake-leads.csv
 *
 * Or:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json node scripts/export-intake-leads.mjs
 *
 * The CSV contains personal data. Do not commit it.
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const INTAKE_LEADS_COLLECTION = "intakeLeads";

const PREFERRED = [
  "kind",
  "clientSubmissionId",
  "submittedAt",
  "storedAt",
  "event",
  "source",
  "fullName",
  "email",
  "phoneOriginal",
  "organization",
  "companyName",
];

export function leadsToCsv(rows) {
  const flat = rows.map((row) => flattenRecord(row));
  const present = new Set(flat.flatMap((row) => Object.keys(row)));
  const headers = [
    ...PREFERRED.filter((key) => present.has(key)),
    ...[...present].filter((key) => !PREFERRED.includes(key)).sort(),
  ];
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of flat) {
    lines.push(headers.map((key) => escapeCell(row[key] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function flattenRecord(value, prefix = "", out = {}) {
  if (Array.isArray(value)) {
    const keyed = value.length > 0 && value.every((item) =>
      item && typeof item === "object" && !Array.isArray(item) && typeof item.key === "string",
    );
    if (keyed) {
      for (const item of value) {
        for (const [field, fieldValue] of Object.entries(item)) {
          if (field === "key") continue;
          assign(out, `${prefix}${item.key}.${field}`, fieldValue);
        }
      }
      return out;
    }
    assign(out, prefix.replace(/\.$/, ""), JSON.stringify(value));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenRecord(child, `${prefix}${key}.`, out);
    }
    return out;
  }
  assign(out, prefix.replace(/\.$/, ""), value);
  return out;
}

function assign(out, key, value) {
  if (!key) return;
  if (value == null) {
    out[key] = "";
    return;
  }
  out[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
}

function escapeCell(value) {
  const text = String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  if (/[",\n\r]/.test(guarded)) return `"${guarded.replace(/"/g, '""')}"`;
  return guarded;
}

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

async function main() {
  const { applicationDefault, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const projectId = readArg("project", "hi-coworking-plat");
  const out = readArg("out", "intake-leads.csv");
  initializeApp({ credential: applicationDefault(), projectId });
  const snap = await getFirestore().collection(INTAKE_LEADS_COLLECTION).get();
  const rows = snap.docs.map((doc) => doc.data());
  rows.sort((a, b) => {
    const stored = String(a.storedAt ?? "").localeCompare(String(b.storedAt ?? ""));
    if (stored !== 0) return stored;
    return String(a.clientSubmissionId ?? "").localeCompare(String(b.clientSubmissionId ?? ""));
  });
  writeFileSync(out, leadsToCsv(rows));
  console.log(`Wrote ${rows.length} leads to ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Export failed");
    process.exit(1);
  });
}
