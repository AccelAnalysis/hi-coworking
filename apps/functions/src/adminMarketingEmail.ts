import { createHash, randomBytes, randomUUID } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import {
  MicrosoftGraphEmailError,
  MicrosoftGraphEmailProvider,
  type MarketingEmailMessage,
} from "./providers/emailProvider";
import { MicrosoftEmailCampaignChannel } from "./providers/adminCampaignChannel";

const CONFIG_COLLECTION = "systemConfig";
const CONFIG_DOCUMENT = "adminMarketingEmail";
const CAMPAIGN_COLLECTION = "adminMarketingCampaigns";
const AUDIT_COLLECTION = "adminMarketingAudits";
const RATE_LIMIT_COLLECTION = "adminMarketingRateLimits";
const PREFERENCE_TOKEN_COLLECTION = "adminMarketingPreferenceTokens";
const ALIAS_VERIFICATION_COLLECTION = "adminMarketingAliasVerifications";
const DEFAULT_SECRET_NAME = "MICROSOFT_MARKETING_CLIENT_SECRET";
const MAX_SELECTED_RECIPIENTS = 150;
const MAX_SEARCH_RESULTS = 25;
const MAX_HISTORY_RESULTS = 50;

export type MarketingEnvironment = "disabled" | "development" | "production";
export type MarketingSegment =
  | "all_eligible_members"
  | "active_members"
  | "founding_members"
  | "selected_members";
export type MarketingPreferenceStatus =
  | "unknown"
  | "subscribed"
  | "unsubscribed"
  | "suppressed"
  | "bounced";

type CampaignStatus =
  | "draft"
  | "sending"
  | "sent"
  | "partially_failed"
  | "failed";

export interface AdminMarketingEmailConfig {
  enabled: boolean;
  environment: MarketingEnvironment;
  tenantId: string;
  clientId: string;
  mailboxUpn: string;
  clientSecretName: string;
  senderAliases: string[];
  defaultSenderAlias: string;
  approvedReplyTo: string[];
  developmentRecipientAllowlist: string[];
  unsubscribeBaseUrl: string;
  maxRecipientsPerSend: number;
  rateLimitRecipientsPerHour: number;
}

interface MarketingPreference {
  status: MarketingPreferenceStatus;
  source?: string;
  evidenceReference?: string;
  updatedAt?: number;
  updatedBy?: string;
}

interface MarketingRecipient {
  uid: string;
  email: string;
  displayName: string;
  status: "subscribed";
}

interface RecipientResolution {
  recipients: MarketingRecipient[];
  excluded: Record<string, number>;
  scanned: number;
}

interface CampaignDraft {
  id: string;
  channel: "microsoft_email";
  status: CampaignStatus;
  name: string;
  subject: string;
  bodyText: string;
  senderAlias: string;
  replyTo?: string;
  segment: MarketingSegment;
  selectedUserIds: string[];
  createdBy: string;
  createdAt: number;
  updatedBy: string;
  updatedAt: number;
  idempotencyHash?: string;
  eligibleRecipientCount?: number;
  excludedRecipientCount?: number;
  sentRecipientCount?: number;
  failedRecipientCount?: number;
  sentAt?: number;
  provider?: "microsoft_email";
  graphCorrelationIds?: string[];
  errorCode?: string;
}

interface CallableAuthLike {
  uid: string;
  token: Record<string, unknown>;
}

function db() {
  return admin.firestore();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown, limit = 200): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean))].slice(0, limit);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(Math.floor(value), minimum), maximum)
    : fallback;
}

