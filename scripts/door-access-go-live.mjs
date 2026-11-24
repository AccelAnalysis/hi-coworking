#!/usr/bin/env node
/**
 * Door access go-live steps (Jonathan approved Nov 24, 2026, 5:24 PM ET).
 * Run only by .github/workflows/firebase-live-access-functions.yml.
 * Every step is idempotent and safe to re-run.
 *
 *   verify   The SEAM_API_KEY stored in Firebase is for the production
 *            workspace "Jonathan's Production" and can see the Floor
 *            Entrance lock.
 *   webhook  Points Seam at us-central1 access_seamWebhook and makes the
 *            Firebase secret SEAM_WEBHOOK_SECRET match it. Removes only the
 *            dead us-east1 seam_webhook endpoint.
 *   door     Creates or completes the doors record for the Floor Entrance
 *            lock (D1-D6, private office, conference room).
 *   smoke    The deployed webhook answers (405 to GET, as designed).
 *
 * Never reads, changes or deletes access codes on the lock (the existing
 * permanent codes stay untouched), and never prints a key, secret or code.
 * Needs SEAM_API_KEY in the environment (masked by the workflow) and
 * GOOGLE_APPLICATION_CREDENTIALS with gcloud authenticated.
 */
import { execFileSync } from "node:child_process";

export const PROJECT = "hi-coworking-plat";
export const WORKSPACE_NAME = "Jonathan's Production";
export const DEVICE_ID = "6fcd15b8-8fc1-4dcc-bd9d-2747e63ebc11";
export const WEBHOOK_URL = `https://us-central1-${PROJECT}.cloudfunctions.net/access_seamWebhook`;
export const DEAD_WEBHOOK_URL = `https://us-east1-${PROJECT}.cloudfunctions.net/seam_webhook`;
export const DOOR_ID = "floor-entrance";
export const DOOR_RESOURCE_IDS = ["seat-1", "seat-2", "seat-3", "seat-4", "seat-5", "seat-6", "private-office", "mode-conference"];
export const WEBHOOK_EVENT_TYPES = [
  "access_code.set_on_device",
  "access_code.removed_from_device",
  "access_code.failed_to_set_on_device",
  "access_code.delay_in_setting_on_device",
  "access_code.failed_to_remove_from_device",
  "access_code.delay_in_removing_from_device",
  "access_code.deleted_external_to_seam",
  "access_code.modified_external_to_seam",
  "lock.unlocked",
  "device.connected",
  "device.disconnected",
  "device.low_battery",
  "device.battery_status_changed",
];

