"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.addCredits = addCredits;
exports.deductCredits = deductCredits;
exports.getCreditHistory = getCreditHistory;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const https_1 = require("firebase-functions/v2/https");
function getDb() {
    return admin.firestore();
}
/**
 * Add credits to a user's balance.
 */
async function addCredits(uid, amount, type, description, referenceId) {
    if (amount <= 0)
        throw new Error("Amount must be positive");
    const db = getDb();
    const userRef = db.collection("users").doc(uid);
    await db.runTransaction(async (t) => {
        const userDoc = await t.get(userRef);
        if (!userDoc.exists)
            throw new https_1.HttpsError("not-found", "User not found");
        const userData = userDoc.data();
        const currentCredits = userData?.credits || 0;
        const lifetime = userData?.lifetimeCreditsPurchased || 0;
        // Create transaction record
        const transRef = db.collection("creditTransactions").doc();
        const transData = {
            id: transRef.id,
            userId: uid,
            amount: amount,
            type,
            referenceId,
            description,
            createdAt: Date.now(),
        };
        t.set(transRef, transData);
        const updates = {
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
async function deductCredits(uid, amount, type, description, referenceId) {
    if (amount <= 0)
        throw new Error("Amount must be positive");
    const db = getDb();
    const userRef = db.collection("users").doc(uid);
    await db.runTransaction(async (t) => {
        const userDoc = await t.get(userRef);
        if (!userDoc.exists)
            throw new https_1.HttpsError("not-found", "User not found");
        const currentCredits = userDoc.data()?.credits || 0;
        if (currentCredits < amount) {
            throw new https_1.HttpsError("failed-precondition", "Insufficient credits");
        }
        // Create transaction record
        const transRef = db.collection("creditTransactions").doc();
        const transData = {
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
async function getCreditHistory(uid, limit = 20) {
    const db = getDb();
    const snapshot = await db
        .collection("creditTransactions")
        .where("userId", "==", uid)
        .orderBy("createdAt", "desc")
        .limit(limit)
        .get();
    return snapshot.docs.map((d) => d.data());
}
