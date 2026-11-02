import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = "demo-hi-coworking";

function emulatorAddress(variable: string, fallbackPort: number) {
  const address = process.env[variable] ?? `127.0.0.1:${fallbackPort}`;
  const separator = address.lastIndexOf(":");
  return { host: address.slice(0, separator), port: Number(address.slice(separator + 1)) };
}

describe("SayHi accountDetails and vaApplications: server writes only", () => {
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
      await setDoc(doc(context.firestore(), "accountDetails/member-a"), { company: "Sample Co", phone: "+15555550100" });
      await setDoc(doc(context.firestore(), "vaApplications/member-a"), { status: "paperwork_submitted" });
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it("lets the owner read their own details but not write them", async () => {
    const db = env.authenticatedContext("member-a", { role: "member" }).firestore();
    await assertSucceeds(getDoc(doc(db, "accountDetails/member-a")));
    await assertSucceeds(getDoc(doc(db, "vaApplications/member-a")));
    await assertFails(setDoc(doc(db, "accountDetails/member-a"), { company: "Changed" }));
    await assertFails(setDoc(doc(db, "vaApplications/member-a"), { status: "approved" }));
  });

  it("denies another member", async () => {
    const db = env.authenticatedContext("member-b", { role: "member" }).firestore();
    await assertFails(getDoc(doc(db, "accountDetails/member-a")));
    await assertFails(getDoc(doc(db, "vaApplications/member-a")));
  });

  it("lets staff read account details and admins read VA status, with no writes", async () => {
    const staff = env.authenticatedContext("staff-a", { role: "staff" }).firestore();
    await assertSucceeds(getDoc(doc(staff, "accountDetails/member-a")));
    await assertFails(getDoc(doc(staff, "vaApplications/member-a")));
    const adminDb = env.authenticatedContext("admin-a", { role: "admin" }).firestore();
    await assertSucceeds(getDoc(doc(adminDb, "vaApplications/member-a")));
    await assertFails(setDoc(doc(adminDb, "accountDetails/member-a"), { company: "x" }));
  });

  it("denies signed-out visitors", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "accountDetails/member-a")));
    await assertFails(getDoc(doc(db, "vaApplications/member-a")));
  });
});
