/**
 * Removes the TEST Cody event submissions created while checking the live forms,
 * their queued notification jobs, and restores the Oct 23 registration counters
 * from the registrations that remain. Does not send email or edit event copy.
 */
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const EVENT_ID = "evt_1791078442311_hwuqg";
const INTEREST_IDS = ["AVChU3SxGzsicKtukWor", "K38AA9T1I8U1PZd94tDm"];
const REGISTRATION_ID = "o6mlov4spCfUb1pk8ZIw";
const JOB_IDS = [
  "event_confirm_o6mlov4spCfUb1pk8ZIw",
  "event_reminder24_o6mlov4spCfUb1pk8ZIw",
  "event_reminder1_o6mlov4spCfUb1pk8ZIw",
];
const TEST_EMAIL = "cody-form-test@example.com";

initializeApp({ credential: applicationDefault(), projectId: "hi-coworking-plat" });
const db = getFirestore();

async function deleteIfPresent(collection, id) {
  const ref = db.collection(collection).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

async function deleteMatching(collection, field, value) {
  const snap = await db.collection(collection).where(field, "==", value).get();
  const removed = [];
  for (const doc of snap.docs) {
    await doc.ref.delete();
    removed.push(doc.id);
  }
  return removed;
}

async function main() {
  const removed = {
    interests: [],
    registrations: [],
    jobs: [],
  };

  for (const id of INTEREST_IDS) {
    if (await deleteIfPresent("eventInterests", id)) removed.interests.push(id);
  }
  if (await deleteIfPresent("eventRegistrations", REGISTRATION_ID)) {
    removed.registrations.push(REGISTRATION_ID);
  }
  for (const id of JOB_IDS) {
    if (await deleteIfPresent("eventNotificationJobs", id)) removed.jobs.push(id);
  }

  const extraInterests = await deleteMatching("eventInterests", "email", TEST_EMAIL);
  const extraRegistrations = await deleteMatching("eventRegistrations", "email", TEST_EMAIL);
  const extraJobs = await deleteMatching("eventNotificationJobs", "registrationId", REGISTRATION_ID);
  for (const id of extraInterests) {
    if (!removed.interests.includes(id)) removed.interests.push(id);
  }
  for (const id of extraRegistrations) {
    if (!removed.registrations.includes(id)) removed.registrations.push(id);
  }
  for (const id of extraJobs) {
    if (!removed.jobs.includes(id)) removed.jobs.push(id);
  }

  const eventRef = db.collection("events").doc(EVENT_ID);
  const beforeSnap = await eventRef.get();
  if (!beforeSnap.exists) throw new Error(`Missing event ${EVENT_ID}`);
  const before = beforeSnap.data();
  const remaining = await db.collection("eventRegistrations").where("eventId", "==", EVENT_ID).get();
  const count = remaining.size;
  await eventRef.update({
    confirmedQuantity: count,
    registrationCount: count,
    updatedAt: Date.now(),
  });

  for (const id of INTEREST_IDS) {
    if ((await db.collection("eventInterests").doc(id).get()).exists) {
      throw new Error(`eventInterests/${id} still exists`);
    }
  }
  if ((await db.collection("eventRegistrations").doc(REGISTRATION_ID).get()).exists) {
    throw new Error(`eventRegistrations/${REGISTRATION_ID} still exists`);
  }
  for (const id of JOB_IDS) {
    if ((await db.collection("eventNotificationJobs").doc(id).get()).exists) {
      throw new Error(`eventNotificationJobs/${id} still exists`);
    }
  }
  const leftoverInterests = await db.collection("eventInterests").where("email", "==", TEST_EMAIL).get();
  const leftoverRegistrations = await db.collection("eventRegistrations").where("email", "==", TEST_EMAIL).get();
  if (!leftoverInterests.empty || !leftoverRegistrations.empty) {
    throw new Error("TEST Cody submissions still remain");
  }

  const after = (await eventRef.get()).data();
  for (const field of ["title", "format", "startTime", "endTime", "location"]) {
    if (JSON.stringify(after[field]) !== JSON.stringify(before[field])) {
      throw new Error(`Event field ${field} changed`);
    }
  }
  if (after.confirmedQuantity !== count || after.registrationCount !== count) {
    throw new Error(`Registration count is ${after.confirmedQuantity}/${after.registrationCount}, expected ${count}`);
  }

  console.log(JSON.stringify({
    removed,
    eventId: EVENT_ID,
    title: after.title,
    format: after.format,
    startTime: after.startTime,
    endTime: after.endTime,
    location: after.location ?? null,
    confirmedQuantity: after.confirmedQuantity,
    registrationCount: after.registrationCount,
    remainingRegistrationIds: remaining.docs.map((doc) => doc.id),
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
