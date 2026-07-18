import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const expectedPath = resolve(root, "apps/web/.env.local");
const rootPath = resolve(root, ".env.local");
const variableName = "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN";

function readToken(path) {
  if (!existsSync(path)) return null;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const raw = match[1].trim();
    if (
      raw.length >= 2
      && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))
    ) {
      return raw.slice(1, -1).trim();
    }
    return raw;
  }
  return null;
}

const expectedToken = readToken(expectedPath);
const rootToken = readToken(rootPath);

if (!existsSync(expectedPath)) {
  console.error("Mapbox environment check failed: apps/web/.env.local does not exist.");
  if (rootToken) {
    console.error("A token was found in the repository-root .env.local, but Next.js is running from apps/web.");
    console.error(`Move ${variableName} to apps/web/.env.local.`);
  } else {
    console.error(`Create apps/web/.env.local and add ${variableName}=pk.your-public-token`);
  }
  process.exit(1);
}

if (!expectedToken) {
  console.error(`Mapbox environment check failed: ${variableName} is missing or empty in apps/web/.env.local.`);
  process.exit(1);
}

if (!expectedToken.startsWith("pk.")) {
  console.error("Mapbox environment check failed: the browser map requires a public token beginning with pk.");
  console.error("Do not place a secret sk. token in a NEXT_PUBLIC_ variable.");
  process.exit(1);
}

if (expectedToken.length < 20) {
  console.error("Mapbox environment check failed: the configured public token appears incomplete.");
  process.exit(1);
}

console.log("Mapbox environment check passed.");
console.log(`- ${variableName} is present in apps/web/.env.local`);
console.log("- The token uses the required public pk. format");
console.log("Restart the Next.js development server so the browser bundle receives the token.");
