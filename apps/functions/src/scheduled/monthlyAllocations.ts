import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { MEMBERSHIP_TIERS } from "../config";
import { addCredits } from "../credits";

function getDb() {
  return admin.firestore();
}

/**
 * Monthly scheduled task to allocate credits to active members.
 * Runs on the 1st of every month at 00:00 (midnight).
 */
export const allocateMonthlyCredits = onSchedule(
  {
    schedule: "0 0 1 * *", // 1st of every month at midnight
    timeZone: "America/New_York", // Or UTC, but consistent with business ops
    memory: "512MiB",
  },
  async (event) => {
    logger.info("Starting monthly credit allocation...", { scheduleTime: event.scheduleTime });

    const db = getDb();
    const usersRef = db.collection("users");
    
    // Process in batches
    // Query for active members only
    const snapshot = await usersRef
      .where("membershipStatus", "==", "active")
      .get();

    if (snapshot.empty) {
      logger.info("No active members found for credit allocation.");
      return;
    }

    logger.info(`Found ${snapshot.size} active members. Processing...`);

    let successCount = 0;
    let errorCount = 0;

    const batchSize = 100; // arbitrary chunk size for potential batched writes if we weren't using `addCredits` helper
    // Since `addCredits` uses a transaction internally, we can just map over them.
    // However, `Promise.all` on thousands of users might overwhelm the connection.
    // Let's process in chunks.

    const users = snapshot.docs;
    
    for (let i = 0; i < users.length; i += batchSize) {
      const chunk = users.slice(i, i + batchSize);
      
      await Promise.all(
        chunk.map(async (doc) => {
          const userData = doc.data();
          const uid = doc.id;
          const planId = userData.plan;

          if (!planId) {
            logger.warn(`User ${uid} is active but has no plan ID.`);
            return;
          }

          // Find the tier definition
          const tier = MEMBERSHIP_TIERS.find((t) => t.id === planId);
          
          if (!tier) {
            // It might be a legacy plan or custom plan not in the standard config
            // We'll skip for now or log warning
            logger.debug(`User ${uid} has plan '${planId}' which is not in MEMBERSHIP_TIERS.`);
            return;
          }

          const creditsToGive = tier.includedCreditsPerMonth;
          
          if (creditsToGive <= 0) {
            return;
          }

          try {
            // We use a simplified description for the transaction
            const month = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
            
            await addCredits(
              uid,
              creditsToGive,
              "monthly_allocation",
              `Monthly included credits for ${tier.name} - ${month}`,
              `monthly_${new Date().toISOString().slice(0, 7)}` // Simple dedup key prefix
            );
            successCount++;
          } catch (err) {
            logger.error(`Failed to allocate credits for user ${uid}`, { err });
            errorCount++;
          }
        })
      );
    }

    logger.info("Monthly credit allocation complete.", { successCount, errorCount });
  }
);
