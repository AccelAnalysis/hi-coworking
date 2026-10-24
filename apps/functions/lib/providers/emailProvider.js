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
exports.ResendEmailProvider = exports.EmailSendError = exports.RESEND_BATCH_LIMIT = exports.RESEND_API_BASE_URL = exports.DEFAULT_EMAIL_FROM = exports.RESEND_API_KEY_SECRET_NAME = void 0;
exports.emailFrom = emailFrom;
exports.emailReplyTo = emailReplyTo;
exports.categoryTags = categoryTags;
const node_crypto_1 = require("node:crypto");
const logger = __importStar(require("firebase-functions/logger"));
/**
 * Outbound email for the Hi Coworking app. Resend is the only provider.
 *
 * The API key comes from the Secret Manager secret named by
 * RESEND_API_KEY_SECRET_NAME (see ./emailSecret.ts). It is never read from
 * git, an .env file, or logs. The sender defaults to hello@hi-coworking.com
 * and can be overridden with the HI_COWORKING_EMAIL_FROM env var.
 *
 * The Power NOW confirmation mail for expo_submitNasaLead has its own Resend
 * client in ../expo/powerNowConfirmation.ts and does not use this module.
 */
exports.RESEND_API_KEY_SECRET_NAME = "HI_COWORKING_RESEND_API_KEY";
exports.DEFAULT_EMAIL_FROM = "Hi Coworking <hello@hi-coworking.com>";
exports.RESEND_API_BASE_URL = "https://api.resend.com";
exports.RESEND_BATCH_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 10000;
class EmailSendError extends Error {
    constructor(status, code) {
        super(`Resend send failed: ${status ?? "network"} ${code}`.trim());
        this.name = "EmailSendError";
        this.status = status;
        this.code = code;
        this.retryable = status === null || status === 429 || status >= 500;
    }
}
exports.EmailSendError = EmailSendError;
/** Sender for app mail. HI_COWORKING_EMAIL_FROM may be a bare address or "Name <address>". */
function emailFrom(env = process.env) {
    const raw = env.HI_COWORKING_EMAIL_FROM?.trim();
    if (!raw)
        return exports.DEFAULT_EMAIL_FROM;
    if (raw.includes("<") && raw.includes(">"))
        return raw;
    return `Hi Coworking <${raw}>`;
}
/** Optional Reply-To for app mail. Unset by default, matching the previous provider. */
function emailReplyTo(env = process.env) {
    return env.HI_COWORKING_EMAIL_REPLY_TO?.trim() || undefined;
}
/** Resend tag names and values allow only ASCII letters, digits, "_" and "-". */
function categoryTags(categories) {
    const seen = new Set();
    const tags = [];
    for (const category of categories || []) {
        const name = category.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
        if (!name || seen.has(name))
            continue;
        seen.add(name);
        tags.push({ name, value: "true" });
    }
    return tags;
}
/**
 * Resend REST client. Uses fetch so there is no SDK dependency, and so tests
 * can pass a mocked fetch. Logs never include the API key, recipient
 * addresses, or Resend's error message text (which can echo addresses).
 */
class ResendEmailProvider {
    constructor(apiKey, options = {}) {
        this.apiKey = apiKey;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        this.env = options.env ?? process.env;
        this.baseUrl = options.baseUrl ?? exports.RESEND_API_BASE_URL;
    }
    payload(message) {
        const replyTo = message.replyTo || emailReplyTo(this.env);
        const tags = categoryTags(message.categories);
        return {
            from: message.from || emailFrom(this.env),
            to: [message.to],
            subject: message.subject,
            html: message.html,
            ...(message.text ? { text: message.text } : {}),
            ...(replyTo ? { reply_to: replyTo } : {}),
            ...(tags.length ? { tags } : {}),
        };
    }
    async post(path, body, idempotencyKey) {
        const headers = {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
        };
        if (idempotencyKey)
            headers["Idempotency-Key"] = idempotencyKey;
        let response;
        try {
            response = await this.fetchImpl(`${this.baseUrl}${path}`, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(this.timeoutMs),
            });
        }
        catch (error) {
            const code = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
                ? "timeout"
                : "network_error";
            throw new EmailSendError(null, code);
        }
        const parsed = await response.json().catch(() => null);
        if (!response.ok) {
            const code = typeof parsed?.name === "string" && /^[a-z_]{1,64}$/.test(parsed.name) ? parsed.name : "error";
            throw new EmailSendError(response.status, code);
        }
        return parsed;
    }
    async send(message) {
        if (!this.apiKey)
            throw new EmailSendError(null, "missing_api_key");
        const payload = this.payload(message);
        const idempotencyKey = message.idempotencyKey ? idempotencyKeyFor(message.idempotencyKey, payload) : undefined;
        try {
            const body = await this.post("/emails", payload, idempotencyKey);
            const messageId = typeof body?.id === "string" && body.id.trim() ? body.id.trim() : `resend_${Date.now()}`;
            logger.info("Resend email sent", { messageId, tags: payload.tags?.map((tag) => tag.name) });
            return { messageId };
        }
        catch (error) {
            logSendError("Resend send failed", error);
            throw error;
        }
    }
    async sendBatch(messages) {
        let sent = 0;
        let failed = 0;
        if (!this.apiKey)
            return { sent: 0, failed: messages.length };
        // Resend's batch endpoint takes up to 100 messages, each with its own
        // subject and body, so every recipient gets their own rendered copy.
        for (let i = 0; i < messages.length; i += exports.RESEND_BATCH_LIMIT) {
            const batch = messages.slice(i, i + exports.RESEND_BATCH_LIMIT);
            if (batch.length === 0)
                continue;
            try {
                const body = await this.post("/emails/batch", batch.map((message) => this.payload(message)));
                const ids = Array.isArray(body?.data) ? body.data.length : batch.length;
                sent += Math.min(ids, batch.length);
                failed += batch.length - Math.min(ids, batch.length);
            }
            catch (error) {
                logSendError("Resend batch send failed", error, { batchSize: batch.length });
                failed += batch.length;
            }
        }
        return { sent, failed };
    }
}
exports.ResendEmailProvider = ResendEmailProvider;
function idempotencyKeyFor(prefix, payload) {
    const digest = (0, node_crypto_1.createHash)("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
    return `${prefix.slice(0, 200)}/${digest}`;
}
function logSendError(label, error, extra = {}) {
    if (error instanceof EmailSendError) {
        logger.error(label, { status: error.status, code: error.code, retryable: error.retryable, ...extra });
    }
    else {
        logger.error(label, { code: "unexpected", ...extra });
    }
}
