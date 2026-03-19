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
exports.SendGridProvider = void 0;
const logger = __importStar(require("firebase-functions/logger"));
/**
 * SendGrid email provider.
 * Requires SENDGRID_API_KEY secret set via `firebase functions:secrets:set SENDGRID_API_KEY`.
 */
class SendGridProvider {
    constructor(apiKey) {
        this.baseUrl = "https://api.sendgrid.com/v3";
        this.apiKey = apiKey;
    }
    async send(message) {
        const payload = {
            personalizations: [{ to: [{ email: message.to }] }],
            from: { email: message.from },
            subject: message.subject,
            content: [
                ...(message.text ? [{ type: "text/plain", value: message.text }] : []),
                { type: "text/html", value: message.html },
            ],
            ...(message.replyTo ? { reply_to: { email: message.replyTo } } : {}),
            ...(message.categories?.length ? { categories: message.categories } : {}),
        };
        const response = await fetch(`${this.baseUrl}/mail/send`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const errorBody = await response.text().catch(() => "unknown");
            logger.error("SendGrid send failed", { status: response.status, body: errorBody });
            throw new Error(`SendGrid send failed: ${response.status}`);
        }
        const messageId = response.headers.get("x-message-id") || `sg_${Date.now()}`;
        logger.info("SendGrid email sent", { to: message.to, messageId });
        return { messageId };
    }
    async sendBatch(messages) {
        let sent = 0;
        let failed = 0;
        // SendGrid supports up to 1000 personalizations per request, but we batch in groups of 100
        const batchSize = 100;
        for (let i = 0; i < messages.length; i += batchSize) {
            const batch = messages.slice(i, i + batchSize);
            if (batch.length === 0)
                continue;
            // All messages in a batch must share from/subject for personalizations batching
            const first = batch[0];
            const personalizations = batch.map((msg) => ({
                to: [{ email: msg.to }],
                subject: msg.subject,
            }));
            const payload = {
                personalizations,
                from: { email: first.from },
                content: [
                    ...(first.text ? [{ type: "text/plain", value: first.text }] : []),
                    { type: "text/html", value: first.html },
                ],
                ...(first.categories?.length ? { categories: first.categories } : {}),
            };
            try {
                const response = await fetch(`${this.baseUrl}/mail/send`, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(payload),
                });
                if (response.ok) {
                    sent += batch.length;
                }
                else {
                    const errorBody = await response.text().catch(() => "unknown");
                    logger.error("SendGrid batch send failed", { status: response.status, body: errorBody });
                    failed += batch.length;
                }
            }
            catch (err) {
                logger.error("SendGrid batch send error", { err });
                failed += batch.length;
            }
        }
        return { sent, failed };
    }
}
exports.SendGridProvider = SendGridProvider;
