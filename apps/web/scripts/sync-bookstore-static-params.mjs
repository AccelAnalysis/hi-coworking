import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, "..");
const envPath = path.join(webRoot, ".env.local");
const targetPath = path.join(webRoot, "src/app/bookstore/staticBookIds.ts");

function parseEnvFile(contents) {
  const out = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function resolveFirebaseEnv() {
  let fromFile = {};
  try {
    const envContents = await readFile(envPath, "utf8");
    fromFile = parseEnvFile(envContents);
  } catch {
    // .env.local optional in CI
  }

  return {
    projectId:
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
      fromFile.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    apiKey:
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
      fromFile.NEXT_PUBLIC_FIREBASE_API_KEY,
  };
}

function extractIds(rows) {
  return rows
    .map((row) => row?.document?.name)
    .filter(Boolean)
    .map((name) => String(name).split("/").pop())
    .filter(Boolean);
}

function toModuleContent(ids) {
  const uniqueSortedIds = Array.from(new Set(ids)).sort();
  const serialized = JSON.stringify(uniqueSortedIds, null, 2);

  return `// This file is auto-updated by scripts/sync-bookstore-static-params.mjs before build.\n// It is checked into source so static export has deterministic IDs.\nexport const STATIC_BOOKSTORE_IDS: string[] = ${serialized};\n`;
}

async function main() {
  const { projectId, apiKey } = await resolveFirebaseEnv();

  if (!projectId || !apiKey) {
    console.warn("[bookstore:sync] Missing Firebase env vars. Keeping existing staticBookIds.ts");
    return;
  }

  const endpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "books" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "published" },
            op: "EQUAL",
            value: { booleanValue: true },
          },
        },
        limit: 200,
      },
    }),
  });

  if (!response.ok) {
    console.warn(`[bookstore:sync] Firestore query failed with ${response.status}. Keeping existing staticBookIds.ts`);
    return;
  }

  const rows = await response.json();
  const ids = extractIds(Array.isArray(rows) ? rows : []);
  await writeFile(targetPath, toModuleContent(ids), "utf8");
  console.log(`[bookstore:sync] Synced ${ids.length} published book IDs.`);
}

main().catch((err) => {
  console.warn("[bookstore:sync] Failed to sync static IDs. Keeping existing file.");
  console.warn(err);
});
