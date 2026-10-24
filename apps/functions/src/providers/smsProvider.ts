import * as logger from "firebase-functions/logger";
import { TWILIO_OPTED_OUT_ERROR_CODE, enforceSmsCompliance } from "./smsCompliance";

export interface SmsMessage {
  to: string;
  body: string;
  from?: string;
}

export interface SmsBatchResult {
  sent: number;
  failed: number;
  /** Recipients Twilio rejected with 21610 (they replied STOP). */
  optedOut: string[];
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<{ sid: string }>;
  sendBatch(messages: SmsMessage[]): Promise<SmsBatchResult>;
}

export class SmsSendError extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly to: string;

  constructor(status: number, code: number | null, to: string) {
    super(`Twilio send failed: ${status}${code ? ` (${code})` : ""}`);
    this.name = "SmsSendError";
    this.status = status;
    this.code = code;
    this.to = to;
  }

  get recipientOptedOut() {
    return this.code === TWILIO_OPTED_OUT_ERROR_CODE;
  }
}

function twilioErrorCode(body: string): number | null {
  try {
    const parsed = JSON.parse(body) as { code?: unknown };
    const code = Number(parsed.code);
    return Number.isFinite(code) && code > 0 ? code : null;
  } catch {
    return null;
  }
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `***${digits.slice(-4)}` : "***";
}

/**
 * Twilio SMS provider.
 * Requires secrets:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_FROM_NUMBER
 * Set via `firebase functions:secrets:set <KEY>`.
 */
export class TwilioSmsProvider implements SmsProvider {
  private accountSid: string;
  private authToken: string;
  private fromNumber: string;

  private fetchImpl: typeof fetch;

  constructor(accountSid: string, authToken: string, fromNumber: string, fetchImpl: typeof fetch = fetch) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.fromNumber = fromNumber;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Every SMS leaves through here, so the sender name and the
   * "Reply STOP to opt out. Msg & data rates may apply." footer are applied
   * at send time, whatever copy the caller or an admin supplied.
   */
  async send(message: SmsMessage): Promise<{ sid: string }> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

    const params = new URLSearchParams();
    params.set("To", message.to);
    params.set("From", message.from || this.fromNumber);
    params.set("Body", enforceSmsCompliance(message.body));

    const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unknown");
      const code = twilioErrorCode(errorBody);
      if (code === TWILIO_OPTED_OUT_ERROR_CODE) {
        logger.warn("Twilio recipient has opted out", { to: maskPhone(message.to), code });
      } else {
        logger.error("Twilio send failed", { status: response.status, code, body: errorBody });
      }
      throw new SmsSendError(response.status, code, message.to);
    }

    const data = (await response.json()) as { sid?: string };
    const sid = data.sid || `tw_${Date.now()}`;
    logger.info("Twilio SMS sent", { to: maskPhone(message.to), sid });
    return { sid };
  }

  async sendBatch(messages: SmsMessage[]): Promise<SmsBatchResult> {
    let sent = 0;
    let failed = 0;
    const optedOut: string[] = [];

    // Twilio doesn't have a native batch API; send sequentially with concurrency limit
    const concurrency = 5;
    for (let i = 0; i < messages.length; i += concurrency) {
      const batch = messages.slice(i, i + concurrency);
      const results = await Promise.allSettled(batch.map((msg) => this.send(msg)));

      for (const result of results) {
        if (result.status === "fulfilled") {
          sent++;
        } else if (result.reason instanceof SmsSendError && result.reason.recipientOptedOut) {
          optedOut.push(result.reason.to);
          failed++;
        } else {
          logger.error("Twilio batch item failed", { reason: result.reason instanceof Error ? result.reason.message : String(result.reason) });
          failed++;
        }
      }
    }

    return { sent, failed, optedOut };
  }
}
