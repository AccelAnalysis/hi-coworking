import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  imageUrl?: string;
  data?: Record<string, string>;
  link?: string;
}

export interface PushProvider {
  send(message: PushMessage): Promise<{ messageId: string }>;
  sendBatch(messages: PushMessage[]): Promise<{ sent: number; failed: number }>;
}

/**
 * Firebase Cloud Messaging push provider.
 * Uses the Firebase Admin SDK — no additional secrets needed beyond the service account.
 */
export class FcmPushProvider implements PushProvider {
  async send(message: PushMessage): Promise<{ messageId: string }> {
    const messaging = admin.messaging();

    const fcmMessage: admin.messaging.Message = {
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

  async sendBatch(messages: PushMessage[]): Promise<{ sent: number; failed: number }> {
    if (messages.length === 0) return { sent: 0, failed: 0 };

    const messaging = admin.messaging();

    // FCM sendEachForMulticast supports up to 500 messages per call
    const batchSize = 500;
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);

      const fcmMessages: admin.messaging.Message[] = batch.map((msg) => ({
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
      } catch (err) {
        logger.error("FCM batch send error", { err });
        failed += batch.length;
      }
    }

    return { sent, failed };
  }
}
