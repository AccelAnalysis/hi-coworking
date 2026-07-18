import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const expectedPath = resolve(root, "apps/web/.env.local");
const rootPath = resolve(root, ".env.local");
const variableName = "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN";
const styleEndpoint = "https://api.mapbox.com/styles/v1/mapbox/streets-v12";

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

function fingerprintToken(token) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `pk-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function requestedOrigin() {
  const argument = process.argv.find((value) => value.startsWith("--origin="));
  return argument?.slice("--origin=".length)
    || process.env.MAPBOX_TEST_ORIGIN
    || "http://localhost:3000/";
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

let origin;
try {
  origin = new URL(requestedOrigin());
} catch {
  console.error("Mapbox environment check failed: --origin must be a complete HTTP(S) URL.");
  process.exit(1);
}

if (origin.protocol !== "http:" && origin.protocol !== "https:") {
  console.error("Mapbox environment check failed: the test origin must use HTTP or HTTPS.");
  process.exit(1);
}

const referer = `${origin.origin}/`;
const fingerprint = fingerprintToken(expectedToken);
const url = `${styleEndpoint}?access_token=${encodeURIComponent(expectedToken)}&fresh=true`;

console.log("Mapbox environment file check passed.");
console.log(`- token fingerprint: ${fingerprint}`);
console.log(`- tested browser origin: ${referer}`);
console.log("- checking Mapbox Streets v12 access…");

let response;
try {
  response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Referer: referer,
    },
  });
} catch (error) {
  console.error(`Mapbox network check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (!response.ok) {
  let detail = response.statusText;
  try {
    const body = await response.json();
    if (typeof body?.message === "string") detail = body.message;
  } catch {
    // Preserve the HTTP status text.
  }
  console.error(`Mapbox style check failed with HTTP ${response.status}: ${detail}`);
  if (response.status === 403) {
    console.error(`Confirm that ${referer} is allowed by the token and that the token includes styles:read access.`);
  }
  process.exit(1);
}

console.log("Mapbox style check passed.");
console.log("- Streets v12 is readable with this token and origin");
console.log("- fully restart Next.js, or rebuild and redeploy a static export, so this fingerprint reaches the browser bundle");
