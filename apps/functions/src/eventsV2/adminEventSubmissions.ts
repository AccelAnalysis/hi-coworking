import { onCall, HttpsError } from "firebase-functions/v2/https";
import { adminEventCallableOptions } from "./adminEventCors";
import { db, requireAdmin } from "./core";
import type { EventSubmissionAction } from "./eventSubmissionNotify";
import type { EventDocV2, RegistrationDocV2 } from "./types";

const SUBMISSION_LIMIT = 250;

type InterestRecord = {
  kind?: string;
  name?: string;
  email?: string;
  phone?: string;
  eventId?: string;
  createdAt?: number;
};

export type AdminEventSubmission = {
  id: string;
  action: EventSubmissionAction;
  name: string;
  email: string;
  phone?: string;
  eventId: string;
  eventTitle: string;
  eventSlug: string;
  submittedAt: number;
};

function actionForInterest(kind: string | undefined): EventSubmissionAction | null {
  if (kind === "pitch") return "apply_to_pitch";
  if (kind === "prize") return "offer_prize";
  return null;
}

export const events_v2AdminListEventSubmissions = onCall(adminEventCallableOptions, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  requireAdmin(request.auth);

  const [registrationsSnap, interestsSnap] = await Promise.all([
    db().collection("eventRegistrations").orderBy("registeredAt", "desc").limit(SUBMISSION_LIMIT).get(),
    db().collection("eventInterests").orderBy("createdAt", "desc").limit(SUBMISSION_LIMIT).get(),
  ]);

  const eventIds = new Set<string>();
  for (const registrationDoc of registrationsSnap.docs) {
    const eventId = String(registrationDoc.get("eventId") || "");
    if (eventId) eventIds.add(eventId);
  }
  for (const interestDoc of interestsSnap.docs) {
    const eventId = String(interestDoc.get("eventId") || "");
    if (eventId) eventIds.add(eventId);
  }

  const events = new Map<string, { title: string; slug: string }>();
  await Promise.all([...eventIds].map(async (eventId) => {
    const snap = await db().collection("events").doc(eventId).get();
    if (!snap.exists) {
      events.set(eventId, { title: eventId, slug: "" });
      return;
    }
    const event = snap.data() as EventDocV2;
    events.set(eventId, { title: event.title || eventId, slug: event.slug || "" });
  }));

  const submissions: AdminEventSubmission[] = [];
  for (const registrationDoc of registrationsSnap.docs) {
    const data = registrationDoc.data() as RegistrationDocV2 & { phone?: string };
    const event = events.get(data.eventId);
    const phone = typeof data.phone === "string" ? data.phone.trim() : "";
    submissions.push({
      id: registrationDoc.id,
      action: "attend",
      name: data.displayName || "",
      email: data.email || "",
      ...(phone ? { phone } : {}),
      eventId: data.eventId,
      eventTitle: event?.title || data.eventId,
      eventSlug: event?.slug || "",
      submittedAt: data.registeredAt || 0,
    });
  }
  for (const interestDoc of interestsSnap.docs) {
    const data = interestDoc.data() as InterestRecord;
    const action = actionForInterest(data.kind);
    if (!action) continue;
    const eventId = data.eventId || "";
    const event = events.get(eventId);
    const phone = typeof data.phone === "string" ? data.phone.trim() : "";
    submissions.push({
      id: interestDoc.id,
      action,
      name: data.name || "",
      email: data.email || "",
      ...(phone ? { phone } : {}),
      eventId,
      eventTitle: event?.title || eventId,
      eventSlug: event?.slug || "",
      submittedAt: data.createdAt || 0,
    });
  }

  submissions.sort((left, right) => right.submittedAt - left.submittedAt);
  return { submissions };
});
