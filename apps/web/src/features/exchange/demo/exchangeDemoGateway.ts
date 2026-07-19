import type { ExchangeRepositorySnapshot } from "../data/exchangeRepository";
import type {
  ConnectionQuery,
  CreateReferralDraftInput,
  ExchangeRun3Gateway,
  ReferralWorkspaceRecord,
  ReferralWorkspaceSnapshot,
} from "../data/exchangeRun3Gateway";
import type { ExchangeConnectionMode } from "../state/exchangeWorkspaceTypes";
import {
  EXCHANGE_DEMO_INTELLIGENCE,
  EXCHANGE_DEMO_RFX,
  EXCHANGE_DEMO_SERVICE_OFFERS,
  EXCHANGE_DEMO_SUGGESTIONS,
  EXCHANGE_DEMO_TERRITORIES,
  cloneDemoReferrals,
} from "./exchangeDemoFixtures";

function modeMatches(
  record: ReferralWorkspaceRecord,
  mode: ExchangeConnectionMode,
): boolean {
  switch (mode) {
    case "sent":
      return record.direction === "sent" && record.status !== "draft";
    case "received":
      return record.direction === "received";
    case "draft":
      return record.status === "draft";
    case "active":
      return ["sent", "accepted", "in_progress"].includes(record.status)
        && !record.activeDispute;
    case "converted":
      return record.status === "converted" && !record.activeDispute;
    case "closed":
      return ["closed", "declined", "withdrawn", "expired"].includes(record.status);
    case "disputed":
      return record.activeDispute || record.commerceStatus === "disputed";
  }
}

function textMatches(record: ReferralWorkspaceRecord, searchQuery: string): boolean {
  const query = searchQuery.trim().toLocaleLowerCase();
  if (!query) return true;
  return [
    record.title,
    record.needSummary,
    record.category,
    record.referrerLabel,
    record.recipientLabel,
    record.territoryLabel,
    ...record.naicsCodes,
  ].some((value) => value?.toLocaleLowerCase().includes(query));
}

function countModes(records: ReferralWorkspaceRecord[]): Record<ExchangeConnectionMode, number> {
  return {
    sent: records.filter((record) => modeMatches(record, "sent")).length,
    received: records.filter((record) => modeMatches(record, "received")).length,
    draft: records.filter((record) => modeMatches(record, "draft")).length,
    active: records.filter((record) => modeMatches(record, "active")).length,
    converted: records.filter((record) => modeMatches(record, "converted")).length,
    closed: records.filter((record) => modeMatches(record, "closed")).length,
    disputed: records.filter((record) => modeMatches(record, "disputed")).length,
  };
}

export function filterDemoConnections(
  records: ReferralWorkspaceRecord[],
  query: ConnectionQuery,
): ReferralWorkspaceRecord[] {
  const suggestionRelationships = new Map(
    EXCHANGE_DEMO_SUGGESTIONS.map((suggestion) => [
      suggestion.providerLabel,
      suggestion.relationshipState,
    ]),
  );
  return records.filter((record) => {
    if (!modeMatches(record, query.mode)) return false;
    if (!textMatches(record, query.searchQuery)) return false;
    if (query.statuses.length > 0 && !query.statuses.includes(record.status)) return false;
    if (
      query.industries.length > 0
      && !query.industries.some((industry) =>
        record.category.toLocaleLowerCase().includes(industry.toLocaleLowerCase())
        || record.naicsCodes.includes(industry))
    ) return false;
    if (
      query.territories.length > 0
      && (!record.territoryFips || !query.territories.includes(record.territoryFips))
    ) return false;
    if (query.compensation === "configured" && !record.compensation.configured) return false;
    if (query.compensation === "none" && record.compensation.configured) return false;
    if (
      query.relationship !== "all"
      && suggestionRelationships.get(record.recipientLabel) !== query.relationship
    ) return false;
    return true;
  });
}

function appendEvent(
  record: ReferralWorkspaceRecord,
  type: string,
  label: string,
): ReferralWorkspaceRecord {
  const now = Date.now();
  return {
    ...record,
    updatedAt: now,
    version: record.version + 1,
    timeline: [
      ...record.timeline,
      {
        id: `${record.id}-event-${record.timeline.length + 1}`,
        type,
        label,
        actorLabel: "Demo member",
        createdAt: now,
      },
    ],
  };
}

export function calculateDemoReferralAmounts(
  grossReferralPayoutCents: number,
  platformFeeBasisPoints = 100,
) {
  if (!Number.isSafeInteger(grossReferralPayoutCents) || grossReferralPayoutCents < 0) {
    throw new Error("Gross referral payout must be non-negative integer cents");
  }
  const platformFeeCents = Math.floor(
    (grossReferralPayoutCents * platformFeeBasisPoints + 5_000) / 10_000,
  );
  return {
    grossReferralPayoutCents,
    platformFeeBasisPoints,
    platformFeeCents,
    netReferrerPayoutCents: grossReferralPayoutCents - platformFeeCents,
  };
}

