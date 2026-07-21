import type {
  MarketingEmailBatchResult,
  MarketingEmailMessage,
  MarketingEmailProvider,
} from "./emailProvider";

export type AdminCampaignChannelName = "microsoft_email" | "sms";

export interface AdminCampaignDeliveryResult {
  sent: number;
  failed: number;
  provider: AdminCampaignChannelName;
  results: MarketingEmailBatchResult["results"];
}

export interface AdminCampaignChannel<TMessage> {
  readonly name: AdminCampaignChannelName;
  deliver(messages: TMessage[]): Promise<AdminCampaignDeliveryResult>;
}

/**
 * Current production-shaped channel. SMS is intentionally not implemented;
 * a future provider can satisfy this same contract without changing campaign
 * authorization, consent, suppression, idempotency, or audit services.
 */
export class MicrosoftEmailCampaignChannel implements AdminCampaignChannel<MarketingEmailMessage> {
  readonly name = "microsoft_email" as const;

  constructor(private readonly provider: MarketingEmailProvider) {}

  async deliver(messages: MarketingEmailMessage[]): Promise<AdminCampaignDeliveryResult> {
    const result = await this.provider.sendBatch(messages);
    return {
      ...result,
      provider: this.name,
    };
  }
}
