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
exports.TwilioSmsProvider = void 0;
const logger = __importStar(require("firebase-functions/logger"));
/**
 * Twilio SMS provider.
 * Requires secrets:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER
 * Set via `firebase functions:secrets:set <KEY>`.
 */
class TwilioSmsProvider {
    constructor(accountSid, authToken, fromNumber) {
        this.accountSid = accountSid;
        this.authToken = authToken;
        this.fromNumber = fromNumber;
    }
    async send(message) {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
        const params = new URLSearchParams();
        params.set("To", message.to);
        params.set("From", message.from || this.fromNumber);
        params.set("Body", message.body);
        const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
        });
        if (!response.ok) {
            const errorBody = await response.text().catch(() => "unknown");
            logger.error("Twilio send failed", { status: response.status, body: errorBody });
            throw new Error(`Twilio send failed: ${response.status}`);
        }
        const data = (await response.json());
        const sid = data.sid || `tw_${Date.now()}`;
        logger.info("Twilio SMS sent", { to: message.to, sid });
        return { sid };
    }
    async sendBatch(messages) {
        let sent = 0;
        let failed = 0;
        // Twilio doesn't have a native batch API; send sequentially with concurrency limit
        const concurrency = 5;
        for (let i = 0; i < messages.length; i += concurrency) {
            const batch = messages.slice(i, i + concurrency);
            const results = await Promise.allSettled(batch.map((msg) => this.send(msg)));
            for (const result of results) {
                if (result.status === "fulfilled") {
                    sent++;
                }
                else {
                    logger.error("Twilio batch item failed", { reason: result.reason });
                    failed++;
                }
            }
        }
        return { sent, failed };
    }
}
exports.TwilioSmsProvider = TwilioSmsProvider;