export function createExchangeDemoGateway(
  initialRecords: ReferralWorkspaceRecord[] = cloneDemoReferrals(),
): ExchangeRun3Gateway {
  let records = structuredClone(initialRecords);
  let createdCount = 0;
  const reportedAmounts = new Map<string, number>();

  const find = (referralId: string) => {
    const record = records.find((candidate) => candidate.id === referralId);
    if (!record) throw new Error("The demo referral could not be found.");
    return record;
  };

  const replace = (next: ReferralWorkspaceRecord) => {
    records = records.map((record) => record.id === next.id ? next : record);
    return structuredClone(next);
  };

  const gateway: ExchangeRun3Gateway = {
    mode: "demo",
    async listConnections(query): Promise<ReferralWorkspaceSnapshot> {
      return {
        records: structuredClone(filterDemoConnections(records, query)),
        suggestions: structuredClone(EXCHANGE_DEMO_SUGGESTIONS),
        serviceOffers: structuredClone(EXCHANGE_DEMO_SERVICE_OFFERS),
        counts: countModes(records),
        generatedAt: Date.now(),
        truncated: false,
      };
    },
    async suggestRecipients(input) {
      const category = input.serviceCategory?.toLocaleLowerCase();
      return structuredClone(EXCHANGE_DEMO_SUGGESTIONS.filter((suggestion) => {
        if (category && !suggestion.matchedCapabilities.some((capability) => (
          capability.toLocaleLowerCase().includes(category)
          || category.includes(capability.toLocaleLowerCase())
        )) && !suggestion.serviceOffer?.serviceCategory.toLocaleLowerCase().includes(category)) return false;
        if (input.naicsCodes.length && !suggestion.serviceOffer?.naicsCodes.some((code) => input.naicsCodes.includes(code))) return false;
        if (input.territoryFips && !suggestion.serviceOffer?.territoryFips.includes(input.territoryFips)) return false;
        return true;
      }));
    },
    async getReferralDetail(referralId) {
      return structuredClone(find(referralId));
    },
    async createReferralDraft(input: CreateReferralDraftInput) {
      createdCount += 1;
      const now = Date.now();
      const offer = EXCHANGE_DEMO_SERVICE_OFFERS.find(
        (candidate) => candidate.id === input.serviceOfferId,
      );
      const id = `demo-created-${createdCount}`;
      const record: ReferralWorkspaceRecord = {
        id,
        direction: "sent",
        status: "draft",
        activeDispute: false,
        referralType: input.referralType,
        title: input.title,
        needSummary: input.needSummary,
        category: input.category || "Other",
        naicsCodes: input.naicsCodes,
        territoryFips: input.territoryFips,
        territoryLabel: input.territoryFips,
        referrerLabel: "Tidewater Manufacturing Alliance",
        recipientLabel: input.recipientLabel,
        actingOrganizationLabel: "Tidewater Manufacturing Alliance",
        createdAt: now,
        updatedAt: now,
        version: 0,
        consentStatus: input.consentStatus,
        contactDisclosure: input.referredParty
          ? input.consentStatus === "confirmed" ? "available" : "withheld"
          : "not_applicable",
        contactSummary: input.referredParty
          ? "Synthetic demo contact remains consent-controlled."
          : undefined,
        compensation: {
          type: input.compensationType,
          configured: input.compensationType !== "none",
          label: offer?.compensationLabel
            ?? (input.compensationType === "none" ? "No compensation" : "Custom demo terms"),
          currency: input.currency,
          settlementEnabled: false,
        },
        commerceStatus: "none",
        serviceOfferId: offer?.id,
        serviceOfferVersion: offer?.version,
        linkedEntities: [
          ...(input.relatedRfxId
            ? [{ type: "rfx" as const, id: input.relatedRfxId, label: "Linked RFx opportunity", available: true }]
            : []),
          ...(input.relatedTeamId
            ? [{ type: "team" as const, id: input.relatedTeamId, label: "Linked RFx team", available: true }]
            : []),
        ],
        timeline: [{
          id: `${id}-event-1`,
          type: "draft_created",
          label: "Draft created",
          actorLabel: "Demo member",
          createdAt: now,
        }],
        notes: [],
        evidenceCount: 0,
      };
      records = [record, ...records];
      return structuredClone(record);
    },
    async sendReferral(referralId, expectedVersion) {
      const current = find(referralId);
      if (current.version !== expectedVersion) throw new Error("The demo referral changed; reload and retry.");
      if (current.status !== "draft") throw new Error("Only a draft referral can be sent.");
      return replace({ ...appendEvent(current, "referral_sent", "Referral sent"), status: "sent" });
    },
    async respondReferral(referralId, response, expectedVersion, acceptTerms) {
      const current = find(referralId);
      if (current.version !== expectedVersion) throw new Error("The demo referral changed; reload and retry.");
      if (current.status !== "sent") throw new Error("Only a sent referral can receive a response.");
      if (response === "accepted" && acceptTerms?.acknowledged !== true) {
        throw new Error("The demo recipient must explicitly accept the locked terms.");
      }
      if (
        response === "accepted"
        && current.serviceOfferId
        && (
          acceptTerms?.serviceOfferId !== current.serviceOfferId
          || acceptTerms.serviceOfferVersion !== current.serviceOfferVersion
        )
      ) {
        throw new Error("The accepted demo offer version does not match this referral.");
      }
      const accepted = response === "accepted";
      const next = appendEvent(
        current,
        accepted ? "referral_accepted" : "referral_declined",
        accepted ? "Referral accepted" : "Referral declined",
      );
      return replace({
        ...next,
        status: accepted ? "accepted" : "declined",
        commerceStatus: accepted && current.compensation.configured
          ? "awaiting_transaction"
          : "none",
        termsSnapshot: accepted
          ? {
            compensationType: current.compensation.type,
              compensationLabel: current.compensation.label,
              serviceOfferId: current.serviceOfferId,
              serviceOfferVersion: current.serviceOfferVersion,
              currency: current.compensation.currency,
              attributionWindowDays: 90,
              platformFeeBasisPoints: 100,
              platformFeeConfigVersion: 1,
              acceptedByLabel: current.recipientLabel,
              acceptedAt: Date.now(),
              calculationVersion: 1,
            }
          : undefined,
      });
    },
    async progressReferral(referralId, status, expectedVersion) {
      const current = find(referralId);
      if (current.version !== expectedVersion) throw new Error("The demo referral changed; reload and retry.");
      const label = status === "in_progress"
        ? "Referral moved in progress"
        : status === "converted"
          ? "Referral converted"
          : status === "withdrawn"
            ? "Referral withdrawn"
            : "Referral closed";
      return replace({
        ...appendEvent(current, `referral_${status}`, label),
        status,
        commerceStatus: status === "converted" && current.compensation.configured
          ? "awaiting_transaction"
          : current.commerceStatus,
      });
    },
    async reportTransaction(
      referralId,
      expectedVersion,
      collectedTransactionCents,
      currency,
      serviceOfferId,
    ) {
      const current = find(referralId);
      if (current.version !== expectedVersion) throw new Error("The demo referral changed; reload and retry.");
      if (serviceOfferId && serviceOfferId !== current.termsSnapshot?.serviceOfferId) {
        throw new Error("The demo transaction offer does not match the accepted terms.");
      }
      const reportId = `demo-report-${referralId}`;
      reportedAmounts.set(referralId, collectedTransactionCents);
      return replace({
        ...appendEvent(current, "transaction_reported", "Transaction reported"),
        commerceStatus: "awaiting_confirmation",
        compensation: { ...current.compensation, currency },
        latestTransactionReportId: reportId,
        latestTransactionReportVersion: 0,
      });
    },
    async confirmTransaction(referralId, reportId, expectedReportVersion) {
      const current = find(referralId);
      if (current.latestTransactionReportId !== reportId || current.latestTransactionReportVersion !== expectedReportVersion) {
        throw new Error("The demo transaction report changed; reload and retry.");
      }
      const collected = reportedAmounts.get(referralId) ?? 1_000_000;
      const gross = current.compensation.type === "none"
        ? 0
        : current.compensation.type === "fixed"
          ? current.compensation.grossReferralPayoutCents ?? 50_000
          : current.compensation.type === "percentage"
            ? Math.floor(collected / 10)
            : 0;
      const calculation = calculateDemoReferralAmounts(gross, 100);
      const confirmed = appendEvent(current, "transaction_confirmed", "Transaction confirmed");
      return replace({
        ...appendEvent(confirmed, "calculation_completed", "Compensation calculated"),
        commerceStatus: "settlement_unavailable",
        latestTransactionReportVersion: expectedReportVersion + 1,
        compensation: {
          ...current.compensation,
          ...calculation,
          settlementEnabled: false,
        },
      });
    },
    async getIntelligence() {
      return structuredClone(EXCHANGE_DEMO_INTELLIGENCE);
    },
  };

  return gateway;
}

let demoGateway: ExchangeRun3Gateway | undefined;

export function getExchangeDemoGateway(): ExchangeRun3Gateway {
  demoGateway ??= createExchangeDemoGateway();
  return demoGateway;
}

export const exchangeDemoOpportunityRepository = {
  async loadSnapshot(): Promise<ExchangeRepositorySnapshot> {
    return {
      rfx: structuredClone(EXCHANGE_DEMO_RFX),
      releasedTerritories: structuredClone(
        EXCHANGE_DEMO_TERRITORIES.filter((territory) => territory.status === "released"),
      ),
      scheduledTerritories: structuredClone(
        EXCHANGE_DEMO_TERRITORIES.filter((territory) => territory.status === "scheduled"),
      ),
      unreleasedTerritories: structuredClone(
        EXCHANGE_DEMO_TERRITORIES.filter((territory) => territory.status === "paused" || territory.status === "archived"),
      ),
      manageableRfxIds: ["demo-rfx-water"],
    };
  },
  async loadViewportRfx() {
    return structuredClone(EXCHANGE_DEMO_RFX);
  },
};
