import { randomUUID } from "node:crypto";
import * as logger from "firebase-functions/logger";

export interface MarketingEmailMessage {
  to: string;
  fromAlias: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  campaignId?: string;
}

export interface MarketingEmailSendResult {
  messageId: string;
  graphRequestId?: string;
  graphClientRequestId?: string;
}

export interface MarketingEmailBatchResult {
  sent: number;
  failed: number;
  results: Array<{
    recipient: string;
    ok: boolean;
    messageId?: string;
    errorCode?: string;
  }>;
}

export interface MarketingEmailProvider {
  send(message: MarketingEmailMessage): Promise<MarketingEmailSendResult>;
  sendBatch(messages: MarketingEmailMessage[]): Promise<MarketingEmailBatchResult>;
}

export interface MicrosoftGraphEmailProviderConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailboxUpn: string;
  timeoutMs?: number;
}

interface CachedGraphToken {
  value: string;
  expiresAt: number;
}

interface GraphTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

export class MicrosoftGraphEmailError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MicrosoftGraphEmailError";
  }
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new MicrosoftGraphEmailError(`${label} is not configured`, "configuration-missing");
  }
  return normalized;
}

function safeCorrelationId(response: Response, fallback: string): string {
  return response.headers.get("request-id")
    || response.headers.get("client-request-id")
    || fallback;
}

/**
 * Application-only Microsoft Graph provider for one centrally controlled
 * Microsoft 365 mailbox. It never accepts delegated user tokens or member
 * credentials. Mailbox and alias authorization are enforced by the caller and
 * by Exchange Online Application RBAC.
 */
export class MicrosoftGraphEmailProvider implements MarketingEmailProvider {
  private readonly tenantId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly mailboxUpn: string;
  private readonly timeoutMs: number;
  private token: CachedGraphToken | null = null;

  constructor(config: MicrosoftGraphEmailProviderConfig) {
    this.tenantId = required(config.tenantId, "Microsoft tenant ID");
    this.clientId = required(config.clientId, "Microsoft client ID");
    this.clientSecret = required(config.clientSecret, "Microsoft client credential");
    this.mailboxUpn = required(config.mailboxUpn, "Microsoft marketing mailbox");
    this.timeoutMs = Math.min(Math.max(config.timeoutMs ?? 20_000, 2_000), 60_000);
  }

  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 60_000) return this.token.value;

    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(
        `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: controller.signal,
        },
      );
    } catch (error) {
      throw new MicrosoftGraphEmailError(
        error instanceof Error && error.name === "AbortError"
          ? "Microsoft token request timed out"
          : "Microsoft token request failed",
        "token-request-failed",
      );
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => ({})) as GraphTokenResponse;
    if (!response.ok || !payload.access_token) {
      logger.error("Microsoft Graph token acquisition failed", {
        status: response.status,
        providerCode: payload.error || "unknown",
      });
      throw new MicrosoftGraphEmailError(
        "Microsoft Graph authentication failed",
        payload.error || "token-rejected",
        response.status,
      );
    }

    this.token = {
      value: payload.access_token,
      expiresAt: now + Math.max(300, payload.expires_in ?? 3_600) * 1_000,
    };
    return this.token.value;
  }

  async send(message: MarketingEmailMessage): Promise<MarketingEmailSendResult> {
    const accessToken = await this.accessToken();
    const clientRequestId = randomUUID();
    const payload = {
      message: {
        subject: message.subject,
        body: {
          contentType: "HTML",
          content: message.html,
        },
        toRecipients: [{ emailAddress: { address: message.to } }],
        from: { emailAddress: { address: message.fromAlias } },
        ...(message.replyTo
          ? { replyTo: [{ emailAddress: { address: message.replyTo } }] }
          : {}),
        ...(message.campaignId
          ? {
            internetMessageHeaders: [{
              name: "x-hi-coworking-campaign-id",
              value: message.campaignId,
            }],
          }
          : {}),
      },
      saveToSentItems: true,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(this.mailboxUpn)}/sendMail`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "client-request-id": clientRequestId,
            "return-client-request-id": "true",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      );
    } catch (error) {
      throw new MicrosoftGraphEmailError(
        error instanceof Error && error.name === "AbortError"
          ? "Microsoft Graph send timed out"
          : "Microsoft Graph send failed",
        "graph-request-failed",
      );
    } finally {
      clearTimeout(timeout);
    }

    const graphRequestId = response.headers.get("request-id") || undefined;
    const graphClientRequestId = response.headers.get("client-request-id") || clientRequestId;
    if (response.status !== 202) {
      const errorPayload = await response.json().catch(() => null) as {
        error?: { code?: string; message?: string };
      } | null;
      logger.error("Microsoft Graph marketing email rejected", {
        status: response.status,
        providerCode: errorPayload?.error?.code || "unknown",
        graphRequestId,
      });
      throw new MicrosoftGraphEmailError(
        "Microsoft Graph rejected the marketing email",
        errorPayload?.error?.code || "graph-send-rejected",
        response.status,
      );
    }

    const messageId = safeCorrelationId(response, `graph_${clientRequestId}`);
    logger.info("Microsoft Graph marketing email accepted", {
      graphRequestId,
      graphClientRequestId,
      campaignId: message.campaignId,
    });
    return { messageId, graphRequestId, graphClientRequestId };
  }

  async sendBatch(messages: MarketingEmailMessage[]): Promise<MarketingEmailBatchResult> {
    const results: MarketingEmailBatchResult["results"] = [];
    let sent = 0;
    let failed = 0;

    // Keep concurrency intentionally low. Exchange Online remains the source of
    // truth for throttling, and each recipient is sent separately so addresses
    // are never exposed to other recipients.
    const concurrency = 3;
    for (let index = 0; index < messages.length; index += concurrency) {
      const batch = messages.slice(index, index + concurrency);
      const outcomes = await Promise.all(batch.map(async (message) => {
        try {
          const result = await this.send(message);
          return {
            recipient: message.to,
            ok: true as const,
            messageId: result.messageId,
          };
        } catch (error) {
          return {
            recipient: message.to,
            ok: false as const,
            errorCode: error instanceof MicrosoftGraphEmailError
              ? error.code
              : "unknown-send-error",
          };
        }
      }));
      for (const outcome of outcomes) {
        results.push(outcome);
        if (outcome.ok) sent += 1;
        else failed += 1;
      }
    }

    return { sent, failed, results };
  }
}
