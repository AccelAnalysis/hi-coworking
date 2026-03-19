import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";

// Mirror of shared types - CreditTransactionType
export type CreditTransactionType =
  | "purchase"
  | "monthly_allocation"
  | "usage"
  | "refund"
  | "admin_adjustment"
  | "expired";

export interface CreditTransactionDocData {
  id: string;
  userId: string;
  amount: number; // Positive for add, negative for deduct
  type: CreditTransactionType;
  referenceId?: string;
  description: string;
  createdAt: number;
}

function getDb() {
  return admin.firestore();
}

/**
 * Add credits to a user's balance.
 */
export async function addCredits(
  uid: string,
  amount: number,
  type: CreditTransactionType,
  description: string,
  referenceId?: string
): Promise<void> {
  if (amount <= 0) throw new Error("Amount must be positive");

  const db = getDb();
  const userRef = db.collection("users").doc(uid);

  await db.runTransaction(async (t) => {
    const userDoc = await t.get(userRef);
    if (!userDoc.exists) throw new HttpsError("not-found", "User not found");

    const userData = userDoc.data();
    const currentCredits = userData?.credits || 0;
    const lifetime = userData?.lifetimeCreditsPurchased || 0;

    // Create transaction record
    const transRef = db.collection("creditTransactions").doc();
    const transData: CreditTransactionDocData = {
      id: transRef.id,
      userId: uid,
      amount: amount,
      type,
      referenceId,
      description,
      createdAt: Date.now(),
    };

    t.set(transRef, transData);
    
    const updates: Record<string, any> = {
      credits: currentCredits + amount,
      updatedAt: Date.now(),
    };

    // Track lifetime purchases
    if (type === "purchase") {
      updates.lifetimeCreditsPurchased = lifetime + amount;
    }

    t.update(userRef, updates);
  });

  logger.info(`Added ${amount} credits to user ${uid}`, { type, referenceId });
}

/**
 * Deduct credits from a user's balance.
 * Throws if insufficient balance.
 */
export async function deductCredits(
  uid: string,
  amount: number,
  type: CreditTransactionType,
  description: string,
  referenceId?: string
): Promise<void> {
  if (amount <= 0) throw new Error("Amount must be positive");

  const db = getDb();
  const userRef = db.collection("users").doc(uid);

  await db.runTransaction(async (t) => {
    const userDoc = await t.get(userRef);
    if (!userDoc.exists) throw new HttpsError("not-found", "User not found");

    const currentCredits = userDoc.data()?.credits || 0;

    if (currentCredits < amount) {
      throw new HttpsError("failed-precondition", "Insufficient credits");
    }

    // Create transaction record
    const transRef = db.collection("creditTransactions").doc();
    const transData: CreditTransactionDocData = {
      id: transRef.id,
      userId: uid,
      amount: -amount, // Stored as negative
      type,
      referenceId,
      description,
      createdAt: Date.now(),
    };

    t.set(transRef, transData);
    t.update(userRef, {
      credits: currentCredits - amount,
      updatedAt: Date.now(),
    });
  });

  logger.info(`Deducted ${amount} credits from user ${uid}`, { type, referenceId });
}

/**
 * Get credit history for a user.
 */
export async function getCreditHistory(uid: string, limit = 20) {
  const db = getDb();
  const snapshot = await db
    .collection("creditTransactions")
    .where("userId", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map((d) => d.data() as CreditTransactionDocData);
}
