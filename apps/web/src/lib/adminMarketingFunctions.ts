import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export type MarketingEnvironment = "disabled" | "development" | "production";
export type MarketingSegment =
  | "all_eligible_members"
  | "active_members"
  | "founding_members"
  | "selected_members";

export interface AdminMarketingConfiguration {
  enabled: boolean;
  environment: MarketingEnvironment;
  mailboxConfigured: boolean;
  senderAliases: string[];
  defaultSenderAlias: string;
  approvedReplyTo: string[];
  maxRecipientsPerSend: number;
  rateLimitRecipientsPerHour: number;
  unsubscribeConfigured: boolean;
  memberMailboxConnectionsEnabled: false;
  smsEnabled: false;
  aliasVerifications: Array<Record<string, unknown>>;
}

export interface AdminMarketingCampaign {
  id: string;
  name: string;
  subject: string;
  bodyPreview: string;
  senderAlias: string;
  replyTo?: string;
  segment: MarketingSegment;
  selectedRecipientCount: number;
  status: "draft" | "sending" | "sent" | "partially_failed" | "failed";
  eligibleRecipientCount: number;
  excludedRecipientCount: number;
  sentRecipientCount: number;
  failedRecipientCount: number;
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
  provider: "microsoft_email";
  errorCode: string | null;
}

export interface MarketingRecipientPreview {
  uid: string;
  email: string;
  displayName: string;
}

export const adminMarketingGetConfigurationFn = httpsCallable<
  Record<string, never>,
  AdminMarketingConfiguration
>(functions, "adminMarketing_getConfiguration");

export const adminMarketingSaveDraftFn = httpsCallable<
  {
    campaignId?: string;
    name: string;
    subject: string;
    bodyText: string;
    senderAlias?: string;
    replyTo?: string;
    segment: MarketingSegment;
    selectedUserIds?: string[];
  },
  { campaign: AdminMarketingCampaign }
>(functions, "adminMarketing_saveDraft");

export const adminMarketingPreviewRecipientsFn = httpsCallable<
  { segment: MarketingSegment; selectedUserIds?: string[] },
  {
    eligibleCount: number;
    excludedCount: number;
    excludedByReason: Record<string, number>;
    scannedCount: number;
    capped: boolean;
    sample: MarketingRecipientPreview[];
  }
>(functions, "adminMarketing_previewRecipients");

export const adminMarketingSearchRecipientsFn = httpsCallable<
  { query: string },
  { recipients: MarketingRecipientPreview[] }
>(functions, "adminMarketing_searchRecipients");

export const adminMarketingSendTestFn = httpsCallable<
  {
    recipient: string;
    subject: string;
    bodyText: string;
    senderAlias?: string;
    replyTo?: string;
  },
  {
    success: boolean;
    providerAccepted: boolean;
    requiresRecipientVisibleAliasVerification: boolean;
    messageId?: string;
  }
>(functions, "adminMarketing_sendTest");

export const adminMarketingSendCampaignFn = httpsCallable<
  { campaignId: string; idempotencyKey: string; confirmedRecipientCount: number },
  { idempotent: boolean; campaign: AdminMarketingCampaign }
>(functions, "adminMarketing_sendCampaign");

export const adminMarketingListCampaignsFn = httpsCallable<
  Record<string, never>,
  { campaigns: AdminMarketingCampaign[] }
>(functions, "adminMarketing_listCampaigns");

export const adminMarketingUpdatePreferenceFn = httpsCallable<
  {
    uid: string;
    status: "subscribed" | "unsubscribed" | "suppressed" | "bounced";
    source: string;
    evidenceReference?: string;
    note?: string;
  },
  { success: boolean; uid: string; status: string }
>(functions, "adminMarketing_updatePreference");

export const adminMarketingUnsubscribeFn = httpsCallable<
  { token: string },
  { success: boolean; status: "unsubscribed" }
>(functions, "adminMarketing_unsubscribe");

export const adminMarketingRecordAliasVerificationFn = httpsCallable<
  {
    alias: string;
    observedFrom: string;
    observedReplyTo?: string;
    recipientDomain?: string;
    note?: string;
  },
  { success: boolean; alias: string; verified: boolean }
>(functions, "adminMarketing_recordAliasVerification");
