import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = "demo-hi-coworking";
const PATH = "staffFollowUps/no_checkin_booking-1";

function emulatorAddress(variable: string, fallbackPort: number) {
  const address = process.env[variable] ?? `127.0.0.1:${fallbackPort}`;
  const separator = address.lastIndexOf(":");
  return { host: address.slice(0, separator), port: Number(address.slice(separator + 1)) };
}

describe("staffFollowUps: admins read, only server code writes", () => {
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
      await setDoc(doc(context.firestore(), PATH), { owner: "jessica", type: "no_checkin", memberId: "member-a", status: "open" });
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  for (const role of ["admin", "master"]) {
    it(`lets ${role} read but not write`, async () => {
      const db = env.authenticatedContext(`${role}-a`, { role }).firestore();
      await assertSucceeds(getDoc(doc(db, PATH)));
      await assertSucceeds(getDocs(collection(db, "staffFollowUps")));
      await assertFails(updateDoc(doc(db, PATH), { status: "done" }));
      await assertFails(setDoc(doc(db, "staffFollowUps/new"), { owner: "jessica" }));
    });
  }

  const denied = [
    ["the member it is about", "member-a", { role: "member" }],
    ["staff", "staff-a", { role: "staff" }],
    ["a kiosk device", "kiosk-ipad", { role: "member", kiosk: true }],
  ] as const;
  for (const [label, uid, claims] of denied) {
    it(`denies ${label}`, async () => {
      const db = env.authenticatedContext(uid, { ...claims }).firestore();
      await assertFails(getDoc(doc(db, PATH)));
      await assertFails(getDocs(collection(db, "staffFollowUps")));
      await assertFails(setDoc(doc(db, PATH), { status: "done" }));
    });
  }

  it("denies signed-out visitors", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, PATH)));
  });
});
