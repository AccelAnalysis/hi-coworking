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
exports.resolveRecipients = resolveRecipients;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
/**
 * Resolve campaign recipients based on event registrations and audience rules.
 * For announce/reminder jobs, targets registered users + optionally broader audience.
 * For follow_up jobs, targets only registered attendees.
 */
async function resolveRecipients(campaignId, jobType, eventId, audienceRules) {
    const db = admin.firestore();
    const recipients = new Map();
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
        let usersQuery = db.collection("users")
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
    const enriched = [];
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
            }
            else {
                enriched.push(recipient);
            }
        }
        catch {
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
