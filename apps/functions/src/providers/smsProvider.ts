import * as logger from "firebase-functions/logger";

export interface SmsMessage {
  to: string;
  body: string;
  from?: string;
}

export interface SmsProvider {
  send(message: SmsMessage): Promise<{ sid: string }>;
  sendBatch(messages: SmsMessage[]): Promise<{ sent: number; failed: number }>;
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

  constructor(accountSid: string, authToken: string, fromNumber: string) {
    this.accountSid = accountSid;
    this.authToken = authToken;
    this.fromNumber = fromNumber;
  }

  async send(message: SmsMessage): Promise<{ sid: string }> {
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

    const data = (await response.json()) as { sid?: string };
    const sid = data.sid || `tw_${Date.now()}`;
    logger.info("Twilio SMS sent", { to: message.to, sid });
    return { sid };
  }

  async sendBatch(messages: SmsMessage[]): Promise<{ sent: number; failed: number }> {
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
        } else {
          logger.error("Twilio batch item failed", { reason: result.reason });
          failed++;
        }
      }
    }

    return { sent, failed };
  }
}
