import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = "demo-hi-coworking";

function emulatorAddress(variable: string, fallbackPort: number) {
  const address = process.env[variable] ?? `127.0.0.1:${fallbackPort}`;
  const separator = address.lastIndexOf(":");
  return { host: address.slice(0, separator), port: Number(address.slice(separator + 1)) };
}

describe("Events v2 Firestore boundary", () => {
  let env: RulesTestEnvironment;

  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        ...emulatorAddress("FIRESTORE_EMULATOR_HOST", 8081),
        rules: readFileSync(resolve("firestore.rules"), "utf8"),
      },
    });
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "events/private-link"), {
        id: "private-link",
        status: "published",
        title: "Published event",
        virtualUrl: "https://meet.example.test/private",
      });
      await setDoc(doc(context.firestore(), "eventRegistrations/reg-one"), {
        id: "reg-one",
        eventId: "private-link",
        uid: "member",
        email: "member@example.test",
        status: "CONFIRMED",
      });
      await setDoc(doc(context.firestore(), "eventHolds/hold-one"), {
        id: "hold-one",
        eventId: "private-link",
        status: "HELD",
        secretHash: "server-only",
      });
    });
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it("denies raw event documents to visitors and members while allowing admins", async () => {
    const anonymous = env.unauthenticatedContext().firestore();
    const member = env.authenticatedContext("member", { role: "member" }).firestore();
    const staff = env.authenticatedContext("staff", { role: "staff" }).firestore();
    const admin = env.authenticatedContext("admin", { role: "admin" }).firestore();

    await assertFails(getDoc(doc(anonymous, "events/private-link")));
    await assertFails(getDoc(doc(member, "events/private-link")));
    await assertFails(getDoc(doc(staff, "events/private-link")));
    await assertSucceeds(getDoc(doc(admin, "events/private-link")));
  });

  it("keeps Event v2 registration and hold records server-only", async () => {
    const member = env.authenticatedContext("member", { role: "member" }).firestore();
    const admin = env.authenticatedContext("admin", { role: "admin" }).firestore();

    await assertFails(getDoc(doc(member, "eventRegistrations/reg-one")));
    await assertFails(getDoc(doc(admin, "eventRegistrations/reg-one")));
    await assertFails(getDoc(doc(member, "eventHolds/hold-one")));
    await assertFails(getDoc(doc(admin, "eventHolds/hold-one")));
    await assertFails(updateDoc(doc(admin, "events/private-link"), { status: "cancelled" }));
  });
});