export function normalizeEmail(value: unknown): string {
  const email = asString(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function hasAdminMarketingEmailCapability(token: Record<string, unknown> | null | undefined): boolean {
  return token?.role === "master" || token?.adminMarketingEmail === true;
}

function requireMarketingAdmin(auth: CallableAuthLike | null | undefined): CallableAuthLike {
  if (!auth) throw new HttpsError("unauthenticated", "Authentication is required");
  if (!hasAdminMarketingEmailCapability(auth.token)) {
    throw new HttpsError(
      "permission-denied",
      "Administrative marketing email requires the adminMarketingEmail capability",
    );
  }
  return auth;
}

function requireMaster(auth: CallableAuthLike | null | undefined): CallableAuthLike {
  if (!auth) throw new HttpsError("unauthenticated", "Authentication is required");
  if (auth.token.role !== "master") {
    throw new HttpsError("permission-denied", "Only a super administrator can perform this action");
  }
  return auth;
}

export function normalizeAdminMarketingConfig(value: unknown): AdminMarketingEmailConfig {
  const raw = asRecord(value);
  const environment = ["disabled", "development", "production"].includes(asString(raw.environment))
    ? asString(raw.environment) as MarketingEnvironment
    : "disabled";
  const senderAliases = asStringArray(raw.senderAliases, 25)
    .map(normalizeEmail)
    .filter(Boolean);
  const configuredDefault = normalizeEmail(raw.defaultSenderAlias);
  const defaultSenderAlias = senderAliases.includes(configuredDefault)
    ? configuredDefault
    : senderAliases[0] || "";
  return {
    enabled: raw.enabled === true && environment !== "disabled",
    environment,
    tenantId: asString(raw.tenantId),
    clientId: asString(raw.clientId),
    mailboxUpn: normalizeEmail(raw.mailboxUpn),
    clientSecretName: asString(raw.clientSecretName) || DEFAULT_SECRET_NAME,
    senderAliases,
    defaultSenderAlias,
    approvedReplyTo: asStringArray(raw.approvedReplyTo, 25)
      .map(normalizeEmail)
      .filter(Boolean),
    developmentRecipientAllowlist: asStringArray(raw.developmentRecipientAllowlist, 250)
      .map(normalizeEmail)
      .filter(Boolean),
    unsubscribeBaseUrl: asString(raw.unsubscribeBaseUrl),
    maxRecipientsPerSend: boundedInteger(raw.maxRecipientsPerSend, 100, 1, 500),
    rateLimitRecipientsPerHour: boundedInteger(raw.rateLimitRecipientsPerHour, 250, 1, 5_000),
  };
}

async function loadConfig(): Promise<AdminMarketingEmailConfig> {
  const snap = await db().collection(CONFIG_COLLECTION).doc(CONFIG_DOCUMENT).get();
  return normalizeAdminMarketingConfig(snap.data());
}

function ensureConfigured(config: AdminMarketingEmailConfig, options: { requireUnsubscribe?: boolean } = {}) {
  if (!config.enabled) {
    throw new HttpsError(
      "failed-precondition",
      "Microsoft administrative marketing email is disabled",
    );
  }
  if (!config.tenantId || !config.clientId || !config.mailboxUpn || !config.senderAliases.length) {
    throw new HttpsError(
      "failed-precondition",
      "Microsoft administrative marketing email configuration is incomplete",
    );
  }
  if (options.requireUnsubscribe && !/^https:\/\//i.test(config.unsubscribeBaseUrl)) {
    throw new HttpsError(
      "failed-precondition",
      "A secure unsubscribe URL is required before campaign distribution",
    );
  }
}

function validateSenderAlias(config: AdminMarketingEmailConfig, value: unknown): string {
  const alias = normalizeEmail(value) || config.defaultSenderAlias;
  if (!alias || !config.senderAliases.includes(alias)) {
    throw new HttpsError("invalid-argument", "The selected sender alias is not approved");
  }
  return alias;
}

function validateReplyTo(config: AdminMarketingEmailConfig, value: unknown): string | undefined {
  const replyTo = normalizeEmail(value);
  if (!replyTo) return undefined;
  if (!config.approvedReplyTo.includes(replyTo)) {
    throw new HttpsError("invalid-argument", "The selected Reply-To address is not approved");
  }
  return replyTo;
}

function validateCampaignName(value: unknown): string {
  const name = asString(value);
  if (name.length < 2 || name.length > 120) {
    throw new HttpsError("invalid-argument", "Campaign name must be between 2 and 120 characters");
  }
  return name;
}

function validateSubject(value: unknown): string {
  const subject = asString(value).replace(/[\r\n]+/g, " ");
  if (subject.length < 2 || subject.length > 160) {
    throw new HttpsError("invalid-argument", "Subject must be between 2 and 160 characters");
  }
  return subject;
}

function validateBody(value: unknown): string {
  const body = asString(value);
  if (body.length < 2 || body.length > 20_000) {
    throw new HttpsError("invalid-argument", "Message must be between 2 and 20,000 characters");
  }
  return body;
}

function validateSegment(value: unknown): MarketingSegment {
  const segment = asString(value);
  if (![
    "all_eligible_members",
    "active_members",
    "founding_members",
    "selected_members",
  ].includes(segment)) {
    throw new HttpsError("invalid-argument", "A supported member segment is required");
  }
  return segment as MarketingSegment;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderSafeMarketingHtml(
  bodyText: string,
  options: { unsubscribeUrl?: string; testMessage?: boolean } = {},
): string {
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
  const footer = options.testMessage
    ? "<p style=\"margin:24px 0 0;color:#64748b;font-size:12px\">Administrative marketing email test. No subscription status was changed.</p>"
    : options.unsubscribeUrl
      ? `<p style="margin:24px 0 0;color:#64748b;font-size:12px">You are receiving this administrative marketing message because your Hi-Coworking marketing preference is subscribed. <a href="${escapeHtml(options.unsubscribeUrl)}">Unsubscribe</a>.</p>`
      : "";
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;color:#0f172a;font-family:Arial,sans-serif"><div style="max-width:640px;margin:0 auto;padding:32px 24px;background:#ffffff">${paragraphs}${footer}</div></body></html>`;
}

function safeSubjectHash(subject: string): string {
  return createHash("sha256").update(subject).digest("hex").slice(0, 24);
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function preferenceFromUser(data: Record<string, unknown>): MarketingPreference {
  const raw = asRecord(data.marketingEmail);
  const status = ["subscribed", "unsubscribed", "suppressed", "bounced"].includes(asString(raw.status))
    ? asString(raw.status) as MarketingPreferenceStatus
    : "unknown";
  return {
    status,
    source: asString(raw.source) || undefined,
    evidenceReference: asString(raw.evidenceReference) || undefined,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : undefined,
    updatedBy: asString(raw.updatedBy) || undefined,
  };
}

function foundingMember(data: Record<string, unknown>): boolean {
  const plan = asString(data.plan).toLowerCase();
  const exchangeMembership = asRecord(data.exchangeMembership);
  return plan.includes("founding")
    || asString(exchangeMembership.plan).toLowerCase().includes("founding")
    || exchangeMembership.founderNumber !== undefined;
}

export function evaluateMarketingRecipient(
  uid: string,
  rawData: Record<string, unknown>,
  segment: MarketingSegment,
  config: AdminMarketingEmailConfig,
  selectedIds: Set<string>,
): { recipient?: MarketingRecipient; exclusion?: string } {
  const email = normalizeEmail(rawData.email);
  if (!email) return { exclusion: "missing_email" };
  const preference = preferenceFromUser(rawData);
  if (preference.status !== "subscribed" || !preference.source) {
    return { exclusion: preference.status === "unknown" ? "no_explicit_consent" : preference.status };
  }
  const role = asString(rawData.role);
  if (["master", "admin", "staff"].includes(role)) return { exclusion: "administrator_excluded" };
  if (segment === "selected_members" && !selectedIds.has(uid)) return { exclusion: "not_selected" };
  if (segment === "active_members" && rawData.membershipStatus !== "active") {
    return { exclusion: "not_active" };
  }
  if (segment === "founding_members" && !foundingMember(rawData)) {
    return { exclusion: "not_founding" };
  }
  if (config.environment === "development"
      && !config.developmentRecipientAllowlist.includes(email)) {
    return { exclusion: "development_allowlist" };
  }
  return {
    recipient: {
      uid,
      email,
      displayName: asString(rawData.displayName) || "Member",
      status: "subscribed",
    },
  };
}

async function resolveRecipients(
  segment: MarketingSegment,
  selectedUserIds: string[],
  config: AdminMarketingEmailConfig,
): Promise<RecipientResolution> {
  const selectedIds = new Set(selectedUserIds);
  let docs: FirebaseFirestore.DocumentSnapshot[];
  if (segment === "selected_members") {
    if (!selectedUserIds.length) {
      throw new HttpsError("invalid-argument", "Select at least one subscribed member");
    }
    docs = await db().getAll(...selectedUserIds.map((uid) => db().collection("users").doc(uid)));
  } else {
    const snap = await db()
      .collection("users")
      .where("marketingEmail.status", "==", "subscribed")
      .limit(Math.max(config.maxRecipientsPerSend * 5, 500))
      .get();
    docs = snap.docs;
  }

  const recipients: MarketingRecipient[] = [];
  const excluded: Record<string, number> = {};
  for (const doc of docs) {
    if (!doc.exists) {
      excluded.not_found = (excluded.not_found || 0) + 1;
      continue;
    }
    const evaluated = evaluateMarketingRecipient(
      doc.id,
      doc.data() as Record<string, unknown>,
      segment,
      config,
      selectedIds,
    );
    if (evaluated.recipient) recipients.push(evaluated.recipient);
    else {
      const reason = evaluated.exclusion || "ineligible";
      excluded[reason] = (excluded[reason] || 0) + 1;
    }
  }
  return {
    recipients: recipients.slice(0, config.maxRecipientsPerSend),
    excluded,
    scanned: docs.length,
  };
}

async function accessSecret(secretName: string): Promise<string> {
  const mounted = process.env[secretName];
  if (mounted?.trim()) return mounted.trim();

  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  const credential = admin.app().options.credential;
  if (!projectId || !credential) {
    throw new HttpsError(
      "failed-precondition",
      "Google Secret Manager access is not configured for Microsoft marketing email",
    );
  }
  const accessToken = await credential.getAccessToken();
  const response = await fetch(
    `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/secrets/${encodeURIComponent(secretName)}/versions/latest:access`,
    { headers: { Authorization: `Bearer ${accessToken.access_token}` } },
  );
  if (!response.ok) {
    logger.error("Microsoft marketing client credential could not be accessed", {
      secretName,
      status: response.status,
    });
    throw new HttpsError(
      "failed-precondition",
      "Microsoft marketing email credential is unavailable",
    );
  }
  const payload = await response.json() as { payload?: { data?: string } };
  const value = payload.payload?.data
    ? Buffer.from(payload.payload.data, "base64").toString("utf8").trim()
    : "";
  if (!value) {
    throw new HttpsError("failed-precondition", "Microsoft marketing email credential is empty");
  }
  return value;
}

async function channelFor(config: AdminMarketingEmailConfig): Promise<MicrosoftEmailCampaignChannel> {
  const clientSecret = await accessSecret(config.clientSecretName);
  return new MicrosoftEmailCampaignChannel(new MicrosoftGraphEmailProvider({
    tenantId: config.tenantId,
    clientId: config.clientId,
    clientSecret,
    mailboxUpn: config.mailboxUpn,
  }));
}

async function writeAudit(
  action: string,
  actorUid: string,
  details: Record<string, unknown>,
): Promise<void> {
  await db().collection(AUDIT_COLLECTION).add({
    action,
    actorUid,
    channel: "microsoft_email",
    createdAt: Date.now(),
    ...details,
  });
}

async function enforceRateLimit(
  actorUid: string,
  recipientCount: number,
  config: AdminMarketingEmailConfig,
): Promise<void> {
  const now = new Date();
  const hourKey = now.toISOString().slice(0, 13).replace(/[-T:]/g, "");
  const ref = db().collection(RATE_LIMIT_COLLECTION).doc(`${actorUid}_${hourKey}`);
  await db().runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const current = typeof snap.data()?.recipientCount === "number"
      ? snap.data()!.recipientCount as number
      : 0;
    if (current + recipientCount > config.rateLimitRecipientsPerHour) {
      throw new HttpsError(
        "resource-exhausted",
        "The administrative marketing email hourly recipient limit has been reached",
      );
    }
    transaction.set(ref, {
      actorUid,
      hourKey,
      recipientCount: current + recipientCount,
      updatedAt: Date.now(),
      expiresAt: Date.now() + 48 * 60 * 60 * 1_000,
    }, { merge: true });
  });
}

async function createUnsubscribeUrl(
  recipient: MarketingRecipient,
  campaignId: string,
  config: AdminMarketingEmailConfig,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashValue(token);
  await db().collection(PREFERENCE_TOKEN_COLLECTION).doc(tokenHash).set({
    uid: recipient.uid,
    emailHash: hashValue(recipient.email).slice(0, 24),
    campaignId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1_000,
    usedAt: null,
  });
  const url = new URL(config.unsubscribeBaseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

function safeCampaignResult(campaign: CampaignDraft) {
  return {
    id: campaign.id,
    name: campaign.name,
    subject: campaign.subject,
    bodyPreview: campaign.bodyText.slice(0, 240),
    senderAlias: campaign.senderAlias,
    replyTo: campaign.replyTo,
    segment: campaign.segment,
    selectedRecipientCount: campaign.selectedUserIds.length,
    status: campaign.status,
    eligibleRecipientCount: campaign.eligibleRecipientCount || 0,
    excludedRecipientCount: campaign.excludedRecipientCount || 0,
    sentRecipientCount: campaign.sentRecipientCount || 0,
    failedRecipientCount: campaign.failedRecipientCount || 0,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    sentAt: campaign.sentAt || null,
    provider: campaign.provider || "microsoft_email",
    errorCode: campaign.errorCode || null,
  };
}

export const adminMarketing_getConfiguration = onCall(async (request) => {
  requireMarketingAdmin(request.auth as CallableAuthLike | null);
  const config = await loadConfig();
  const verifications = await db().collection(ALIAS_VERIFICATION_COLLECTION).limit(25).get();
  return {
    enabled: config.enabled,
    environment: config.environment,
    mailboxConfigured: Boolean(config.mailboxUpn),
    senderAliases: config.senderAliases,
    defaultSenderAlias: config.defaultSenderAlias,
    approvedReplyTo: config.approvedReplyTo,
    maxRecipientsPerSend: config.maxRecipientsPerSend,
    rateLimitRecipientsPerHour: config.rateLimitRecipientsPerHour,
    unsubscribeConfigured: /^https:\/\//i.test(config.unsubscribeBaseUrl),
    memberMailboxConnectionsEnabled: false,
    smsEnabled: false,
    aliasVerifications: verifications.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
});

export const adminMarketing_saveDraft = onCall(async (request) => {
  const auth = requireMarketingAdmin(request.auth as CallableAuthLike | null);
  const config = await loadConfig();
  ensureConfigured(config);
  const input = asRecord(request.data);
  const id = asString(input.campaignId) || `mkt_${randomUUID()}`;
  if (!/^mkt_[A-Za-z0-9_-]{8,}$/.test(id)) {
    throw new HttpsError("invalid-argument", "Invalid marketing campaign ID");
  }
  const senderAlias = validateSenderAlias(config, input.senderAlias);
  const replyTo = validateReplyTo(config, input.replyTo);
  const segment = validateSegment(input.segment);
  const selectedUserIds = asStringArray(input.selectedUserIds, MAX_SELECTED_RECIPIENTS);
  if (segment !== "selected_members" && selectedUserIds.length) {
    throw new HttpsError("invalid-argument", "Selected member IDs are only valid for the selected-members segment");
  }
  const ref = db().collection(CAMPAIGN_COLLECTION).doc(id);
  const existing = await ref.get();
  const existingData = existing.data() as CampaignDraft | undefined;
  if (existingData && existingData.createdBy !== auth.uid && auth.token.role !== "master") {
    throw new HttpsError("permission-denied", "Only the campaign creator or a super administrator may edit this draft");
  }
  if (existingData && existingData.status !== "draft" && existingData.status !== "failed") {
    throw new HttpsError("failed-precondition", "A campaign that has started sending cannot be edited");
  }
  const now = Date.now();
  const campaign: CampaignDraft = {
    id,
    channel: "microsoft_email",
    status: "draft",
    name: validateCampaignName(input.name),
    subject: validateSubject(input.subject),
    bodyText: validateBody(input.bodyText),
    senderAlias,
    ...(replyTo ? { replyTo } : {}),
    segment,
    selectedUserIds,
    createdBy: existingData?.createdBy || auth.uid,
    createdAt: existingData?.createdAt || now,
    updatedBy: auth.uid,
    updatedAt: now,
  };
  await ref.set(campaign, { merge: false });
  await writeAudit("campaign_draft_saved", auth.uid, {
    campaignId: id,
    senderAlias,
    segment,
    subjectHash: safeSubjectHash(campaign.subject),
  });
  return { campaign: safeCampaignResult(campaign) };
});

export const adminMarketing_previewRecipients = onCall(async (request) => {
  requireMarketingAdmin(request.auth as CallableAuthLike | null);
  const config = await loadConfig();
  ensureConfigured(config);
  const input = asRecord(request.data);
  const segment = validateSegment(input.segment);
  const selectedUserIds = asStringArray(input.selectedUserIds, MAX_SELECTED_RECIPIENTS);
  const resolution = await resolveRecipients(segment, selectedUserIds, config);
  return {
    eligibleCount: resolution.recipients.length,
    excludedCount: Object.values(resolution.excluded).reduce((sum, count) => sum + count, 0),
    excludedByReason: resolution.excluded,
    scannedCount: resolution.scanned,
    capped: resolution.recipients.length >= config.maxRecipientsPerSend,
    sample: resolution.recipients.slice(0, 20).map((recipient) => ({
      uid: recipient.uid,
      email: recipient.email,
      displayName: recipient.displayName,
    })),
  };
});

export const adminMarketing_searchRecipients = onCall(async (request) => {
  requireMarketingAdmin(request.auth as CallableAuthLike | null);
  const config = await loadConfig();
  ensureConfigured(config);
  const queryText = asString(asRecord(request.data).query).toLowerCase();
  if (queryText.length < 2) return { recipients: [] };
  const snap = await db()
    .collection("users")
    .where("marketingEmail.status", "==", "subscribed")
    .limit(250)
    .get();
  const recipients = snap.docs.flatMap((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const evaluated = evaluateMarketingRecipient(
      doc.id,
      data,
      "all_eligible_members",
      config,
      new Set(),
    );
    if (!evaluated.recipient) return [];
    const haystack = `${evaluated.recipient.displayName} ${evaluated.recipient.email}`.toLowerCase();
    return haystack.includes(queryText) ? [evaluated.recipient] : [];
  }).slice(0, MAX_SEARCH_RESULTS);
  return { recipients };
});

export const adminMarketing_sendTest = onCall(async (request) => {
  const auth = requireMarketingAdmin(request.auth as CallableAuthLike | null);
  const config = await loadConfig();
  ensureConfigured(config);
  const input = asRecord(request.data);
  const recipient = normalizeEmail(input.recipient);
  if (!recipient || !config.developmentRecipientAllowlist.includes(recipient)) {
    throw new HttpsError(
      "permission-denied",
      "Test recipients must be present in the server-controlled recipient allowlist",
    );
  }
  const senderAlias = validateSenderAlias(config, input.senderAlias);
  const replyTo = validateReplyTo(config, input.replyTo);
  const subject = validateSubject(input.subject);
  const bodyText = validateBody(input.bodyText);
  await enforceRateLimit(auth.uid, 1, config);
  const testId = `test_${randomUUID()}`;
  const channel = await channelFor(config);
  const result = await channel.deliver([{
    to: recipient,
    fromAlias: senderAlias,
    subject: `[TEST] ${subject}`.slice(0, 160),
    html: renderSafeMarketingHtml(bodyText, { testMessage: true }),
    text: bodyText,
    replyTo,
    campaignId: testId,
  }]);
  await writeAudit("test_email_requested", auth.uid, {
    campaignId: testId,
    senderAlias,
    recipientCount: 1,
    sentRecipientCount: result.sent,
    failedRecipientCount: result.failed,
    subjectHash: safeSubjectHash(subject),
    environment: config.environment,
    result: result.failed ? "failed" : "accepted",
  });
  if (result.failed) {
    throw new HttpsError("internal", "Microsoft Graph did not accept the test message");
  }
  return {
    success: true,
    providerAccepted: true,
    requiresRecipientVisibleAliasVerification: true,
    messageId: result.results[0]?.messageId,
  };
});

export const adminMarketing_sendCampaign = onCall(async (request) => {
  const auth = requireMarketingAdmin(request.auth as CallableAuthLike | null);
  const config = await loadConfig();
  ensureConfigured(config, { requireUnsubscribe: true });
  const input = asRecord(request.data);
  const campaignId = asString(input.campaignId);
  const idempotencyKey = asString(input.idempotencyKey);
  const confirmedRecipientCount = boundedInteger(input.confirmedRecipientCount, -1, -1, 100_000);
  if (!campaignId || idempotencyKey.length < 12 || idempotencyKey.length > 200) {
    throw new HttpsError("invalid-argument", "Campaign ID and a valid idempotency key are required");
  }
  const ref = db().collection(CAMPAIGN_COLLECTION).doc(campaignId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Marketing campaign not found");
  const campaign = snap.data() as CampaignDraft;
  const idempotencyHash = hashValue(idempotencyKey);
  if (["sent", "partially_failed"].includes(campaign.status)
      && campaign.idempotencyHash === idempotencyHash) {
    return { idempotent: true, campaign: safeCampaignResult(campaign) };
  }
  if (campaign.status !== "draft" && campaign.status !== "failed") {
    throw new HttpsError("failed-precondition", "Campaign is already being processed");
  }
  const resolution = await resolveRecipients(campaign.segment, campaign.selectedUserIds, config);
  if (!resolution.recipients.length) {
    throw new HttpsError("failed-precondition", "No explicitly subscribed recipients are eligible");
  }
  if (confirmedRecipientCount !== resolution.recipients.length) {
    throw new HttpsError(
      "failed-precondition",
      "Recipient count changed. Preview and confirm the current eligible count before sending",
    );
  }
  await enforceRateLimit(auth.uid, resolution.recipients.length, config);

  const claimed = await db().runTransaction(async (transaction) => {
    const currentSnap = await transaction.get(ref);
    const current = currentSnap.data() as CampaignDraft | undefined;
    if (!current) throw new HttpsError("not-found", "Marketing campaign not found");
    if (["sent", "partially_failed"].includes(current.status)
        && current.idempotencyHash === idempotencyHash) return false;
    if (current.status !== "draft" && current.status !== "failed") {
      throw new HttpsError("aborted", "Campaign was claimed by another request");
    }
    transaction.update(ref, {
      status: "sending",
      idempotencyHash,
      eligibleRecipientCount: resolution.recipients.length,
      excludedRecipientCount: Object.values(resolution.excluded).reduce((sum, count) => sum + count, 0),
      updatedBy: auth.uid,
      updatedAt: Date.now(),
      errorCode: FieldValue.delete(),
    });
    return true;
  });
  if (!claimed) {
    const current = (await ref.get()).data() as CampaignDraft;
    return { idempotent: true, campaign: safeCampaignResult(current) };
  }

  try {
    const messages: MarketingEmailMessage[] = [];
    for (const recipient of resolution.recipients) {
      const unsubscribeUrl = await createUnsubscribeUrl(recipient, campaignId, config);
      messages.push({
        to: recipient.email,
        fromAlias: campaign.senderAlias,
        subject: campaign.subject,
        html: renderSafeMarketingHtml(campaign.bodyText, { unsubscribeUrl }),
        text: `${campaign.bodyText}\n\nUnsubscribe: ${unsubscribeUrl}`,
        replyTo: campaign.replyTo,
        campaignId,
      });
    }
    const channel = await channelFor(config);
    const delivery = await channel.deliver(messages);
    const status: CampaignStatus = delivery.sent === messages.length
      ? "sent"
      : delivery.sent > 0
        ? "partially_failed"
        : "failed";
    const correlationIds = delivery.results
      .flatMap((result) => result.messageId ? [result.messageId] : [])
      .slice(0, 20);
    const now = Date.now();
    await ref.update({
      status,
      provider: delivery.provider,
      sentRecipientCount: delivery.sent,
      failedRecipientCount: delivery.failed,
      sentAt: now,
      updatedAt: now,
      graphCorrelationIds: correlationIds,
      ...(status === "failed" ? { errorCode: "all-deliveries-failed" } : { errorCode: FieldValue.delete() }),
    });
    await writeAudit("campaign_send_completed", auth.uid, {
      campaignId,
      campaignName: campaign.name,
      senderAlias: campaign.senderAlias,
      segment: campaign.segment,
      eligibleRecipientCount: resolution.recipients.length,
      excludedRecipientCount: Object.values(resolution.excluded).reduce((sum, count) => sum + count, 0),
      sentRecipientCount: delivery.sent,
      failedRecipientCount: delivery.failed,
      consentFiltering: resolution.excluded,
      subjectHash: safeSubjectHash(campaign.subject),
      environment: config.environment,
      result: status,
    });
    const updated = (await ref.get()).data() as CampaignDraft;
    return { idempotent: false, campaign: safeCampaignResult(updated) };
  } catch (error) {
    const errorCode = error instanceof MicrosoftGraphEmailError
      ? error.code
      : error instanceof HttpsError
        ? error.code
        : "campaign-send-failed";
    await ref.update({ status: "failed", errorCode, updatedAt: Date.now() });
    await writeAudit("campaign_send_failed", auth.uid, {
      campaignId,
      senderAlias: campaign.senderAlias,
      subjectHash: safeSubjectHash(campaign.subject),
      environment: config.environment,
      errorClassification: errorCode,
    });
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", "Administrative marketing campaign delivery failed");
  }
});

export const adminMarketing_listCampaigns = onCall(async (request) => {
  requireMarketingAdmin(request.auth as CallableAuthLike | null);
  const snap = await db()
    .collection(CAMPAIGN_COLLECTION)
    .orderBy("createdAt", "desc")
    .limit(MAX_HISTORY_RESULTS)
    .get();
  return { campaigns: snap.docs.map((doc) => safeCampaignResult(doc.data() as CampaignDraft)) };
});

export const adminMarketing_updatePreference = onCall(async (request) => {
  const auth = requireMarketingAdmin(request.auth as CallableAuthLike | null);
  const input = asRecord(request.data);
  const uid = asString(input.uid);
  const status = asString(input.status) as MarketingPreferenceStatus;
  const source = asString(input.source);
  const evidenceReference = asString(input.evidenceReference);
  const note = asString(input.note).slice(0, 500);
  if (!uid || !["subscribed", "unsubscribed", "suppressed", "bounced"].includes(status)) {
    throw new HttpsError("invalid-argument", "User ID and a supported marketing status are required");
  }
  if (!source || (status === "subscribed" && evidenceReference.length < 3)) {
    throw new HttpsError(
      "invalid-argument",
      "A source and documented evidence reference are required; consent must not be fabricated",
    );
  }
  const userRef = db().collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError("not-found", "Member not found");
  const previous = preferenceFromUser(userSnap.data() as Record<string, unknown>);
  await userRef.update({
    marketingEmail: {
      status,
      source,
      evidenceReference: evidenceReference || null,
      updatedAt: Date.now(),
      updatedBy: auth.uid,
    },
    updatedAt: Date.now(),
  });
  await writeAudit("recipient_preference_updated", auth.uid, {
    recipientUid: uid,
    previousStatus: previous.status,
    newStatus: status,
    source,
    evidenceReferenceHash: evidenceReference ? hashValue(evidenceReference).slice(0, 24) : null,
    note: note || null,
  });
  return { success: true, uid, status };
});

export const adminMarketing_unsubscribe = onCall(async (request) => {
  const token = asString(asRecord(request.data).token);
  if (token.length < 32 || token.length > 200) {
    throw new HttpsError("invalid-argument", "A valid unsubscribe token is required");
  }
  const tokenHash = hashValue(token);
  const tokenRef = db().collection(PREFERENCE_TOKEN_COLLECTION).doc(tokenHash);
  const result = await db().runTransaction(async (transaction) => {
    const tokenSnap = await transaction.get(tokenRef);
    const tokenData = tokenSnap.data();
    if (!tokenData || typeof tokenData.uid !== "string") {
      throw new HttpsError("not-found", "This unsubscribe link is invalid");
    }
    if (typeof tokenData.expiresAt !== "number" || tokenData.expiresAt < Date.now()) {
      throw new HttpsError("deadline-exceeded", "This unsubscribe link has expired");
    }
    const userRef = db().collection("users").doc(tokenData.uid);
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) throw new HttpsError("not-found", "Member record not found");
    transaction.update(userRef, {
      marketingEmail: {
        status: "unsubscribed",
        source: "email_unsubscribe_link",
        evidenceReference: tokenData.campaignId || null,
        updatedAt: Date.now(),
        updatedBy: "self_service",
      },
      updatedAt: Date.now(),
    });
    transaction.set(tokenRef, { usedAt: Date.now() }, { merge: true });
    return { uid: tokenData.uid as string, campaignId: tokenData.campaignId as string | undefined };
  });
  await writeAudit("recipient_unsubscribed", "self_service", {
    recipientUid: result.uid,
    campaignId: result.campaignId || null,
    result: "unsubscribed",
  });
  return { success: true, status: "unsubscribed" as const };
});

export const adminMarketing_setCapability = onCall(async (request) => {
  const auth = requireMaster(request.auth as CallableAuthLike | null);
  const input = asRecord(request.data);
  const targetUid = asString(input.targetUid);
  const enabled = input.enabled === true;
  if (!targetUid) throw new HttpsError("invalid-argument", "Target user ID is required");
  const target = await admin.auth().getUser(targetUid);
  const claims = { ...(target.customClaims || {}) };
  if (enabled) claims.adminMarketingEmail = true;
  else delete claims.adminMarketingEmail;
  await admin.auth().setCustomUserClaims(targetUid, claims);
  await writeAudit("marketing_capability_updated", auth.uid, {
    targetUid,
    enabled,
  });
  return { success: true, targetUid, enabled };
});

export const adminMarketing_recordAliasVerification = onCall(async (request) => {
  const auth = requireMarketingAdmin(request.auth as CallableAuthLike | null);
  const config = await loadConfig();
  ensureConfigured(config);
  const input = asRecord(request.data);
  const alias = validateSenderAlias(config, input.alias);
  const observedFrom = normalizeEmail(input.observedFrom);
  const observedReplyTo = normalizeEmail(input.observedReplyTo);
  const note = asString(input.note).slice(0, 1_000);
  if (observedFrom !== alias) {
    throw new HttpsError(
      "failed-precondition",
      "The recipient-visible From address does not match the approved alias",
    );
  }
  if (observedReplyTo && !config.approvedReplyTo.includes(observedReplyTo)) {
    throw new HttpsError("invalid-argument", "The observed Reply-To address is not approved");
  }
  const id = hashValue(alias).slice(0, 32);
  await db().collection(ALIAS_VERIFICATION_COLLECTION).doc(id).set({
    alias,
    observedFrom,
    observedReplyTo: observedReplyTo || null,
    recipientDomain: asString(input.recipientDomain).slice(0, 120) || null,
    note: note || null,
    verifiedBy: auth.uid,
    verifiedAt: Date.now(),
  }, { merge: true });
  await writeAudit("sender_alias_verified", auth.uid, {
    alias,
    observedFrom,
    observedReplyTo: observedReplyTo || null,
  });
  return { success: true, alias, verified: true };
});
