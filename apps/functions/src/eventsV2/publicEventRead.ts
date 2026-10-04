import { onCall, HttpsError } from "firebase-functions/v2/https";
import { adminEventCallableOptions } from "./adminEventCors";
import { db, publicEvent } from "./core";
import type { EventDocV2 } from "./types";

export const events_v2ListPublicEvents = onCall(adminEventCallableOptions, async (request) => {
  const scope = String((request.data as { scope?: string } | undefined)?.scope || "upcoming");
  const descending = scope === "past";
  const snap = await db().collection("events")
    .orderBy("startTime", descending ? "desc" : "asc")
    .limit(250)
    .get();
  const now = Date.now();
  const rows = snap.docs
    .map((doc) => doc.data() as EventDocV2)
    .filter((event) => {
      if (scope === "past") {
        return (event.status === "published" || event.status === "completed") && event.endTime < now;
      }
      return event.status === "published" && event.endTime >= now;
    })
    .map(publicEvent);
  return { events: rows };
});

export const events_v2GetPublicEvent = onCall(adminEventCallableOptions, async (request) => {
  const identifier = String((request.data as { identifier?: string } | undefined)?.identifier || "").trim();
  if (!identifier) throw new HttpsError("invalid-argument", "Event identifier is required.");
  const direct = await db().collection("events").doc(identifier).get();
  let event: EventDocV2 | null = direct.exists ? direct.data() as EventDocV2 : null;
  if (!event) {
    const bySlug = await db().collection("events").where("slug", "==", identifier).limit(1).get();
    event = bySlug.empty ? null : bySlug.docs[0].data() as EventDocV2;
  }
  if (!event || (event.status !== "published" && event.status !== "completed")) {
    throw new HttpsError("not-found", "Event not found.");
  }
  return { event: publicEvent(event) };
});
