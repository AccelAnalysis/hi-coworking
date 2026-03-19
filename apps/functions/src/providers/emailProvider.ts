import * as logger from "firebase-functions/logger";

export interface EmailMessage {
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  categories?: string[];
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ messageId: string }>;
  sendBatch(messages: EmailMessage[]): Promise<{ sent: number; failed: number }>;
}

/**
 * SendGrid email provider.
 * Requires SENDGRID_API_KEY secret set via `firebase functions:secrets:set SENDGRID_API_KEY`.
 */
export class SendGridProvider implements EmailProvider {
  private apiKey: string;
  private baseUrl = "https://api.sendgrid.com/v3";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async send(message: EmailMessage): Promise<{ messageId: string }> {
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

  async sendBatch(messages: EmailMessage[]): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    // SendGrid supports up to 1000 personalizations per request, but we batch in groups of 100
    const batchSize = 100;
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);

      if (batch.length === 0) continue;

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
        } else {
          const errorBody = await response.text().catch(() => "unknown");
          logger.error("SendGrid batch send failed", { status: response.status, body: errorBody });
          failed += batch.length;
        }
      } catch (err) {
        logger.error("SendGrid batch send error", { err });
        failed += batch.length;
      }
    }

    return { sent, failed };
  }
}
