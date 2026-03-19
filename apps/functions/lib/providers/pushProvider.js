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
exports.FcmPushProvider = void 0;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
/**
 * Firebase Cloud Messaging push provider.
 * Uses the Firebase Admin SDK — no additional secrets needed beyond the service account.
 */
class FcmPushProvider {
    async send(message) {
        const messaging = admin.messaging();
        const fcmMessage = {
            token: message.token,
            notification: {
                title: message.title,
                body: message.body,
                ...(message.imageUrl ? { imageUrl: message.imageUrl } : {}),
            },
            data: {
                ...(message.data || {}),
                ...(message.link ? { link: message.link } : {}),
            },
            webpush: {
                fcmOptions: {
                    link: message.link || "/events",
                },
            },
        };
        const messageId = await messaging.send(fcmMessage);
        logger.info("FCM push sent", { token: message.token.slice(0, 12) + "...", messageId });
        return { messageId };
    }
    async sendBatch(messages) {
        if (messages.length === 0)
            return { sent: 0, failed: 0 };
        const messaging = admin.messaging();
        // FCM sendEachForMulticast supports up to 500 messages per call
        const batchSize = 500;
        let sent = 0;
        let failed = 0;
        for (let i = 0; i < messages.length; i += batchSize) {
            const batch = messages.slice(i, i + batchSize);
            const fcmMessages = batch.map((msg) => ({
                token: msg.token,
                notification: {
                    title: msg.title,
                    body: msg.body,
                    ...(msg.imageUrl ? { imageUrl: msg.imageUrl } : {}),
                },
                data: {
                    ...(msg.data || {}),
                    ...(msg.link ? { link: msg.link } : {}),
                },
            }));
            try {
                const response = await messaging.sendEach(fcmMessages);
                sent += response.successCount;
                failed += response.failureCount;
                if (response.failureCount > 0) {
                    const failedTokens = response.responses
                        .map((resp, idx) => (!resp.success ? batch[idx].token.slice(0, 12) : null))
                        .filter(Boolean);
                    logger.warn("FCM batch partial failure", { failedCount: response.failureCount, failedTokens });
                }
            }
            catch (err) {
                logger.error("FCM batch send error", { err });
                failed += batch.length;
            }
        }
        return { sent, failed };
    }
}
exports.FcmPushProvider = FcmPushProvider;
