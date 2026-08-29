import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

function db() {
  return admin.firestore();
}

function requireStaff(request: { auth?: { token: Record<string, unknown> } | null }) {
  const role = request.auth?.token.role as string | undefined;
  if (!request.auth || !["staff", "admin", "master"].includes(role || "")) {
    throw new HttpsError("permission-denied", "Staff access is required.");
  }
}

export const events_staffListUpcoming = onCall(async (request) => {
  requireStaff(request);
  const snap = await db().collection("events")
    .where("status", "==", "published")
    .where("endTime", ">=", Date.now())
    .orderBy("endTime", "asc")
    .limit(50)
    .get();
  return {
    events: snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title,
        startTime: data.startTime,
        endTime: data.endTime,
        location: data.location || null,
        seatCap: data.seatCap ?? null,
        confirmedQuantity: Number(data.confirmedQuantity ?? data.registrationCount ?? 0),
      };
    }),
  };
});

export const events_staffGetRoster = onCall(async (request) => {
  requireStaff(request);
  const { eventId } = request.data as { eventId?: string };
  if (!eventId) throw new HttpsError("invalid-argument", "eventId is required.");
  const [eventSnap, registrationSnap, waitlistSnap] = await Promise.all([
    db().collection("events").doc(eventId).get(),
    db().collection("eventRegistrations").where("eventId", "==", eventId).orderBy("registeredAt", "asc").get(),
    db().collection("eventWaitlist").where("eventId", "==", eventId).where("status", "in", ["WAITING", "OFFERED"]).get(),
  ]);
  if (!eventSnap.exists) throw new HttpsError("not-found", "Event not found.");
  const registrations = registrationSnap.docs.map((doc) => doc.data());
  return {
    event: { id: eventSnap.id, ...eventSnap.data() },
    registrations,
    waitlistCount: waitlistSnap.size,
    summary: {
      registeredQuantity: registrations
        .filter((row) => ["CONFIRMED", "REFUND_PENDING"].includes(String(row.status)))
        .reduce((sum, row) => sum + Number(row.quantity || 1), 0),
      checkedInQuantity: registrations.reduce((sum, row) => sum + Number(row.checkedInQuantity || 0), 0),
    },
  };
});
