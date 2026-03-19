import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { revokeAccessGrant, seamApiKey, NO_SHOW_GRACE_MINUTES } from "../access";

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

/**
 * Runs every 15 minutes.
 * Revokes grants where the booking start + NO_SHOW_GRACE_MINUTES has passed
 * but no code_used event has been recorded — indicating a no-show.
 */
export const access_noShowRevoke = onSchedule(
  { schedule: "every 15 minutes", secrets: [seamApiKey] },
  async () => {
    const now = Date.now();
    const noShowCutoff = now - NO_SHOW_GRACE_MINUTES * 60 * 1000;

    // Find grants that started more than NO_SHOW_GRACE_MINUTES ago and are still active
    const snap = await db
      .collection("accessGrants")
      .where("startsAt", "<", noShowCutoff)
      .where("endsAt", ">", now) // Not yet expired
      .where("status", "==", "active")
      .limit(50)
      .get();

    if (snap.empty) {
      logger.info("access_noShowRevoke: no candidate grants found");
      return;
    }

    let noShowCount = 0;
    await Promise.allSettled(
      snap.docs.map(async (doc) => {
        const grantId = doc.id;
        // Check if any code_used event exists for this grant
        const usedEventsSnap = await db
          .collection("accessEvents")
          .where("grantId", "==", grantId)
          .where("eventType", "==", "code_used")
          .limit(1)
          .get();

        if (usedEventsSnap.empty) {
          // No usage recorded — treat as no-show
          noShowCount++;
          await revokeAccessGrant(grantId, "no_show", "system");
        }
      })
    );

    logger.info(`access_noShowRevoke: processed ${snap.size} candidates, revoked ${noShowCount} no-shows`);
  }
);
