import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { revokeAccessGrant, seamApiKey, NO_SHOW_GRACE_MINUTES } from "../access";
import { decideNoShow, type NoShowInput } from "../accessCodes/noShow";

const db = admin.firestore();

/**
 * Runs every 15 minutes.
 * Revokes grants whose endsAt has passed (expired).
 */
export const access_expireGrants = onSchedule(
  { schedule: "every 15 minutes", secrets: [seamApiKey] },
  async () => {
    const now = Date.now();
    const snap = await db
      .collection("accessGrants")
      .where("endsAt", "<", now)
      .where("status", "in", ["pending", "active"])
      .limit(50)
      .get();

    if (snap.empty) {
      logger.info("access_expireGrants: no expired grants found");
      return;
    }

    logger.info(`access_expireGrants: revoking ${snap.size} expired grants`);
    await Promise.allSettled(
      snap.docs.map((doc) => revokeAccessGrant(doc.id, "expired", "system"))
    );
  }
);

/** Most grants looked at per run (those ending soonest, i.e. in progress). */
const NO_SHOW_SCAN_LIMIT = 200;

type NoShowDeps = {
  revoke: (grantId: string) => Promise<void>;
};

async function loadNoShowInput(grantId: string, now: number): Promise<NoShowInput> {
  const grantSnap = await db.collection("accessGrants").doc(grantId).get();
  const grant = grantSnap.exists ? (grantSnap.data() as Record<string, unknown>) : null;
  const bookingId = typeof grant?.bookingId === "string" ? grant.bookingId : "";
  const doorId = typeof grant?.doorId === "string" ? grant.doorId : "";
  const userId = typeof grant?.userId === "string" ? grant.userId : "";
  // Single-field queries only, so no composite index is needed; filtered here.
  const [booking, door, codes, grantEvents, bookingEvents, visits] = await Promise.all([
    bookingId ? db.collection("bookings").doc(bookingId).get().then((d) => (d.exists ? (d.data() as Record<string, unknown>) : null)) : null,
    doorId ? db.collection("doors").doc(doorId).get().then((d) => (d.exists ? (d.data() as Record<string, unknown>) : null)) : null,
    db.collection("accessCodes").where("grantId", "==", grantId).get(),
    db.collection("accessEvents").where("grantId", "==", grantId).get(),
    bookingId ? db.collection("accessEvents").where("bookingId", "==", bookingId).get() : null,
    userId ? db.collection("kioskVisits").where("uid", "==", userId).get() : null,
  ]);
  return {
    now,
    noShowGraceMinutes: NO_SHOW_GRACE_MINUTES,
    grant,
    booking,
    door,
    codes: codes.docs.map((d) => d.data()),
    events: [...grantEvents.docs, ...(bookingEvents?.docs ?? [])].map((d) => d.data()),
    visits: (visits?.docs ?? []).map((d) => d.data()),
  };
}

/**
 * One no-show pass. A grant is revoked only when decideNoShow says so after
 * every lookup worked; any lookup error keeps the code. The decision is made
 * again from fresh data right before revoking, so an unlock recorded while
 * the pass runs still saves the member. Logs counts only.
 */
export async function runNoShowSweep(now: number, deps: NoShowDeps): Promise<Record<string, number>> {
  const counts: Record<string, number> = { candidates: 0, revoked: 0 };
  const bump = (key: string) => {
    counts[key] = (counts[key] ?? 0) + 1;
  };
  let snap;
  try {
    snap = await db
      .collection("accessGrants")
      .where("endsAt", ">", now)
      .orderBy("endsAt")
      .limit(NO_SHOW_SCAN_LIMIT)
      .get();
  } catch (err: unknown) {
    logger.error("access_noShowRevoke: grant lookup failed; nothing revoked", { error: err instanceof Error ? err.name : "error" });
    return { ...counts, lookup_failed: 1 };
  }
  const candidates = snap.docs.filter((doc) => doc.data().status === "active");
  counts.candidates = candidates.length;

  for (const doc of candidates) {
    try {
      const first = decideNoShow(await loadNoShowInput(doc.id, now));
      if (!first.revoke) {
        bump(first.reason);
        continue;
      }
      const recheck = decideNoShow(await loadNoShowInput(doc.id, Math.max(now, Date.now())));
      if (!recheck.revoke) {
        bump(recheck.reason);
        continue;
      }
      await deps.revoke(doc.id);
      counts.revoked++;
    } catch {
      bump("lookup_failed");
    }
  }
  logger.info("access_noShowRevoke: done", counts);
  return counts;
}

/**
 * Runs every 15 minutes. Revokes the code of a member who has not arrived
 * NO_SHOW_GRACE_MINUTES after their booking started. "Arrived" means a
 * verified Seam unlock with their code (recorded by access_seamWebhook), any
 * other door or staff unlock for the booking, or a front-desk check-in. When
 * anything is missing or unknown (door not online, code never confirmed on
 * the lock, booking not found, a lookup error) the code is kept.
 */
export const access_noShowRevoke = onSchedule(
  { schedule: "every 15 minutes", secrets: [seamApiKey] },
  async () => {
    await runNoShowSweep(Date.now(), {
      revoke: (grantId) => revokeAccessGrant(grantId, "no_show", "system"),
    });
  }
);
