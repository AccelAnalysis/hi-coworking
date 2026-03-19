import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

export interface Recipient {
  uid: string;
  email?: string;
  phone?: string;
  displayName?: string;
  fcmToken?: string;
}

/**
 * Resolve campaign recipients based on event registrations and audience rules.
 * For announce/reminder jobs, targets registered users + optionally broader audience.
 * For follow_up jobs, targets only registered attendees.
 */
export async function resolveRecipients(
  campaignId: string,
  jobType: "announce" | "reminder" | "starting_soon" | "follow_up",
  eventId?: string,
  audienceRules?: {
    membershipTiers?: string[];
    tags?: string[];
    interests?: string[];
  }
): Promise<Recipient[]> {
  const db = admin.firestore();
  const recipients = new Map<string, Recipient>();

  // Always include event registrants if eventId is provided
  if (eventId) {
    const regsSnap = await db
      .collection("events")
      .doc(eventId)
      .collection("registrations")
      .where("status", "==", "active")
      .get();

    for (const doc of regsSnap.docs) {
      const data = doc.data();
      recipients.set(data.uid, {
        uid: data.uid,
        email: data.email,
        displayName: data.displayName,
      });
    }
  }

  // For announce jobs, also pull from broader audience based on rules
  if (jobType === "announce" && audienceRules) {
    let usersQuery: FirebaseFirestore.Query = db.collection("users")
      .where("membershipStatus", "==", "active");

    if (audienceRules.membershipTiers?.length) {
      usersQuery = usersQuery.where("plan", "in", audienceRules.membershipTiers);
    }

    const usersSnap = await usersQuery.limit(500).get();

    for (const doc of usersSnap.docs) {
      const data = doc.data();
      if (!recipients.has(doc.id)) {
        recipients.set(doc.id, {
          uid: doc.id,
          email: data.email,
          displayName: data.displayName || data.name,
          phone: data.phone,
        });
      }
    }
  }

  // Enrich recipients with FCM tokens and missing contact info
  const enriched: Recipient[] = [];
  for (const recipient of recipients.values()) {
    try {
      const userDoc = await db.collection("users").doc(recipient.uid).get();
      const userData = userDoc.data();
      if (userData) {
        enriched.push({
          ...recipient,
          email: recipient.email || userData.email,
          phone: recipient.phone || userData.phone,
          displayName: recipient.displayName || userData.displayName || userData.name,
          fcmToken: userData.fcmToken,
        });
      } else {
        enriched.push(recipient);
      }
    } catch {
      enriched.push(recipient);
    }
  }

  logger.info("Resolved campaign recipients", {
    campaignId,
    jobType,
    count: enriched.length,
  });

  return enriched;
}
