import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = "demo-hi-coworking";
const COLLECTIONS = [
  "kioskVisits", "kioskOpenVisits", "kioskAlerts", "kioskBookingFlags", "kioskRequests", "kioskLookups",
  "kioskRateLimits", "kioskDevices", "kioskSettings", "kioskMemberCodes", "kioskCodeIndex",
];

function emulatorAddress(variable: string, fallbackPort: number) {
  const address = process.env[variable] ?? `127.0.0.1:${fallbackPort}`;
  const separator = address.lastIndexOf(":");
  return { host: address.slice(0, separator), port: Number(address.slice(separator + 1)) };
}

describe("front-desk kiosk collections are server-only", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { ...emulatorAddress("FIRESTORE_EMULATOR_HOST", 8081), rules: readFileSync(resolve("firestore.rules"), "utf8") },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      for (const name of COLLECTIONS) await setDoc(doc(context.firestore(), `${name}/member-a`), { uid: "member-a" });
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  const personas = [
    ["the member it belongs to", "member-a", { role: "member" }],
    ["a kiosk device", "kiosk-ipad", { role: "member", kiosk: true }],
    ["staff", "staff-a", { role: "staff" }],
    ["an admin", "admin-a", { role: "admin" }],
  ] as const;

  for (const [label, uid, claims] of personas) {
    it(`denies ${label} every read and write`, async () => {
      const db = env.authenticatedContext(uid, { ...claims }).firestore();
      for (const name of COLLECTIONS) {
        await assertFails(getDoc(doc(db, `${name}/member-a`)));
        await assertFails(getDocs(collection(db, name)));
        await assertFails(setDoc(doc(db, `${name}/member-a`), { uid: "member-a", status: "closed" }));
        await assertFails(setDoc(doc(db, `${name}/new-doc`), { uid }));
      }
    });
  }

  it("denies signed-out clients", async () => {
    const db = env.unauthenticatedContext().firestore();
    for (const name of COLLECTIONS) await assertFails(getDoc(doc(db, `${name}/member-a`)));
  });
});
