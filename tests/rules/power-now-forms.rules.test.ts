import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, test } from "vitest";

const PROJECT_ID = "demo-power-now-forms";

function emulatorAddress() {
  const address = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8081";
  const separator = address.lastIndexOf(":");
  return { host: address.slice(0, separator), port: Number(address.slice(separator + 1)) };
}

describe("Power NOW form rules", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        ...emulatorAddress(),
        rules: readFileSync(resolve("firestore.rules"), "utf8"),
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "powerNowCriteria/current"), {
        placeholder: true,
        notice: "Placeholder rubric.",
        items: [{ id: "placeholder-clarity", label: "Placeholder criterion: clarity of the problem", max: 5 }],
      });
      await setDoc(doc(db, "powerNowFitQuestions/current"), {
        placeholder: true,
        items: [{ id: "placeholder-problem", prompt: "Placeholder question: what problem is this business solving?" }],
      });
      await setDoc(doc(db, "powerNowJudges/judge-1"), { email: "judge1@example.test", active: true });
      await setDoc(doc(db, "powerNowJudges/judge-2"), { email: "judge2@example.test", active: true });
      await setDoc(doc(db, "powerNowHosts/host-1"), { email: "host@example.test", active: true });
      await setDoc(doc(db, "powerNowPitchers/pitcher-1"), { email: "pitcher@example.test", active: true, nightIds: ["2026-11-12"] });
      await setDoc(doc(db, "powerNowNights/2026-11-12"), { label: "November night", locked: false });
      await setDoc(doc(db, "powerNowNights/2026-11-12/pitchers/founder-1"), {
        name: "Ada Lovelace",
        email: "pitcher@example.test",
        selected: true,
        uid: "pitcher-1",
      });
      await setDoc(doc(db, "powerNowScores/2026-11-12_founder-1_judge-2"), score("judge-2"));
      await setDoc(doc(db, "powerNowPrivateComments/2026-11-12_founder-1_judge-2"), {
        nightId: "2026-11-12",
        pitcherId: "founder-1",
        judgeUid: "judge-2",
        comment: "Private note",
        updatedAt: Timestamp.now(),
      });
    });
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  test("public is denied", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "powerNowCriteria/current")));
    await assertFails(getDoc(doc(db, "powerNowFitQuestions/current")));
    await assertFails(getDoc(doc(db, "powerNowScores/2026-11-12_founder-1_judge-2")));
    await assertFails(getDocs(collection(db, "powerNowJudges")));
    await assertFails(getDoc(doc(db, "powerNowPrivateComments/2026-11-12_founder-1_judge-2")));
    await assertFails(getDoc(doc(db, "powerNowSettings/current")));
    await assertFails(getDoc(doc(db, "powerNowReleasedNotes/pitcher-1")));
    await assertFails(setDoc(doc(db, "powerNowJudges/intruder"), { email: "intruder@example.test", active: true }));
    await assertFails(setDoc(doc(db, "powerNowHosts/intruder"), { email: "intruder@example.test", active: true }));
  });

  test("a selected pitcher can read the criteria only", async () => {
    const db = testEnv.authenticatedContext("pitcher-1", { role: "member" }).firestore();
    await assertSucceeds(getDoc(doc(db, "powerNowCriteria/current")));
    await assertFails(getDoc(doc(db, "powerNowScores/2026-11-12_founder-1_judge-2")));
    await assertFails(getDocs(collection(db, "powerNowScores")));
    await assertFails(getDoc(doc(db, "powerNowFitQuestions/current")));
    await assertFails(getDoc(doc(db, "powerNowNights/2026-11-12")));
    await assertFails(updateDoc(doc(db, "powerNowCriteria/current"), { notice: "changed" }));
  });

  test("a judge cannot score twice or read another judge", async () => {
    const db = testEnv.authenticatedContext("judge-1", { role: "member" }).firestore();
    const own = doc(db, "powerNowScores/2026-11-12_founder-1_judge-1");
    await assertSucceeds(getDoc(doc(db, "powerNowPrivateComments/2026-11-12_founder-1_judge-1")));
    await assertFails(setDoc(own, { ...score("judge-1"), founderStrength: "", founderNextStep: "" }));
    await assertFails(setDoc(own, { ...score("judge-1"), points: [{ criterionId: "j1-opportunity", value: 6 }] }));
    await assertSucceeds(setDoc(own, score("judge-1")));
    await assertSucceeds(getDoc(own));
    await assertFails(getDoc(doc(db, "powerNowScores/2026-11-12_founder-1_judge-2")));
    await assertFails(getDocs(collection(db, "powerNowScores")));
    await assertFails(setDoc(doc(db, "powerNowScores/2026-11-12_founder-1_judge-1-extra"), {
      ...score("judge-1"),
      nightId: "2026-11-12",
      pitcherId: "founder-1",
    }));
    await assertFails(updateDoc(own, { points: [{ criterionId: "j1-opportunity", value: 4 }], updatedAt: Timestamp.now() }));
    await assertSucceeds(setDoc(doc(db, "powerNowPrivateComments/2026-11-12_founder-1_judge-1"), {
      nightId: "2026-11-12",
      pitcherId: "founder-1",
      judgeUid: "judge-1",
      comment: "Only Jonathan",
      updatedAt: Timestamp.now(),
    }));
    await assertFails(getDoc(doc(db, "powerNowPrivateComments/2026-11-12_founder-1_judge-2")));
    await assertFails(updateDoc(doc(db, "powerNowPrivateComments/2026-11-12_founder-1_judge-1"), {
      comment: "Changed after submit",
      updatedAt: Timestamp.now(),
    }));
    const admin = testEnv.authenticatedContext("admin-1", { role: "admin" }).firestore();
    await assertSucceeds(updateDoc(doc(admin, "powerNowScores/2026-11-12_founder-1_judge-1"), { submitted: false }));
    await assertSucceeds(updateDoc(own, { submitted: true, recused: true, points: [], updatedAt: Timestamp.now() }));
  });

  test("a host can read every score and cannot read private comments or manage roles", async () => {
    const db = testEnv.authenticatedContext("host-1", { role: "member" }).firestore();
    await assertSucceeds(getDoc(doc(db, "powerNowCriteria/current")));
    await assertSucceeds(getDoc(doc(db, "powerNowScores/2026-11-12_founder-1_judge-2")));
    await assertSucceeds(getDocs(collection(db, "powerNowScores")));
    await assertFails(getDoc(doc(db, "powerNowPrivateComments/2026-11-12_founder-1_judge-2")));
    await assertFails(getDoc(doc(db, "powerNowFitQuestions/current")));
    await assertFails(setDoc(doc(db, "powerNowScores/2026-11-12_founder-1_host-1"), score("host-1")));
    await assertFails(setDoc(doc(db, "powerNowJudges/new-judge"), { email: "new-judge@example.test", active: true }));
    await assertSucceeds(getDoc(doc(db, "powerNowSettings/current")));
    await assertSucceeds(updateDoc(doc(db, "powerNowNights/2026-11-12"), { locked: true }));
    await assertFails(updateDoc(doc(db, "powerNowNights/2026-11-12"), { founderCommentsReleased: true }));
  });

  test("a configured lock time closes scoring", async () => {
    const admin = testEnv.authenticatedContext("admin-1", { role: "admin" }).firestore();
    await assertSucceeds(updateDoc(doc(admin, "powerNowNights/2026-11-12"), {
      lockAt: Timestamp.fromDate(new Date("2020-01-01T00:00:00Z")),
    }));
    const judge = testEnv.authenticatedContext("judge-1", { role: "member" }).firestore();
    await assertFails(setDoc(doc(judge, "powerNowScores/2026-11-12_founder-1_judge-1"), score("judge-1")));
  });

  test("a locked night rejects score edits", async () => {
    const admin = testEnv.authenticatedContext("admin-1", { role: "admin" }).firestore();
    await assertSucceeds(updateDoc(doc(admin, "powerNowNights/2026-11-12"), { locked: true }));
    const judge = testEnv.authenticatedContext("judge-1", { role: "member" }).firestore();
    await assertFails(setDoc(doc(judge, "powerNowScores/2026-11-12_founder-1_judge-1"), score("judge-1")));
  });

  test("a non-admin cannot manage judges", async () => {
    const member = testEnv.authenticatedContext("member-1", { role: "member" }).firestore();
    const judge = testEnv.authenticatedContext("judge-1", { role: "member" }).firestore();
    const pitcher = testEnv.authenticatedContext("pitcher-1", { role: "member" }).firestore();
    const admin = testEnv.authenticatedContext("admin-1", { role: "admin" }).firestore();
    const payload = { email: "new-judge@example.test", active: true };
    await assertFails(setDoc(doc(member, "powerNowJudges/new-judge"), payload));
    await assertFails(setDoc(doc(judge, "powerNowJudges/new-judge"), payload));
    await assertFails(setDoc(doc(pitcher, "powerNowJudges/new-judge"), payload));
    await assertFails(setDoc(doc(judge, "powerNowPitchers/new-pitcher"), { email: "pitcher2@example.test", active: true }));
    await assertFails(setDoc(doc(judge, "powerNowHosts/new-host"), { email: "host2@example.test", active: true }));
    await assertFails(getDoc(doc(pitcher, "powerNowPrivateComments/2026-11-12_founder-1_judge-2")));
    await assertSucceeds(setDoc(doc(admin, "powerNowJudges/new-judge"), payload));
    await assertSucceeds(setDoc(doc(admin, "powerNowHosts/new-host"), { email: "host2@example.test", active: true }));
    await assertSucceeds(getDocs(collection(admin, "powerNowScores")));
    await assertSucceeds(getDoc(doc(admin, "powerNowPrivateComments/2026-11-12_founder-1_judge-2")));
    await assertSucceeds(setDoc(doc(admin, "powerNowReleasedNotes/pitcher-1"), {
      nightId: "2026-11-12",
      comments: [{ judge: "Judge", strength: "Clear problem.", nextStep: "Call five customers." }],
    }));
    await assertSucceeds(getDoc(doc(pitcher, "powerNowReleasedNotes/pitcher-1")));
    await assertFails(getDoc(doc(judge, "powerNowReleasedNotes/pitcher-1")));
    await assertFails(setDoc(doc(pitcher, "powerNowReleasedNotes/pitcher-1"), { nightId: "2026-11-12", comments: [] }));
  });
});

function score(judgeUid: string) {
  return {
    nightId: "2026-11-12",
    pitcherId: "founder-1",
    judgeUid,
    recused: false,
    submitted: true,
    founderStrength: "Clear problem.",
    founderNextStep: "Talk to five more customers.",
    points: [{ criterionId: "j1-opportunity", value: 3 }],
    updatedAt: Timestamp.now(),
  };
}
