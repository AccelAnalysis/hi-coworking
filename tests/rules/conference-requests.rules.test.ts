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

function emulatorAddress(variable: string, fallbackPort: number) {
  const address = process.env[variable] ?? `127.0.0.1:${fallbackPort}`;
  const separator = address.lastIndexOf(":");
  return { host: address.slice(0, separator), port: Number(address.slice(separator + 1)) };
}

describe("conferenceSlotRequests and bookingUpgrades rules", () => {
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
      await setDoc(doc(context.firestore(), "conferenceSlotRequests/req-1"), {
        name: "Casey",
        email: "casey@example.com",
        status: "pending",
        date: "2030-01-04",
      });
      await setDoc(doc(context.firestore(), "bookingUpgrades/up-1"), {
        userId: "member-a",
        bookingId: "booking-1",
        status: "pending",
      });
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it("lets staff read conference requests but never write them from the client", async () => {
    const staff = env.authenticatedContext("staff-a", { role: "staff" }).firestore();
    await assertSucceeds(getDoc(doc(staff, "conferenceSlotRequests/req-1")));
    await assertSucceeds(getDocs(collection(staff, "conferenceSlotRequests")));
    await assertFails(updateDoc(doc(staff, "conferenceSlotRequests/req-1"), { status: "approved" }));
    await assertFails(setDoc(doc(staff, "conferenceSlotRequests/new"), { status: "pending" }));
  });

  it("denies members and signed-out visitors from reading conference requests", async () => {
    const member = env.authenticatedContext("member-a", { role: "member" }).firestore();
    await assertFails(getDoc(doc(member, "conferenceSlotRequests/req-1")));
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, "conferenceSlotRequests/req-1")));
    await assertFails(setDoc(doc(anon, "conferenceSlotRequests/new"), { status: "pending" }));
  });

  it("lets the booking owner and staff read an upgrade record, with no client writes", async () => {
    const owner = env.authenticatedContext("member-a", { role: "member" }).firestore();
    await assertSucceeds(getDoc(doc(owner, "bookingUpgrades/up-1")));
    await assertFails(updateDoc(doc(owner, "bookingUpgrades/up-1"), { status: "applied" }));
    const other = env.authenticatedContext("member-b", { role: "member" }).firestore();
    await assertFails(getDoc(doc(other, "bookingUpgrades/up-1")));
    const admin = env.authenticatedContext("admin-a", { role: "admin" }).firestore();
    await assertSucceeds(getDoc(doc(admin, "bookingUpgrades/up-1")));
  });
});