async function seam(path, body = {}) {
  const key = process.env.SEAM_API_KEY;
  if (!key) throw new Error("SEAM_API_KEY is not set");
  const res = await fetch(`https://connect.getseam.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok) {
    const type = json?.error?.type ? ` (${json.error.type})` : "";
    throw new Error(`Seam ${path} returned ${res.status}${type}`);
  }
  return json;
}

function gcloud(args, input) {
  return execFileSync("gcloud", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

async function verify() {
  const { workspace } = await seam("/workspaces/get");
  console.log(`Seam workspace: "${workspace?.name}" (sandbox: ${workspace?.is_sandbox === true})`);
  if (workspace?.name !== WORKSPACE_NAME || workspace?.is_sandbox === true) {
    throw new Error(`The Firebase SEAM_API_KEY is not for the "${WORKSPACE_NAME}" production workspace.`);
  }
  const { device } = await seam("/devices/get", { device_id: DEVICE_ID });
  const p = device?.properties || {};
  console.log(`Lock: "${p.name ?? device?.display_name ?? "?"}" online=${p.online === true} battery=${typeof p.battery_level === "number" ? Math.round(p.battery_level * 100) + "%" : "?"} online_codes=${device?.can_program_online_access_codes === true}`);
  if (device?.device_id !== DEVICE_ID) throw new Error("Floor Entrance lock not visible to this key.");
}

function currentWebhookSecret() {
  try {
    return gcloud(["secrets", "versions", "access", "latest", "--secret=SEAM_WEBHOOK_SECRET", `--project=${PROJECT}`]).trim();
  } catch {
    return "";
  }
}

function setWebhookSecret(value) {
  try {
    gcloud(["secrets", "versions", "add", "SEAM_WEBHOOK_SECRET", "--data-file=-", `--project=${PROJECT}`], value);
  } catch (error) {
    // First go-live: the secret may not exist yet, so create it with this value.
    if (!/NOT_FOUND|not found/i.test(String(error?.stderr ?? error?.message ?? ""))) throw error;
    gcloud(["secrets", "create", "SEAM_WEBHOOK_SECRET", "--replication-policy=automatic", "--data-file=-", `--project=${PROJECT}`], value);
  }
}

async function webhook() {
  const { webhooks = [] } = await seam("/webhooks/list");
  let target = webhooks.find((w) => w.url === WEBHOOK_URL);
  let secret = "";
  if (target) {
    const got = await seam("/webhooks/get", { webhook_id: target.webhook_id }).catch(() => null);
    secret = typeof got?.webhook?.secret === "string" ? got.webhook.secret : "";
    if (!secret) {
      // The signing secret can't be read back: replace the endpoint to get a known one.
      await seam("/webhooks/delete", { webhook_id: target.webhook_id });
      console.log("Replaced the existing us-central1 webhook to obtain its signing secret.");
      target = undefined;
    }
  }
  let created = null;
  if (!target) {
    const out = await seam("/webhooks/create", { url: WEBHOOK_URL, event_types: WEBHOOK_EVENT_TYPES });
    created = out.webhook;
    secret = created?.secret || "";
    if (!secret) throw new Error("Seam did not return a webhook signing secret.");
    console.log(`Created Seam webhook ${created.webhook_id} -> ${WEBHOOK_URL}`);
  } else {
    console.log(`Seam webhook already points to ${WEBHOOK_URL} (${target.webhook_id}).`);
  }
  if (process.env.GITHUB_ACTIONS) console.log(`::add-mask::${secret}`);
  if (currentWebhookSecret() === secret) {
    console.log("SEAM_WEBHOOK_SECRET already matches the webhook.");
  } else {
    try {
      setWebhookSecret(secret);
      console.log("Added a new SEAM_WEBHOOK_SECRET version matching the webhook.");
    } catch (error) {
      if (created) {
        await seam("/webhooks/delete", { webhook_id: created.webhook_id }).catch(() => undefined);
        console.log("Rolled back the new webhook because the secret could not be saved.");
      }
      throw new Error(`Could not save SEAM_WEBHOOK_SECRET: ${String(error?.stderr || error?.message || error).split("\n")[0]}`);
    }
  }
  for (const w of webhooks) {
    if (w.url === DEAD_WEBHOOK_URL) {
      await seam("/webhooks/delete", { webhook_id: w.webhook_id });
      console.log(`Removed the dead webhook ${w.webhook_id} (${DEAD_WEBHOOK_URL}).`);
    }
  }
  const after = (await seam("/webhooks/list")).webhooks || [];
  console.log(`Seam webhooks now: ${after.map((w) => w.url).join(", ") || "(none)"}`);
}

/** Pure: the doors doc to write, given what's there now. */
export function doorRecord(existing, locationId, now) {
  const ids = new Set([...(Array.isArray(existing?.resourceIds) ? existing.resourceIds : []), ...DOOR_RESOURCE_IDS]);
  return {
    id: existing?.id || DOOR_ID,
    name: existing?.name || "Floor Entrance",
    locationId: existing?.locationId || locationId,
    seamDeviceId: DEVICE_ID,
    resourceIds: [...ids],
    status: existing?.status && existing.status !== "archived" ? existing.status : "unknown",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

async function door() {
  const { initializeApp, applicationDefault } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault(), projectId: PROJECT });
  const db = getFirestore();
  const byDevice = await db.collection("doors").where("seamDeviceId", "==", DEVICE_ID).get();
  const existingDoc = byDevice.docs[0] || (await db.collection("doors").doc(DOOR_ID).get());
  const existing = existingDoc.exists ? { id: existingDoc.id, ...existingDoc.data() } : null;
  const locations = await db.collection("locations").limit(2).get();
  const locationId = locations.size === 1 ? locations.docs[0].id : "main";
  const record = doorRecord(existing, locationId, Date.now());
  await db.collection("doors").doc(record.id).set(record, { merge: true });
  const check = (await db.collection("doors").doc(record.id).get()).data();
  console.log(`doors/${record.id}: name="${check.name}" device=${check.seamDeviceId} resources=${check.resourceIds.join(",")} location=${check.locationId}`);
  const others = (await db.collection("doors").get()).docs.filter((d) => d.id !== record.id && d.data().status !== "archived");
  if (others.length) console.log(`Note: ${others.length} other live door record(s): ${others.map((d) => d.id).join(", ")}`);
}

async function smoke() {
  const res = await fetch(WEBHOOK_URL, { method: "GET" });
  console.log(`GET ${WEBHOOK_URL} -> ${res.status}`);
  if (res.status !== 405) throw new Error("access_seamWebhook did not answer as expected (405).");
  const signed = await fetch(WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  console.log(`Unsigned POST -> ${signed.status} (401 expected: fails closed)`);
  if (signed.status !== 401) throw new Error("access_seamWebhook accepted an unsigned request.");
}

const steps = { verify, webhook, door, smoke };
const step = process.argv[2];
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!steps[step]) {
    console.error(`Usage: door-access-go-live.mjs ${Object.keys(steps).join("|")}`);
    process.exit(2);
  }
  steps[step]().catch((error) => {
    console.error(error?.message || String(error));
    process.exit(1);
  });
}
